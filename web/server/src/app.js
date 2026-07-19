import cors from "cors";
import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { db, dbHost, dbMode } from "./db.js";
import { hashPassword, requireAuth, signToken, verifyPassword } from "./auth.js";
import { pushToUser } from "./ws.js";

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

    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [username],
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That username is taken." });
    }

    const user = { id: crypto.randomUUID(), username };
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
      args: [user.id, username, await hashPassword(password), Date.now()],
    });

    res.json({ token: signToken(user), user: { id: user.id, username } });
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
      sql: "SELECT id, username, password_hash FROM users WHERE username = ?",
      args: [username],
    });
    const row = result.rows[0];
    const ok = row && (await verifyPassword(password, String(row.password_hash)));
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const user = { id: String(row.id), username: String(row.username) };
    res.json({ token: signToken(user), user });
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
    res.json({
      messages: rows.reverse().map((r) => ({
        id: String(r.id), channelId: String(r.channel_id),
        senderId: String(r.sender_id), senderUsername: String(r.sender_username),
        content: String(r.content), sentAt: Number(r.sent_at),
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
    const msg = { id, channelId, senderId: req.userId, senderUsername: req.username, content, sentAt };
    // Push real-time event to all channel participants
    const { rows: dmParts } = await db.execute({
      sql: "SELECT user_id FROM channel_participants WHERE channel_id = ?", args: [channelId],
    });
    const { rows: gParts } = await db.execute({
      sql: `SELECT gm.user_id FROM channels c JOIN group_members gm ON gm.group_id = c.group_id
            WHERE c.id = ?`, args: [channelId],
    });
    const recipients = new Set([...dmParts, ...gParts].map((r) => String(r.user_id)));
    for (const uid of recipients) pushToUser(uid, "message:new", msg);
    res.json(msg);
  } catch (err) {
    console.error("[messages:post]", err);
    res.status(500).json({ error: "Unable to send message." });
  }
});

