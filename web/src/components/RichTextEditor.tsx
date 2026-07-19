import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

// ─── Sanitizer ───────────────────────────────────────────────────────────────

/** Minimal HTML sanitizer — only allows b/i/u/br/div and verse-ref spans. */
function sanitize(html: string): string {
  if (typeof document === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  function clean(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === "BR") return document.createElement("br");
    if (["B", "I", "U"].includes(tag)) {
      const out = document.createElement(tag.toLowerCase());
      for (const c of Array.from(el.childNodes)) {
        const r = clean(c);
        if (r) out.appendChild(r);
      }
      return out;
    }
    if (tag === "SPAN" && el.classList.contains("verse-ref")) {
      const ref = el.getAttribute("data-ref") ?? el.textContent ?? "";
      const out = document.createElement("span");
      out.className = "verse-ref";
      out.setAttribute("data-ref", ref);
      out.setAttribute("contenteditable", "false");
      out.textContent = ref;
      return out;
    }
    if (tag === "DIV" || tag === "P") {
      const out = document.createElement("div");
      for (const c of Array.from(el.childNodes)) {
        const r = clean(c);
        if (r) out.appendChild(r);
      }
      return out;
    }
    // Anything else: preserve text content only
    return document.createTextNode(el.textContent ?? "");
  }

  const out = document.createElement("div");
  for (const c of Array.from(doc.body.childNodes)) {
    const r = clean(c);
    if (r) out.appendChild(r);
  }
  return out.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const svgBase = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  style: { width: 16, height: 16 },
};

function BoldIcon() {
  return (
    <svg {...svgBase}>
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  );
}
function ItalicIcon() {
  return (
    <svg {...svgBase}>
      <path d="M19 4h-9M14 20H5M15 4 9 20" />
    </svg>
  );
}
function UnderlineIcon() {
  return (
    <svg {...svgBase}>
      <path d="M6 3v7a6 6 0 0 0 12 0V3" />
      <path d="M4 21h16" />
    </svg>
  );
}
function BookOpenIcon() {
  return (
    <svg {...svgBase}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg {...svgBase}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// ─── AnswerDisplay (read-only rendered view) ──────────────────────────────────

interface AnswerDisplayProps {
  html: string;
  onVerseClick: (ref: string) => void;
}

function AnswerDisplay({ html, onVerseClick }: AnswerDisplayProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".verse-ref");
      if (target) {
        e.preventDefault();
        const verseRef = target.getAttribute("data-ref");
        if (verseRef) onVerseClick(verseRef);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onVerseClick]);

  return (
    <div
      ref={ref}
      className="answer-display"
      // sanitize() is called before storage and before render
      dangerouslySetInnerHTML={{ __html: sanitize(html) }}
    />
  );
}

// ─── RichTextEditor ──────────────────────────────────────────────────────────

interface RichTextEditorProps {
  /** Sanitized HTML value. */
  value: string;
  onChange: (html: string) => void;
  onVerseClick?: (ref: string) => void;
  placeholder?: string;
}

