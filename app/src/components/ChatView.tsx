import { useEffect, useRef, useState, useCallback } from "react";
import type { Message, Reaction } from "../types";
import { listMessages, sendMessage, getMyChannelKey, getMyGroupKey, toggleReaction } from "../lib/api";
import { useAppState } from "../state/AppState";
import { realtime } from "../lib/realtime";
import {
  getCachedChannelKey, cacheChannelKey,
  loadKeyPair, decryptChannelKey, decryptMessage, encryptMessage,
  type EncryptedMessage,
} from "../lib/encryption";
import { ArrowLeftIcon, LockIcon, SendIcon, SmileIcon, GifIcon } from "./icons";

const QUICK_REACTIONS = ["❤️", "🙏", "👍", "😂", "😮", "🔥", "✝️", "🕊️"];
const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY as string | undefined;

interface ChatViewProps {
  channelId: string;
  title: string;
  isGroup?: boolean;
  /** For thread channels — which group's key to use. */
  groupId?: string;
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

function isGifContent(s: string): { url: string } | null {
  try {
    const obj = JSON.parse(s) as unknown;
    if (obj && typeof obj === "object" && (obj as { type?: string }).type === "gif") {
      return { url: (obj as { url: string }).url };
    }
  } catch { /* */ }
  return null;
}

export default function ChatView({ channelId, title, isGroup = false, groupId, onBack }: ChatViewProps) {
  const { user } = useAppState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [channelKey, setChannelKey] = useState<CryptoKey | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [reactionsByMsg, setReactionsByMsg] = useState<Record<string, Reaction[]>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<{ url: string; preview: string }[]>([]);
  const lastTypingRef = useRef<number>(0);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Load / decrypt channel key ──────────────────────────────────────────────
  const setupKey = useCallback(async () => {
    const cached = getCachedChannelKey(channelId);
    if (cached) { setChannelKey(cached); setEncryptionReady(true); return; }
    const pair = await loadKeyPair();
    if (!pair) return;
    try {
      const fetchFn = isGroup ? () => getMyGroupKey(groupId ?? channelId) : () => getMyChannelKey(channelId);
      const { encryptedKey } = await fetchFn();
      if (!encryptedKey) return;
      const key = await decryptChannelKey(encryptedKey, pair.privateKey);
      cacheChannelKey(channelId, key);
      setChannelKey(key);
      setEncryptionReady(true);
    } catch { /* */ }
  }, [channelId, isGroup, groupId]);

  // ── Decrypt messages ────────────────────────────────────────────────────────
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

  useEffect(() => { void setupKey(); }, [setupKey]);

  useEffect(() => {
    setLoadingMsgs(true);
    listMessages(channelId).then(({ messages: msgs }) => {
      setMessages(msgs);
      const map: Record<string, Reaction[]> = {};
      for (const m of msgs) map[m.id] = m.reactions ?? [];
      setReactionsByMsg(map);
      setLoadingMsgs(false);
    }).catch(() => setLoadingMsgs(false));
  }, [channelId]);

  useEffect(() => { void decryptAll(messages, channelKey); }, [messages, channelKey, decryptAll]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // ── Typing indicators ───────────────────────────────────────────────────────
  useEffect(() => {
    const clearTyping = (uid: string) => {
      clearTimeout(typingTimers.current[uid]);
      setTypingUsers((prev) => { const next = { ...prev }; delete next[uid]; return next; });
    };
    const unsubStart = realtime.on("typing:start", (data) => {
      const d = data as { channelId: string; userId: string; username: string };
      if (d.channelId !== channelId || d.userId === user?.id) return;
      setTypingUsers((prev) => ({ ...prev, [d.userId]: d.username }));
      clearTimeout(typingTimers.current[d.userId]);
      typingTimers.current[d.userId] = setTimeout(() => clearTyping(d.userId), 3000);
    });
    const unsubStop = realtime.on("typing:stop", (data) => {
      const d = data as { channelId: string; userId: string };
      if (d.channelId !== channelId) return;
      clearTyping(d.userId);
    });
    return () => { unsubStart(); unsubStop(); };
  }, [channelId, user?.id]);

  // ── Reactions + new message WS ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = realtime.on("message:reaction", (data) => {
      const d = data as { messageId: string; reactions: Reaction[] };
      setReactionsByMsg((prev) => ({ ...prev, [d.messageId]: d.reactions }));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = realtime.on("message:new", (data) => {
      const msg = data as Message;
      if (msg.channelId !== channelId) return;
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
      setReactionsByMsg((prev) => ({ ...prev, [msg.id]: msg.reactions ?? [] }));
    });
    return unsub;
  }, [channelId]);

  // ── Giphy search ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showGifPicker || !GIPHY_KEY) return;
    const id = setTimeout(async () => {
      try {
        const url = gifQuery.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(gifQuery)}&limit=12&rating=g`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=12&rating=g`;
        const res = await fetch(url);
        const json = await res.json() as { data: Array<{ images: { original: { url: string }; fixed_height_small: { url: string } } }> };
        setGifResults(json.data.map((g) => ({ url: g.images.original.url, preview: g.images.fixed_height_small.url })));
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(id);
  }, [gifQuery, showGifPicker]);

