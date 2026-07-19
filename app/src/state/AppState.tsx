import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  fetchServerState,
  getStoredUser,
  getToken,
  login as apiLogin,
  pushServerState,
  register as apiRegister,
  storeSession,
} from "../lib/api";
import { progressKey } from "../lib/schedule";
import {
  DEFAULT_SETTINGS,
  type PlanDay,
  type PlanState,
  type Settings,
  type Track,
  type User,
} from "../types";

const STATE_KEY = "bible-planner:state";
const SKIP_AUTH_KEY = "bible-planner:skip-auth";

function loadLocalState(): PlanState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlanState;
      return {
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        progress: Array.isArray(parsed.progress) ? parsed.progress : [],
        answers:
          parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
            ? parsed.answers
            : {},
        customQuestions:
          parsed.customQuestions && typeof parsed.customQuestions === "object" && !Array.isArray(parsed.customQuestions)
            ? parsed.customQuestions
            : {},
        updatedAt: parsed.updatedAt ?? 0,
      };
    }
  } catch {
    // Corrupt local state falls through to defaults.
  }
  return { settings: DEFAULT_SETTINGS, progress: [], answers: {}, customQuestions: {}, updatedAt: 0 };
}

interface AppStateValue {
  plan: PlanDay[];
  planLoading: boolean;
  settings: Settings;
  progress: Set<string>;
  answers: Record<string, string>;
  user: User | null;
  syncError: string | null;
  /** True after the user chose "continue without an account" on the landing page. */
  skippedAuth: boolean;
  skipAuth: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  toggleProgress: (day: number, track: Track) => void;
  /** Update a study-question answer. key = `"day:questionIndex"`. */
  updateAnswer: (key: string, html: string) => void;
  customQuestions: Record<number, string[]>;
  addCustomQuestion: (day: number, text: string) => void;
  removeCustomQuestion: (day: number, idx: number) => void;
  resetProgress: () => void;
  register: (username: string, password: string, birthDate: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  openBibleRef: (bookId: number, chapter: number) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<PlanDay[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [state, setState] = useState<PlanState>(loadLocalState);
  const [user, setUser] = useState<User | null>(() => (getToken() ? getStoredUser() : null));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [skippedAuth, setSkippedAuth] = useState(
    () => localStorage.getItem(SKIP_AUTH_KEY) === "1",
  );
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the 365-day plan (served statically, cached by the service worker).
  useEffect(() => {
    fetch("/plan.json")
      .then((res) => res.json())
      .then((days: PlanDay[]) => setPlan(days))
      .catch(() => setSyncError("Couldn't load the reading plan. Check your connection and reload."))
      .finally(() => setPlanLoading(false));
  }, []);

  // Persist every state change locally (guest mode works fully offline)…
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [state]);

  // …and, when signed in, debounce-push it to the server.
  const schedulePush = useCallback((next: PlanState) => {
    if (!getToken()) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      try {
        await pushServerState(next);
        setSyncError(null);
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        const body = (err as Error & { body?: { data?: PlanState; updatedAt?: number } }).body;
        if (status === 409 && body?.data) {
          // Another device wrote newer state; adopt it.
          setState({ ...body.data, updatedAt: body.updatedAt ?? Date.now() });
          setSyncError(null);
        } else if (status === 401) {
          setSyncError("Session expired — sign in again to keep syncing.");
        } else {
          setSyncError("Changes saved on this device; syncing will retry.");
        }
      }
    }, 1200);
  }, []);

  const mutate = useCallback(
    (updater: (prev: PlanState) => PlanState) => {
      setState((prev) => {
        const next = { ...updater(prev), updatedAt: Date.now() };
        schedulePush(next);
        return next;
      });
    },
    [schedulePush],
  );

  // On load with a session: pull server state and reconcile.
  useEffect(() => {
    if (!getToken()) return;
    fetchServerState()
      .then(({ data, updatedAt }) => {
        if (!data) {
          // Fresh account with no server state yet — seed it from this device.
          setState((prev) => {
            const next = { ...prev, updatedAt: prev.updatedAt || Date.now() };
            pushServerState(next).catch(() => {});
            return next;
          });
          return;
        }
        setState((prev) => (updatedAt > prev.updatedAt ? { ...data, updatedAt } : prev));
      })
      .catch((err) => {
        if ((err as Error & { status?: number }).status === 401) {
          clearSession();
          setUser(null);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const progress = useMemo(() => new Set(state.progress), [state.progress]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      mutate((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    },
    [mutate],
  );

  const toggleProgress = useCallback(
    (day: number, track: Track) => {
      mutate((prev) => {
        const key = progressKey(day, track);
        const set = new Set(prev.progress);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        return { ...prev, progress: [...set] };
      });
    },
    [mutate],
  );

  const resetProgress = useCallback(() => {
    mutate((prev) => ({ ...prev, progress: [] }));
  }, [mutate]);

  const updateAnswer = useCallback(
    (key: string, html: string) => {
      mutate((prev) => ({
        ...prev,
        answers: { ...prev.answers, [key]: html },
      }));
    },
    [mutate],
  );

  const addCustomQuestion = useCallback(
    (day: number, text: string) => {
      mutate((prev) => {
        const existing = prev.customQuestions?.[day] ?? [];
        return {
          ...prev,
          customQuestions: { ...(prev.customQuestions ?? {}), [day]: [...existing, text] },
        };
      });
    },
    [mutate],
  );

  const removeCustomQuestion = useCallback(
    (day: number, idx: number) => {
      mutate((prev) => {
        const existing = [...(prev.customQuestions?.[day] ?? [])];
        existing.splice(idx, 1);
        return {
          ...prev,
          customQuestions: { ...(prev.customQuestions ?? {}), [day]: existing },
        };
      });
    },
    [mutate],
  );

  const adoptSession = useCallback(
    async (token: string, nextUser: User) => {
      storeSession(token, nextUser);
      setUser(nextUser);
      // Pull-and-reconcile runs via the user effect; merge progress by union so a
      // first sign-in on a second device never loses locally tracked readings.
      try {
        const { data, updatedAt } = await fetchServerState();
        if (data) {
          setState((prev) => {
            const merged: PlanState = {
              settings: updatedAt > prev.updatedAt ? data.settings : prev.settings,
              progress: [...new Set([...prev.progress, ...data.progress])],
              answers: updatedAt > prev.updatedAt ? (data.answers ?? {}) : prev.answers,
              customQuestions: updatedAt > prev.updatedAt ? (data.customQuestions ?? {}) : (prev.customQuestions ?? {}),
              updatedAt: Date.now(),
            };
            pushServerState(merged).catch(() => {});
            return merged;
          });
        }
      } catch {
        // Reconcile effect will retry on next load.
      }
    },
    [],
  );

  const register = useCallback(
    async (username: string, password: string, birthDate: string) => {
      const { token, user: nextUser } = await apiRegister(username, password, birthDate);
      await adoptSession(token, nextUser);
    },
    [adoptSession],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const { token, user: nextUser } = await apiLogin(username, password);
      await adoptSession(token, nextUser);
    },
    [adoptSession],
  );

  const skipAuth = useCallback(() => {
    localStorage.setItem(SKIP_AUTH_KEY, "1");
    setSkippedAuth(true);
  }, []);

  const openBibleRef = useCallback((bookId: number, chapter: number) => {
    updateSettings({ lastBookId: bookId, lastChapter: chapter });
    window.dispatchEvent(new CustomEvent("navigate-bible"));
  }, [updateSettings]);

  const logout = useCallback(() => {
    clearSession();
    // Signing out returns to the landing page, so clear any earlier "skip" too.
    localStorage.removeItem(SKIP_AUTH_KEY);
    setSkippedAuth(false);
    setUser(null);
  }, []);

  const value: AppStateValue = {
    plan,
    planLoading,
    settings: state.settings,
    progress,
    answers: state.answers,
    customQuestions: state.customQuestions ?? {},
    user,
    syncError,
    skippedAuth,
    skipAuth,
    updateSettings,
    toggleProgress,
    updateAnswer,
    addCustomQuestion,
    removeCustomQuestion,
    resetProgress,
    register,
    login,
    logout,
    openBibleRef,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used within AppStateProvider");
  return value;
}
