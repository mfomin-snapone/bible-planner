import { useMemo, useRef, useState } from "react";
import { currentDay, progressKey, dateForDay } from "../lib/schedule";
import { useAppState } from "../state/AppState";
import { TRACKS, type PlanDay, type Settings } from "../types";
import { DayCard } from "./DayCard";
import { ChevronIcon } from "./icons";

export function PlanScreen() {
  const { plan, planLoading, settings, progress } = useAppState();
  const [query, setQuery] = useState("");
  const [openDay, setOpenDay] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const today = currentDay(settings, plan.length);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plan;
    return plan.filter(
      (d) =>
        d.theme.toLowerCase().includes(q) ||
        d.tanakh.toLowerCase().includes(q) ||
        d.psalm.toLowerCase().includes(q) ||
        d.proverbs.toLowerCase().includes(q) ||
        d.brit_chadashah.toLowerCase().includes(q) ||
        String(d.day) === q,
    );
  }, [plan, query]);

  const selected = openDay !== null ? plan[openDay - 1] : null;

  if (selected) {
    return (
      <>
        <div className="screen-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setOpenDay(null)}
            aria-label="Back to plan"
            style={{ display: "flex", color: "var(--accent)" }}
          >
            <ChevronIcon direction="left" className="q-icon" />
            Plan
          </button>
        </div>
        <DayCard day={selected} />
      </>
    );
  }

  return (
    <>
      <div className="screen-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Reading Plan
        {today !== null && (
          <button
            className="btn btn-secondary"
            style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            onClick={() => {
              document
                .getElementById(`plan-day-${today}`)
                ?.scrollIntoView({ block: "center" });
            }}
          >
            Today
          </button>
        )}
      </div>

      <input
        className="search-input"
        type="search"
        placeholder="Search theme, passage, or day number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {planLoading && <div className="spinner" />}

      <div ref={listRef}>
        {filtered.map((day) => (
          <PlanRow
            key={day.day}
            day={day}
            settings={settings}
            isToday={day.day === today}
            completed={TRACKS.filter((t) => progress.has(progressKey(day.day, t))).length}
            onOpen={() => setOpenDay(day.day)}
          />
        ))}
      </div>
    </>
  );
}

function PlanRow({
  day,
  settings,
  isToday,
  completed,
  onOpen,
}: {
  day: PlanDay;
  settings: Settings;
  isToday: boolean;
  completed: number;
  onOpen: () => void;
}) {
  const dotClass =
    completed === TRACKS.length ? "done" : completed > 0 ? "partial" : "";
  const date = dateForDay(settings, day.day);
  const dateLabel = date
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  return (
    <button className="plan-row" id={`plan-day-${day.day}`} onClick={onOpen}>
      <span className={`plan-day-badge ${isToday ? "today" : ""}`}>
        {isToday ? "TODAY" : day.day}
      </span>
      <span className={`progress-dot ${dotClass}`} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="plan-row-title">{day.theme}</span>
        <br />
        <span className="plan-row-sub">
          {dateLabel && <span className="plan-row-date">{dateLabel} · </span>}
          {day.tanakh} · {day.psalm} · {day.proverbs} · {day.brit_chadashah}
        </span>
      </span>
    </button>
  );
}
