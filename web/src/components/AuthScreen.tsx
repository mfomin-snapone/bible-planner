import { useState, type FormEvent } from "react";
import { useAppState } from "../state/AppState";
import { BookIcon } from "./icons";

/** Shared login/register form, used by the landing AuthScreen and the Settings card. */
export function AuthForm({ onDone }: { onDone?: () => void }) {
  const { login, register } = useAppState();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password);
      setUsername("");
      setPassword("");
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
      </div>
      {error && <p className="error-text">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy || !username || !password}>
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
