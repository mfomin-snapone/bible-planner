/**
 * Preset Bible reading plan templates.
 * The default plan comes from plan.json (full 365-day Messianic study plan).
 * All other templates generate simplified daily reading schedules.
 */
import { BIBLE_BOOKS } from "./bibleBooks";
import type { PlanDay } from "../types";

export interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  days: number;
  category: "messianic" | "reading" | "devotional";
  /** If false, use the full plan.json. If true, readings are generated. */
  generated: boolean;
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: "default",
    name: "365-Day Messianic Study",
    description: "Full Tanakh + B'rit Chadashah with daily Psalm, Proverb, study themes, and questions. Messianic Jewish perspective.",
    days: 365,
    category: "messianic",
    generated: false,
  },
  {
    id: "nt-90",
    name: "New Testament in 90 Days",
    description: "Read through the entire B'rit Chadashah (Matthew → Revelation) at ~3 chapters per day.",
    days: 90,
    category: "reading",
    generated: true,
  },
  {
    id: "torah-50",
    name: "Torah in 50 Days",
    description: "Journey through the five books of Moses — Genesis through Deuteronomy — at ~3 chapters per day.",
    days: 50,
    category: "reading",
    generated: true,
  },
  {
    id: "psalms-30",
    name: "Psalms & Proverbs in 30 Days",
    description: "5 Psalms and 1 chapter of Proverbs each day for a month of wisdom and worship.",
    days: 30,
    category: "devotional",
    generated: true,
  },
  {
    id: "whole-bible-1yr",
    name: "Whole Bible in 1 Year",
    description: "Read every book of the Bible in canonical order — about 3–4 chapters per day.",
    days: 365,
    category: "reading",
    generated: true,
  },
  {
    id: "custom",
    name: "Custom Plan",
    description: "Build your own reading plan — choose books, order, and daily pace.",
    days: 0,
    category: "reading",
    generated: true,
  },
  {
    id: "parasha",
    name: "Weekly Parashah (Messianic)",
    description: "The traditional annual Torah portion cycle with haftarah, synced to this week's actual reading in the Hebrew calendar.",
    days: 0,
    category: "messianic",
    generated: true,
  },
];

// ─── Reading schedule generators ─────────────────────────────────────────────

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

interface ChapterRef {
  book: string;
  ch: number;
}

/**
 * Formats chapters as the reader's reference parser (lib/passage.ts) actually
 * understands: "Book N-M" ranges for consecutive chapters of the same book,
 * joined with "; " across book boundaries. A plain ", "-joined list of
 * "Book N" refs (the previous approach) isn't a format the reader parses at
 * all, so multi-chapter generated readings silently failed to open.
 */
function formatChapterRefs(items: ChapterRef[]): string {
  if (items.length === 0) return "";
  const runs: string[] = [];
  let { book: runBook, ch: runStart } = items[0];
  let runEnd = runStart;
  for (let i = 1; i < items.length; i++) {
    const { book, ch } = items[i];
    if (book === runBook && ch === runEnd + 1) {
      runEnd = ch;
    } else {
      runs.push(runStart === runEnd ? `${runBook} ${runStart}` : `${runBook} ${runStart}-${runEnd}`);
      runBook = book;
      runStart = ch;
      runEnd = ch;
    }
  }
  runs.push(runStart === runEnd ? `${runBook} ${runStart}` : `${runBook} ${runStart}-${runEnd}`);
  return runs.join("; ");
}

/** New Testament (Matthew–Revelation) in 90 days, ~3 ch/day */
function generateNT90(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .filter((b) => b.id >= 40)
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1 })));
  const perDay = Math.ceil(chapters.length / 90);
  return chunkArray(chapters, perDay).slice(0, 90).map((refs, i) => ({
    day: i + 1,
    tanakh: "",
    psalm: "",
    proverbs: "",
    brit_chadashah: formatChapterRefs(refs),
    theme: refs[0]?.book ?? "",
    questions: [],
  }));
}

/** Torah (Genesis–Deuteronomy) in 50 days */
function generateTorah50(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .filter((b) => b.id <= 5)
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1 })));
  const perDay = Math.ceil(chapters.length / 50);
  return chunkArray(chapters, perDay).slice(0, 50).map((refs, i) => ({
    day: i + 1,
    tanakh: formatChapterRefs(refs),
    psalm: "",
    proverbs: "",
    brit_chadashah: "",
    theme: refs[0]?.book ?? "",
    questions: [],
  }));
}

/** Psalms (5/day) + Proverbs (1 ch/day) in 30 days */
function generatePsalms30(): PlanDay[] {
  const psalms = Array.from({ length: 150 }, (_, i) => ({ book: "Psalms", ch: i + 1 }));
  const proverbs = BIBLE_BOOKS.find((b) => b.id === 20)!;
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    tanakh: "",
    psalm: formatChapterRefs(psalms.slice(i * 5, i * 5 + 5)),
    proverbs: `Proverbs ${(i % proverbs.chapters) + 1}`,
    brit_chadashah: "",
    theme: `Day ${i + 1} — Psalms ${i * 5 + 1}–${i * 5 + 5}`,
    questions: [],
  }));
}

/** Whole Bible (Genesis–Revelation) in 365 days */
function generateWholeBible1yr(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, nt: b.id >= 40 })));
  const perDay = Math.ceil(chapters.length / 365);
  return chunkArray(chapters, perDay).slice(0, 365).map((refs, i) => {
    const tanakh = formatChapterRefs(refs.filter((r) => !r.nt));
    const nt = formatChapterRefs(refs.filter((r) => r.nt));
    const first = refs[0];
    return {
      day: i + 1,
      tanakh,
      psalm: "",
      proverbs: "",
      brit_chadashah: nt,
      theme: `${first?.book ?? ""} ${first?.ch ?? ""}`,
      questions: [],
    };
  });
}

/** Custom plan from user-defined book IDs and pace */
export function generateCustomPlan(
  bookIds: number[],
  chaptersPerDay: number,
  ntSeparate: boolean,
): PlanDay[] {
  const allChapters = BIBLE_BOOKS
    .filter((b) => bookIds.includes(b.id))
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, nt: b.id >= 40 })));

  const chunks = chunkArray(allChapters, chaptersPerDay);
  return chunks.map((refs, i) => {
    const tanakh = formatChapterRefs(ntSeparate ? refs.filter((r) => !r.nt) : refs);
    const nt = ntSeparate ? formatChapterRefs(refs.filter((r) => r.nt)) : "";
    return {
      day: i + 1,
      tanakh,
      psalm: "",
      proverbs: "",
      brit_chadashah: nt,
      theme: refs[0] ? `${refs[0].book} ${refs[0].ch}` : "",
      questions: [],
    };
  });
}

const generators: Record<string, () => PlanDay[]> = {
  "nt-90": generateNT90,
  "torah-50": generateTorah50,
  "psalms-30": generatePsalms30,
  "whole-bible-1yr": generateWholeBible1yr,
};

export function generatePlan(templateId: string): PlanDay[] | null {
  return generators[templateId]?.() ?? null;
}
