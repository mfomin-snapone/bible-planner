/**
 * Preset Bible reading plan templates.
 * The default plan comes from plan.json (full 365-day Messianic study plan).
 * All other templates generate simplified daily reading schedules.
 */
import { BIBLE_BOOKS, type BibleBook } from "./bibleBooks";
import { themeForBook } from "./bookThemes";
import type { PlanDay, Question } from "../types";

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
  {
    id: "four-plus-one",
    name: "Four Places a Day",
    description: "Four simultaneous strands each day — Torah & History, Prophets & Wisdom, Gospels & Acts, and Epistles & Revelation — plus a daily Psalm (the Psalter repeats over the year). Whole Bible in about a year.",
    days: 365,
    category: "reading",
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
  id?: number;
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

const OBSERVATION_Q = [
  "What stands out to you as you read {ref}?",
  "Who are the key people or groups in {ref}, and what do they do?",
  "What repeated words, images, or ideas do you notice in {ref}?",
  "What's the central event or claim in {ref}?",
  "What surprised you in {ref}?",
];
const WORD_STUDY_Q = [
  "Is there a name, title, or key term in {ref} worth looking up?",
  "Pick one word or phrase in {ref} that feels significant — what might it have meant to its first hearers?",
  "What historical or cultural background would help you understand {ref} better?",
  "Are there Hebrew or Greek ideas behind {ref} that get flattened in translation?",
];
const MESSIANIC_Q = [
  "How might {ref} point forward to, or echo, the person and work of Messiah?",
  "Does anything in {ref} anticipate themes later fulfilled in Yeshua?",
  "How does {ref} fit into God's larger redemptive story?",
  "What does {ref} reveal about God's character that finds its fullest expression in Messiah?",
];
const APPLICATION_Q = [
  "What is one specific way {ref} could shape your actions this week?",
  "Where do you see yourself in {ref} — and what is God inviting you to do?",
  "What would it look like to actually live out {ref} today?",
  "Is there a promise, warning, or command in {ref} you need to take to heart?",
];
const DISCUSSION_Q = [
  "What question would you want to bring to a group about {ref}?",
  "What part of {ref} would you want to talk through with someone else?",
  "Where might people disagree on how {ref} is usually understood?",
  "What would you ask someone who has studied {ref} more deeply than you?",
];

/**
 * Template-based study questions for generated plans — the hand-authored
 * default plan.json has its own bespoke questions instead. Gives every
 * generated plan the same five question types the app already supports
 * (observation/word study/messianic connection/application/discussion),
 * varied by day so they don't repeat verbatim, and anchored to that day's
 * actual reading rather than being generic filler.
 */
export function generateQuestions(day: number, ref: string): Question[] {
  if (!ref) return [];
  const pick = (bank: string[]) => bank[day % bank.length].replace("{ref}", ref);
  return [
    { type: "observation", text: pick(OBSERVATION_Q) },
    { type: "word_study", text: pick(WORD_STUDY_Q) },
    { type: "messianic_connection", text: pick(MESSIANIC_Q) },
    { type: "application", text: pick(APPLICATION_Q) },
    { type: "discussion", text: pick(DISCUSSION_Q) },
  ];
}

/** New Testament (Matthew–Revelation) in 90 days, ~3 ch/day */
function generateNT90(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .filter((b) => b.id >= 40)
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, id: b.id })));
  const perDay = Math.ceil(chapters.length / 90);
  return chunkArray(chapters, perDay).slice(0, 90).map((refs, i) => {
    const brit_chadashah = formatChapterRefs(refs);
    return {
      day: i + 1,
      tanakh: "",
      psalm: "",
      proverbs: "",
      brit_chadashah,
      theme: themeForBook(refs[0]?.id, brit_chadashah),
      questions: generateQuestions(i + 1, brit_chadashah),
    };
  });
}

/** Torah (Genesis–Deuteronomy) in 50 days */
function generateTorah50(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .filter((b) => b.id <= 5)
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, id: b.id })));
  const perDay = Math.ceil(chapters.length / 50);
  return chunkArray(chapters, perDay).slice(0, 50).map((refs, i) => {
    const tanakh = formatChapterRefs(refs);
    return {
      day: i + 1,
      tanakh,
      psalm: "",
      proverbs: "",
      brit_chadashah: "",
      theme: themeForBook(refs[0]?.id, tanakh),
      questions: generateQuestions(i + 1, tanakh),
    };
  });
}

