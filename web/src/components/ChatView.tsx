import { useEffect, useRef, useState, useCallback } from "react";
import type { Message } from "../types";
import { listMessages, sendMessage, getMyChannelKey, getMyGroupKey } from "../lib/api";
import { useAppState } from "../state/AppState";
import { realtime } from "../lib/realtime";
import {
  getCachedChannelKey, cacheChannelKey,
  loadKeyPair, decryptChannelKey, decryptMessage, encryptMessage,
  type EncryptedMessage,
} from "../lib/encryption";
import { ArrowLeftIcon, LockIcon, SendIcon } from "./icons";

interface ChatViewProps {
  channelId: string;
  title: string;
  /** True if this is a group channel (uses group key endpoint). */
  isGroup?: boolean;
  onBack: () => void;
}

function tryParseEncrypted(content: string): EncryptedMessage | null {
  try {
    const obj = JSON.parse(content) as unknown;
    if (obj && typeof obj === "object" && "iv" in obj && "ct" in obj) {
      return obj as EncryptedMessage;
    }
  } catch { /* not JSON */ }
  return null;
}

export default function ChatView({ channelId, title, isGroup = false, onBack }: ChatViewProps) {
  const { user } = useAppState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [channelKey, setChannelKey] = useState<CryptoKey | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Load / decrypt channel key ──────────────────────────────────────────────
  const setupKey = useCallback(async () => {
    const cached = getCachedChannelKey(channelId);
    if (cached) { setChannelKey(cached); setEncryptionReady(true); return; }

    const pair = await loadKeyPair();
    if (!pair) return; // no key pair — will show unencrypted or "set up encryption" prompt

    try {
      const fetchFn = isGroup ? getMyGroupKey : getMyChannelKey;
      const { encryptedKey } = await fetchFn(channelId);
      if (!encryptedKey) return; // key not yet provisioned for this user
      const key = await decryptChannelKey(encryptedKey, pair.privateKey);
      cacheChannelKey(channelId, key);
      setChannelKey(key);
      setEncryptionReady(true);
    } catch {
      // Key exists on server but failed to decrypt (wrong device / rotated key)
    }
  }, [channelId, isGroup]);

  // ── Decrypt a batch of messages ─────────────────────────────────────────────
  const decryptAll = useCallback(async (msgs: Message[], key: CryptoKey | null) => {
    const newDecrypted: Record<string, string> = {};
    for (const m of msgs) {
      if (decrypted[m.id]) { newDecrypted[m.id] = decrypted[m.id]; continue; }
      const parsed = tryParseEncrypted(m.content);
      if (!parsed) { newDecrypted[m.id] = m.content; continue; }
      if (!key) { newDecrypted[m.id] = "🔒 Encrypted message"; continue; }
      try { newDecrypted[m.id] = await decryptMessage(parsed, key); }
      catch { newDecrypted[m.id] = "🔒 Unable to decrypt"; }
    }
    setDecrypted((prev) => ({ ...prev, ...newDecrypted }));
  }, [decrypted]);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    void setupKey();
  }, [setupKey]);

  useEffect(() => {
    setLoadingMsgs(true);
    listMessages(channelId).then(({ messages: msgs }) => {
      setMessages(msgs);
      setLoadingMsgs(false);
    }).catch(() => setLoadingMsgs(false));
  }, [channelId]);

  // Re-decrypt whenever messages or key changes
  useEffect(() => {
    void decryptAll(messages, channelKey);
  }, [messages, channelKey, decryptAll]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Real-time WebSocket updates ─────────────────────────────────────────────
  useEffect(() => {
    const unsub = realtime.on("message:new", (data) => {
      const msg = data as Message;
      if (msg.channelId !== channelId) return;
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return unsub;
  }, [channelId]);

  // ── Send ────────────────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const plain = text.trim();
    if (!plain || sending) return;
    setSending(true);
    setText("");
    try {
      let content: string;
      if (channelKey) {
        const enc = await encryptMessage(plain, channelKey);
        content = JSON.stringify(enc);
      } else {
        content = plain; // fallback: unencrypted (key not yet provisioned)
      }
      const msg = await sendMessage(channelId, content);
      // Optimistic: add to local list immediately (WS will echo it too, deduped)
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setDecrypted((prev) => ({ ...prev, [msg.id]: plain }));
    } catch {
      setText(plain); // restore if send failed
    }
    setSending(false);
  }

  const myId = user?.id;

  return (
    <div className="chat-screen">
      {/* Header */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <div className="chat-header-info">
          <span className="chat-title">{title}</span>
          <span className="chat-e2e-badge">
            <LockIcon className="chat-lock-icon" />
            End-to-end encrypted
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {loadingMsgs && <p className="chat-loading">Loading messages…</p>}
        {!loadingMsgs && messages.length === 0 && (
          <p className="chat-empty">No messages yet. Say hello!</p>
        )}
        {messages.map((m) => {
          const isMine = m.senderId === myId;
          const body = decrypted[m.id] ?? (tryParseEncrypted(m.content) ? "🔒 Encrypted" : m.content);
          return (
            <div key={m.id} className={`chat-bubble-row ${isMine ? "chat-mine" : "chat-theirs"}`}>
              {!isMine && (
                <span className="chat-avatar">{m.senderUsername.charAt(0).toUpperCase()}</span>
              )}
              <div className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
                {!isMine && <span className="chat-sender">{m.senderUsername}</span>}
                <span className="chat-body">{body}</span>
                <span className="chat-time">{formatTime(m.sentAt)}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form className="chat-input-bar" onSubmit={(e) => void handleSend(e)}>
        <input
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={encryptionReady ? "Message…" : "Message (unencrypted — set up keys in Settings)"}
          maxLength={4000}
          disabled={sending}
        />
        <button className="chat-send-btn" type="submit" disabled={!text.trim() || sending} aria-label="Send">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
