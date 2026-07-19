import type { DmChannel, Group, GroupMember, Message, PlanState, Reaction, Thread, AppNotification, User } from "../types";

const TOKEN_KEY = "bible-planner:token";
const USER_KEY = "bible-planner:user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const error = new Error(body.error || `Request failed (${res.status})`);
    (error as Error & { status?: number; body?: unknown }).status = res.status;
    (error as Error & { status?: number; body?: unknown }).body = body;
    throw error;
  }
  return body;
}

export function register(username: string, password: string, birthDate: string) {
  return request<{ token: string; user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, birthDate }),
  });
}

export function login(username: string, password: string) {
  return request<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function updateProfile(avatar: string) {
  return request<{ ok: boolean }>("/api/users/me", {
    method: "PUT",
    body: JSON.stringify({ avatar }),
  });
}

export function reportMessage(messageId: string, reason: string) {
  return request<{ ok: boolean }>(`/api/messages/${messageId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function fetchServerState() {
  return request<{ data: PlanState | null; updatedAt: number }>("/api/state");
}

export function pushServerState(state: PlanState) {
  return request<{ ok: boolean; updatedAt: number }>("/api/state", {
    method: "PUT",
    body: JSON.stringify({ data: state, updatedAt: state.updatedAt }),
  });
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

export function uploadPublicKey(publicKeyJwk: string) {
  return request<{ ok: boolean }>("/api/keys", { method: "POST", body: JSON.stringify({ publicKeyJwk }) });
}

export function fetchPublicKey(userId: string) {
  return request<{ publicKeyJwk: string }>(`/api/keys/${encodeURIComponent(userId)}`);
}

// ─── User search ──────────────────────────────────────────────────────────────

export function searchUsers(q: string) {
  return request<{ users: { id: string; username: string }[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export function createGroup(name: string, description: string, planStartDate?: string, planStartDay?: number, icon?: string) {
  return request<{ id: string; name: string; inviteCode: string; channelId: string }>("/api/groups", {
    method: "POST",
    body: JSON.stringify({ name, description, planStartDate, planStartDay, icon }),
  });
}

export function listGroups() {
  return request<{ groups: Group[] }>("/api/groups");
}

export function getGroup(id: string) {
  return request<Group & { members: GroupMember[] }>(`/api/groups/${encodeURIComponent(id)}`);
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "description" | "planStartDate" | "planStartDay" | "icon">>) {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteGroup(id: string) {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function leaveGroup(id: string) {
  return request<{ ok: boolean; groupDeleted: boolean }>(`/api/groups/${encodeURIComponent(id)}/leave`, { method: "POST" });
}

export function removeGroupMember(groupId: string, userId: string) {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export function setGroupMemberRole(groupId: string, userId: string, role: "admin" | "member") {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function setInviteSettings(groupId: string, expiresInMs: number | null, maxUses: number | null) {
  return request<{ ok: boolean; inviteExpiresAt: number | null; inviteMaxUses: number | null }>(
    `/api/groups/${encodeURIComponent(groupId)}/invite`,
    { method: "PUT", body: JSON.stringify({ expiresInMs, maxUses }) },
  );
}

export function regenerateInviteCode(groupId: string) {
  return request<{ inviteCode: string }>(`/api/groups/${encodeURIComponent(groupId)}/invite/regenerate`, { method: "POST" });
}

export function lookupInviteCode(code: string) {
  return request<{ id: string; name: string; description: string }>(`/api/groups/invite/${encodeURIComponent(code)}`);
}

export function joinGroup(code: string) {
  return request<{ groupId: string; alreadyMember: boolean }>(`/api/groups/join/${encodeURIComponent(code)}`, { method: "POST" });
}

export function uploadGroupKey(groupId: string, targetUserId: string, encryptedKey: string) {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(groupId)}/keys`, {
    method: "POST",
    body: JSON.stringify({ targetUserId, encryptedKey }),
  });
}

export function getMyGroupKey(groupId: string) {
  return request<{ encryptedKey: string | null }>(`/api/groups/${encodeURIComponent(groupId)}/my-key`);
}

// ─── DM Channels ─────────────────────────────────────────────────────────────

export function getOrCreateDM(otherUserId: string) {
  return request<{ channelId: string; created: boolean }>("/api/channels/dm", {
    method: "POST",
    body: JSON.stringify({ otherUserId }),
  });
}

export function listDMs() {
  return request<{ dms: DmChannel[] }>("/api/channels");
}

export function uploadChannelKey(channelId: string, targetUserId: string, encryptedKey: string) {
  return request<{ ok: boolean }>(`/api/channels/${encodeURIComponent(channelId)}/keys`, {
    method: "POST",
    body: JSON.stringify({ targetUserId, encryptedKey }),
  });
}

export function getMyChannelKey(channelId: string) {
  return request<{ encryptedKey: string | null }>(`/api/channels/${encodeURIComponent(channelId)}/my-key`);
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function listMessages(channelId: string, before?: number) {
  const q = before ? `?before=${before}` : "";
  return request<{ messages: Message[] }>(`/api/channels/${encodeURIComponent(channelId)}/messages${q}`);
}

export function sendMessage(channelId: string, content: string) {
  return request<Message>(`/api/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export function toggleReaction(messageId: string, emoji: string) {
  return request<{ reactions: Reaction[] }>(`/api/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export function deleteMessage(messageId: string) {
  return request<{ ok: boolean; deletedAt?: number }>(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export function listThreads(groupId: string) {
  return request<{ threads: Thread[] }>(`/api/groups/${encodeURIComponent(groupId)}/threads`);
}

export function createThread(groupId: string, name: string, emoji: string) {
  return request<{ id: string; channelId: string }>(`/api/groups/${encodeURIComponent(groupId)}/threads`, {
    method: "POST",
    body: JSON.stringify({ name, emoji }),
  });
}

export function updateThread(threadId: string, patch: { name?: string; emoji?: string }) {
  return request<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteThread(threadId: string) {
  return request<{ ok: boolean }>(`/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
}

// ─── Notifications ────────────────────────────────────────────────────────────

export function listNotifications() {
  return request<{ notifications: AppNotification[]; unreadCount: number }>("/api/notifications");
}

export function markNotificationsRead() {
  return request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" });
}
