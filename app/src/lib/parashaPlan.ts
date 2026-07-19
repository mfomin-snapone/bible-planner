import type { PlanDay } from "../types";
import { generateQuestions } from "./planTemplates";

const MS_PER_DAY = 86_400_000;

interface Sedra {
  title: string;
  hebrew: string;
  jsDate: Date;
  torah: string;
  haftarah: string;
}

const yearCache = new Map<number, Promise<Sedra[]>>();

/** Weekly parashat-hashavua data for a Gregorian year, from Hebcal's public API. */
function fetchSedrotForGregorianYear(year: number): Promise<Sedra[]> {
  let cached = yearCache.get(year);
  if (cached) return cached;
  cached = fetch(
    `https://www.hebcal.com/hebcal?v=1&cfg=json&s=on&maj=off&min=off&mod=off&nx=off&year=${year}&month=x`,
  )
    .then((res) => {
      if (!res.ok) throw new Error(`Hebcal request failed (${res.status})`);
      return res.json();
    })
    .then((data: { items?: Array<Record<string, unknown>> }) =>
      (data.items ?? [])
        .filter((it) => it.category === "parashat")
        .map((it): Sedra => {
          const [y, m, d] = String(it.date).split("-").map(Number);
          const leyning = (it.leyning ?? {}) as { torah?: string; haftarah?: string };
          return {
            title: String(it.title ?? ""),
            hebrew: String(it.hebrew ?? ""),
            jsDate: new Date(y, m - 1, d),
            torah: leyning.torah ?? "",
            haftarah: leyning.haftarah ?? "",
          };
        }),
    );
  yearCache.set(year, cached);
  return cached;
}

/**
 * The traditional annual Torah portion cycle (parashat hashavua), synced to
 * the real Hebrew calendar — including which weeks combine two portions —
 * via Hebcal's public API rather than re-deriving the leap-year/double-portion
 * rules by hand. `anchor` is the calendar date that plan day 1 represents;
 * each subsequent day repeats that week's portion until the next Shabbat.
 */
export async function generateParashaPlan(anchor: Date, days: number): Promise<PlanDay[]> {
  const anchorMidnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const lastDate = new Date(anchorMidnight.getTime() + (days - 1) * MS_PER_DAY);
  const years = new Set<number>();
  for (let y = anchorMidnight.getFullYear() - 1; y <= lastDate.getFullYear(); y++) years.add(y);

  const lists = await Promise.all(Array.from(years, fetchSedrotForGregorianYear));
  const sedrot = lists.flat().sort((a, b) => a.jsDate.getTime() - b.jsDate.getTime());
  if (sedrot.length === 0) throw new Error("No parashah data available");

  const plan: PlanDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(anchorMidnight.getTime() + i * MS_PER_DAY);
    // "This week's" portion is read on the next Shabbat on/after `date`.
    const sedra = sedrot.find((s) => s.jsDate.getTime() >= date.getTime()) ?? sedrot[sedrot.length - 1];
    plan.push({
      day: i + 1,
      tanakh: sedra.torah,
      psalm: "",
      proverbs: "",
      brit_chadashah: "",
      theme: sedra.haftarah ? `${sedra.title} — Haftarah: ${sedra.haftarah}` : sedra.title,
      questions: generateQuestions(i + 1, sedra.title),
    });
  }
  return plan;
}