export function RichTextEditor({
  value,
  onChange,
  onVerseClick,
  placeholder = "Write your answer…",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isFocused = useRef(false);
  const savedRange = useRef<Range | null>(null);
  const [editing, setEditing] = useState(false);
  const [showVerseForm, setShowVerseForm] = useState(false);
  const [verseInput, setVerseInput] = useState("");

  // Sync external value → DOM when not actively editing
  useEffect(() => {
    if (!isFocused.current && editorRef.current) {
      editorRef.current.innerHTML = sanitize(value);
    }
  }, [value]);

  // Focus the editor when entering edit mode
  useEffect(() => {
    if (editing) {
      editorRef.current?.focus();
    }
  }, [editing]);

  const saveContent = useCallback(() => {
    if (editorRef.current) {
      onChange(sanitize(editorRef.current.innerHTML));
    }
  }, [onChange]);

  const handleFocus = () => {
    isFocused.current = true;
  };
  const handleBlur = () => {
    // Delay so clicks on toolbar buttons aren't counted as blur
    setTimeout(() => {
      if (!editorRef.current?.contains(document.activeElement) && !showVerseForm) {
        isFocused.current = false;
        setEditing(false);
        saveContent();
      }
    }, 150);
  };

  // ── Toolbar handlers — use onMouseDown + preventDefault to keep focus ────
  const execCmd = (cmd: string, e: MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd, false);
    editorRef.current?.focus();
  };

  const handleVerseMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    setShowVerseForm(true);
  };

  const insertVerse = () => {
    const ref = verseInput.trim();
    if (!ref) { setShowVerseForm(false); return; }

    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      const sel = window.getSelection();
      if (savedRange.current && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      }
      document.execCommand(
        "insertHTML",
        false,
        `<span class="verse-ref" data-ref="${escapeAttr(ref)}" contenteditable="false">${escapeAttr(ref)}</span>&#8203;`,
      );
    }
    savedRange.current = null;
    setVerseInput("");
    setShowVerseForm(false);
    saveContent();
  };

  const onVerseKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); insertVerse(); }
    if (e.key === "Escape") { setShowVerseForm(false); }
  };

  const isEmpty = !value || value.replace(/<[^>]*>/g, "").trim() === "";

  // ── Read-only display mode ───────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="rte-wrapper">
        {isEmpty ? (
          <button className="rte-placeholder" onClick={() => setEditing(true)}>
            <EditIcon />
            <span>{placeholder}</span>
          </button>
        ) : (
          <div className="rte-display-wrap">
            <AnswerDisplay html={value} onVerseClick={onVerseClick ?? (() => {})} />
            <button
              className="rte-edit-btn"
              onClick={() => setEditing(true)}
              aria-label="Edit answer"
              title="Edit"
            >
              <EditIcon />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────────
  return (
    <div className="rte-wrapper">
      <div className="rte-toolbar">
        <button
          className="rte-tb-btn"
          onMouseDown={(e) => execCmd("bold", e)}
          aria-label="Bold"
          title="Bold (Ctrl+B)"
        >
          <BoldIcon />
        </button>
        <button
          className="rte-tb-btn"
          onMouseDown={(e) => execCmd("italic", e)}
          aria-label="Italic"
          title="Italic (Ctrl+I)"
        >
          <ItalicIcon />
        </button>
        <button
          className="rte-tb-btn"
          onMouseDown={(e) => execCmd("underline", e)}
          aria-label="Underline"
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon />
        </button>
        <div className="rte-divider" />
        <button
          className="rte-tb-btn"
          onMouseDown={handleVerseMouseDown}
          aria-label="Insert verse reference"
          title="Insert verse reference"
        >
          <BookOpenIcon />
          <span style={{ fontSize: "0.72rem", marginLeft: 2 }}>Verse</span>
        </button>
      </div>

      {showVerseForm && (
        <div className="rte-verse-form">
          <input
            autoFocus
            type="text"
            className="rte-verse-input"
            placeholder="e.g. John 3:16 or Genesis 1:1-3"
            value={verseInput}
            onChange={(e) => setVerseInput(e.target.value)}
            onKeyDown={onVerseKeyDown}
          />
          <button className="btn" style={{ padding: "6px 12px" }} onMouseDown={(e) => { e.preventDefault(); insertVerse(); }}>
            Insert
          </button>
          <button className="btn btn-secondary" style={{ padding: "6px 12px" }} onMouseDown={(e) => { e.preventDefault(); setShowVerseForm(false); }}>
            Cancel
          </button>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={editorRef}
        className="rte-editor"
        contentEditable
        suppressContentEditableWarning
        onFocus={handleFocus}
        onBlur={handleBlur}
        data-placeholder={placeholder}
        onInput={saveContent}
        spellCheck
      />
    </div>
  );
}
