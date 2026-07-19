import { useEffect, useState, useCallback } from "react";
import type { Group, GroupMember, DmChannel, Thread, AppNotification } from "../types";
import {
  listGroups, getGroup, createGroup, joinGroup, lookupInviteCode,
  updateGroup, searchUsers, getOrCreateDM, listDMs,
  uploadPublicKey as _uploadPublicKey, fetchPublicKey,
  uploadChannelKey, uploadGroupKey,
  listThreads, createThread,
  listNotifications, markNotificationsRead,
} from "../lib/api";
import {
  getOrCreateKeyPair, exportPublicKey, generateChannelKey,
  encryptChannelKey, importPublicKey, cacheChannelKey,
} from "../lib/encryption";
import { realtime } from "../lib/realtime";
import { useAppState } from "../state/AppState";
import {
  UsersIcon, PersonAddIcon, MessageCircleIcon,
  ChevronRightIcon, CopyIcon, BellIcon, PencilIcon,
} from "./icons";
import ChatView from "./ChatView";

// ─── Types ────────────────────────────────────────────────────────────────────

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "join" }
  | { kind: "detail"; groupId: string }
  | { kind: "chat"; channelId: string; title: string; isGroup?: boolean; groupId?: string }
  | { kind: "dm_list" }
  | { kind: "dm_new" };

