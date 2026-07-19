import type { Translation } from "../types";

export interface BibleVerse {
  verse: number;
  text: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<S>\d+<\/S>/g, "")
    .replace(/<sup>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const cache = new Map<string, BibleVerse[]>();

export async function fetchChapter(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<BibleVerse[]> {
  const key = `${translation}/${bookId}/${chapter}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await fetch(`https://bolls.life/get-text/${translation}/${bookId}/${chapter}/`);
  if (!res.ok) throw new Error(`Failed to load chapter (${res.status})`);
  const data: { verse: number; text: string }[] = await res.json();
  const verses = data.map((v) => ({ verse: v.verse, text: stripHtml(v.text) }));
  cache.set(key, verses);
  return verses;
}