/** Psalms (5/day) + Proverbs (1 ch/day) in 30 days */
function generatePsalms30(): PlanDay[] {
  const psalms = Array.from({ length: 150 }, (_, i) => ({ book: "Psalms", ch: i + 1 }));
  const proverbs = BIBLE_BOOKS.find((b) => b.id === 20)!;
  return Array.from({ length: 30 }, (_, i) => {
    const psalm = formatChapterRefs(psalms.slice(i * 5, i * 5 + 5));
    const proverbsRef = `Proverbs ${(i % proverbs.chapters) + 1}`;
    return {
      day: i + 1,
      tanakh: "",
      psalm,
      proverbs: proverbsRef,
      brit_chadashah: "",
      theme: themeForBook(19, `Psalms ${i * 5 + 1}–${i * 5 + 5}`),
      questions: generateQuestions(i + 1, `${psalm} and ${proverbsRef}`),
    };
  });
}

/** Whole Bible (Genesis–Revelation) in 365 days */
function generateWholeBible1yr(): PlanDay[] {
  const chapters = BIBLE_BOOKS
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, id: b.id, nt: b.id >= 40 })));
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
      theme: themeForBook(first?.id, tanakh || nt),
      questions: generateQuestions(i + 1, tanakh || nt),
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
    .flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, id: b.id, nt: b.id >= 40 })));

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
      theme: refs[0] ? themeForBook(refs[0].id, `${refs[0].book} ${refs[0].ch}`) : "",
      questions: generateQuestions(i + 1, tanakh || nt),
    };
  });
}

/**
 * Four simultaneous strands a day (a generated, canonical-order approximation
 * of the "four passages + a Psalm" reading style — not a reproduction of any
 * specific publisher's day-by-day schedule) plus the Psalter on repeat.
 */
function generateFourPlusOne(): PlanDay[] {
  const DAYS = 365;
  const chapterList = (books: BibleBook[]) =>
    books.flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.name, ch: i + 1, id: b.id })));

  const torahHistory = chapterList(BIBLE_BOOKS.filter((b) => b.id <= 17));
  const prophetsWisdom = chapterList(BIBLE_BOOKS.filter((b) => b.id === 18 || (b.id >= 20 && b.id <= 39)));
  const gospelsActs = chapterList(BIBLE_BOOKS.filter((b) => b.id >= 40 && b.id <= 44));
  const epistlesRevelation = chapterList(BIBLE_BOOKS.filter((b) => b.id >= 45 && b.id <= 66));

  const chunksOf = (strand: ChapterRef[]) => chunkArray(strand, Math.max(1, Math.ceil(strand.length / DAYS)));
  const [chunkA, chunkB, chunkC, chunkD] = [torahHistory, prophetsWisdom, gospelsActs, epistlesRevelation].map(chunksOf);

  return Array.from({ length: DAYS }, (_, i) => {
    const a = chunkA[i] ?? [];
    const b = chunkB[i] ?? [];
    const c = chunkC[i] ?? [];
    const d = chunkD[i] ?? [];
    const tanakh = [formatChapterRefs(a), formatChapterRefs(b)].filter(Boolean).join("; ");
    const nt = [formatChapterRefs(c), formatChapterRefs(d)].filter(Boolean).join("; ");
    const first = a[0] ?? b[0] ?? c[0] ?? d[0];
    return {
      day: i + 1,
      tanakh,
      psalm: `Psalms ${(i % 150) + 1}`,
      proverbs: "",
      brit_chadashah: nt,
      theme: first ? themeForBook(first.id, `${first.book} ${first.ch}`) : "",
      questions: generateQuestions(i + 1, tanakh || nt),
    };
  });
}

const generators: Record<string, () => PlanDay[]> = {
  "nt-90": generateNT90,
  "torah-50": generateTorah50,
  "psalms-30": generatePsalms30,
  "whole-bible-1yr": generateWholeBible1yr,
  "four-plus-one": generateFourPlusOne,
};

export function generatePlan(templateId: string): PlanDay[] | null {
  return generators[templateId]?.() ?? null;
}
