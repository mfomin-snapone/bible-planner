import { useEffect, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { BibleScreen } from "./components/BibleScreen";
import GroupsScreen from "./components/GroupsScreen";
import { BookIcon, GearIcon, ListIcon, SunIcon, UsersIcon } from "./components/icons";
import { PlanScreen } from "./components/PlanScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { TodayScreen } from "./components/TodayScreen";
import { getToken, uploadPublicKey } from "./lib/api";
import { getOrCreateKeyPair, exportPublicKey } from "./lib/encryption";
import { realtime, buildWsUrl } from "./lib/realtime";
import { useAppState } from "./state/AppState";

type Tab = "today" | "plan" | "bible" | "community" | "settings";

export default function App() {
  const { settings, user, skippedAuth, skipAuth } = useAppState();
  const [tab, setTab] = useState<Tab>("today");

  // Apply appearance settings as root data-attributes driving the CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme =
        settings.themeMode === "system"
          ? systemDark.matches
            ? "dark"
            : "light"
          : settings.themeMode;
      root.dataset.accent = settings.accent;
      root.dataset.font = settings.font;
      root.dataset.scale = settings.scale;
      root.dataset.textAlign = settings.textAlign ?? "left";
      // Granular typography overrides (inline style > data-scale CSS)
      root.style.setProperty("--base-size", `${settings.fontSize ?? 16}px`);
      root.style.setProperty("--line-height", `${settings.lineHeight ?? 1.55}`);
      root.style.setProperty("--letter-spacing", `${settings.letterSpacing ?? 0}em`);
    };
    apply();
    systemDark.addEventListener("change", apply);
    return () => systemDark.removeEventListener("change", apply);
  }, [
    settings.themeMode,
    settings.accent,
    settings.font,
    settings.scale,
    settings.fontSize,
    settings.lineHeight,
    settings.letterSpacing,
    settings.textAlign,
  ]);

  // Connect WebSocket when signed in
  useEffect(() => {
    const token = getToken();
    if (user && token) {
      realtime.connect(buildWsUrl(token));
    } else {
      realtime.disconnect();
    }
  }, [user]);

  // Initialize E2E key pair on login and upload public key to server
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getOrCreateKeyPair()
      .then((pair) => exportPublicKey(pair.publicKey))
      .then((jwk) => { if (!cancelled) return uploadPublicKey(jwk); })
      .catch(() => { /* non-fatal — user can still chat unencrypted */ });
    return () => { cancelled = true; };
  }, [user]);

  // Land on the login page unless already signed in (or explicitly skipped).
  if (!user && !skippedAuth) {
    return <AuthScreen onSkip={skipAuth} />;
  }

  return (
    <div className="app-shell">
      {tab === "today" && <TodayScreen />}
      {tab === "plan" && <PlanScreen />}
      {tab === "bible" && <BibleScreen />}
      {tab === "community" && <GroupsScreen />}
      {tab === "settings" && <SettingsScreen />}

      <nav className="tab-bar" aria-label="Main">
        <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
          <SunIcon />
          Today
        </button>
        <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
          <ListIcon />
          Plan
        </button>
        <button className={tab === "bible" ? "active" : ""} onClick={() => setTab("bible")}>
          <BookIcon />
          Bible
        </button>
        <button className={tab === "community" ? "active" : ""} onClick={() => setTab("community")}>
          <UsersIcon />
          Community
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          <GearIcon />
          Settings
        </button>
      </nav>
    </div>
  );
}
