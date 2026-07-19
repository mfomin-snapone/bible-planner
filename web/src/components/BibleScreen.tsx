import { useEffect, useRef, useState } from "react";
import { BIBLE_BOOKS } from "../lib/bibleBooks";
import { useAppState } from "../state/AppState";
import { TRANSLATIONS, type Translation } from "../types";
import { AppearanceSheet } from "./AppearancePanel";
import { ChapterView } from "./ChapterView";
import { ChevronIcon } from "./icons";

/** Free-reading Bible tab: any book, any chapter, remembers your place. */
export function BibleScreen() {
  const { settings, updateSettings } = useAppState();
  const [showAppearance, setShowAppearance] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const book = BIBLE_BOOKS.find((b) => b.id === settings.lastBookId) ?? BIBLE_BOOKS[0];
  const chapter = Math.min(Math.max(settings.lastChapter, 1), book.chapters);

  const go = (bookId: number, nextChapter: number) => {
    updateSettings({ lastBookId: bookId, lastChapter: nextChapter });
  };

  useEffect(() => {
    topRef.current?.scrollIntoView();
  }, [settings.lastBookId, settings.lastChapter]);

  const prev = () => {
    if (chapter > 1) {
      go(book.id, chapter - 1);
    } else {
      const prevBook = BIBLE_BOOKS.find((b) => b.id === book.id - 1);
      if (prevBook) go(prevBook.id, prevBook.chapters);
    }
  };

  const next = () => {
    if (chapter < book.chapters) {
      go(book.id, chapter + 1);
    } else {
      const nextBook = BIBLE_BOOKS.find((b) => b.id === book.id + 1);
      if (nextBook) go(nextBook.id, 1);
    }
  };

  const atStart = book.id === 1 && chapter === 1;
  const atEnd = book.id === 66 && chapter === book.chapters;
  const displayName = book.id === 19 ? "Psalm" : book.name;

  return (
    <>
      <div ref={topRef} />
      <div className="bible-toolbar">
        <select
          className="book-select"
          value={book.id}
          onChange={(e) => go(parseInt(e.target.value, 10), 1)}
          aria-label="Book"
        >
          {BIBLE_BOOKS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={chapter}
          onChange={(e) => go(book.id, parseInt(e.target.value, 10))}
          aria-label="Chapter"
        >
          {Array.from({ length: book.chapters }, (_, i) => i + 1).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={settings.translation}
          onChange={(e) => updateSettings({ translation: e.target.value as Translation })}
          aria-label="Translation"
        >
          {TRANSLATIONS.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}
            </option>
          ))}
        </select>
        <button className="aa-btn" onClick={() => setShowAppearance(true)} aria-label="Appearance">
          Aa
        </button>
      </div>

      <h3 style={{ margin: "10px 2px 12px", fontSize: "1.3rem" }}>
        {displayName} {chapter}{" "}
        <span className="small muted" style={{ fontWeight: 400 }}>
          {settings.translation}
        </span>
      </h3>

      <ChapterView bookId={book.id} chapter={chapter} translation={settings.translation} />

      <div className="bible-nav">
        <button className="btn btn-secondary" onClick={prev} disabled={atStart}>
          <ChevronIcon direction="left" className="q-icon" /> Previous
        </button>
        <button className="btn btn-secondary" onClick={next} disabled={atEnd}>
          Next <ChevronIcon direction="right" className="q-icon" />
        </button>
      </div>

      {showAppearance && <AppearanceSheet onClose={() => setShowAppearance(false)} />}
    </>
  );
}
