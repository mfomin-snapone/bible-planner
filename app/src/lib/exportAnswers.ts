import { PLAN_TEMPLATES, generatePlan, generateCustomPlan } from "./planTemplates";
import { generateParashaPlan } from "./parashaPlan";
import { dateForDay } from "./schedule";
import { QUESTION_LABELS, type PlanDay, type Settings } from "../types";

type AnswersSource = {
  settings: Settings;
  answers: Record<string, string>;
  customQuestions: Record<string, string[]>;
};

let cachedDefaultPlan: Promise<PlanDay[]> | null = null;

function loadDefaultPlan(): Promise<PlanDay[]> {
  if (!cachedDefaultPlan) {
    cachedDefaultPlan = fetch("/plan.json").then((res) => res.json());
  }
  return cachedDefaultPlan;
}

/**
 * Best-effort reconstruction of a template's day-by-day content for export.
 * Generated templates are pure functions of fixed data, so they reproduce
 * exactly. "custom" and "parasha" depend on settings that may have changed
 * since the answers were written (book selection/pace, or start date) — the
 * export flags those sections so the caveat is visible, not silent.
 */
async function getPlanDaysForExport(templateId: string, settings: Settings): Promise<PlanDay[] | null> {
  try {
    if (templateId === "default") return await loadDefaultPlan();
    if (templateId === "custom") {
      return generateCustomPlan(settings.customPlanBookIds ?? [], settings.customPlanPace ?? 3, true);
    }
    if (templateId === "parasha") {
      const anchor = settings.startDate ? dateForDay(settings, 1) ?? new Date() : new Date();
      return await generateParashaPlan(anchor, 400);
    }
    return generatePlan(templateId);
  } catch {
    return null;
  }
}

function htmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every distinct plan template id referenced by any saved answer or custom question. */
function templateIdsWithData(state: AnswersSource): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(state.answers)) {
    const i = key.indexOf("::");
    if (i > 0) ids.add(key.slice(0, i));
  }
  for (const key of Object.keys(state.customQuestions)) {
    const i = key.indexOf("::");
    if (i > 0) ids.add(key.slice(0, i));
  }
  return [...ids];
}

/** Days (for one template) that have any recorded answer or custom question. */
function daysWithData(state: AnswersSource, templateId: string): number[] {
  const days = new Set<number>();
  const prefix = `${templateId}::`;
  for (const key of Object.keys(state.answers)) {
    if (!key.startsWith(prefix)) continue;
    const m = key.slice(prefix.length).match(/^(\d+):/);
    if (m) days.add(Number(m[1]));
  }
  for (const key of Object.keys(state.customQuestions)) {
    if (!key.startsWith(prefix)) continue;
    const d = Number(key.slice(prefix.length));
    if (!Number.isNaN(d)) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

export async function buildAnswersExport(state: AnswersSource): Promise<string> {
  const templateIds = templateIdsWithData(state);
  const lines: string[] = [];
  lines.push("Shema Study — Exported Study Answers");
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)}`);

  if (templateIds.length === 0) {
    lines.push("");
    lines.push("You haven't written any study answers yet.");
    return lines.join("\n");
  }

  for (const templateId of templateIds) {
    const template = PLAN_TEMPLATES.find((t) => t.id === templateId);
    const label = template?.name ?? templateId;
    lines.push("");
    lines.push("=".repeat(60));
    lines.push(label);
    if (templateId === "custom" || templateId === "parasha") {
      lines.push(
        "(Regenerated from your current settings for this plan — passages may not exactly match what you saw if you've reconfigured it since answering.)",
      );
    }
    lines.push("=".repeat(60));

    const plan = await getPlanDaysForExport(templateId, state.settings);
    const days = daysWithData(state, templateId);

    for (const day of days) {
      const planDay = plan?.[day - 1];
      lines.push("");
      lines.push(`--- Day ${day}${planDay?.theme ? ` — ${planDay.theme}` : ""} ---`);
      const refs = planDay
        ? [planDay.tanakh, planDay.psalm, planDay.proverbs, planDay.brit_chadashah].filter(Boolean).join(" · ")
        : "";
      if (refs) lines.push(refs);

      if (planDay) {
        planDay.questions.forEach((q, idx) => {
          const answer = state.answers[`${templateId}::${day}:q:${idx}`];
          if (!answer) return;
          lines.push("");
          lines.push(`[${QUESTION_LABELS[q.type] ?? q.type}] ${q.text}`);
          lines.push(htmlToText(answer) || "(no answer written)");
        });
      }

      const customQs = state.customQuestions[`${templateId}::${day}`] ?? [];
      customQs.forEach((qText, idx) => {
        const answer = state.answers[`${templateId}::${day}:cq:${idx}`];
        lines.push("");
        lines.push(`[My Question] ${qText}`);
        lines.push(htmlToText(answer) || "(no answer written)");
      });
    }
  }

  return lines.join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