  useEffect(() => {
    if (!pickerFor) return;
    const h = () => setPickerFor(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [pickerFor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const plain = text.trim();
    if (!plain || sending) return;
    setSending(true);
    setText("");
    realtime.send({ event: "typing:stop", data: { channelId, username: user?.username ?? "" } });
    try {
      const content = channelKey ? JSON.stringify(await encryptMessage(plain, channelKey)) : plain;
      const msg = await sendMessage(channelId, content);
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: [] }]);
      setDecrypted((prev) => ({ ...prev, [msg.id]: plain }));
      setReactionsByMsg((prev) => ({ ...prev, [msg.id]: [] }));
    } catch { setText(plain); }
    setSending(false);
  }

  async function sendGif(url: string) {
    setShowGifPicker(false);
    setSending(true);
    const plain = JSON.stringify({ type: "gif", url });
    try {
      const content = channelKey ? JSON.stringify(await encryptMessage(plain, channelKey)) : plain;
      const msg = await sendMessage(channelId, content);
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: [] }]);
      setDecrypted((prev) => ({ ...prev, [msg.id]: plain }));
    } catch { /* ignore */ }
    setSending(false);
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTypingRef.current > 2500) {
      lastTypingRef.current = now;
      realtime.send({ event: "typing:start", data: { channelId, username: user?.username ?? "" } });
    }
  };

  async function handleReaction(messageId: string, emoji: string) {
    setPickerFor(null);
    try {
      const { reactions } = await toggleReaction(messageId, emoji);
      setReactionsByMsg((prev) => ({ ...prev, [messageId]: reactions }));
    } catch { /* ignore */ }
  }

  const myId = user?.id;
  const typingNames = Object.values(typingUsers);

  return (
    <div className="chat-screen">
      <div className="chat-header">
        <button className="chat-back-btn" onClick={onBack} aria-label="Back"><ArrowLeftIcon /></button>
        <div className="chat-header-info">
          <span className="chat-title">{title}</span>
          <span className="chat-e2e-badge"><LockIcon className="chat-lock-icon" />End-to-end encrypted</span>
        </div>
      </div>

      <div className="chat-messages">
        {loadingMsgs && <p className="chat-loading">Loading messages…</p>}
        {!loadingMsgs && messages.length === 0 && <p className="chat-empty">No messages yet. Say hello!</p>}
        {messages.map((m) => {
          const isMine = m.senderId === myId;
          const rawBody = decrypted[m.id] ?? (tryParseEncrypted(m.content) ? "🔒 Encrypted" : m.content);
          const gif = isGifContent(rawBody);
          const reactions = reactionsByMsg[m.id] ?? [];
          const grouped: Record<string, { count: number; mine: boolean }> = {};
          for (const r of reactions) {
            if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false };
            grouped[r.emoji].count++;
            if (r.userId === myId) grouped[r.emoji].mine = true;
          }
          return (
            <div key={m.id} className={`chat-bubble-row ${isMine ? "chat-mine" : "chat-theirs"}`}>
              {!isMine && <span className="chat-avatar">{m.senderUsername.charAt(0).toUpperCase()}</span>}
              <div className="chat-bubble-wrap">
                <div className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
                  {!isMine && <span className="chat-sender">{m.senderUsername}</span>}
                  {gif
                    ? <img src={gif.url} alt="GIF" className="chat-gif" loading="lazy" />
                    : <span className="chat-body">{rawBody}</span>}
                  <span className="chat-time">{formatTime(m.sentAt)}</span>
                  <button className="chat-react-btn" onClick={(e) => { e.stopPropagation(); setPickerFor(pickerFor === m.id ? null : m.id); }} aria-label="React">
                    <SmileIcon />
                  </button>
                  {pickerFor === m.id && (
                    <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
                      {QUICK_REACTIONS.map((emoji) => (
                        <button key={emoji} className="reaction-pick-btn" onClick={() => void handleReaction(m.id, emoji)}>{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
                {Object.keys(grouped).length > 0 && (
                  <div className="chat-reactions">
                    {Object.entries(grouped).map(([emoji, { count, mine }]) => (
                      <button key={emoji} className={`chat-reaction ${mine ? "mine" : ""}`} onClick={() => void handleReaction(m.id, emoji)}>
                        <span>{emoji}</span><span className="chat-reaction-count">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <div className="typing-indicator">
            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            <span className="typing-label">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showGifPicker && (
        <div className="gif-picker">
          {GIPHY_KEY ? (
            <>
              <input className="gif-search-input" value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} placeholder="Search GIFs…" autoFocus />
              <div className="gif-grid">
                {gifResults.map((g, i) => (
                  <button key={i} className="gif-item" onClick={() => void sendGif(g.url)}>
                    <img src={g.preview} alt="gif" loading="lazy" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form className="gif-url-form" onSubmit={(e) => {
              e.preventDefault();
              const v = (e.currentTarget.elements.namedItem("gifUrl") as HTMLInputElement).value.trim();
              if (v) void sendGif(v);
            }}>
              <input name="gifUrl" className="gif-search-input" placeholder="Paste a GIF URL and press Enter…" autoFocus />
              <button className="btn" type="submit">Send</button>
            </form>
          )}
        </div>
      )}

      <form className="chat-input-bar" onSubmit={(e) => void handleSend(e)}>
        <button type="button" className="chat-gif-btn" onClick={() => setShowGifPicker((v) => !v)} aria-label="GIF" title="Send GIF">
          <GifIcon />
        </button>
        <input
          className="chat-input"
          value={text}
          onChange={handleInputChange}
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
