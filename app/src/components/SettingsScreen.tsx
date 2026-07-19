import { useState, useRef } from "react";
import { catchMeUp, currentDay, daysBehind, firstIncompleteDay, isDayComplete, todayIso } from "../lib/schedule";
import { useAppState } from "../state/AppState";
import { TRACKS, TRANSLATIONS, type Translation } from "../types";
import { AppearanceControls } from "./AppearancePanel";
import { AuthForm } from "./AuthScreen";
import { BellIcon, ClockBackIcon, UserCircleIcon } from "./icons";
import { AVATAR_PRESETS, getAvatar } from "../lib/avatars";
import { AvatarDisplay, AvatarIcon } from "../lib/AvatarIcon";
import { updateProfile } from "../lib/api";
import { PLAN_TEMPLATES } from "../lib/planTemplates";
import { CustomPlanBuilderSheet } from "./CustomPlanBuilder";
import { DayNumberInput } from "./DayNumberInput";
import { buildAnswersExport, downloadTextFile } from "../lib/exportAnswers";

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
          isDayComplete(progress, settings.planTemplateId, d),
        ).length
      : 0;
  const today = currentDay(settings, total);
  const behind = daysBehind(settings, settings.planTemplateId, progress, total);
  const activeTemplate = PLAN_TEMPLATES.find((t) => t.id === settings.planTemplateId) ?? PLAN_TEMPLATES[0];

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
              <DayNumberInput
                id="start-day-setting"
                value={settings.startDay}
                max={total || 365}
                style={{ width: 84 }}
                onCommit={(v) => updateSettings({ startDay: v })}
              />
            </div>
            <div className="setting-row">
              <label>Current day</label>
              <span className="muted">{today !== null ? `Day ${today}` : "—"}</span>
            </div>
            <div className="setting-row">
              <label>Schedule</label>
              {behind > 0 ? (
                <span className="status-pill status-pill--behind">
                  <ClockBackIcon className="q-icon" /> {behind} day{behind === 1 ? "" : "s"} behind
                </span>
              ) : (
                <span className="status-pill status-pill--ontrack">On track</span>
              )}
            </div>
            {behind > 0 && (
              <div className="setting-row">
                <label>Catch up</label>
                {confirmCatchUp ? (
                  <span style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        updateSettings(catchMeUp(settings, settings.planTemplateId, progress, total));
                        setConfirmCatchUp(false);
                      }}
                    >
                      Confirm Day {firstIncompleteDay(settings, settings.planTemplateId, progress, total)}
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

      <RemindersCard />
      <PlanTemplateCard />
      <ExportAnswersCard />

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
              Reset progress for "{activeTemplate.name}"? This cannot be undone. (Other plans you've used keep their progress.)
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
            Reset This Plan's Progress
          </button>
        )}
      </div>
    </>
  );
}

function RemindersCard() {
  const { settings, updateSettings } = useAppState();
  const [permDenied, setPermDenied] = useState(false);

  async function handleToggle() {
    if (!settings.reminderEnabled) {
      if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm === "denied") { setPermDenied(true); return; }
      }
    }
    setPermDenied(false);
    updateSettings({ reminderEnabled: !settings.reminderEnabled });
  }

  return (
    <>
      <div className="section-label">
        <BellIcon className="q-icon" /> Reminders
      </div>
      <div className="card">
        <div className="setting-row">
          <label>Daily reminder</label>
          <button
            className={`toggle-btn ${settings.reminderEnabled ? "toggle-on" : ""}`}
            onClick={() => void handleToggle()}
            aria-checked={settings.reminderEnabled}
            role="switch"
          >
            {settings.reminderEnabled ? "On" : "Off"}
          </button>
        </div>
        {settings.reminderEnabled && (
          <>
            <div className="setting-row">
              <label>Time</label>
              <input
                type="time"
                value={settings.reminderTime}
                onChange={(e) => updateSettings({ reminderTime: e.target.value })}
              />
            </div>
            <div className="setting-row">
              <label>Days</label>
              <select
                value={settings.reminderFrequency}
                onChange={(e) =>
                  updateSettings({ reminderFrequency: e.target.value as "daily" | "weekdays" | "weekends" })
                }
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays only</option>
                <option value="weekends">Weekends only</option>
              </select>
            </div>
          </>
        )}
        {permDenied && (
          <p className="small muted" style={{ margin: "8px 0 0", color: "var(--danger, #e05)" }}>
            Notifications are blocked. Enable them in your browser or device settings.
          </p>
        )}
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          You'll receive a notification to open your reading for the day.
        </p>
      </div>
    </>
  );
}

