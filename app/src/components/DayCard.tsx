import { useState } from "react";
import { getHebrewDateInfo, type HebrewHoliday } from "../lib/hebrewCalendar";
import { dateForDay, isDayComplete, progressKey } from "../lib/schedule";
import { useAppState } from "../state/AppState";
import {
  QUESTION_LABELS,
  TRACK_LABELS,
  TRACKS,
  type PlanDay,
  type QuestionType,
  type Track,
} from "../types";
import {
  BookIcon,
  BooksIcon,
  ChatIcon,
  CheckCircleIcon,
  EyeIcon,
  LampIcon,
  MusicIcon,
  SearchIcon,
  StarIcon,
  WalkIcon,
} from "./icons";
import { ReaderOverlay, type ReaderRequest } from "./ReaderOverlay";
import { RichTextEditor } from "./RichTextEditor";

const TRACK_ICONS: Record<Track, typeof BookIcon> = {
  tanakh: BooksIcon,
  psalm: MusicIcon,
  proverbs: LampIcon,
  brit_chadashah: BookIcon,
};

const QUESTION_ICONS: Record<QuestionType, typeof BookIcon> = {
  observation: EyeIcon,
  word_study: SearchIcon,
  messianic_connection: StarIcon,
  application: WalkIcon,
  discussion: ChatIcon,
};

export function DayCard({ day }: { day: PlanDay }) {
  const { settings, progress, toggleProgress, answers, updateAnswer, customQuestions, addCustomQuestion, removeCustomQuestion } = useAppState();
  const [reader, setReader] = useState<ReaderRequest | null>(null);
  const [addingQ, setAddingQ] = useState(false);
  const [newQText, setNewQText] = useState("");

  const date = dateForDay(settings, day.day);
  const hebrewInfo = date
    ? getHebrewDateInfo(date.getFullYear(), date.getMonth() + 1, date.getDate())
    : null;
  const dayComplete = isDayComplete(progress, settings.planTemplateId, day.day);
  const customQKey = `${settings.planTemplateId}::${day.day}`;

  return (
    <>
      <div className="card">
        <div className="day-header">
          <span className="small muted" style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Day {day.day}
            {dayComplete && (
              <span className="day-complete-badge">
                <CheckCircleIcon filled /> Complete
              </span>
            )}
          </span>
          {date && (
            <span className="small muted">
              {date.toLocaleDateString(undefined, {
                weekday: "short",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        <div className="day-theme">{day.theme}</div>

        {hebrewInfo && hebrewInfo.holidays.length > 0 && (
          <div className="holiday-row">
            {hebrewInfo.holidays.map((h) => (
              <HolidayBadge key={h.name} holiday={h} />
            ))}
          </div>
        )}
        {hebrewInfo && (
          <div className="hebrew-date small muted">
            {hebrewInfo.day} {hebrewInfo.monthName} {hebrewInfo.year}
          </div>
        )}
      </div>

      <div className="section-label">Readings</div>
      <div className="card" style={{ paddingTop: 4, paddingBottom: 4, overflow: "hidden" }}>
        {TRACKS.filter((track) => day[track]).map((track) => {
          const Icon = TRACK_ICONS[track];
          const done = progress.has(progressKey(settings.planTemplateId, day.day, track));
          return (
            <div className={`reading-row ${done ? "done" : ""}`} key={track}>
              <button
                className="reading-main"
                onClick={() =>
                  setReader({ reference: day[track], day: day.day, track })
                }
                title={`Read ${day[track]}`}
              >
                <Icon />
                <span style={{ minWidth: 0 }}>
                  <span className="reading-track">{TRACK_LABELS[track]}</span>
                  <br />
                  <span className="reading-ref">{day[track]}</span>
                </span>
              </button>
              <button
                className={`check-btn ${done ? "done" : ""}`}
                onClick={() => toggleProgress(day.day, track)}
                aria-label={`Mark ${TRACK_LABELS[track]} ${done ? "unread" : "read"}`}
                aria-pressed={done}
              >
                <CheckCircleIcon filled={done} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ margin: "0 4px 4px" }}>
        Tap a passage to read it ({settings.translation}). Tap the circle to mark it done.
      </p>

      <div className="section-label">Study Questions</div>
      <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {day.questions.map((question, idx) => {
          const Icon = QUESTION_ICONS[question.type] ?? ChatIcon;
          const answerKey = `${settings.planTemplateId}::${day.day}:q:${idx}`;
          return (
            <div className="question" key={question.type + question.text.slice(0, 12)}>
              <div className="question-label">
                <Icon className="q-icon" />
                {QUESTION_LABELS[question.type] ?? question.type}
              </div>
              <div className="question-text">{question.text}</div>
              <RichTextEditor
                value={answers[answerKey] ?? ""}
                onChange={(html) => updateAnswer(answerKey, html)}
                onVerseClick={(ref) => setReader({ reference: ref })}
                placeholder="Write your answer…"
              />
            </div>
          );
        })}
      </div>

      {/* ── Custom Questions ─────────────────────────────────────────────── */}
      <div className="section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>My Questions</span>
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 10px", fontSize: "0.78rem" }}
          onClick={() => setAddingQ(true)}
        >
          + Add
        </button>
      </div>

      {addingQ && (
        <div className="card custom-q-add">
          <input
            className="custom-q-input"
            value={newQText}
            onChange={(e) => setNewQText(e.target.value)}
            placeholder="Type your study question…"
            maxLength={300}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newQText.trim()) {
                addCustomQuestion(day.day, newQText.trim());
                setNewQText("");
                setAddingQ(false);
              }
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                if (newQText.trim()) {
                  addCustomQuestion(day.day, newQText.trim());
                  setNewQText("");
                  setAddingQ(false);
                }
              }}
              disabled={!newQText.trim()}
            >
              Save
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setNewQText(""); setAddingQ(false); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(customQuestions[customQKey] ?? []).length > 0 && (
        <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {(customQuestions[customQKey] ?? []).map((qText, idx) => {
            const answerKey = `${settings.planTemplateId}::${day.day}:cq:${idx}`;
            return (
              <div className="question" key={idx}>
                <div className="question-label" style={{ justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ChatIcon className="q-icon" />
                    My Question
                  </div>
                  <button
                    className="custom-q-remove"
                    onClick={() => removeCustomQuestion(day.day, idx)}
                    aria-label="Remove question"
                  >
                    Remove
                  </button>
                </div>
                <div className="question-text">{qText}</div>
                <RichTextEditor
                  value={answers[answerKey] ?? ""}
                  onChange={(html) => updateAnswer(answerKey, html)}
                  onVerseClick={(ref) => setReader({ reference: ref })}
                  placeholder="Write your answer…"
                />
              </div>
            );
          })}
        </div>
      )}

      {reader && <ReaderOverlay request={reader} onClose={() => setReader(null)} />}
    </>
  );
}

const HOLIDAY_TYPE_COLORS: Record<string, string> = {
  major: "var(--accent)",
  fast: "var(--danger)",
  shabbat: "var(--success)",
  modern: "#8b5cf6",
  minor: "var(--text-muted)",
  rosh_chodesh: "var(--text-muted)",
};

function HolidayBadge({ holiday }: { holiday: HebrewHoliday }) {
  const color = HOLIDAY_TYPE_COLORS[holiday.type] ?? "var(--accent)";
  return (
    <span className="holiday-badge" style={{ borderColor: color, color }}>
      {holiday.hebrewName && (
        <span className="holiday-hebrew">{holiday.hebrewName}</span>
      )}
      {holiday.name}
    </span>
  );
}
