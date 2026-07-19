import { dateForDay } from "../lib/schedule";
import { PLAN_TEMPLATES } from "../lib/planTemplates";
import { useAppState } from "../state/AppState";
import { QUESTION_LABELS, type PlanDay, type Settings } from "../types";
import { ArrowLeftIcon } from "./icons";

export function PlanExportView({ days, onClose }: { days: PlanDay[]; onClose: () => void }) {
  const { settings, answers, customQuestions } = useAppState();
  const templateId = settings.planTemplateId;
  const planName = PLAN_TEMPLATES.find((t) => t.id === templateId)?.name ?? "Reading Plan";

  const sorted = [...days].sort((a, b) => a.day - b.day);
  const rangeLabel =
    sorted.length === 0
      ? ""
      : sorted.length === 1
      ? `Day ${sorted[0].day}`
      : `${sorted.length} Days (Day ${sorted[0].day}–${sorted[sorted.length - 1].day})`;

  return (
    <div className="export-preview">
      <div className="export-toolbar no-print">
        <button className="btn btn-secondary" onClick={onClose}>
          <ArrowLeftIcon className="q-icon" /> Back
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="export-doc">
        <h1 className="export-doc-title">{planName}</h1>
        <p className="export-doc-subtitle">{rangeLabel} · Exported {new Date().toLocaleDateString()}</p>

        {sorted.map((day) => (
          <ExportDay key={day.day} day={day} settings={settings} templateId={templateId} answers={answers} customQuestions={customQuestions} />
        ))}
      </div>
    </div>
  );
}

function ExportDay({
  day, settings, templateId, answers, customQuestions,
}: {
  day: PlanDay;
  settings: Settings;
  templateId: string;
  answers: Record<string, string>;
  customQuestions: Record<string, string[]>;
}) {
  const date = dateForDay(settings, day.day);
  const refs = [day.tanakh, day.psalm, day.proverbs, day.brit_chadashah].filter(Boolean);
  const customQs = customQuestions[`${templateId}::${day.day}`] ?? [];

  return (
    <section className="export-day">
      <h2 className="export-day-title">
        Day {day.day}
        {date && <span className="export-day-date"> — {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>}
      </h2>
      <h3 className="export-day-theme">{day.theme}</h3>
      {refs.length > 0 && <p className="export-day-refs">{refs.join(" · ")}</p>}

      {day.questions.length > 0 && (
        <div className="export-questions">
          {day.questions.map((q, idx) => {
            const answer = answers[`${templateId}::${day.day}:q:${idx}`];
            return (
              <div className="export-question" key={idx}>
                <div className="export-question-label">{QUESTION_LABELS[q.type] ?? q.type}</div>
                <div className="export-question-text">{q.text}</div>
                <div
                  className="export-answer"
                  dangerouslySetInnerHTML={{ __html: answer || "<em>(no answer written)</em>" }}
                />
              </div>
            );
          })}
        </div>
      )}

      {customQs.length > 0 && (
        <div className="export-questions">
          {customQs.map((qText, idx) => {
            const answer = answers[`${templateId}::${day.day}:cq:${idx}`];
            return (
              <div className="export-question" key={idx}>
                <div className="export-question-label">My Question</div>
                <div className="export-question-text">{qText}</div>
                <div
                  className="export-answer"
                  dangerouslySetInnerHTML={{ __html: answer || "<em>(no answer written)</em>" }}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
