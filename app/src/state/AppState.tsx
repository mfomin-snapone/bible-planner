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
import { progressKey, dateForDay } from "../lib/schedule";
import { generateParashaPlan } from "../lib/parashaPlan";
import {
  DEFAULT_SETTINGS,
  type PlanDay,
  type PlanState,
  type Settings,
  type Track,
  type User,
} from "../types";
import { generatePlan, generateCustomPlan } from "../lib/planTemplates";

const STATE_KEY = "bible-planner:state";
const SKIP_AUTH_KEY = "bible-planner:skip-auth";

/**
 * Progress keys used to be un-scoped ("day:track"); they're now scoped per
 * plan template ("templateId::day::track") so switching plans doesn't mix up
 * progress between them. Old-format keys belonged to whatever template was
 * active, so they migrate into that template's namespace instead of vanishing.
 * Applied to every path that can bring a `PlanState` blob into memory — the
 * initial local load, and both server-sync reconciliation points below.
 */
function migrateState(raw: PlanState): PlanState {
  const templateId = raw.settings?.planTemplateId ?? DEFAULT_SETTINGS.planTemplateId;
  const progress = Array.isArray(raw.progress) ? raw.progress : [];
  return {
    ...raw,
    progress: progress.map((key) =>
      typeof key === "string" && !key.includes("::") ? `${templateId}::${key}` : key,
    ),
  };
}

function loadLocalState(): PlanState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlanState;
      const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      return migrateState({
        settings,
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
      });
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
  const reminderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load reading plan — either the static plan.json or a generated template.
  useEffect(() => {
    const templateId = state.settings.planTemplateId ?? "default";
    if (templateId !== "default" && templateId !== "custom" && templateId !== "parasha") {
      const generated = generatePlan(templateId);
      if (generated) { setPlan(generated); setPlanLoading(false); return; }
    }
    if (templateId === "custom") {
      const custom = generateCustomPlan(
        state.settings.customPlanBookIds ?? [],
        state.settings.customPlanPace ?? 3,
        true,
      );
      setPlan(custom.length ? custom : []);
      setPlanLoading(false);
      return;
    }
    if (templateId === "parasha") {
      const anchor = state.settings.startDate ? dateForDay(state.settings, 1) ?? new Date() : new Date();
      generateParashaPlan(anchor, 371)
        .then((days) => setPlan(days))
        .catch(() => setSyncError("Couldn't load the Parashah cycle. Check your connection and reload."))
        .finally(() => setPlanLoading(false));
      return;
    }
    fetch("/plan.json")
      .then((res) => res.json())
      .then((days: PlanDay[]) => setPlan(days))
      .catch(() => setSyncError("Couldn't load the reading plan. Check your connection and reload."))
      .finally(() => setPlanLoading(false));
  }, [state.settings.planTemplateId, state.settings.customPlanBookIds, state.settings.customPlanPace, state.settings.startDate, state.settings.startDay]);

  // Persist every state change locally (guest mode works fully offline)…
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [state]);

  // Schedule/cancel browser notification reminders.
  useEffect(() => {
    if (reminderTimer.current) { clearTimeout(reminderTimer.current); reminderTimer.current = null; }
    const { reminderEnabled, reminderTime, reminderFrequency } = state.settings;
    if (!reminderEnabled || !("Notification" in window) || Notification.permission !== "granted") return;

    function scheduleNext() {
      const [h, m] = (reminderTime ?? "08:00").split(":").map(Number);
      const now = new Date();
      const next = new Date(now);
      next.setHours(h, m, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);

      // Skip days not in the schedule
      const dayOfWeek = next.getDay(); // 0=Sun, 6=Sat
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      if ((reminderFrequency === "weekdays" && !isWeekday) ||
          (reminderFrequency === "weekends" && !isWeekend)) {
        next.setDate(next.getDate() + 1);
      }

      const ms = next.getTime() - Date.now();
      reminderTimer.current = setTimeout(() => {
        new Notification("Time to read! 📖", {
          body: "Your daily Bible reading is waiting for you.",
          icon: "/icons/icon-192.png",
        });
        scheduleNext(); // reschedule for next day
      }, ms);
    }

    scheduleNext();
    return () => { if (reminderTimer.current) clearTimeout(reminderTimer.current); };
  }, [state.settings.reminderEnabled, state.settings.reminderTime, state.settings.reminderFrequency]);

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
          setState(migrateState({ ...body.data, updatedAt: body.updatedAt ?? Date.now() }));
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
        setState((prev) => (updatedAt > prev.updatedAt ? migrateState({ ...data, updatedAt }) : prev));
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
        const key = progressKey(prev.settings.planTemplateId, day, track);
        const set = new Set(prev.progress);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        return { ...prev, progress: [...set] };
      });
    },
    [mutate],
  );

  const resetProgress = useCallback(() => {
    // Only clears the active plan's progress — other plans you've switched
    // away from keep theirs, matching the per-template progress scoping.
    mutate((prev) => ({
      ...prev,
      progress: prev.progress.filter((key) => !key.startsWith(`${prev.settings.planTemplateId}::`)),
    }));
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
          const migratedData = migrateState(data);
          setState((prev) => {
            const merged: PlanState = {
              settings: updatedAt > prev.updatedAt ? migratedData.settings : prev.settings,
              progress: [...new Set([...prev.progress, ...migratedData.progress])],
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