function PlanTemplateCard() {
  const { settings, updateSettings } = useAppState();
  const [showPicker, setShowPicker] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<(typeof PLAN_TEMPLATES)[number] | null>(null);

  const active = PLAN_TEMPLATES.find((t) => t.id === settings.planTemplateId) ?? PLAN_TEMPLATES[0];
  const isCustom = active.id === "custom";

  function applySwitch(t: (typeof PLAN_TEMPLATES)[number]) {
    setPendingTemplate(null);
    if (t.id === "custom") {
      setShowBuilder(true);
      return;
    }
    if (t.id === "parasha") {
      // Anchors the cycle so "Day 1" is always today's actual portion.
      updateSettings({ planTemplateId: t.id, startDate: todayIso(), startDay: 1 });
      return;
    }
    updateSettings({ planTemplateId: t.id });
  }

  return (
    <>
      <div className="section-label">Reading Plan</div>
      <div className="card">
        <div className="setting-row">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "var(--text-h)" }}>{active.name}</div>
            <div className="small muted">
              {isCustom && settings.customPlanBookIds.length > 0
                ? `${settings.customPlanBookIds.length} book${settings.customPlanBookIds.length === 1 ? "" : "s"} · ${settings.customPlanPace} chapters/day`
                : active.description}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {isCustom && (
              <button
                className="btn btn-secondary"
                style={{ whiteSpace: "nowrap" }}
                onClick={() => setShowBuilder(true)}
              >
                Edit
              </button>
            )}
            <button className="btn btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => setShowPicker(true)}>
              Change
            </button>
          </div>
        </div>
        {showPicker && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {PLAN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="plan-template-option"
                data-active={t.id === settings.planTemplateId}
                onClick={() => {
                  setShowPicker(false);
                  if (t.id === settings.planTemplateId) {
                    // Re-picking the active plan just edits it (custom) — not a switch.
                    if (t.id === "custom") setShowBuilder(true);
                    return;
                  }
                  setPendingTemplate(t);
                }}
              >
                <span style={{ fontWeight: 600 }}>{t.name}</span>
                <span className="small muted">{t.description}</span>
              </button>
            ))}
            <button className="btn btn-secondary btn-block" style={{ marginTop: 4 }} onClick={() => setShowPicker(false)}>
              Cancel
            </button>
          </div>
        )}
        {pendingTemplate && (
          <div className="setting-row" style={{ display: "block" }}>
            <p className="small" style={{ margin: "0 0 10px" }}>
              Switch to "{pendingTemplate.name}"? Your progress on "{active.name}" is saved — switch back anytime to pick up where you left off.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-block" onClick={() => setPendingTemplate(null)}>
                Cancel
              </button>
              <button className="btn btn-block" onClick={() => applySwitch(pendingTemplate)}>
                Switch Plan
              </button>
            </div>
          </div>
        )}
      </div>
      {showBuilder && (
        <CustomPlanBuilderSheet
          initialBookIds={settings.customPlanBookIds}
          initialPace={settings.customPlanPace}
          onClose={() => setShowBuilder(false)}
          onSave={(bookIds, pace) => {
            updateSettings({ customPlanBookIds: bookIds, customPlanPace: pace, planTemplateId: "custom" });
            setShowBuilder(false);
          }}
        />
      )}
    </>
  );
}

