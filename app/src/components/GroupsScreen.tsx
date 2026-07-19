import { useEffect, useState, useCallback } from "react";
import type { Group, GroupMember, DmChannel, Thread, AppNotification } from "../types";
import {
  listGroups, getGroup, createGroup, joinGroup, lookupInviteCode,
  updateGroup, deleteGroup, leaveGroup, removeGroupMember, setGroupMemberRole,
  setInviteSettings, regenerateInviteCode,
  searchUsers, getOrCreateDM, listDMs,
  uploadPublicKey as _uploadPublicKey, fetchPublicKey,
  uploadChannelKey, uploadGroupKey,
  listThreads, createThread, updateThread, deleteThread,
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
  ChevronRightIcon, CopyIcon, BellIcon, PencilIcon, GearIcon,
  TrashIcon, LogOutIcon,
} from "./icons";
import ChatView from "./ChatView";
import { DayNumberInput } from "./DayNumberInput";

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

  // WS: group membership changed elsewhere (removed/left/deleted) — keep the list in sync
  useEffect(() => {
    const unsubRemoved = realtime.on("group:removed", () => { void reload(); });
    const unsubDeleted = realtime.on("group:deleted", () => { void reload(); });
    return () => { unsubRemoved(); unsubDeleted(); };
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
              className="groups-header-btn"
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
              <span>Alerts</span>
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {showNotifs && (
              <div className="notif-panel">
                <div className="notif-panel-header">
                  <span>Notifications</span>
                  <button className="link-btn small" onClick={() => setShowNotifs(false)}>Close</button>
                </div>
                {notifications.length === 0 && <p className="notif-empty">No notifications yet.</p>}
                {notifications.slice(0, 20).map((n) => {
                  const canNav = !!(n.channelId && (n.type === "message" || n.type === "reaction"));
                  const channelTitle = n.data.channelTitle
                    ? String(n.data.channelTitle)
                    : `@${String(n.data.fromUsername ?? "")}`;
                  return (
                    <div
                      key={n.id}
                      className={`notif-item ${n.read ? "" : "notif-unread"}${canNav ? " notif-item-nav" : ""}`}
                      role={canNav ? "button" : undefined}
                      tabIndex={canNav ? 0 : undefined}
                      onClick={() => {
                        if (!canNav) return;
                        setShowNotifs(false);
                        setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
                        markNotificationsRead().catch(() => {});
                        setView({
                          kind: "chat",
                          channelId: n.channelId!,
                          title: channelTitle,
                          isGroup: Boolean(n.data.isGroup),
                        });
                      }}
                    >
                      <span className="notif-icon">{n.type === "reaction" ? "❤️" : n.type === "message" ? "💬" : "👥"}</span>
                      <div className="notif-body">
                        {n.type === "reaction" && (
                          <span><b>{n.data.fromUsername as string}</b> reacted {n.data.emoji as string} to your message</span>
                        )}
                        {n.type === "message" && (
                          <span>
                            <b>{n.data.fromUsername as string}</b>
                            {n.data.channelTitle ? <> in <b>{n.data.channelTitle as string}</b></> : ""}
                            {n.data.preview ? <>: <span className="notif-preview">{String(n.data.preview).slice(0, 60)}</span></> : " sent a message"}
                          </span>
                        )}
                        {n.type === "group_join" && <span>Someone joined your group</span>}
                        <span className="notif-time">{formatRelativeTime(n.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button className="groups-header-btn" title="Join a group" onClick={() => setView({ kind: "join" })}>
            <PersonAddIcon />
            <span>Join</span>
          </button>
          <button className="groups-header-btn" title="Create group" onClick={() => setView({ kind: "create" })}>
            <UsersIcon />
            <span>New Group</span>
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
              <div className="groups-row-avatar">{g.icon || g.name.charAt(0).toUpperCase()}</div>
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

const GROUP_EMOJIS = ["📖", "🙏", "✝️", "🕊️", "⭐", "📿", "🌿", "🔥", "💒", "👥", "📚", "🎶", "🌅", "❤️", "🌟", "🗣️", "🌾", "⚡"];

function CreateGroupView({ onBack, onCreate }: { onBack: () => void; onCreate: () => void }) {
  const { settings, user } = useAppState();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [icon, setIcon] = useState("📖");
  const [editingIcon, setEditingIcon] = useState(false);
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
      const result = await createGroup(name.trim(), desc.trim(), startDate || undefined, startDay, icon);
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
          <div className="thread-emoji-row">
            <button type="button" className="thread-emoji-trigger" onClick={() => setEditingIcon((v) => !v)}>
              <span className="thread-emoji-big">{icon}</span>
              <PencilIcon className="thread-emoji-edit-icon" />
            </button>
            {editingIcon && (
              <div className="thread-emoji-picker">
                {GROUP_EMOJIS.map((e) => (
                  <button key={e} type="button" className={`thread-emoji-opt ${e === icon ? "selected" : ""}`}
                    onClick={() => { setIcon(e); setEditingIcon(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <input className="groups-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Morning Torah Study" style={{ flex: 1 }} />
          </div>
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
          <DayNumberInput className="groups-input" max={365} value={startDay} onCommit={setStartDay} />
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
  const [editingThread, setEditingThread] = useState<Thread | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, tRes] = await Promise.all([getGroup(groupId), listThreads(groupId)]);
      setGroup(g);
      setThreads(tRes.threads);
    } catch { /* ignore */ }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    return realtime.on("group:member_joined", async (data) => {
      const { groupId: gid, userId: newUserId } = data as { groupId: string; userId: string };
      if (gid !== groupId || group?.role !== "admin") return;
      try {
        const pair = await getOrCreateKeyPair();
        const myJwk = await exportPublicKey(pair.publicKey);
        const myPubKey = await importPublicKey(myJwk);
        const channelKey = await generateChannelKey();
        const { publicKeyJwk: newMemberJwk } = await fetchPublicKey(newUserId);
        const newMemberPubKey = await importPublicKey(newMemberJwk);
        const encryptedKey = await encryptChannelKey(channelKey, newMemberPubKey);
        await uploadGroupKey(groupId, newUserId, encryptedKey);
        const myEncKey = await encryptChannelKey(channelKey, myPubKey);
        await uploadGroupKey(groupId, user!.id, myEncKey);
      } catch { /* non-fatal */ }
      await load();
    });
  }, [groupId, group?.role, user, load]);

  useEffect(() => {
    return realtime.on("thread:update", (data) => {
      const { groupId: gid, threadId, name, emoji } = data as { groupId: string; threadId: string; name?: string; emoji?: string };
      if (gid !== groupId) return;
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, name: name ?? t.name, emoji: emoji ?? t.emoji } : t)));
    });
  }, [groupId]);

  useEffect(() => {
    return realtime.on("thread:deleted", (data) => {
      const { groupId: gid, threadId } = data as { groupId: string; threadId: string };
      if (gid !== groupId) return;
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    });
  }, [groupId]);

  // WS: member role changed / removed / left — refresh the member list & my own role
  useEffect(() => {
    const unsubRole = realtime.on("group:member_role_changed", (data) => {
      if ((data as { groupId: string }).groupId === groupId) void load();
    });
    const unsubLeft = realtime.on("group:member_left", (data) => {
      if ((data as { groupId: string }).groupId === groupId) void load();
    });
    const unsubRemoved = realtime.on("group:removed", (data) => {
      if ((data as { groupId: string }).groupId === groupId) onBack();
    });
    const unsubDeleted = realtime.on("group:deleted", (data) => {
      if ((data as { groupId: string }).groupId === groupId) { onChanged(); onBack(); }
    });
    return () => { unsubRole(); unsubLeft(); unsubRemoved(); unsubDeleted(); };
  }, [groupId, load, onBack, onChanged]);

  async function copyCode() {
    if (!group) return;
    await navigator.clipboard.writeText(group.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!group) return <div className="groups-screen"><p className="groups-loading">Loading…</p></div>;

  const isAdmin = group.role === "admin";
  // Estimate current group plan day
  const groupDay = group.planStartDate
    ? Math.max(1, Math.floor((Date.now() - new Date(group.planStartDate).getTime()) / 86400000) + group.planStartDay)
    : null;

  return (
    <div className="groups-screen">
      {/* Header */}
      <div className="groups-header">
        <button className="groups-back-btn" onClick={onBack}>← Back</button>
        <h2 className="groups-title">{group.name}</h2>
        {isAdmin && (
          <button className="groups-icon-btn" onClick={() => setShowSettings(true)} title="Group settings">
            <GearIcon className="q-icon" />
          </button>
        )}
      </div>

      {/* Hero card */}
      <div className="group-hero-card">
        <div className="group-hero-avatar">{group.icon || group.name.charAt(0).toUpperCase()}</div>
        <div className="group-hero-body">
          <h3 className="group-hero-name">{group.name}</h3>
          {group.description
            ? <p className="group-hero-desc">{group.description}</p>
            : isAdmin && <p className="group-hero-desc group-hero-desc-empty">Add a description in group settings</p>}
        </div>
      </div>

      {/* Stats bar */}
      <div className="group-stats-bar">
        <div className="group-stat">
          <span className="group-stat-num">{group.members.length}</span>
          <span className="group-stat-label">Members</span>
        </div>
        <div className="group-stat">
          <span className="group-stat-num">{threads.length}</span>
          <span className="group-stat-label">Threads</span>
        </div>
        <div className="group-stat">
          <span className="group-stat-num">{groupDay ?? "—"}</span>
          <span className="group-stat-label">Plan Day</span>
        </div>
        <div className="group-stat" style={{ cursor: "pointer" }} onClick={() => void copyCode()}>
          <span className="group-stat-num" style={{ fontSize: "0.72rem", letterSpacing: "0.08em" }}>{group.inviteCode}</span>
          <span className="group-stat-label">{copied ? "Copied!" : "Invite Code"}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="group-actions-grid">
        {group.channelId && (
          <button className="group-action-btn" onClick={() => onChat(group.channelId!, group.name, true, group.id)}>
            <MessageCircleIcon className="q-icon" />
            <span>Group Chat</span>
          </button>
        )}
        <button className="group-action-btn" onClick={() => setShowNewThread(true)}>
          <PencilIcon className="q-icon" />
          <span>New Thread</span>
        </button>
        <button className="group-action-btn" onClick={() => void copyCode()}>
          <CopyIcon className="q-icon" />
          <span>{copied ? "Copied!" : "Invite"}</span>
        </button>
        {isAdmin && (
          <button className="group-action-btn" onClick={() => setShowSettings(true)}>
            <GearIcon className="q-icon" />
            <span>Settings</span>
          </button>
        )}
      </div>

      {/* Threads */}
      <section className="groups-section">
        <div className="groups-section-header">
          <h3 className="groups-section-title">Threads</h3>
          <button className="groups-text-btn" onClick={() => setShowNewThread(true)}>+ New Thread</button>
        </div>
        {threads.length === 0 && (
          <p className="groups-empty-text">No threads yet — create one to start a focused discussion.</p>
        )}
        {threads.map((t) => (
          <div key={t.id} className="groups-row thread-row">
            <button className="thread-row-main" onClick={() => onChat(t.channelId, `${t.emoji} ${t.name}`, true, groupId)}>
              <div className="thread-emoji-badge">{t.emoji}</div>
              <div className="groups-row-info">
                <span className="groups-row-name">{t.name}</span>
                {t.lastMessageAt && <span className="groups-row-sub">{formatRelativeTime(t.lastMessageAt)}</span>}
              </div>
              <ChevronRightIcon className="groups-row-chevron" />
            </button>
            <button className="thread-edit-btn" onClick={() => setEditingThread(t)} aria-label={`Edit ${t.name}`} title="Rename or change icon">
              <PencilIcon className="q-icon" />
            </button>
          </div>
        ))}
        {showNewThread && (
          <ThreadModal
            groupId={groupId}
            onClose={() => setShowNewThread(false)}
            onSaved={(thread) => { setThreads((prev) => [...prev, thread]); setShowNewThread(false); }}
          />
        )}
        {editingThread && (
          <ThreadModal
            groupId={groupId}
            thread={editingThread}
            onClose={() => setEditingThread(null)}
            onSaved={(updated) => {
              setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
              setEditingThread(null);
            }}
            onDeleted={() => {
              setThreads((prev) => prev.filter((t) => t.id !== editingThread.id));
              setEditingThread(null);
            }}
          />
        )}
      </section>

      {/* Members */}
      <section className="groups-section">
        <h3 className="groups-section-title">Members ({group.members.length})</h3>
        {group.members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isMe={m.id === user?.id}
            viewerIsAdmin={isAdmin}
            groupId={groupId}
            onChanged={load}
          />
        ))}
      </section>

      {/* Leave group */}
      <section className="groups-section">
        <LeaveGroupControl
          groupId={groupId}
          onLeft={() => { onChanged(); onBack(); }}
        />
      </section>

      {/* Admin settings sheet */}
      {showSettings && (
        <GroupSettingsSheet
          group={group}
          onClose={() => setShowSettings(false)}
          onSaved={() => { void load(); onChanged(); setShowSettings(false); }}
          onDeleted={() => { onChanged(); onBack(); }}
        />
      )}
    </div>
  );
}

// ─── Member row (promote/demote/remove) ───────────────────────────────────────

function MemberRow({
  member, isMe, viewerIsAdmin, groupId, onChanged,
}: {
  member: GroupMember;
  isMe: boolean;
  viewerIsAdmin: boolean;
  groupId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canManage = viewerIsAdmin && !isMe;

  async function toggleRole() {
    setBusy(true); setErr(null);
    try {
      await setGroupMemberRole(groupId, member.id, member.role === "admin" ? "member" : "admin");
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to change role.");
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true); setErr(null);
    try {
      await removeGroupMember(groupId, member.id);
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to remove member.");
      setConfirmingRemove(false);
    }
    setBusy(false);
  }

  return (
    <div className="groups-member-row" style={{ flexWrap: "wrap" }}>
      <div className="groups-row-avatar">{member.username.charAt(0).toUpperCase()}</div>
      <span className="groups-member-name">{member.username}</span>
      <div style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
        {isMe && <span className="groups-member-badge">You</span>}
        {member.role === "admin" && <span className="groups-member-badge groups-admin-badge">Admin</span>}
        {canManage && !confirmingRemove && (
          <>
            <button className="groups-text-btn" disabled={busy} onClick={() => void toggleRole()}>
              {member.role === "admin" ? "Demote" : "Make Admin"}
            </button>
            {member.role !== "admin" && (
              <button className="groups-text-btn groups-text-btn-danger" disabled={busy} onClick={() => setConfirmingRemove(true)}>
                Remove
              </button>
            )}
          </>
        )}
        {canManage && confirmingRemove && (
          <>
            <span className="small muted">Remove {member.username}?</span>
            <button className="groups-text-btn groups-text-btn-danger" disabled={busy} onClick={() => void remove()}>
              Confirm
            </button>
            <button className="groups-text-btn" disabled={busy} onClick={() => setConfirmingRemove(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
      {err && <p className="groups-error" style={{ width: "100%", margin: "4px 0 0" }}>{err}</p>}
    </div>
  );
}

// ─── Leave group ───────────────────────────────────────────────────────────────

function LeaveGroupControl({ groupId, onLeft }: { groupId: string; onLeft: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleLeave() {
    setBusy(true); setErr(null);
    try {
      await leaveGroup(groupId);
      onLeft();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to leave group.");
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="small">Leave this group? You'll need a new invite to rejoin.</span>
        {err && <p className="groups-error" style={{ margin: 0 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-danger" disabled={busy} onClick={() => void handleLeave()}>
            {busy ? "Leaving…" : "Leave Group"}
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <button className="group-action-btn" style={{ color: "var(--danger)" }} onClick={() => setConfirming(true)}>
      <LogOutIcon className="q-icon" />
      <span>Leave Group</span>
    </button>
  );
}

function GroupSettingsSheet({
  group, onClose, onSaved, onDeleted,
}: {
  group: Group & { members: GroupMember[] };
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [icon, setIcon] = useState(group.icon ?? "📖");
  const [editingIcon, setEditingIcon] = useState(false);
  const [desc, setDesc] = useState(group.description ?? "");
  const [startDate, setStartDate] = useState(group.planStartDate ?? "");
  const [startDay, setStartDay] = useState(group.planStartDay);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState(group.inviteCode);
  const [inviteExpiresAt, setInviteExpiresAt] = useState(group.inviteExpiresAt ?? null);
  const [expirySelection, setExpirySelection] = useState(group.inviteExpiresAt ? "custom" : "never");
  const [inviteMaxUses, setInviteMaxUses] = useState(group.inviteMaxUses ?? null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await updateGroup(group.id, {
        name: name.trim() || undefined,
        description: desc,
        icon,
        planStartDate: startDate || undefined,
        planStartDay: startDay,
      });
      onSaved();
    } catch {
      setErr("Failed to save settings.");
    }
    setBusy(false);
  }

  async function handleRegenerate() {
    setInviteBusy(true); setInviteMsg(null);
    try {
      const { inviteCode: newCode } = await regenerateInviteCode(group.id);
      setInviteCode(newCode);
      setInviteMsg("New invite code generated — the old one no longer works.");
    } catch {
      setInviteMsg("Failed to regenerate the invite code.");
    }
    setInviteBusy(false);
  }

  async function handleInviteSettingsChange(expiresInMs: number | null, maxUses: number | null) {
    setInviteBusy(true); setInviteMsg(null);
    try {
      const result = await setInviteSettings(group.id, expiresInMs, maxUses);
      setInviteExpiresAt(result.inviteExpiresAt);
      setInviteMaxUses(result.inviteMaxUses);
    } catch {
      setInviteMsg("Failed to update invite settings.");
    }
    setInviteBusy(false);
  }

  async function handleDelete() {
    setDeleteBusy(true);
    try {
      await deleteGroup(group.id);
      onDeleted();
    } catch {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Group Settings">
        <div className="sheet-handle" />
        <h3 style={{ margin: "0 0 16px", fontWeight: 700, color: "var(--text-h)" }}>Group Settings</h3>
        <form onSubmit={(e) => void handleSave(e)}>
          <label className="groups-label">
            Group name
            <div className="thread-emoji-row">
              <button type="button" className="thread-emoji-trigger" onClick={() => setEditingIcon((v) => !v)}>
                <span className="thread-emoji-big">{icon}</span>
                <PencilIcon className="thread-emoji-edit-icon" />
              </button>
              {editingIcon && (
                <div className="thread-emoji-picker">
                  {GROUP_EMOJIS.map((e) => (
                    <button key={e} type="button" className={`thread-emoji-opt ${e === icon ? "selected" : ""}`}
                      onClick={() => { setIcon(e); setEditingIcon(false); }}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
              <input className="groups-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={{ flex: 1 }} />
            </div>
          </label>
          <label className="groups-label" style={{ marginTop: 12 }}>
            Description
            <textarea className="groups-input groups-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={2} placeholder="What this group is about…" />
          </label>
          <div style={{ marginTop: 12 }}>
            <label className="groups-label" style={{ marginBottom: 4 }}>Plan start</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" className="groups-input" style={{ flex: 1 }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <DayNumberInput className="groups-input" style={{ width: 72 }} max={365} value={startDay} placeholder="Day" onCommit={setStartDay} />
            </div>
          </div>
          {err && <p className="groups-error">{err}</p>}
          <button className="btn btn-block" type="submit" disabled={busy} style={{ marginTop: 16 }}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </form>

        <div className="settings-divider" />

        <h4 style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text-h)", fontSize: "0.9rem" }}>Invite Link</h4>
        <div className="groups-invite-code-row">
          <span className="groups-invite-code">{inviteCode}</span>
          <button type="button" className="groups-text-btn" disabled={inviteBusy} onClick={() => void handleRegenerate()}>
            Regenerate
          </button>
        </div>
        <label className="groups-label" style={{ marginTop: 10 }}>
          Expires
          <select
            className="groups-input"
            disabled={inviteBusy}
            value={expirySelection}
            onChange={(e) => {
              const v = e.target.value;
              setExpirySelection(v);
              const ms = v === "never" ? null : Number(v);
              void handleInviteSettingsChange(ms, inviteMaxUses);
            }}
          >
            <option value="never">Never</option>
            {expirySelection === "custom" && <option value="custom">Custom (already set)</option>}
            <option value={60 * 60 * 1000}>In 1 hour</option>
            <option value={24 * 60 * 60 * 1000}>In 1 day</option>
            <option value={7 * 24 * 60 * 60 * 1000}>In 7 days</option>
            <option value={30 * 24 * 60 * 60 * 1000}>In 30 days</option>
          </select>
        </label>
        {inviteExpiresAt && (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Expires {new Date(inviteExpiresAt).toLocaleString()}
          </p>
        )}
        <label className="groups-label" style={{ marginTop: 10 }}>
          Max uses
          <select
            className="groups-input"
            disabled={inviteBusy}
            value={inviteMaxUses ?? "unlimited"}
            onChange={(e) => {
              const v = e.target.value;
              void handleInviteSettingsChange(inviteExpiresAt, v === "unlimited" ? null : Number(v));
            }}
          >
            <option value="unlimited">Unlimited</option>
            <option value={1}>1 use</option>
            <option value={5}>5 uses</option>
            <option value={10}>10 uses</option>
            <option value={25}>25 uses</option>
          </select>
        </label>
        {inviteMaxUses != null && (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Used {group.inviteUseCount ?? 0} of {inviteMaxUses}
          </p>
        )}
        {inviteMsg && <p className="small" style={{ margin: "6px 0 0", color: "var(--accent)" }}>{inviteMsg}</p>}

        <div className="settings-divider" />

        <h4 style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--danger)", fontSize: "0.9rem" }}>Danger Zone</h4>
        {confirmDelete ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="small">Delete "{group.name}" permanently? All messages, threads, and membership are lost for everyone. This cannot be undone.</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-danger" disabled={deleteBusy} onClick={() => void handleDelete()}>
                {deleteBusy ? "Deleting…" : "Delete Group"}
              </button>
              <button className="btn btn-secondary" disabled={deleteBusy} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
            <TrashIcon className="q-icon" /> Delete Group
          </button>
        )}

        <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Thread Modal (create or edit) ────────────────────────────────────────────

const THREAD_EMOJIS = ["💬", "📖", "🙏", "❤️", "✝️", "🕊️", "🌟", "💡", "🔥", "📝", "🗣️", "👥", "📌", "🎯", "❓", "🌿", "⚡", "🎵"];

function ThreadModal({ groupId, thread, onClose, onSaved, onDeleted }: {
  groupId: string;
  /** Omit to create a new thread; pass an existing thread to rename/re-icon it. */
  thread?: Thread;
  onClose: () => void;
  onSaved: (thread: Thread) => void;
  onDeleted?: () => void;
}) {
  const isEdit = !!thread;
  const [name, setName] = useState(thread?.name ?? "");
  const [emoji, setEmoji] = useState(thread?.emoji ?? "💬");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingEmoji, setEditingEmoji] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Thread name is required."); return; }
    setBusy(true);
    try {
      if (thread) {
        await updateThread(thread.id, { name: name.trim(), emoji });
        onSaved({ ...thread, name: name.trim(), emoji });
      } else {
        const { id, channelId } = await createThread(groupId, name.trim(), emoji);
        onSaved({ id, groupId, channelId, name: name.trim(), emoji, createdBy: "", createdAt: Date.now(), lastMessageAt: null });
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Failed to ${isEdit ? "update" : "create"} thread.`);
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (!thread) return;
    setBusy(true);
    try {
      await deleteThread(thread.id);
      onDeleted?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to delete thread.");
      setBusy(false);
    }
  }

  return (
    <div className="thread-modal-backdrop" onClick={onClose}>
      <div className="thread-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="thread-modal-title">{isEdit ? "Edit Thread" : "New Thread"}</h3>
        <form onSubmit={(e) => void handleSubmit(e)}>
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
              {busy ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : "Create Thread")}
            </button>
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
        {isEdit && (
          confirmDelete ? (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="small">Delete this thread and all its messages? This cannot be undone.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void handleDelete()}>
                  {busy ? "Deleting…" : "Delete Thread"}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="groups-text-btn groups-text-btn-danger"
              style={{ marginTop: 14 }}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon className="q-icon" /> Delete Thread
            </button>
          )
        )}
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
