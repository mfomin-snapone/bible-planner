import { TRACKS, type Settings } from "../types";

const MS_PER_DAY = 86_400_000;

/** Local-midnight timestamp for an ISO yyyy-mm-dd date string. */
function localMidnight(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The plan day for a calendar date: `startDay` on `startDate`, advancing one plan day
 * per calendar day. Clamped to 1...totalDays. Null before the plan is started.
 */
export function currentDay(
  settings: Settings,
  totalDays: number,
  now = new Date(),
): number | null {
  if (!settings.startDate || totalDays <= 0) return null;
  const start = localMidnight(settings.startDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsed = Math.round((today - start) / MS_PER_DAY);
  return Math.min(Math.max(elapsed + settings.startDay, 1), totalDays);
}

/** The calendar date on which a plan day falls. */
export function dateForDay(settings: Settings, day: number): Date | null {
  if (!settings.startDate) return null;
  return new Date(localMidnight(settings.startDate) + (day - settings.startDay) * MS_PER_DAY);
}

/**
 * Progress is scoped per plan template so switching plans doesn't bleed one
 * plan's checked-off days into another's (and switching back restores it).
 */
export function progressKey(templateId: string, day: number, track: string): string {
  return `${templateId}::${day}::${track}`;
}

export function isDayComplete(progress: Set<string>, templateId: string, day: number): boolean {
  return TRACKS.every((track) => progress.has(progressKey(templateId, day, track)));
}

/** The earliest scheduled day (at or after startDay) that isn't fully checked off. */
export function firstIncompleteDay(
  settings: Settings,
  templateId: string,
  progress: Set<string>,
  totalDays: number,
): number {
  const lower = Math.min(Math.max(settings.startDay, 1), totalDays);
  for (let day = lower; day <= totalDays; day++) {
    if (!isDayComplete(progress, templateId, day)) return day;
  }
  return totalDays;
}

/** How many days the schedule has drifted ahead of actual checked-off progress. */
export function daysBehind(
  settings: Settings,
  templateId: string,
  progress: Set<string>,
  totalDays: number,
  now = new Date(),
): number {
  const current = currentDay(settings, totalDays, now);
  if (current === null) return 0;
  return Math.max(0, current - firstIncompleteDay(settings, templateId, progress, totalDays));
}

/** Settings patch that shifts the schedule so today becomes the first unfinished day. */
export function catchMeUp(
  settings: Settings,
  templateId: string,
  progress: Set<string>,
  totalDays: number,
  now = new Date(),
): Pick<Settings, "startDate" | "startDay"> {
  return {
    startDate: todayIso(now),
    startDay: firstIncompleteDay(settings, templateId, progress, totalDays),
  };
}
