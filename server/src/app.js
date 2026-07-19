import cors from "cors";
import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { db, dbHost, dbMode } from "./db.js";
import { hashPassword, requireAuth, signToken, verifyPassword } from "./auth.js";
import { pushToUser, broadcastToChannel } from "./ws.js";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Unauthenticated on purpose — reports only config presence/storage mode, never secrets — so
// deployment misconfiguration (silently falling back to a non-persistent local file, or a
// different Turso database than expected) is directly checkable.
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    dbMode,
    dbHost,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
});

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");
    const birthDate = String(req.body?.birthDate ?? "").trim();

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-32 characters: letters, numbers, dots, dashes.",
      });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
    }
    if (!birthDate) {
      return res.status(400).json({ error: "Date of birth is required." });
    }
    const dob = new Date(birthDate);
    if (isNaN(dob.getTime())) {
      return res.status(400).json({ error: "Invalid date of birth." });
    }
    const ageMs = Date.now() - dob.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) {
      return res.status(400).json({ error: "You must be 18 or older to create an account." });
    }

    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [username],
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That username is taken." });
    }

    const user = { id: crypto.randomUUID(), username };
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash, birth_date, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [user.id, username, await hashPassword(password), birthDate, Date.now()],
    });

    res.json({ token: signToken(user), user: { id: user.id, username, avatar: "default" } });
  } catch (err) {
    console.error("[register]", err);
    res.status(500).json({ error: "Unable to register right now." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");

    const result = await db.execute({
      sql: "SELECT id, username, password_hash, avatar FROM users WHERE username = ?",
      args: [username],
    });
    const row = result.rows[0];
    const ok = row && (await verifyPassword(password, String(row.password_hash)));
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const user = { id: String(row.id), username: String(row.username) };
    res.json({ token: signToken(user), user: { ...user, avatar: String(row.avatar ?? "default") } });
  } catch (err) {
    console.error("[login]", err);
    res.status(500).json({ error: "Unable to log in right now." });
  }
});

