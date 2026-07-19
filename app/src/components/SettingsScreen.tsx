import { useState } from "react";
import { catchMeUp, currentDay, daysBehind, firstIncompleteDay, isDayComplete } from "../lib/schedule";
import { useAppState } from "../state/AppState";
import { TRACKS, TRANSLATIONS, type Translation } from "../types";
import { AppearanceControls } from "./AppearancePanel";
import { AuthForm } from "./AuthScreen";
import { ClockBackIcon, UserCircleIcon } from "./icons";
import { AVATAR_PRESETS, getAvatar } from "../lib/avatars";
import { updateProfile } from "../lib/api";

export function SettingsScreen() {
  const { plan, settings, progress, updateSettings, resetProgress } = useAppState();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmCatchUp, setConfirmCatchUp] = useState(false);

  const total = plan.length;
  const totalReadings = total * TRACKS.length;
  const fraction = totalReadings > 0 ? progress.size / totalReadings : 0;
  const completeDays =
    total > 0
      ? Array.from({ length: total }, (_, i) => i + 1).filter((d) =>
          isDayComplete(progress, d),
        ).length
      : 0;
  const today = currentDay(settings, total);
  const behind = daysBehind(settings, progress, total);

  return (
    <>
      <div className="screen-title">Settings</div>

      <div className="section-label">Progress</div>
      <div className="card">
        <div className="progress-bar">
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          {Math.round(fraction * 100)}% of all readings complete
        </p>
        <div className="setting-row">
          <label>Days fully completed</label>
          <span className="muted">
            {completeDays} of {total}
          </span>
        </div>
        <div className="setting-row">
          <label>Readings checked off</label>
          <span className="muted">
            {progress.size} of {totalReadings}
          </span>
        </div>
      </div>

      <div className="section-label">Appearance</div>
      <div className="card">
        <AppearanceControls />
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Shema Yisrael — Hear O Israel, Adonai our God, Adonai is one. (Deuteronomy 6:4)
        </p>
      </div>

      <div className="section-label">Bible</div>
      <div className="card">
        <div className="setting-row">
          <label htmlFor="translation-select">Translation</label>
          <select
            id="translation-select"
            value={settings.translation}
            onChange={(e) =>
              updateSettings({ translation: e.target.value as Translation })
            }
          >
            {TRANSLATIONS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label} ({t.code})
              </option>
            ))}
          </select>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Passages open in the built-in reader. Text is fetched per chapter (internet
          required) and cached for the session.
        </p>
      </div>

      <div className="section-label">Plan</div>
      <div className="card">
        {settings.startDate ? (
          <>
            <div className="setting-row">
              <label htmlFor="start-date-setting">Start date</label>
              <input
                id="start-date-setting"
                type="date"
                value={settings.startDate}
                onChange={(e) => updateSettings({ startDate: e.target.value })}
              />
            </div>
            <div className="setting-row">
              <label htmlFor="start-day-setting">Day on start date</label>
              <input
                id="start-day-setting"
                type="number"
                min={1}
                max={total || 365}
                style={{ width: 84 }}
                value={settings.startDay}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) {
                    updateSettings({
                      startDay: Math.min(Math.max(v, 1), total || 365),
                    });
                  }
                }}
              />
            </div>
            <div className="setting-row">
              <label>Current day</label>
              <span className="muted">{today !== null ? `Day ${today}` : "—"}</span>
            </div>
            {behind > 0 && (
              <div className="setting-row">
                <label>
                  <ClockBackIcon className="q-icon" /> {behind} day
                  {behind === 1 ? "" : "s"} behind
                </label>
                {confirmCatchUp ? (
                  <span style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        updateSettings(catchMeUp(settings, progress, total));
                        setConfirmCatchUp(false);
                      }}
                    >
                      Confirm Day {firstIncompleteDay(settings, progress, total)}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setConfirmCatchUp(false)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-secondary" onClick={() => setConfirmCatchUp(true)}>
                    Catch Me Up
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Plan not started yet — set a start date from the Today tab.
          </p>
        )}
      </div>

      <div className="section-label">Account & Sync</div>
      <AccountCard />

      <div className="section-label">About</div>
      <div className="card">
        <div className="setting-row">
          <label>Plan</label>
          <span className="muted">{total || 365} days, 4 tracks</span>
        </div>
        <div className="setting-row">
          <label>Perspective</label>
          <span className="muted">Messianic Jewish (TLV)</span>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Tanakh in traditional order, a Psalm and a Proverb a day, and the B'rit
          Chadashah — with daily study questions.
        </p>
      </div>

      <div className="card">
        {confirmReset ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="small" style={{ flex: 1 }}>
              Reset all reading progress? This cannot be undone.
            </span>
            <button
              className="btn btn-danger"
              onClick={() => {
                resetProgress();
                setConfirmReset(false);
              }}
            >
              Reset
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-danger btn-block" onClick={() => setConfirmReset(true)}>
            Reset All Progress
          </button>
        )}
      </div>
    </>
  );
}

function AccountCard() {
  const { user, logout, updateSettings } = useAppState();
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const currentAvatar = user?.avatar ?? "default";

  async function handleAvatarChange(id: string) {
    if (!user) return;
    setSavingAvatar(true);
    setAvatarMsg(null);
    try {
      await updateProfile(id);
      // Update local user record
      updateSettings({}); // trigger re-render (user state is in AppState)
      // Patch stored user
      const raw = localStorage.getItem("bible-planner:user");
      if (raw) {
        const u = JSON.parse(raw) as { avatar?: string };
        u.avatar = id;
        localStorage.setItem("bible-planner:user", JSON.stringify(u));
      }
      setAvatarMsg("Avatar updated!");
      setTimeout(() => setAvatarMsg(null), 2000);
    } catch {
      setAvatarMsg("Failed to save — try again.");
    }
    setSavingAvatar(false);
  }

  if (user) {
    const preset = getAvatar(currentAvatar);
    return (
      <div className="card">
        <div className="setting-row">
          <label>Signed in as</label>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="avatar-circle"
              style={{ background: preset.bg, color: preset.fg }}
              aria-hidden
            >
              {preset.symbol}
            </span>
            <span className="muted">{user.username}</span>
          </span>
        </div>

        <div style={{ paddingTop: 10 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 500, color: "var(--text-h)", display: "flex", alignItems: "center", gap: 6 }}>
            <UserCircleIcon className="q-icon" /> Profile picture
          </p>
          <div className="avatar-grid">
            {AVATAR_PRESETS.map((a) => (
              <button
                key={a.id}
                className={`avatar-opt ${currentAvatar === a.id ? "selected" : ""}`}
                style={{ background: a.bg, color: a.fg }}
                title={a.label}
                disabled={savingAvatar}
                onClick={() => void handleAvatarChange(a.id)}
                aria-label={a.label}
                aria-pressed={currentAvatar === a.id}
              >
                {a.symbol}
              </button>
            ))}
          </div>
          {avatarMsg && <p className="small" style={{ margin: "6px 0 0", color: avatarMsg.startsWith("Failed") ? "var(--danger)" : "var(--success)" }}>{avatarMsg}</p>}
        </div>

        <p className="small muted" style={{ margin: "12px 0 12px" }}>
          Your progress and settings sync to this account across all your devices.
        </p>
        <button className="btn btn-secondary btn-block" onClick={logout}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="small muted" style={{ marginTop: 0 }}>
        Works fully on this device without an account. Sign in to sync your progress
        across devices.
      </p>
      <AuthForm />
    </div>
  );
}