function ExportAnswersCard() {
  const { settings, answers, customQuestions } = useAppState();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const hasAnyAnswers = Object.keys(answers).length > 0 || Object.keys(customQuestions).length > 0;

  return (
    <>
      <div className="section-label">Your Data</div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-h)" }}>Export study answers</div>
            <div className="small muted">
              Every answer and custom question you've written, across every plan you've used.
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: "nowrap" }}
            disabled={busy || !hasAnyAnswers}
            onClick={async () => {
              setBusy(true);
              setDone(false);
              try {
                const text = await buildAnswersExport({ settings, answers, customQuestions });
                downloadTextFile(`shema-study-answers-${new Date().toISOString().slice(0, 10)}.txt`, text);
                setDone(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
        {!hasAnyAnswers && (
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            You haven't written any study answers yet.
          </p>
        )}
        {done && (
          <p className="small" style={{ margin: "8px 0 0", color: "var(--success)" }}>
            Downloaded.
          </p>
        )}
      </div>
    </>
  );
}

function AccountCard() {
  const { user, logout, updateSettings } = useAppState();
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAvatar = user?.avatar ?? "default";

  function patchLocalAvatar(val: string) {
    const raw = localStorage.getItem("bible-planner:user");
    if (raw) {
      const u = JSON.parse(raw) as { avatar?: string };
      u.avatar = val;
      localStorage.setItem("bible-planner:user", JSON.stringify(u));
    }
    updateSettings({}); // trigger re-render
  }

  async function handleAvatarChange(id: string) {
    if (!user) return;
    setSavingAvatar(true);
    setAvatarMsg(null);
    try {
      await updateProfile(id);
      patchLocalAvatar(id);
      setAvatarMsg("Avatar updated!");
      setTimeout(() => setAvatarMsg(null), 2000);
    } catch {
      setAvatarMsg("Failed to save — try again.");
    }
    setSavingAvatar(false);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavingAvatar(true);
    setAvatarMsg(null);
    try {
      const dataUrl = await resizeImage(file, 200);
      await updateProfile(dataUrl);
      patchLocalAvatar(dataUrl);
      setAvatarMsg("Photo updated!");
      setTimeout(() => setAvatarMsg(null), 2000);
    } catch {
      setAvatarMsg("Failed to upload — try again.");
    }
    setSavingAvatar(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (user) {
    const preset = getAvatar(currentAvatar);
    const isPhoto = currentAvatar.startsWith("data:") || currentAvatar.startsWith("http");
    return (
      <div className="card">
        <div className="setting-row">
          <label>Signed in as</label>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AvatarDisplay
              avatarId={currentAvatar}
              bg={preset.bg}
              fg={preset.fg}
              username={user.username}
              className="avatar-circle"
              aria-hidden
            />
            <span className="muted">{user.username}</span>
          </span>
        </div>

        <div style={{ paddingTop: 10 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 500, color: "var(--text-h)", display: "flex", alignItems: "center", gap: 6 }}>
            <UserCircleIcon className="q-icon" /> Profile picture
          </p>

          {/* Photo upload */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => void handlePhotoUpload(e)}
            />
            <button
              className={`btn btn-secondary${isPhoto ? " btn-block" : ""}`}
              style={{ flex: isPhoto ? 1 : undefined }}
              disabled={savingAvatar}
              onClick={() => fileInputRef.current?.click()}
            >
              {isPhoto ? "Replace photo" : "Upload photo"}
            </button>
            {isPhoto && (
              <button
                className="btn btn-secondary"
                disabled={savingAvatar}
                onClick={() => void handleAvatarChange("default")}
              >
                Remove
              </button>
            )}
          </div>

          {/* Preset grid */}
          <div className="avatar-grid">
            {AVATAR_PRESETS.map((a) => (
              <button
                key={a.id}
                className={`avatar-opt ${!isPhoto && currentAvatar === a.id ? "selected" : ""}`}
                style={{ background: a.bg, color: a.fg }}
                title={a.label}
                disabled={savingAvatar}
                onClick={() => void handleAvatarChange(a.id)}
                aria-label={a.label}
                aria-pressed={!isPhoto && currentAvatar === a.id}
              >
                <AvatarIcon id={a.id} size={20} />
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

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}
