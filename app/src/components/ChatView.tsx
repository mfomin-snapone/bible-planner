import { useEffect, useRef, useState, useCallback } from "react";
import type { Message, Reaction } from "../types";
import { listMessages, sendMessage, toggleReaction, reportMessage, getMyChannelKey, getMyGroupKey } from "../lib/api";
import { useAppState } from "../state/AppState";
import { realtime } from "../lib/realtime";
import { decryptMessage, getCachedChannelKey, cacheChannelKey, loadKeyPair, decryptChannelKey, type EncryptedMessage } from "../lib/encryption";
import { ArrowLeftIcon, LockIcon, SendIcon, SmileIcon, GifIcon, FlagIcon, BookOpenIcon } from "./icons";
import { getAvatar } from "../lib/avatars";

const QUICK_REACTIONS = ["❤️", "🙏", "👍", "😂", "😮", "🔥", "✝️", "🕊️"];
const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY as string | undefined;

import { BIBLE_BOOKS } from "../lib/bibleBooks";

// ─── Book name normalisation table ────────────────────────────────────────────
const BOOK_ALIASES: Record<string, string> = {
  gen:"Genesis",exod:"Exodus",exo:"Exodus",lev:"Leviticus",num:"Numbers",deut:"Deuteronomy",deu:"Deuteronomy",
  josh:"Joshua",judg:"Judges",jdg:"Judges",ruth:"Ruth",
  "1sam":"1 Samuel","2sam":"2 Samuel","1kgs":"1 Kings","2kgs":"2 Kings",
  "1chr":"1 Chronicles","2chr":"2 Chronicles",ezra:"Ezra",neh:"Nehemiah",esth:"Esther",
  job:"Job",ps:"Psalms",psa:"Psalms",psalm:"Psalms",psalms:"Psalms",
  prov:"Proverbs",pro:"Proverbs",eccl:"Ecclesiastes",ecc:"Ecclesiastes",eccles:"Ecclesiastes",
  song:"Song of Solomon",sos:"Song of Solomon",
  isa:"Isaiah",jer:"Jeremiah",lam:"Lamentations",ezek:"Ezekiel",eze:"Ezekiel",
  dan:"Daniel",hos:"Hosea",joel:"Joel",amos:"Amos",obad:"Obadiah",
  jonah:"Jonah",jon:"Jonah",mic:"Micah",nah:"Nahum",hab:"Habakkuk",zeph:"Zephaniah",
  hag:"Haggai",zech:"Zechariah",zec:"Zechariah",mal:"Malachi",
  matt:"Matthew",mat:"Matthew",matthew:"Matthew",mark:"Mark",luke:"Luke",
  john:"John",acts:"Acts",rom:"Romans",
  "1cor":"1 Corinthians","2cor":"2 Corinthians",
  gal:"Galatians",eph:"Ephesians",phil:"Philippians",col:"Colossians",
  "1thess":"1 Thessalonians","2thess":"2 Thessalonians",
  "1tim":"1 Timothy","2tim":"2 Timothy",titus:"Titus",philem:"Philemon",
  heb:"Hebrews",jas:"James",
  "1pet":"1 Peter","2pet":"2 Peter",
  "1john":"1 John","2john":"2 John","3john":"3 John",
  jude:"Jude",rev:"Revelation",
};

interface VerseRef {
  display: string;
  bookId: number;
  chapter: number;
}

