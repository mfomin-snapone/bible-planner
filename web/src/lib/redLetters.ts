// Verse-level "words of Yeshua" dataset, built from the WEB USFM \wj markers by
// scripts/build-red-letters.js. Shape: { bookId: { chapter: [verse, ...] } }.
type RedLetterData = Record<string, Record<string, number[]>>;

let data: RedLetterData | null = null;
let loading: Promise<void> | null = null;

export function loadRedLetters(): Promise<void> {
  if (data) return Promise.resolve();
  loading ??= fetch("/red-letters.json")
    .then((res) => res.json())
    .then((json: RedLetterData) => {
      data = json;
    })
    .catch(() => {
      // Non-fatal: reader simply renders without red letters.
    });
  return loading;
}

export function redVersesFor(bookId: number, chapter: number): Set<number> {
  const verses = data?.[String(bookId)]?.[String(chapter)];
  return new Set(verses ?? []);
}
