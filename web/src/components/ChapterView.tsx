import { useEffect, useState } from "react";
import { fetchChapter, type BibleVerse } from "../lib/bibleApi";
import { loadRedLetters, redVersesFor } from "../lib/redLetters";
import { useAppState } from "../state/AppState";
import type { Translation } from "../types";

/** Fetches and renders one chapter's verses, with optional red-letter styling. */
export function ChapterView({
  bookId,
  chapter,
  translation,
}: {
  bookId: number;
  chapter: number;
  translation: Translation;
}) {
  const { settings } = useAppState();
  const [verses, setVerses] = useState<BibleVerse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redReady, setRedReady] = useState(false);

  useEffect(() => {
    loadRedLetters().then(() => setRedReady(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVerses(null);
    setError(null);
    fetchChapter(translation, bookId, chapter)
      .then((data) => {
        if (!cancelled) setVerses(data);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load this chapter. Check your connection and try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [translation, bookId, chapter]);

  const red = settings.redLetters && redReady ? redVersesFor(bookId, chapter) : new Set<number>();

  return (
    <>
      {error && <p className="error-text">{error}</p>}
      {!verses && !error && <div className="spinner" />}
      {verses?.map((v) => (
        <p className={`verse ${red.has(v.verse) ? "red-letter" : ""}`} key={v.verse}>
          <span className="verse-num">{v.verse}</span>
          {v.text}
        </p>
      ))}
    </>
  );
}