// ─── GroupsScreen ─────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const { user } = useAppState();
  const [view, setView] = useState<View>({ kind: "list" });
  const [groups, setGroups] = useState<Group[]>([]);
  const [dms, setDms] = useState<DmChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [gRes, dRes] = await Promise.all([listGroups(), listDMs()]);
      setGroups(gRes.groups);
      setDms(dRes.dms);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user]);

  const reloadNotifs = useCallback(async () => {
    if (!user) return;
    try { setNotifications((await listNotifications()).notifications); } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void reloadNotifs(); }, [reloadNotifs]);

  // WS: new notification
  useEffect(() => {
    const unsub = realtime.on("notification:new", () => { void reloadNotifs(); });
    return unsub;
  }, [reloadNotifs]);

  // WS: new thread
  useEffect(() => {
    const unsub = realtime.on("thread:new", () => { void reload(); });
    return unsub;
  }, [reload]);

  if (!user) return (
    <div className="groups-empty">
      <p>Sign in to access the community features.</p>
    </div>
  );

  // Sub-view routing
  if (view.kind === "chat") {
    return (
      <ChatView
        channelId={view.channelId}
        title={view.title}
        isGroup={view.isGroup}
        groupId={view.groupId}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "create") {
    return <CreateGroupView onBack={() => setView({ kind: "list" })} onCreate={reload} />;
  }
  if (view.kind === "join") {
    return <JoinGroupView onBack={() => setView({ kind: "list" })} onJoin={reload} />;
  }
  if (view.kind === "detail") {
    return (
      <GroupDetailView
        groupId={view.groupId}
        onBack={() => setView({ kind: "list" })}
        onChat={(channelId, title, isGroup, chatGroupId) => setView({ kind: "chat", channelId, title, isGroup, groupId: chatGroupId })}
        onChanged={reload}
      />
    );
  }
  if (view.kind === "dm_new") {
    return (
      <NewDMView
        onBack={() => setView({ kind: "list" })}
        onOpen={(channelId, username) => setView({ kind: "chat", channelId, title: `@${username}` })}
      />
    );
  }

  // Main list view
  return (
    <div className="groups-screen">
      <div className="groups-header">
        <h2 className="groups-title">Community</h2>
        <div className="groups-header-actions">
          {/* Notifications bell */}
          <div className="notif-bell-wrap">
            <button
              className="groups-icon-btn"
              title="Notifications"
              onClick={async () => {
                setShowNotifs((v) => !v);
                if (!showNotifs && unreadCount > 0) {
                  await markNotificationsRead().catch(() => {});
                  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                }
              }}
            >
              <BellIcon />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {showNotifs && (
              <div className="notif-panel">
                <div className="notif-panel-header">
                  <span>Notifications</span>
                  <button className="link-btn small" onClick={() => setShowNotifs(false)}>Close</button>
                </div>
                {notifications.length === 0 && <p className="notif-empty">No notifications yet.</p>}
                {notifications.slice(0, 20).map((n) => (
                  <div key={n.id} className={`notif-item ${n.read ? "" : "notif-unread"}`}>
                    <span className="notif-icon">{n.type === "reaction" ? "❤️" : n.type === "message" ? "💬" : "👥"}</span>
                    <div className="notif-body">
                      {n.type === "reaction" && <span>{ (n.data.fromUsername as string) } reacted {n.data.emoji as string} to your message</span>}
                      {n.type === "message" && <span>{ (n.data.fromUsername as string) } sent a message</span>}
                      {n.type === "group_join" && <span>Someone joined your group</span>}
                      <span className="notif-time">{formatRelativeTime(n.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="groups-icon-btn" title="Join a group" onClick={() => setView({ kind: "join" })}>
            <PersonAddIcon />
          </button>
          <button className="groups-icon-btn" title="Create group" onClick={() => setView({ kind: "create" })}>
            <UsersIcon />
          </button>
        </div>
      </div>

      {loading && !groups.length && <p className="groups-loading">Loading…</p>}

      {groups.length > 0 && (
        <section className="groups-section">
          <h3 className="groups-section-title">Study Groups</h3>
          {groups.map((g) => (
            <button
              key={g.id}
              className="groups-row"
              onClick={() => setView({ kind: "detail", groupId: g.id })}
            >
              <div className="groups-row-avatar">{g.name.charAt(0).toUpperCase()}</div>
              <div className="groups-row-info">
                <span className="groups-row-name">{g.name}</span>
                <span className="groups-row-sub">{g.role === "admin" ? "Admin" : "Member"}</span>
              </div>
              <ChevronRightIcon className="groups-row-chevron" />
            </button>
          ))}
        </section>
      )}

      <section className="groups-section">
        <div className="groups-section-header">
          <h3 className="groups-section-title">Direct Messages</h3>
          <button className="groups-text-btn" onClick={() => setView({ kind: "dm_new" })}>
            + New DM
          </button>
        </div>
        {dms.length === 0 && !loading && (
          <p className="groups-empty-text">No direct messages yet.</p>
        )}
        {dms.map((dm) => (
          <button
            key={dm.channelId}
            className="groups-row"
            onClick={() => setView({ kind: "chat", channelId: dm.channelId, title: `@${dm.otherUser.username}` })}
          >
            <div className="groups-row-avatar">{dm.otherUser.username.charAt(0).toUpperCase()}</div>
            <div className="groups-row-info">
              <span className="groups-row-name">@{dm.otherUser.username}</span>
              {dm.lastMessageAt && (
                <span className="groups-row-sub">{formatRelativeTime(dm.lastMessageAt)}</span>
              )}
            </div>
            <ChevronRightIcon className="groups-row-chevron" />
          </button>
        ))}
      </section>

      {groups.length === 0 && !loading && (
        <div className="groups-onboarding">
          <UsersIcon className="groups-onboarding-icon" />
          <p>Join or create a study group to read and discuss together.</p>
          <div className="groups-onboarding-actions">
            <button className="btn-primary" onClick={() => setView({ kind: "create" })}>Create Group</button>
            <button className="btn-secondary" onClick={() => setView({ kind: "join" })}>Join Group</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create Group ─────────────────────────────────────────────────────────────

function CreateGroupView({ onBack, onCreate }: { onBack: () => void; onCreate: () => void }) {
  const { settings, user } = useAppState();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [startDate, setStartDate] = useState(settings.startDate ?? "");
  const [startDay, setStartDay] = useState(settings.startDay);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Group name is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const result = await createGroup(name.trim(), desc.trim(), startDate || undefined, startDay);
      // Provision group channel key for the creator
      try {
        const pair = await getOrCreateKeyPair();
        const myJwk = await exportPublicKey(pair.publicKey);
        const myPubKey = await importPublicKey(myJwk);
        const channelKey = await generateChannelKey();
        // Encrypt for self (as group admin)
        const encryptedKey = await encryptChannelKey(channelKey, myPubKey);
        const { id: userId } = user!;
        await uploadGroupKey(result.id, userId, encryptedKey);
        cacheChannelKey(result.id, channelKey);
      } catch { /* non-fatal */ }
      onCreate();
      onBack();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create group.");
    }
    setBusy(false);
  }

  return (
    <div className="groups-screen">
      <div className="groups-header">
        <button className="groups-back-btn" onClick={onBack}>&larr; Back</button>
        <h2 className="groups-title">New Group</h2>
      </div>
      <form className="groups-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="groups-label">
          Group name
          <input className="groups-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Morning Torah Study" />
        </label>
        <label className="groups-label">
          Description (optional)
          <textarea className="groups-input groups-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={3} placeholder="What this group is about…" />
        </label>
        <label className="groups-label">
          Plan start date (optional)
          <input className="groups-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="groups-label">
          Starting from day #{startDay}
          <input className="groups-input" type="number" min={1} max={365} value={startDay} onChange={(e) => setStartDay(Number(e.target.value))} />
        </label>
        {err && <p className="groups-error">{err}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create Group"}
        </button>
      </form>
    </div>
  );
}

// ─── Join Group ───────────────────────────────────────────────────────────────

function JoinGroupView({ onBack, onJoin }: { onBack: () => void; onJoin: () => void }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 3) return;
    setBusy(true); setErr(null);
    try {
      const res = await lookupInviteCode(code.trim());
      setPreview(res);
    } catch {
      setErr("Invalid invite code. Check and try again.");
      setPreview(null);
    }
    setBusy(false);
  }

  async function handleJoin() {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      await joinGroup(code.trim());
      onJoin();
      onBack();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to join.");
    }
    setBusy(false);
  }

  return (
    <div className="groups-screen">
      <div className="groups-header">
        <button className="groups-back-btn" onClick={onBack}>&larr; Back</button>
        <h2 className="groups-title">Join Group</h2>
      </div>
      <form className="groups-form" onSubmit={(e) => void handleLookup(e)}>
        <label className="groups-label">
          Invite code
          <input
            className="groups-input"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); }}
            placeholder="Enter 8-character code"
            maxLength={8}
          />
        </label>
        {err && <p className="groups-error">{err}</p>}
        {!preview && (
          <button className="btn-primary" type="submit" disabled={busy || code.trim().length < 3}>
            {busy ? "Looking up…" : "Look Up"}
          </button>
        )}
      </form>
      {preview && (
        <div className="groups-preview-card">
          <h3 className="groups-preview-name">{preview.name}</h3>
          {preview.description && <p className="groups-preview-desc">{preview.description}</p>}
          {err && <p className="groups-error">{err}</p>}
          <div className="groups-preview-actions">
            <button className="btn-primary" onClick={() => void handleJoin()} disabled={busy}>
              {busy ? "Joining…" : "Join Group"}
            </button>
            <button className="btn-secondary" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group Detail ─────────────────────────────────────────────────────────────

function GroupDetailView({
  groupId, onBack, onChat, onChanged,
}: {
  groupId: string;
  onBack: () => void;
  onChat: (channelId: string, title: string, isGroup?: boolean, chatGroupId?: string) => void;
  onChanged: () => void;
}) {
  const { user } = useAppState();
  const [group, setGroup] = useState<(Group & { members: GroupMember[] }) | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showNewThread, setShowNewThread] = useState(false);
  const [editPlan, setEditPlan] = useState(false);
  const [newStartDate, setNewStartDate] = useState("");
  const [newStartDay, setNewStartDay] = useState(1);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, tRes] = await Promise.all([getGroup(groupId), listThreads(groupId)]);
      setGroup(g);
      setThreads(tRes.threads);
    } catch { /* ignore */ }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  // When a new member joins, admin provisions their group key
  useEffect(() => {
    return realtime.on("group:member_joined", async (data) => {
      const { groupId: gid, userId: newUserId } = data as { groupId: string; userId: string };
      if (gid !== groupId || group?.role !== "admin") return;
      try {
        const pair = await getOrCreateKeyPair();
        const myJwk = await exportPublicKey(pair.publicKey);
        const myPubKey = await importPublicKey(myJwk);
        const channelKey = await generateChannelKey();
        // Encrypt for the new member
        const { publicKeyJwk: newMemberJwk } = await fetchPublicKey(newUserId);
        const newMemberPubKey = await importPublicKey(newMemberJwk);
        const encryptedKey = await encryptChannelKey(channelKey, newMemberPubKey);
        await uploadGroupKey(groupId, newUserId, encryptedKey);
        // Also re-encrypt with admin's own key if not cached
        const myEncKey = await encryptChannelKey(channelKey, myPubKey);
        await uploadGroupKey(groupId, user!.id, myEncKey);
      } catch { /* non-fatal */ }
      await load();
    });
  }, [groupId, group?.role, user, load]);

  useEffect(() => {
    if (group) {
      setNewStartDate(group.planStartDate ?? "");
      setNewStartDay(group.planStartDay);
    }
  }, [group]);

  async function savePlan() {
    if (!group) return;
    setBusy(true);
    try {
      await updateGroup(group.id, { planStartDate: newStartDate || undefined, planStartDay: newStartDay });
      await load();
      onChanged();
      setEditPlan(false);
    } catch { /* ignore */ }
    setBusy(false);
  }

  async function copyCode() {
    if (!group) return;
    await navigator.clipboard.writeText(group.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!group) return <div className="groups-screen"><p className="groups-loading">Loading…</p></div>;

  const isAdmin = group.role === "admin";

  return (
    <div className="groups-screen">
      <div className="groups-header">
        <button className="groups-back-btn" onClick={onBack}>&larr; Back</button>
        <h2 className="groups-title">{group.name}</h2>
      </div>

      {group.description && <p className="groups-detail-desc">{group.description}</p>}

      <div className="groups-info-row">
        <span className="groups-info-label">Invite code</span>
        <span className="groups-invite-code">{group.inviteCode}</span>
        <button className="groups-icon-btn" onClick={() => void copyCode()} title="Copy">
          {copied ? "✓" : <CopyIcon />}
        </button>
      </div>

      <div className="groups-info-row">
        <span className="groups-info-label">Plan start</span>
        {editPlan ? (
          <div className="groups-plan-edit">
            <input type="date" className="groups-input groups-input-sm" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} />
            <input type="number" className="groups-input groups-input-sm" min={1} max={365} value={newStartDay}
              onChange={(e) => setNewStartDay(Number(e.target.value))} placeholder="Day #" />
            <button className="btn-primary btn-sm" onClick={() => void savePlan()} disabled={busy}>Save</button>
            <button className="btn-secondary btn-sm" onClick={() => setEditPlan(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <span>{group.planStartDate ? `${group.planStartDate} (Day ${group.planStartDay})` : "Not set"}</span>
            {isAdmin && (
              <button className="groups-text-btn" onClick={() => setEditPlan(true)}>Edit</button>
            )}
          </>
        )}
      </div>

      {group.channelId && (
        <button className="groups-chat-btn" onClick={() => onChat(group.channelId!, group.name, true, group.id)}>
          <MessageCircleIcon />
          Open Group Chat
        </button>
      )}

      {/* Threads section */}
      <section className="groups-section">
        <div className="groups-section-header">
          <h3 className="groups-section-title">Threads</h3>
          <button className="groups-text-btn" onClick={() => setShowNewThread(true)}>+ New Thread</button>
        </div>
        {threads.length === 0 && <p className="groups-empty-text">No threads yet. Create one to start a focused discussion.</p>}
        {threads.map((t) => (
          <button key={t.id} className="groups-row thread-row" onClick={() => onChat(t.channelId, `${t.emoji} ${t.name}`, true, groupId)}>
            <div className="thread-emoji-badge">{t.emoji}</div>
            <div className="groups-row-info">
              <span className="groups-row-name">{t.name}</span>
              {t.lastMessageAt && <span className="groups-row-sub">{formatRelativeTime(t.lastMessageAt)}</span>}
            </div>
            <ChevronRightIcon className="groups-row-chevron" />
          </button>
        ))}
        {showNewThread && (
          <NewThreadModal
            groupId={groupId}
            onClose={() => setShowNewThread(false)}
            onCreated={(thread) => { setThreads((prev) => [...prev, thread]); setShowNewThread(false); }}
          />
        )}
      </section>

      <section className="groups-section">
        <h3 className="groups-section-title">Members ({group.members.length})</h3>
        {group.members.map((m) => (
          <div key={m.id} className="groups-member-row">
            <div className="groups-row-avatar">{m.username.charAt(0).toUpperCase()}</div>
            <span className="groups-member-name">{m.username}</span>
            {m.id === user?.id && <span className="groups-member-badge">You</span>}
            {m.role === "admin" && <span className="groups-member-badge groups-admin-badge">Admin</span>}
          </div>
        ))}
      </section>
    </div>
  );
}

// ─── New Thread Modal ─────────────────────────────────────────────────────────

const THREAD_EMOJIS = ["💬", "📖", "🙏", "❤️", "✝️", "🕊️", "🌟", "💡", "🔥", "📝", "🗣️", "👥", "📌", "🎯", "❓", "🌿", "⚡", "🎵"];

function NewThreadModal({ groupId, onClose, onCreated }: {
  groupId: string;
  onClose: () => void;
  onCreated: (thread: Thread) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("💬");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingEmoji, setEditingEmoji] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Thread name is required."); return; }
    setBusy(true);
    try {
      const { id, channelId } = await createThread(groupId, name.trim(), emoji);
      onCreated({ id, groupId, channelId, name: name.trim(), emoji, createdBy: "", createdAt: Date.now(), lastMessageAt: null });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create thread.");
    }
    setBusy(false);
  }

  return (
    <div className="thread-modal-backdrop" onClick={onClose}>
      <div className="thread-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="thread-modal-title">New Thread</h3>
        <form onSubmit={(e) => void handleCreate(e)}>
          <div className="thread-emoji-row">
            <button type="button" className="thread-emoji-trigger" onClick={() => setEditingEmoji((v) => !v)}>
              <span className="thread-emoji-big">{emoji}</span>
              <PencilIcon className="thread-emoji-edit-icon" />
            </button>
            {editingEmoji && (
              <div className="thread-emoji-picker">
                {THREAD_EMOJIS.map((e) => (
                  <button key={e} type="button" className={`thread-emoji-opt ${e === emoji ? "selected" : ""}`}
                    onClick={() => { setEmoji(e); setEditingEmoji(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <input
              className="groups-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Thread name…"
              maxLength={80}
              autoFocus
              style={{ flex: 1 }}
            />
          </div>
          {err && <p className="groups-error">{err}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create Thread"}
            </button>
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── New DM ───────────────────────────────────────────────────────────────────

function NewDMView({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (channelId: string, username: string) => void;
}) {
  const { user } = useAppState();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; username: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setBusy(true);
      try { setResults((await searchUsers(q.trim())).users); } catch { /* ignore */ }
      setBusy(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  async function startDM(userId: string, username: string) {
    try {
      const { channelId, created } = await getOrCreateDM(userId);
      // Provision E2E channel key when channel is newly created
      if (created) {
        try {
          const myPair = await getOrCreateKeyPair();
          const myJwk = await exportPublicKey(myPair.publicKey);
          // Fetch other user's public key
          const { publicKeyJwk: otherJwk } = await fetchPublicKey(userId);
          const myPubKey = await importPublicKey(myJwk);
          const otherPubKey = await importPublicKey(otherJwk);
          const channelKey = await generateChannelKey();
          const [myEncKey, otherEncKey] = await Promise.all([
            encryptChannelKey(channelKey, myPubKey),
            encryptChannelKey(channelKey, otherPubKey),
          ]);
          const myId = user!.id;
          await Promise.all([
            uploadChannelKey(channelId, myId, myEncKey),
            uploadChannelKey(channelId, userId, otherEncKey),
          ]);
          cacheChannelKey(channelId, channelKey);
        } catch { /* non-fatal — will chat unencrypted */ }
      }
      onOpen(channelId, username);
    } catch { /* ignore */ }
  }

  return (
    <div className="groups-screen">
      <div className="groups-header">
        <button className="groups-back-btn" onClick={onBack}>&larr; Back</button>
        <h2 className="groups-title">New Message</h2>
      </div>
      <div className="groups-form">
        <input
          className="groups-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search username…"
          autoFocus
        />
        {busy && <p className="groups-loading">Searching…</p>}
        {results.map((u) => (
          <button key={u.id} className="groups-row" onClick={() => void startDM(u.id, u.username)}>
            <div className="groups-row-avatar">{u.username.charAt(0).toUpperCase()}</div>
            <span className="groups-row-name">@{u.username}</span>
          </button>
        ))}
        {!busy && q.trim().length >= 2 && results.length === 0 && (
          <p className="groups-empty-text">No users found.</p>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffDays = Math.floor(diffMs / 86400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ms).toLocaleDateString();
}
