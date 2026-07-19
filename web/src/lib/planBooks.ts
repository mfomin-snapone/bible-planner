import type { PlanDay, Track } from "../types";

// ─── Bible books (canonical names used in passage references) ────────────────

export const TANAKH_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles",
  "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
  "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
];

export const BRIT_CHADASHAH_BOOKS = [
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon",
  "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
];

export const ALL_BOOKS = [...TANAKH_BOOKS, ...BRIT_CHADASHAH_BOOKS];

// Alternate spellings / common abbreviations that might appear in plan.json
const ALIASES: Record<string, string> = {
  "Song of Songs": "Song of Solomon",
  "Psalm": "Psalms",
  "Prov": "Proverbs",
  "Gen": "Genesis",
  "Exo": "Exodus",
  "Lev": "Leviticus",
  "Num": "Numbers",
  "Deut": "Deuteronomy",
  "Jos": "Joshua",
  "Jdg": "Judges",
  "1Sam": "1 Samuel",
  "2Sam": "2 Samuel",
  "1Ki": "1 Kings",
  "2Ki": "2 Kings",
  "1Ch": "1 Chronicles",
  "2Ch": "2 Chronicles",
  "Neh": "Nehemiah",
  "Est": "Esther",
  "Rev": "Revelation",
  "Rev.": "Revelation",
  "Matt": "Matthew",
};

function canonicalize(book: string): string {
  return ALIASES[book] ?? book;
}

/** Returns true if the passage reference contains the given book name. */
function refContainsBook(ref: string, book: string): boolean {
  const lower = ref.toLowerCase();
  const bookLower = book.toLowerCase();
  // The book name should be at word-start and followed by space/digit/end
  const idx = lower.indexOf(bookLower);
  if (idx === -1) return false;
  const after = lower[idx + bookLower.length];
  return after === undefined || after === " " || /\d/.test(after);
}

/**
 * Search through the plan for the first day whose passage(s) start the
 * given book (optionally from a specific chapter).
 *
 * @returns 1-based plan day number, or null if not found.
 */
export function findDayForBook(
  plan: PlanDay[],
  book: string,
  chapter = 1,
): number | null {
  const canonical = canonicalize(book);
  const chapterStr = String(chapter);

  for (const day of plan) {
    const refs = [day.tanakh, day.psalm, day.proverbs, day.brit_chadashah];
    for (const ref of refs) {
      if (!refContainsBook(ref, canonical)) continue;
      if (chapter === 1) return day.day;
      // Check if the reference covers the requested chapter
      // e.g. "Isaiah 40-42" contains chapter 40
      const nums = (ref.match(/\d+/g) ?? []) as string[];
      if (nums.includes(chapterStr)) return day.day;
      if (nums.length >= 2) {
        const [start, end] = nums.map(Number);
        if (!Number.isNaN(start) && !Number.isNaN(end) && chapter >= start && chapter <= end) {
          return day.day;
        }
      }
    }
  }
  return null;
}

/** Extract a rough book name from a reference string (e.g. "Genesis 1-2" → "Genesis"). */
export function bookFromRef(ref: string): string {
  for (const book of ALL_BOOKS) {
    if (ref.toLowerCase().startsWith(book.toLowerCase())) return book;
  }
  return ref.split(/\s+\d/)[0];
}

/** 
 * Given a track and a plan, return the list of distinct books that appear in that track.
 * Useful for populating a "jump to book" picker filtered by track.
 */
export function booksInTrack(plan: PlanDay[], track: Track): string[] {
  const seen = new Set<string>();
  for (const day of plan) {
    const ref = day[track];
    for (const book of ALL_BOOKS) {
      if (refContainsBook(ref, book)) {
        seen.add(book);
        break;
      }
    }
  }
  return [...seen];
}
