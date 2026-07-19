import { useAppState } from "../state/AppState";
import {
  THEME_OPTIONS,
  type Accent,
  type FontChoice,
  type TextAlign,
} from "../types";
import { CheckCircleIcon } from "./icons";

export const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: "deepblue", color: "#32597a", label: "Deep Blue" },
  { id: "olive", color: "#5f6b39", label: "Olive" },
  { id: "purple", color: "#6b4494", label: "Purple" },
  { id: "crimson", color: "#9e3040", label: "Crimson" },
  { id: "teal", color: "#217f80", label: "Teal" },
  { id: "amber", color: "#a1701a", label: "Amber" },
];

/**
 * The appearance controls, reused inline on the Settings screen and inside the
 * reader's "Aa" sheet — one set of settings, changeable anywhere, applied live.
 */
export function AppearanceControls({ showRedLetters = true }: { showRedLetters?: boolean }) {
  const { settings, updateSettings } = useAppState();

  return (
    <>
      <div className="setting-row" style={{ display: "block" }}>
        <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Background</label>
        <div className="theme-swatches" style={{ marginTop: 8 }}>
          {THEME_OPTIONS.map((theme) => (
            <button
              key={theme.id}
              className={`theme-swatch ${settings.themeMode === theme.id ? "selected" : ""}`}
              onClick={() => updateSettings({ themeMode: theme.id })}
              aria-pressed={settings.themeMode === theme.id}
            >
              <span className="disc" style={{ background: theme.swatch }} />
              {theme.label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row" style={{ display: "block" }}>
        <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Accent</label>
        <div className="swatches" style={{ marginTop: 8 }}>
          {ACCENTS.map((accent) => (
            <button
              key={accent.id}
              className={`swatch ${settings.accent === accent.id ? "selected" : ""}`}
              style={{ background: accent.color }}
              onClick={() => updateSettings({ accent: accent.id })}
              aria-label={accent.label}
              aria-pressed={settings.accent === accent.id}
            >
              {settings.accent === accent.id && <CheckCircleIcon filled />}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <label htmlFor="font-select">Font</label>
        <select
          id="font-select"
          value={settings.font}
          onChange={(e) => updateSettings({ font: e.target.value as FontChoice })}
        >
          <option value="system">System</option>
          <option value="serif">Serif</option>
          <option value="rounded">Rounded</option>
          <option value="mono">Monospaced</option>
        </select>
      </div>

      {/* ── Granular font size slider ────────────────────────────── */}
      <div className="setting-row" style={{ display: "block" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Font size</label>
          <span className="small muted">{settings.fontSize ?? 16}px</span>
        </div>
        <input
          type="range"
          className="appearance-slider"
          min={12}
          max={28}
          step={1}
          value={settings.fontSize ?? 16}
          onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
        />
        <div className="slider-labels">
          <span>12</span><span>16</span><span>20</span><span>24</span><span>28</span>
        </div>
      </div>

      {/* ── Line height slider ───────────────────────────────────── */}
      <div className="setting-row" style={{ display: "block" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Line height</label>
          <span className="small muted">{(settings.lineHeight ?? 1.55).toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="appearance-slider"
          min={1.0}
          max={2.5}
          step={0.05}
          value={settings.lineHeight ?? 1.55}
          onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
        />
        <div className="slider-labels">
          <span>1.0</span><span>1.5</span><span>2.0</span><span>2.5</span>
        </div>
      </div>

      {/* ── Letter spacing slider ────────────────────────────────── */}
      <div className="setting-row" style={{ display: "block" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Letter spacing</label>
          <span className="small muted">{((settings.letterSpacing ?? 0) * 1000).toFixed(0)} ‰em</span>
        </div>
        <input
          type="range"
          className="appearance-slider"
          min={-0.05}
          max={0.15}
          step={0.005}
          value={settings.letterSpacing ?? 0}
          onChange={(e) => updateSettings({ letterSpacing: Number(e.target.value) })}
        />
        <div className="slider-labels">
          <span>Tight</span><span>Normal</span><span>Wide</span>
        </div>
      </div>

      {/* ── Text alignment ───────────────────────────────────────── */}
      <div className="setting-row">
        <label style={{ fontWeight: 500, color: "var(--text-h)" }}>Alignment</label>
        <div className="segmented" role="group" aria-label="Text alignment">
          {(["left", "center", "right", "justify"] as TextAlign[]).map((align) => (
            <button
              key={align}
              className={(settings.textAlign ?? "left") === align ? "active" : ""}
              onClick={() => updateSettings({ textAlign: align })}
              aria-pressed={(settings.textAlign ?? "left") === align}
              title={align.charAt(0).toUpperCase() + align.slice(1)}
              style={{ fontSize: "0.78rem", padding: "5px 10px" }}
            >
              {align === "left" && "⬤≡≡"}
              {align === "center" && "≡⬤≡"}
              {align === "right" && "≡≡⬤"}
              {align === "justify" && "≡≡≡"}
            </button>
          ))}
        </div>
      </div>
      {showRedLetters && (
        <div className="setting-row">
          <label id="red-letters-label">Words of Yeshua in red</label>
          <button
            className={`toggle ${settings.redLetters ? "on" : ""}`}
            role="switch"
            aria-checked={settings.redLetters}
            aria-labelledby="red-letters-label"
            onClick={() => updateSettings({ redLetters: !settings.redLetters })}
          />
        </div>
      )}
    </>
  );
}

/** Bottom-sheet wrapper for the appearance controls (the reader's "Aa" panel). */
export function AppearanceSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Appearance">
        <div className="sheet-handle" />
        <AppearanceControls />
        <button className="btn btn-secondary btn-block" style={{ marginTop: 16 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
