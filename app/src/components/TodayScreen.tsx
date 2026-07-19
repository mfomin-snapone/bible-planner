import { useState } from "react";
import { catchMeUp, currentDay, daysBehind, firstIncompleteDay, todayIso } from "../lib/schedule";
import { TANAKH_BOOKS, BRIT_CHADASHAH_BOOKS, findDayForBook } from "../lib/planBooks";
import { useAppState } from "../state/AppState";
import { BookIcon, ClockBackIcon } from "./icons";
import { DayCard } from "./DayCard";

export function TodayScreen() {
  const { plan, planLoading, settings, syncError } = useAppState();

  const day = currentDay(settings, plan.length);
  const planDay = day !== null ? plan[day - 1] : null;

  return (
    <>
      <div className="screen-title">Today</div>
      {syncError && (
        <p className="small muted" style={{ margin: "0 4px 10px" }}>
          {syncError}
        </p>
      )}
      {planLoading && <div className="spinner" />}
      {!planLoading && !planDay && <Onboarding />}
      {!planLoading && planDay && (
        <>
          <CatchUpBanner />
          <DayCard day={planDay} />
        </>
      )}
    </>
  );
}

function CatchUpBanner() {
  const { plan, settings, progress, updateSettings } = useAppState();
  const [confirming, setConfirming] = useState(false);

  const behind = daysBehind(settings, progress, plan.length);
  if (behind === 0) return null;

  const target = firstIncompleteDay(settings, progress, plan.length);

  return (
    <div className="banner">
      <ClockBackIcon />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: "var(--text-h)" }}>
          You're {behind} day{behind === 1 ? "" : "s"} behind
        </div>
        <div className="small muted">
          {confirming
            ? `Shift the schedule so today becomes Day ${target}?`
            : `Restart today at Day ${target}`}
        </div>
      </div>
      {confirming ? (
        <>
          <button
            className="btn"
            onClick={() => {
              updateSettings(catchMeUp(settings, progress, plan.length));
              setConfirming(false);
            }}
          >
            Confirm
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => setConfirming(true)}>
          Catch Me Up
        </button>
      )}
    </div>
  );
}

function Onboarding() {
  const { plan, updateSettings } = useAppState();
  const [startDate, setStartDate] = useState(todayIso());
  const [startDay, setStartDay] = useState(1);
  // "start from book" state
  const [pickBook, setPickBook] = useState(false);
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [bookSearchResult, setBookSearchResult] = useState<number | null>(null);
  const [bookNotFound, setBookNotFound] = useState(false);

  function handleBookLookup() {
    if (!selectedBook) return;
    const day = findDayForBook(plan, selectedBook, selectedChapter);
    if (day !== null) {
      setStartDay(day);
      setBookSearchResult(day);
      setBookNotFound(false);
    } else {
      setBookSearchResult(null);
      setBookNotFound(true);
    }
  }

  return (
    <div className="onboarding">
      <BookIcon />
      <h2>Shema Study</h2>
      <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
        365 days through the Tanakh, Psalms, Proverbs, and B'rit Chadashah — with an
        in-app Bible reader and daily study questions from a Messianic Jewish
        perspective (TLV).
      </p>
      <div className="controls">
        <div className="field">
          <label htmlFor="start-date">Start date</label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="start-day">Begin at day</label>
          <input
            id="start-day"
            type="number"
            min={1}
            max={plan.length || 365}
            value={startDay}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) {
                setStartDay(Math.min(Math.max(v, 1), plan.length || 365));
                setBookSearchResult(null);
              }
            }}
          />
        </div>

        {/* "Start from book" toggle */}
        <button
          className="btn btn-secondary btn-block"
          style={{ marginTop: 4 }}
          onClick={() => { setPickBook((v) => !v); setBookSearchResult(null); setBookNotFound(false); }}
        >
          {pickBook ? "Hide book picker" : "Start from a specific book…"}
        </button>

        {pickBook && (
          <div className="book-picker">
            <label className="book-picker-label">Book</label>
            <select
              className="book-picker-select"
              value={selectedBook}
              onChange={(e) => { setSelectedBook(e.target.value); setBookSearchResult(null); setBookNotFound(false); }}
            >
              <option value="">— Choose a book —</option>
              <optgroup label="Tanakh">
                {TANAKH_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </optgroup>
              <optgroup label="B'rit Chadashah">
                {BRIT_CHADASHAH_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </optgroup>
            </select>

            <label className="book-picker-label" style={{ marginTop: 6 }}>
              Chapter (optional)
            </label>
            <input
              className="book-picker-chapter"
              type="number"
              min={1}
              max={150}
              value={selectedChapter}
              onChange={(e) => { setSelectedChapter(Number(e.target.value) || 1); setBookSearchResult(null); }}
            />

            <button
              className="btn btn-secondary"
              style={{ marginTop: 6 }}
              onClick={handleBookLookup}
              disabled={!selectedBook}
            >
              Find day in plan
            </button>

            {bookSearchResult !== null && (
              <div className="book-picker-confirmed">
                <span>📖</span>
                <span>
                  <strong>{selectedBook}</strong> → Plan Day <strong>{bookSearchResult}</strong>
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ marginLeft: "auto", padding: "4px 10px", fontSize: "0.8rem" }}
                  onClick={() => { setBookSearchResult(null); setStartDay(1); }}
                >
                  Clear
                </button>
              </div>
            )}
            {bookNotFound && (
              <p className="book-picker-result book-picker-notfound">
                "{selectedBook}" was not found in the plan. Try a different book or chapter.
              </p>
            )}
          </div>
        )}

        <button
          className="btn btn-block"
          onClick={() => updateSettings({ startDate, startDay })}
          disabled={!startDate}
        >
          {bookSearchResult !== null
            ? `Start the Plan at Day ${startDay} (${selectedBook})`
            : startDay > 1
            ? `Start the Plan at Day ${startDay}`
            : "Start the Plan"}
        </button>
      </div>
    </div>
  );
}
