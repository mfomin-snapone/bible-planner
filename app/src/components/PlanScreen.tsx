import { useEffect, useMemo, useRef, useState } from "react";
import { currentDay, progressKey, dateForDay } from "../lib/schedule";
import { useAppState } from "../state/AppState";
import { TRACKS, type PlanDay, type Settings } from "../types";
import { DayCard } from "./DayCard";
import { PlanExportView } from "./PlanExportView";
import { ChevronIcon, CheckCircleIcon } from "./icons";

export function PlanScreen() {
  const { plan, planLoading, settings, progress } = useAppState();
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [exportDays, setExportDays] = useState<PlanDay[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  const today = currentDay(settings, plan.length);

  // Land on today's day automatically on first arrival at the list — the
  // Today button below still lets you jump back after scrolling away.
  useEffect(() => {
    if (hasAutoScrolled.current || planLoading || today === null || query.trim()) return;
    hasAutoScrolled.current = true;
    requestAnimationFrame(() => {
      document.getElementById(`plan-day-${today}`)?.scrollIntoView({ block: "center" });
    });
  }, [planLoading, today, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo).getTime() : null;
    const dFrom = dayFrom ? parseInt(dayFrom, 10) : null;
    const dTo = dayTo ? parseInt(dayTo, 10) : null;
    return plan.filter((d) => {
      if (q) {
        const matches =
          d.theme.toLowerCase().includes(q) ||
          d.tanakh.toLowerCase().includes(q) ||
          d.psalm.toLowerCase().includes(q) ||
          d.proverbs.toLowerCase().includes(q) ||
          d.brit_chadashah.toLowerCase().includes(q) ||
          String(d.day) === q;
        if (!matches) return false;
      }
      if (dFrom !== null && d.day < dFrom) return false;
      if (dTo !== null && d.day > dTo) return false;
      if (from !== null || to !== null) {
        const date = dateForDay(settings, d.day);
        if (!date) return false;
        const t = date.getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
      }
      return true;
    });
  }, [plan, query, dateFrom, dateTo, dayFrom, dayTo, settings]);

  const selected = openDay !== null ? plan[openDay - 1] : null;

  if (exportDays) {
    return <PlanExportView days={exportDays} onClose={() => setExportDays(null)} />;
  }

  if (selected) {
    return (
      <>
        <div className="screen-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button
            onClick={() => setOpenDay(null)}
            aria-label="Back to plan"
            style={{ display: "flex", color: "var(--accent)" }}
          >
            <ChevronIcon direction="left" className="q-icon" />
            Plan
          </button>
          <button
            className="btn btn-secondary"
            style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            onClick={() => setExportDays([selected])}
          >
            Export
          </button>
        </div>
        <DayCard day={selected} />
      </>
    );
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedDays(new Set());
  }

  function toggleDay(day: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selectedDays.has(d.day));

  return (
    <>
      <div className="screen-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Reading Plan
        <div style={{ display: "flex", gap: 6 }}>
          {!selectMode && today !== null && (
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
          <button
            className="btn btn-secondary"
            style={{ padding: "5px 12px", fontSize: "0.8rem" }}
            onClick={toggleSelectMode}
          >
            {selectMode ? "Cancel" : "Select & Export"}
          </button>
        </div>
      </div>

      <input
        className="search-input"
        type="search"
        placeholder="Search theme, passage, or day number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selectMode && (
        <>
          <div className="plan-filter-row">
            <label>
              From date
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              To date
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label>
              Day #
              <input
                type="number"
                className="plan-filter-day-num"
                min={1}
                placeholder="from"
                value={dayFrom}
                onChange={(e) => setDayFrom(e.target.value)}
              />
            </label>
            <label>
              &nbsp;
              <input
                type="number"
                className="plan-filter-day-num"
                min={1}
                placeholder="to"
                value={dayTo}
                onChange={(e) => setDayTo(e.target.value)}
              />
            </label>
          </div>
          <div className="plan-select-toolbar">
            <span className="small">{selectedDays.size} of {filtered.length} filtered days selected</span>
            <button
              className="groups-text-btn"
              style={{ marginLeft: "auto" }}
              onClick={() =>
                setSelectedDays(allFilteredSelected ? new Set() : new Set(filtered.map((d) => d.day)))
              }
            >
              {allFilteredSelected ? "Deselect all" : "Select all filtered"}
            </button>
          </div>
        </>
      )}

      {planLoading && <div className="spinner" />}

      <div ref={listRef}>
        {filtered.map((day) => (
          <PlanRow
            key={day.day}
            day={day}
            settings={settings}
            isToday={day.day === today}
            completed={TRACKS.filter((t) => progress.has(progressKey(settings.planTemplateId, day.day, t))).length}
            selectMode={selectMode}
            selected={selectedDays.has(day.day)}
            onOpen={() => (selectMode ? toggleDay(day.day) : setOpenDay(day.day))}
          />
        ))}
      </div>

      {selectMode && selectedDays.size > 0 && (
        <div className="plan-export-bar">
          <button
            className="btn"
            onClick={() => setExportDays(plan.filter((d) => selectedDays.has(d.day)))}
          >
            Export {selectedDays.size} Day{selectedDays.size === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </>
  );
}

function PlanRow({
  day,
  settings,
  isToday,
  completed,
  selectMode,
  selected,
  onOpen,
}: {
  day: PlanDay;
  settings: Settings;
  isToday: boolean;
  completed: number;
  selectMode: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const dotClass =
    completed === TRACKS.length ? "done" : completed > 0 ? "partial" : "";
  const date = dateForDay(settings, day.day);
  const dateLabel = date
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  return (
    <button className={`plan-row ${isToday ? "today" : ""}`} id={`plan-day-${day.day}`} onClick={onOpen}>
      {selectMode ? (
        <CheckCircleIcon filled={selected} className={`plan-row-checkbox ${selected ? "checked" : ""}`} />
      ) : (
        <span className={`plan-day-badge ${isToday ? "today" : ""}`}>
          {isToday ? "TODAY" : day.day}
        </span>
      )}
      <span className={`progress-dot ${dotClass}`} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="plan-row-title">{day.theme}</span>
        <br />
        <span className="plan-row-sub">
          {dateLabel && <span className="plan-row-date">{dateLabel} · </span>}
          {[day.tanakh, day.psalm, day.proverbs, day.brit_chadashah].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