function parseVerseRef(text: string): VerseRef | null {
  // Matches patterns like: "John 3:16", "Matt 28:18-20", "1 Cor 13:4-8", "Ps 23"
  const m = text.match(
    /\b((?:\d\s*)?[A-Za-z]+\.?)\s+(\d+)(?::(\d+)(?:-\d+)?)?\b/
  );
  if (!m) return null;
  const rawBook = m[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  const chapter = parseInt(m[2], 10);
  const canonical = BOOK_ALIASES[rawBook] ?? null;
  if (!canonical) return null;
  const bookEntry = BIBLE_BOOKS.find(
    (b) => b.name.toLowerCase() === canonical.toLowerCase()
  );
  if (!bookEntry || chapter < 1 || chapter > bookEntry.chapters) return null;
  return { display: m[0], bookId: bookEntry.id, chapter };
}

function renderWithVerseChips(
  text: string,
  onRef: (ref: VerseRef) => void,
): React.ReactNode {
  // Split on potential verse references
  const pattern =
    /\b((?:\d\s*)?[A-Za-z]+\.?)\s+(\d+)(?::(\d+)(?:-\d+)?)?\b/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const ref = parseVerseRef(m[0]);
    if (ref) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <button
          key={m.index}
          className="verse-chip"
          onClick={() => onRef(ref)}
          title={`Open ${ref.display} in Bible`}
        >
          <BookOpenIcon />
          {ref.display}
        </button>
      );
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface ChatViewProps {
  channelId: string;
  title: string;
  isGroup?: boolean;
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

const REPORT_REASONS = [
  "Harassment or bullying",
  "Inappropriate content",
  "Spam or off-topic",
  "False information",
  "Other",
];

export default function ChatView({ channelId, title, isGroup = false, onBack }: ChatViewProps) {
  const { user, openBibleRef } = useAppState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [reactionsByMsg, setReactionsByMsg] = useState<Record<string, Reaction[]>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<{ url: string; preview: string }[]>([]);
  const [reportTarget, setReportTarget] = useState<string | null>(null); // message id
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [showVersePicker, setShowVersePicker] = useState(false);
  const [vpBook, setVpBook] = useState(40);
  const [vpChapter, setVpChapter] = useState(1);
  const vpBookEntry = BIBLE_BOOKS.find((b) => b.id === vpBook) ?? BIBLE_BOOKS[39];
  const lastTypingRef = useRef<number>(0);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Decrypt legacy encrypted messages (backward compat) ────────────────────
  const tryDecryptLegacy = useCallback(async (msgs: Message[]) => {
    const encryptedMsgs = msgs.filter((m) => tryParseEncrypted(m.content));
    if (encryptedMsgs.length === 0) return;
    let key = getCachedChannelKey(channelId) ?? null;
    if (!key) {
      try {
        const pair = await loadKeyPair();
        if (pair) {
          const fetchFn = isGroup ? () => getMyGroupKey(channelId) : () => getMyChannelKey(channelId);
          const { encryptedKey } = await fetchFn();
          if (encryptedKey) {
            key = await decryptChannelKey(encryptedKey, pair.privateKey);
            cacheChannelKey(channelId, key);
          }
        }
      } catch { /* key unavailable on this device */ }
    }
    if (!key) return;
    const newDecrypted: Record<string, string> = {};
    for (const m of encryptedMsgs) {
      const parsed = tryParseEncrypted(m.content);
      if (!parsed) continue;
      try { newDecrypted[m.id] = await decryptMessage(parsed, key); } catch { /* */ }
    }
    if (Object.keys(newDecrypted).length > 0) {
      setDecrypted((prev) => ({ ...prev, ...newDecrypted }));
    }
  }, [channelId, isGroup]);

  // ── Load messages ───────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingMsgs(true);
    listMessages(channelId).then(({ messages: msgs }) => {
      setMessages(msgs);
      const map: Record<string, Reaction[]> = {};
      for (const m of msgs) map[m.id] = m.reactions ?? [];
      setReactionsByMsg(map);
      setLoadingMsgs(false);
      void tryDecryptLegacy(msgs);
    }).catch(() => setLoadingMsgs(false));
  }, [channelId, tryDecryptLegacy]);

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
      const msg = await sendMessage(channelId, plain);
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: [] }]);
      setReactionsByMsg((prev) => ({ ...prev, [msg.id]: [] }));
    } catch { setText(plain); }
    setSending(false);
  }

  async function sendGif(url: string) {
    setShowGifPicker(false);
    setSending(true);
    const plain = JSON.stringify({ type: "gif", url });
    try {
      const msg = await sendMessage(channelId, plain);
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: [] }]);
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

  async function submitReport() {
    if (!reportTarget || !reportReason) return;
    setReportBusy(true);
    try {
      await reportMessage(reportTarget, reportReason);
      setReportDone(true);
      setTimeout(() => { setReportTarget(null); setReportReason(""); setReportDone(false); }, 1500);
    } catch { /* ignore */ }
    setReportBusy(false);
  }

  const myId = user?.id;
  const typingNames = Object.values(typingUsers);

  return (
    <div className="chat-screen">
      <div className="chat-header">
        <button className="chat-back-btn" onClick={onBack} aria-label="Back"><ArrowLeftIcon /></button>
        <div className="chat-header-info">
          <span className="chat-title">{title}</span>
          <span className="chat-e2e-badge"><LockIcon className="chat-lock-icon" />Secure</span>
        </div>
      </div>

      <div className="chat-messages">
        {loadingMsgs && <p className="chat-loading">Loading messages…</p>}
        {!loadingMsgs && messages.length === 0 && <p className="chat-empty">No messages yet. Say hello!</p>}
        {messages.map((m) => {
          const isMine = m.senderId === myId;
          const rawBody = decrypted[m.id] ?? (tryParseEncrypted(m.content) ? "🔒 [encrypted — sent from another device]" : m.content);
          const gif = isGifContent(rawBody);
          const reactions = reactionsByMsg[m.id] ?? [];
          const grouped: Record<string, { count: number; mine: boolean }> = {};
          for (const r of reactions) {
            if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false };
            grouped[r.emoji].count++;
            if (r.userId === myId) grouped[r.emoji].mine = true;
          }
          const senderAvatar = getAvatar((m as Message & { senderAvatar?: string }).senderAvatar);
          return (
            <div key={m.id} className={`chat-bubble-row ${isMine ? "chat-mine" : "chat-theirs"}`}>
              {!isMine && (
                <span
                  className="chat-avatar"
                  style={{ background: senderAvatar.bg, color: senderAvatar.fg }}
                  title={m.senderUsername}
                >
                  {senderAvatar.id === "default" ? m.senderUsername.charAt(0).toUpperCase() : senderAvatar.symbol}
                </span>
              )}
              <div className="chat-bubble-wrap">
                <div className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
                  {!isMine && <span className="chat-sender">{m.senderUsername}</span>}
                  {gif
                    ? <img src={gif.url} alt="GIF" className="chat-gif" loading="lazy" />
                    : <span className="chat-body">{renderWithVerseChips(rawBody, (ref) => { openBibleRef(ref.bookId, ref.chapter); onBack(); })}</span>}
                  <span className="chat-time">{formatTime(m.sentAt)}</span>
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
              <div className="chat-msg-actions">
                <button className="chat-react-btn" onClick={(e) => { e.stopPropagation(); setPickerFor(pickerFor === m.id ? null : m.id); }} aria-label="React">
                  <SmileIcon />
                </button>
                {!isMine && (
                  <button className="chat-report-btn" onClick={(e) => { e.stopPropagation(); setReportTarget(m.id); setReportReason(""); }} aria-label="Report message" title="Report">
                    <FlagIcon />
                  </button>
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
        <button type="button" className="chat-gif-btn" onClick={() => { setShowVersePicker(true); setVpBook(40); setVpChapter(1); }} aria-label="Insert verse" title="Insert verse reference">
          <BookOpenIcon />
        </button>
        <input
          className="chat-input"
          value={text}
          onChange={handleInputChange}
          placeholder="Message…"
          maxLength={4000}
          disabled={sending}
        />
        <button className="chat-send-btn" type="submit" disabled={!text.trim() || sending} aria-label="Send">
          <SendIcon />
        </button>
      </form>

      {/* Verse picker modal */}
      {showVersePicker && (
        <div className="report-modal-backdrop" onClick={() => setShowVersePicker(false)}>
          <div className="report-modal verse-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 14px" }}>Insert Verse Reference</h3>
            <label className="verse-picker-label">
              Book
              <select
                className="verse-picker-select"
                value={vpBook}
                onChange={(e) => { setVpBook(Number(e.target.value)); setVpChapter(1); }}
              >
                <optgroup label="Tanakh">
                  {BIBLE_BOOKS.filter((b) => b.id <= 39).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
                <optgroup label="B'rit Chadashah">
                  {BIBLE_BOOKS.filter((b) => b.id >= 40).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="verse-picker-label">
              Chapter
              <div className="verse-picker-chapters">
                {Array.from({ length: vpBookEntry.chapters }, (_, i) => i + 1).map((c) => (
                  <button
                    key={c}
                    className={`verse-picker-ch-btn ${c === vpChapter ? "selected" : ""}`}
                    onClick={() => setVpChapter(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                className="btn"
                onClick={() => {
                  const ref = `${vpBookEntry.name} ${vpChapter}`;
                  setText((prev) => prev ? `${prev} ${ref}` : ref);
                  setShowVersePicker(false);
                }}
              >
                Insert
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowVersePicker(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verse picker modal */}
      {showVersePicker && (
        <div className="report-modal-backdrop" onClick={() => setShowVersePicker(false)}>
          <div className="report-modal verse-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 14px" }}>Insert Verse Reference</h3>
            <label className="verse-picker-label">
              Book
              <select
                className="verse-picker-select"
                value={vpBook}
                onChange={(e) => { setVpBook(Number(e.target.value)); setVpChapter(1); }}
              >
                <optgroup label="Tanakh">
                  {BIBLE_BOOKS.filter((b) => b.id <= 39).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
                <optgroup label="B'rit Chadashah">
                  {BIBLE_BOOKS.filter((b) => b.id >= 40).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="verse-picker-label" style={{ marginTop: 12 }}>
              Chapter
              <div className="verse-picker-chapters">
                {Array.from({ length: vpBookEntry.chapters }, (_, i) => i + 1).map((c) => (
                  <button
                    key={c}
                    className={`verse-picker-ch-btn ${c === vpChapter ? "selected" : ""}`}
                    onClick={() => setVpChapter(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                className="btn"
                onClick={() => {
                  const ref = `${vpBookEntry.name} ${vpChapter}`;
                  setText((prev) => prev ? `${prev} ${ref}` : ref);
                  setShowVersePicker(false);
                }}
              >
                Insert
              </button>
              <button className="btn btn-secondary" onClick={() => setShowVersePicker(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reportTarget && (
        <div className="report-modal-backdrop" onClick={() => { setReportTarget(null); setReportReason(""); }}>
          <div className="report-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Report Message</h3>
            {reportDone ? (
              <p style={{ color: "var(--success)", fontWeight: 600 }}>✓ Report submitted. Thank you.</p>
            ) : (
              <>
                <p className="small muted" style={{ margin: "0 0 4px" }}>Select a reason:</p>
                <div className="report-reasons">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r}
                      className={`report-reason-btn ${reportReason === r ? "selected" : ""}`}
                      onClick={() => setReportReason(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="btn" disabled={!reportReason || reportBusy} onClick={() => void submitReport()}>
                    {reportBusy ? "Sending…" : "Submit Report"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setReportTarget(null); setReportReason(""); }}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
