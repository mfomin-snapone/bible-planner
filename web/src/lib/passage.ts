import { findBook, type BibleBook } from "./bibleBooks";

export interface PassageChapter {
  book: BibleBook;
  chapter: number;
}

/**
 * Parse a plan reading reference into an ordered list of chapters.
 *
 * Handles every shape that appears in the plan data:
 *   "Psalm 10"                      → [Psalms 10]
 *   "Genesis 19-20"                 → [Genesis 19, Genesis 20]
 *   "Deuteronomy 34; Joshua 1"      → [Deuteronomy 34, Joshua 1]
 *   "1 Peter (Kefa) 3-4"            → [1 Peter 3, 1 Peter 4]
 *   "Messianic Jews (Hebrews) 11"   → [Hebrews 11]
 */
export function parseReference(reference: string): PassageChapter[] {
  const chapters: PassageChapter[] = [];
  for (const segment of reference.split(";")) {
    const match = segment.trim().match(/^(.+?)\s+(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) continue;
    const book = findBook(match[1]);
    if (!book) continue;
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : start;
    for (let chapter = start; chapter <= Math.min(end, book.chapters); chapter++) {
      chapters.push({ book, chapter });
    }
  }
  return chapters;
}

export function chapterTitle(passage: PassageChapter): string {
  const name = passage.book.id === 19 ? "Psalm" : passage.book.name;
  return `${name} ${passage.chapter}`;
}
