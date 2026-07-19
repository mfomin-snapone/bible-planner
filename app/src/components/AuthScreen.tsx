import { useState, type FormEvent } from "react";
import { useAppState } from "../state/AppState";
import { BookIcon, ShieldIcon } from "./icons";

function getAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob.getTime())) return null;
  return (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/** Shared login/register form, used by the landing AuthScreen and the Settings card. */
export function AuthForm({ onDone }: { onDone?: () => void }) {
  const { login, register } = useAppState();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = password.length === 0 || password.length >= 8;
  const age = mode === "register" ? getAge(birthDate) : null;
  const ageOk = age === null || age >= 18;
  const ageError = birthDate && age !== null && age < 18;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!birthDate) { setError("Date of birth is required."); return; }
      if (ageError) { setError("You must be 18 or older to create an account."); return; }
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password, birthDate);
      setUsername("");
      setPassword("");
      setBirthDate("");
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="acct-username">Username</label>
        <input
          id="acct-username"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="acct-password">Password</label>
        <input
          id="acct-password"
          type="password"
          value={password}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {mode === "register" && (
          <p className={`field-hint ${!passwordOk ? "field-hint--error" : ""}`}>
            At least 8 characters
          </p>
        )}
      </div>
      {mode === "register" && (
        <div className="field">
          <label htmlFor="acct-dob">
            Date of birth <span className="field-hint" style={{ display: "inline", marginLeft: 4 }}>(must be 18+)</span>
          </label>
          <input
            id="acct-dob"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            required
          />
          {ageError && (
            <p className="field-hint field-hint--error">
              You must be 18 or older to create an account.
            </p>
          )}
          {birthDate && !ageError && age !== null && (
            <p className="field-hint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ShieldIcon className="q-icon" /> Age verified — {Math.floor(age)} years old
            </p>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy || !username || !password || (mode === "register" && (!passwordOk || !ageOk || !birthDate))}>
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "New? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </form>
  );
}

/** Full-page landing shown until the user signs in (or explicitly skips). */
export function AuthScreen({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="auth-screen">
      <BookIcon />
      <h1 style={{ fontSize: "1.5rem" }}>Shema Study</h1>
      <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
        A 365-day journey through the whole Bible — Tanakh, Psalms, Proverbs, and
        B'rit Chadashah — with an in-app reader and daily study questions.
      </p>
      <p className="small muted" style={{ maxWidth: 420, margin: 0 }}>
        Sign in to sync your reading progress across all your devices.
      </p>
      <AuthForm />
      <button className="link-btn small" onClick={onSkip}>
        Continue without an account →
      </button>
    </div>
  );
}