app.get("/api/state", requireAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT data, updated_at FROM plan_states WHERE user_id = ?",
      args: [req.userId],
    });
    const row = result.rows[0];
    if (!row) return res.json({ data: null, updatedAt: 0 });
    res.json({ data: JSON.parse(String(row.data)), updatedAt: Number(row.updated_at) });
  } catch (err) {
    console.error("[state:get]", err);
    res.status(500).json({ error: "Unable to load your plan state." });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  try {
    const { data, updatedAt } = req.body ?? {};
    if (!data || typeof updatedAt !== "number") {
      return res.status(400).json({ error: "data and updatedAt are required." });
    }
    const serialized = JSON.stringify(data);
    if (serialized.length > 500_000) {
      return res.status(413).json({ error: "State payload too large." });
    }

    // Last-write-wins by client timestamp: an older client must not clobber newer state
    // written from another device. The current row is returned so that client can adopt it.
    const existing = await db.execute({
      sql: "SELECT updated_at FROM plan_states WHERE user_id = ?",
      args: [req.userId],
    });
    const currentUpdatedAt = existing.rows[0] ? Number(existing.rows[0].updated_at) : 0;
    if (updatedAt < currentUpdatedAt) {
      const current = await db.execute({
        sql: "SELECT data, updated_at FROM plan_states WHERE user_id = ?",
        args: [req.userId],
      });
      return res.status(409).json({
        error: "A newer state exists.",
        data: JSON.parse(String(current.rows[0].data)),
        updatedAt: currentUpdatedAt,
      });
    }

    await db.execute({
      sql: `INSERT INTO plan_states (user_id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      args: [req.userId, serialized, updatedAt],
    });
    res.json({ ok: true, updatedAt });
  } catch (err) {
    console.error("[state:put]", err);
    res.status(500).json({ error: "Unable to save your plan state." });
  }
});

// ─── User public keys (for E2E encryption) ───────────────────────────────────

app.post("/api/keys", requireAuth, async (req, res) => {
  try {
    const { publicKeyJwk } = req.body ?? {};
    if (typeof publicKeyJwk !== "string") return res.status(400).json({ error: "publicKeyJwk required" });
    await db.execute({
      sql: `INSERT INTO user_keys (user_id, public_key_jwk, created_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET public_key_jwk = excluded.public_key_jwk, created_at = excluded.created_at`,
      args: [req.userId, publicKeyJwk, Date.now()],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[keys:post]", err);
    res.status(500).json({ error: "Unable to save key." });
  }
});

app.get("/api/keys/:userId", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT public_key_jwk FROM user_keys WHERE user_id = ?",
      args: [req.params.userId],
    });
    if (!rows[0]) return res.status(404).json({ error: "No key found for that user." });
    res.json({ publicKeyJwk: String(rows[0].public_key_jwk) });
  } catch (err) {
    res.status(500).json({ error: "Unable to fetch key." });
  }
});

// ─── User search (for starting DMs) ─────────────────────────────────────────

app.get("/api/users/search", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 40);
    if (!q) return res.json({ users: [] });
    const { rows } = await db.execute({
      sql: "SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10",
      args: [`${q}%`, req.userId],
    });
    res.json({ users: rows.map((r) => ({ id: String(r.id), username: String(r.username) })) });
  } catch (err) {
    res.status(500).json({ error: "Search failed." });
  }
});

// ─── Groups ──────────────────────────────────────────────────────────────────

function randomCode(len = 8) {
  return crypto.randomBytes(len).toString("base64url").slice(0, len).toUpperCase();
}

app.post("/api/groups", requireAuth, async (req, res) => {
  try {
    const { name, description = "", planStartDate, planStartDay = 1 } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
    const id = crypto.randomUUID();
    const code = randomCode(8);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO groups_data (id, name, description, created_by, plan_start_date, plan_start_day, invite_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, name.slice(0, 80), description.slice(0, 300), req.userId, planStartDate ?? null, planStartDay, code, now],
    });
    await db.execute({
      sql: "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)",
      args: [id, req.userId, now],
    });
    // Create the group's main channel
    const channelId = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO channels (id, type, group_id, created_at) VALUES (?, 'group', ?, ?)",
      args: [channelId, id, now],
    });
    res.json({ id, name, inviteCode: code, channelId });
  } catch (err) {
    console.error("[groups:post]", err);
    res.status(500).json({ error: "Unable to create group." });
  }
});

app.get("/api/groups", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: `SELECT g.id, g.name, g.description, g.plan_start_date, g.plan_start_day,
                   g.invite_code, gm.role,
                   (SELECT id FROM channels WHERE group_id = g.id LIMIT 1) as channel_id
            FROM groups_data g
            JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
            ORDER BY g.created_at DESC`,
      args: [req.userId],
    });
    res.json({ groups: rows.map((r) => ({
      id: String(r.id), name: String(r.name), description: String(r.description),
      planStartDate: r.plan_start_date ? String(r.plan_start_date) : null,
      planStartDay: Number(r.plan_start_day), inviteCode: String(r.invite_code),
      role: String(r.role), channelId: r.channel_id ? String(r.channel_id) : null,
    })) });
  } catch (err) {
    res.status(500).json({ error: "Unable to load groups." });
  }
});

app.get("/api/groups/invite/:code", async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT id, name, description FROM groups_data WHERE invite_code = ?",
      args: [req.params.code.toUpperCase()],
    });
    if (!rows[0]) return res.status(404).json({ error: "Invalid invite code." });
    res.json({ id: String(rows[0].id), name: String(rows[0].name), description: String(rows[0].description) });
  } catch (err) {
    res.status(500).json({ error: "Unable to look up invite." });
  }
});

app.post("/api/groups/join/:code", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT id FROM groups_data WHERE invite_code = ?",
      args: [req.params.code.toUpperCase()],
    });
    if (!rows[0]) return res.status(404).json({ error: "Invalid invite code." });
    const groupId = String(rows[0].id);
    const existing = await db.execute({
      sql: "SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [groupId, req.userId],
    });
    if (existing.rows.length > 0) return res.json({ groupId, alreadyMember: true });
    await db.execute({
      sql: "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      args: [groupId, req.userId, Date.now()],
    });
    // Notify group members
    const { rows: members } = await db.execute({
      sql: "SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?",
      args: [groupId, req.userId],
    });
    for (const m of members) pushToUser(String(m.user_id), "group:member_joined", { groupId, userId: req.userId, username: req.username });
    res.json({ groupId, alreadyMember: false });
  } catch (err) {
    console.error("[groups:join]", err);
    res.status(500).json({ error: "Unable to join group." });
  }
});

app.get("/api/groups/:id", requireAuth, async (req, res) => {
  try {
    const gid = req.params.id;
    const membership = await db.execute({
      sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [gid, req.userId],
    });
    if (!membership.rows[0]) return res.status(403).json({ error: "Not a member." });
    const { rows: gRows } = await db.execute({
      sql: "SELECT * FROM groups_data WHERE id = ?", args: [gid],
    });
    if (!gRows[0]) return res.status(404).json({ error: "Group not found." });
    const { rows: members } = await db.execute({
      sql: `SELECT gm.user_id, u.username, gm.role FROM group_members gm
            JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?`,
      args: [gid],
    });
    const channelRow = await db.execute({
      sql: "SELECT id FROM channels WHERE group_id = ? LIMIT 1", args: [gid],
    });
    const g = gRows[0];
    res.json({
      id: String(g.id), name: String(g.name), description: String(g.description),
      planStartDate: g.plan_start_date ? String(g.plan_start_date) : null,
      planStartDay: Number(g.plan_start_day), inviteCode: String(g.invite_code),
      role: String(membership.rows[0].role),
      channelId: channelRow.rows[0] ? String(channelRow.rows[0].id) : null,
      members: members.map((m) => ({ id: String(m.user_id), username: String(m.username), role: String(m.role) })),
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to load group." });
  }
});

app.put("/api/groups/:id", requireAuth, async (req, res) => {
  try {
    const gid = req.params.id;
    const role = await db.execute({
      sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [gid, req.userId],
    });
    if (String(role.rows[0]?.role) !== "admin") return res.status(403).json({ error: "Admin only." });
    const { name, description, planStartDate, planStartDay } = req.body ?? {};
    await db.execute({
      sql: `UPDATE groups_data SET name = COALESCE(?, name), description = COALESCE(?, description),
            plan_start_date = COALESCE(?, plan_start_date), plan_start_day = COALESCE(?, plan_start_day)
            WHERE id = ?`,
      args: [name ?? null, description ?? null, planStartDate ?? null, planStartDay ?? null, gid],
    });
    // Notify members of plan update
    const { rows: members } = await db.execute({
      sql: "SELECT user_id FROM group_members WHERE group_id = ?", args: [gid],
    });
    for (const m of members) pushToUser(String(m.user_id), "group:updated", { groupId: gid });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to update group." });
  }
});

// Upload encrypted group key for a specific member (called by admin when adding a member)
app.post("/api/groups/:id/keys", requireAuth, async (req, res) => {
  try {
    const { targetUserId, encryptedKey } = req.body ?? {};
    if (!targetUserId || !encryptedKey) return res.status(400).json({ error: "targetUserId and encryptedKey required." });
    const role = await db.execute({
      sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    if (!role.rows[0]) return res.status(403).json({ error: "Not a member." });
    await db.execute({
      sql: "UPDATE group_members SET encrypted_key = ? WHERE group_id = ? AND user_id = ?",
      args: [encryptedKey, req.params.id, targetUserId],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to set key." });
  }
});

app.get("/api/groups/:id/my-key", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT encrypted_key FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    if (!rows[0]) return res.status(403).json({ error: "Not a member." });
    res.json({ encryptedKey: rows[0].encrypted_key ? String(rows[0].encrypted_key) : null });
  } catch (err) {
    res.status(500).json({ error: "Unable to fetch key." });
  }
});

// ─── DM Channels ─────────────────────────────────────────────────────────────

app.post("/api/channels/dm", requireAuth, async (req, res) => {
  try {
    const { otherUserId } = req.body ?? {};
    if (!otherUserId) return res.status(400).json({ error: "otherUserId required." });
    // Check if DM channel already exists between these two users
    const { rows } = await db.execute({
      sql: `SELECT c.id FROM channels c
            JOIN channel_participants cp1 ON cp1.channel_id = c.id AND cp1.user_id = ?
            JOIN channel_participants cp2 ON cp2.channel_id = c.id AND cp2.user_id = ?
            WHERE c.type = 'dm' LIMIT 1`,
      args: [req.userId, otherUserId],
    });
    if (rows[0]) return res.json({ channelId: String(rows[0].id), created: false });
    const channelId = crypto.randomUUID();
    const now = Date.now();
    await db.execute({ sql: "INSERT INTO channels (id, type, created_at) VALUES (?, 'dm', ?)", args: [channelId, now] });
    await db.execute({ sql: "INSERT INTO channel_participants (channel_id, user_id) VALUES (?, ?)", args: [channelId, req.userId] });
    await db.execute({ sql: "INSERT INTO channel_participants (channel_id, user_id) VALUES (?, ?)", args: [channelId, otherUserId] });
    res.json({ channelId, created: true });
  } catch (err) {
    console.error("[dm:create]", err);
    res.status(500).json({ error: "Unable to create DM." });
  }
});

app.get("/api/channels", requireAuth, async (req, res) => {
  try {
    // Get DM channels
    const { rows: dmChannels } = await db.execute({
      sql: `SELECT c.id, c.type, c.created_at,
                   u.id as other_user_id, u.username as other_username,
                   (SELECT content FROM messages WHERE channel_id = c.id ORDER BY sent_at DESC LIMIT 1) as last_message,
                   (SELECT sent_at FROM messages WHERE channel_id = c.id ORDER BY sent_at DESC LIMIT 1) as last_at
            FROM channels c
            JOIN channel_participants cp ON cp.channel_id = c.id AND cp.user_id = ?
            JOIN channel_participants cp2 ON cp2.channel_id = c.id AND cp2.user_id != ?
            JOIN users u ON u.id = cp2.user_id
            WHERE c.type = 'dm'
            ORDER BY last_at DESC NULLS LAST`,
      args: [req.userId, req.userId],
    });
    res.json({
      dms: dmChannels.map((r) => ({
        channelId: String(r.id), type: "dm",
        otherUser: { id: String(r.other_user_id), username: String(r.other_username) },
        lastMessageAt: r.last_at ? Number(r.last_at) : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to load channels." });
  }
});

// Set encrypted channel key for a participant
app.post("/api/channels/:id/keys", requireAuth, async (req, res) => {
  try {
    const { targetUserId, encryptedKey } = req.body ?? {};
    if (!targetUserId || !encryptedKey) return res.status(400).json({ error: "targetUserId and encryptedKey required." });
    await db.execute({
      sql: "UPDATE channel_participants SET encrypted_key = ? WHERE channel_id = ? AND user_id = ?",
      args: [encryptedKey, req.params.id, targetUserId],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to set key." });
  }
});

app.get("/api/channels/:id/my-key", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT encrypted_key FROM channel_participants WHERE channel_id = ? AND user_id = ?",
      args: [req.params.id, req.userId],
    });
    if (!rows[0]) return res.status(403).json({ error: "Not a participant." });
    res.json({ encryptedKey: rows[0].encrypted_key ? String(rows[0].encrypted_key) : null });
  } catch (err) {
    res.status(500).json({ error: "Unable to fetch key." });
  }
});

// ─── Messages ────────────────────────────────────────────────────────────────

/** Check that the requesting user can access the given channel. */
async function canAccessChannel(userId, channelId) {
  // Check DM participation
  const { rows: dmRows } = await db.execute({
    sql: "SELECT 1 FROM channel_participants WHERE channel_id = ? AND user_id = ?",
    args: [channelId, userId],
  });
  if (dmRows.length > 0) return true;
  // Check group membership
  const { rows: gRows } = await db.execute({
    sql: `SELECT 1 FROM channels c JOIN group_members gm ON gm.group_id = c.group_id
          WHERE c.id = ? AND gm.user_id = ?`,
    args: [channelId, userId],
  });
  return gRows.length > 0;
}

app.get("/api/channels/:id/messages", requireAuth, async (req, res) => {
  try {
    if (!(await canAccessChannel(req.userId, req.params.id))) {
      return res.status(403).json({ error: "Forbidden." });
    }
    const before = req.query.before ? Number(req.query.before) : Date.now() + 1000;
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const { rows } = await db.execute({
      sql: `SELECT m.id, m.channel_id, m.sender_id, u.username as sender_username,
                   m.content, m.sent_at
            FROM messages m JOIN users u ON u.id = m.sender_id
            WHERE m.channel_id = ? AND m.sent_at < ?
            ORDER BY m.sent_at DESC LIMIT ?`,
      args: [req.params.id, before, limit],
    });
    // Fetch reactions for these messages in one query
    const msgIds = rows.map((r) => String(r.id));
    let reactionsMap = {};
    if (msgIds.length > 0) {
      const placeholders = msgIds.map(() => "?").join(",");
      const { rows: rRows } = await db.execute({
        sql: `SELECT r.message_id, r.emoji, r.user_id, u2.username
              FROM reactions r JOIN users u2 ON u2.id = r.user_id
              WHERE r.message_id IN (${placeholders})`,
        args: msgIds,
      });
      for (const r of rRows) {
        const mid = String(r.message_id);
        if (!reactionsMap[mid]) reactionsMap[mid] = [];
        reactionsMap[mid].push({ emoji: String(r.emoji), userId: String(r.user_id), username: String(r.username) });
      }
    }
    res.json({
      messages: rows.reverse().map((r) => ({
        id: String(r.id), channelId: String(r.channel_id),
        senderId: String(r.sender_id), senderUsername: String(r.sender_username),
        content: String(r.content), sentAt: Number(r.sent_at),
        reactions: reactionsMap[String(r.id)] ?? [],
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to load messages." });
  }
});

app.post("/api/channels/:id/messages", requireAuth, async (req, res) => {
  try {
    const channelId = req.params.id;
    if (!(await canAccessChannel(req.userId, channelId))) {
      return res.status(403).json({ error: "Forbidden." });
    }
    const { content } = req.body ?? {};
    if (!content || typeof content !== "string") return res.status(400).json({ error: "content required." });
    const id = crypto.randomUUID();
    const sentAt = Date.now();
    await db.execute({
      sql: "INSERT INTO messages (id, channel_id, sender_id, content, sent_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, channelId, req.userId, content, sentAt],
    });
    const msg = { id, channelId, senderId: req.userId, senderUsername: req.username, content, sentAt, reactions: [] };
    // Push real-time + create notifications for all participants
    const { rows: dmParts } = await db.execute({
      sql: "SELECT user_id FROM channel_participants WHERE channel_id = ?", args: [channelId],
    });
    const { rows: gParts } = await db.execute({
      sql: `SELECT gm.user_id FROM channels c JOIN group_members gm ON gm.group_id = c.group_id
            WHERE c.id = ?`, args: [channelId],
    });
    // Resolve channel title (thread name, group name, or null for DMs)
    const { rows: chRows } = await db.execute({
      sql: `SELECT c.type, COALESCE(t.name, g.name) AS title
            FROM channels c
            LEFT JOIN threads t ON t.channel_id = c.id
            LEFT JOIN groups g ON g.id = c.group_id
            WHERE c.id = ?`,
      args: [channelId],
    });
    const channelTitle = chRows[0] && chRows[0].title ? String(chRows[0].title) : null;
    const isGroup = chRows[0] ? String(chRows[0].type) !== "dm" : false;
    const recipients = new Set([...dmParts, ...gParts].map((r) => String(r.user_id)));
    for (const uid of recipients) {
      pushToUser(uid, "message:new", msg);
      if (uid !== req.userId) {
        const nid = crypto.randomUUID();
        await db.execute({
          sql: "INSERT INTO notifications (id, user_id, type, channel_id, data, created_at) VALUES (?, ?, 'message', ?, ?, ?)",
          args: [nid, uid, channelId, JSON.stringify({ fromUsername: req.username, preview: content.slice(0, 80), channelTitle, isGroup }), sentAt],
        }).catch(() => {});
        pushToUser(uid, "notification:new", { type: "message", channelId, fromUsername: req.username, channelTitle, isGroup });
      }
    }
    res.json(msg);
  } catch (err) {
    console.error("[messages:post]", err);
    res.status(500).json({ error: "Unable to send message." });
  }
});

// ─── Reactions ────────────────────────────────────────────────────────────────

app.post("/api/messages/:id/reactions", requireAuth, async (req, res) => {
  try {
    const { emoji } = req.body ?? {};
    if (!emoji || typeof emoji !== "string") return res.status(400).json({ error: "emoji required" });
    const msgId = req.params.id;
    const { rows: msgRows } = await db.execute({
      sql: "SELECT channel_id, sender_id FROM messages WHERE id = ?",
      args: [msgId],
    });
    if (!msgRows[0]) return res.status(404).json({ error: "Message not found." });
    const channelId = String(msgRows[0].channel_id);
    if (!(await canAccessChannel(req.userId, channelId))) return res.status(403).json({ error: "Forbidden." });

    const existing = await db.execute({
      sql: "SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
      args: [msgId, req.userId, emoji],
    });
    if (existing.rows.length > 0) {
      await db.execute({ sql: "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", args: [msgId, req.userId, emoji] });
    } else {
      await db.execute({ sql: "INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)", args: [msgId, req.userId, emoji, Date.now()] });
      const authorId = String(msgRows[0].sender_id);
      if (authorId !== req.userId) {
        const nid = crypto.randomUUID();
        await db.execute({
          sql: "INSERT INTO notifications (id, user_id, type, channel_id, data, created_at) VALUES (?, ?, 'reaction', ?, ?, ?)",
          args: [nid, authorId, channelId, JSON.stringify({ messageId: msgId, emoji, fromUsername: req.username }), Date.now()],
        }).catch(() => {});
        pushToUser(authorId, "notification:new", { type: "reaction", emoji, fromUsername: req.username });
      }
    }
    const { rows: rRows } = await db.execute({
      sql: "SELECT r.emoji, r.user_id, u.username FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ? ORDER BY r.created_at",
      args: [msgId],
    });
    const reactions = rRows.map((r) => ({ emoji: String(r.emoji), userId: String(r.user_id), username: String(r.username) }));
    await broadcastToChannel(channelId, "message:reaction", { messageId: msgId, reactions }, null);
    res.json({ reactions });
  } catch (err) {
    console.error("[reactions]", err);
    res.status(500).json({ error: "Unable to toggle reaction." });
  }
});

// ─── Threads ──────────────────────────────────────────────────────────────────

app.get("/api/groups/:id/threads", requireAuth, async (req, res) => {
  try {
    const { rows: mem } = await db.execute({ sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", args: [req.params.id, req.userId] });
    if (!mem[0]) return res.status(403).json({ error: "Not a member." });
    const { rows } = await db.execute({
      sql: `SELECT t.id, t.name, t.emoji, t.channel_id, t.created_by, t.created_at,
                   (SELECT sent_at FROM messages WHERE channel_id = t.channel_id ORDER BY sent_at DESC LIMIT 1) as last_at
            FROM threads t WHERE t.group_id = ? ORDER BY t.created_at`,
      args: [req.params.id],
    });
    res.json({ threads: rows.map((r) => ({ id: String(r.id), name: String(r.name), emoji: String(r.emoji), channelId: String(r.channel_id), createdBy: String(r.created_by), createdAt: Number(r.created_at), lastMessageAt: r.last_at ? Number(r.last_at) : null })) });
  } catch (err) { res.status(500).json({ error: "Unable to load threads." }); }
});

app.post("/api/groups/:id/threads", requireAuth, async (req, res) => {
  try {
    const gid = req.params.id;
    const { rows: mem } = await db.execute({ sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", args: [gid, req.userId] });
    if (!mem[0]) return res.status(403).json({ error: "Not a member." });
    const { name, emoji = "💬" } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
    const threadId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const now = Date.now();
    await db.execute({ sql: "INSERT INTO channels (id, type, group_id, created_at) VALUES (?, 'thread', ?, ?)", args: [channelId, gid, now] });
    await db.execute({ sql: "INSERT INTO threads (id, group_id, channel_id, name, emoji, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [threadId, gid, channelId, name.slice(0, 80), emoji, req.userId, now] });
    const { rows: members } = await db.execute({ sql: "SELECT user_id FROM group_members WHERE group_id = ?", args: [gid] });
    for (const m of members) pushToUser(String(m.user_id), "thread:new", { groupId: gid, threadId, name, emoji, channelId });
    res.json({ id: threadId, channelId });
  } catch (err) { console.error("[threads:post]", err); res.status(500).json({ error: "Unable to create thread." }); }
});

app.put("/api/threads/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT t.group_id FROM threads t JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = ? WHERE t.id = ?",
      args: [req.userId, req.params.id],
    });
    if (!rows[0]) return res.status(403).json({ error: "Not a member or thread not found." });
    const { name, emoji } = req.body ?? {};
    await db.execute({ sql: "UPDATE threads SET name = COALESCE(?, name), emoji = COALESCE(?, emoji) WHERE id = ?", args: [name ?? null, emoji ?? null, req.params.id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Unable to update thread." }); }
});

// ─── Notifications ────────────────────────────────────────────────────────────

app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT id, type, channel_id, data, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      args: [req.userId],
    });
    const notifications = rows.map((r) => ({ id: String(r.id), type: String(r.type), channelId: r.channel_id ? String(r.channel_id) : null, data: JSON.parse(String(r.data)), read: Boolean(r.read), createdAt: Number(r.created_at) }));
    res.json({ notifications, unreadCount: notifications.filter((n) => !n.read).length });
  } catch (err) { res.status(500).json({ error: "Unable to load notifications." }); }
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await db.execute({ sql: "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", args: [req.userId] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Unable to mark read." }); }
});

// ─── User Profile ─────────────────────────────────────────────────────────────

const VALID_AVATARS = [
  "default", "menorah", "star", "fish", "olive",
  "shofar", "dove", "scroll", "pomegranate", "grapes",
  "lamb", "candles", "water", "aleph",
];

app.get("/api/users/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.execute({
      sql: "SELECT id, username, avatar FROM users WHERE id = ?",
      args: [req.userId],
    });
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    const r = rows[0];
    res.json({ id: String(r.id), username: String(r.username), avatar: String(r.avatar ?? "default") });
  } catch (err) { res.status(500).json({ error: "Unable to load profile." }); }
});

app.put("/api/users/me", requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body ?? {};
    if (avatar !== undefined && !VALID_AVATARS.includes(String(avatar))) {
      return res.status(400).json({ error: "Invalid avatar choice." });
    }
    await db.execute({
      sql: "UPDATE users SET avatar = COALESCE(?, avatar) WHERE id = ?",
      args: [avatar ?? null, req.userId],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Unable to update profile." }); }
});

// ─── Report Messages ──────────────────────────────────────────────────────────

app.post("/api/messages/:id/report", requireAuth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const reason = String(req.body?.reason ?? "").slice(0, 500);

    const { rows: msgRows } = await db.execute({
      sql: "SELECT sender_id, channel_id FROM messages WHERE id = ?",
      args: [msgId],
    });
    if (!msgRows[0]) return res.status(404).json({ error: "Message not found." });
    const { sender_id, channel_id } = msgRows[0];
    if (!(await canAccessChannel(req.userId, String(channel_id)))) {
      return res.status(403).json({ error: "Forbidden." });
    }
    if (String(sender_id) === req.userId) {
      return res.status(400).json({ error: "Cannot report your own message." });
    }

    // Find target admin: group admin for group/thread channels, app admin for DMs
    let targetAdminId = null;
    const { rows: chanRows } = await db.execute({
      sql: "SELECT type, group_id FROM channels WHERE id = ?",
      args: [String(channel_id)],
    });
    const chan = chanRows[0];
    if (chan && (String(chan.type) === "group" || String(chan.type) === "thread")) {
      const { rows: adminRows } = await db.execute({
        sql: "SELECT user_id FROM group_members WHERE group_id = ? AND role = 'admin' LIMIT 1",
        args: [chan.group_id],
      });
      targetAdminId = adminRows[0]?.user_id ? String(adminRows[0].user_id) : null;
    } else {
      const { rows: appAdminRows } = await db.execute({
        sql: "SELECT id FROM users WHERE is_admin = 1 LIMIT 1",
        args: [],
      });
      targetAdminId = appAdminRows[0]?.id ? String(appAdminRows[0].id) : null;
    }

    await db.execute({
      sql: `INSERT INTO reports (id, reporter_id, message_id, channel_id, reported_user_id, target_admin_id, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), req.userId, msgId, String(channel_id), String(sender_id), targetAdminId, reason, Date.now()],
    });

    // Notify the target admin via WS if available
    if (targetAdminId) {
      pushToUser(targetAdminId, "report:new", { messageId: msgId, reason, reporterUsername: req.username });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[report]", err);
    res.status(500).json({ error: "Unable to submit report." });
  }
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

app.get("/api/admin/reports", requireAuth, async (req, res) => {
  try {
    const { rows: adminCheck } = await db.execute({
      sql: "SELECT is_admin FROM users WHERE id = ?", args: [req.userId],
    });
    if (!adminCheck[0]?.is_admin) return res.status(403).json({ error: "Forbidden." });

    const { rows } = await db.execute({
      sql: `SELECT r.id, r.status, r.reason, r.created_at,
                   r.message_id, r.channel_id,
                   u1.username as reporter_username,
                   u2.username as reported_username,
                   m.content as message_content
            FROM reports r
            JOIN users u1 ON r.reporter_id = u1.id
            JOIN users u2 ON r.reported_user_id = u2.id
            JOIN messages m ON r.message_id = m.id
            ORDER BY r.created_at DESC LIMIT 100`,
      args: [],
    });
    res.json({ reports: rows });
  } catch (err) { res.status(500).json({ error: "Unable to load reports." }); }
});

/** One-time endpoint to grant admin — protected by a secret in env vars. */
app.post("/api/admin/grant", async (req, res) => {
  try {
    const { username, secret } = req.body ?? {};
    const adminSecret = process.env.ADMIN_SETUP_SECRET;
    if (!adminSecret || String(secret) !== adminSecret) {
      return res.status(403).json({ error: "Forbidden." });
    }
    const { rows } = await db.execute({ sql: "SELECT id FROM users WHERE username = ?", args: [String(username)] });
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    await db.execute({ sql: "UPDATE users SET is_admin = 1 WHERE username = ?", args: [String(username)] });
    res.json({ ok: true, message: `${username} is now an admin.` });
  } catch (err) { res.status(500).json({ error: "Unable to grant admin." }); }
});

