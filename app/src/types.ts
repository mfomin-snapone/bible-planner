export type QuestionType =
  | "observation"
  | "word_study"
  | "messianic_connection"
  | "application"
  | "discussion";

export interface Question {
  type: QuestionType;
  text: string;
}

export interface PlanDay {
  day: number;
  tanakh: string;
  psalm: string;
  proverbs: string;
  brit_chadashah: string;
  theme: string;
  questions: Question[];
}

export const TRACKS = ["tanakh", "psalm", "proverbs", "brit_chadashah"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  tanakh: "Tanakh",
  psalm: "Psalms",
  proverbs: "Proverbs",
  brit_chadashah: "B'rit Chadashah",
};

export const QUESTION_LABELS: Record<QuestionType, string> = {
  observation: "Observation",
  word_study: "Word Study",
  messianic_connection: "Messianic Connection",
  application: "Application",
  discussion: "Discussion",
};

export type Translation = "TLV" | "ESV" | "NASB" | "KJV" | "NKJV" | "NIV";

export const TRANSLATIONS: { code: Translation; label: string }[] = [
  { code: "TLV", label: "Tree of Life Version" },
  { code: "ESV", label: "English Standard Version" },
  { code: "NASB", label: "New American Standard Bible" },
  { code: "KJV", label: "King James Version" },
  { code: "NKJV", label: "New King James Version" },
  { code: "NIV", label: "New International Version" },
];

export type ThemeMode = "system" | "light" | "sepia" | "blue" | "dark" | "charcoal" | "amoled";
export type Accent = "deepblue" | "olive" | "purple" | "crimson" | "teal" | "amber";
export type FontChoice = "system" | "serif" | "rounded" | "mono";
export type TextScale = "s" | "m" | "l" | "xl";
export type TextAlign = "left" | "center" | "right" | "justify";

export const THEME_OPTIONS: { id: ThemeMode; label: string; swatch: string }[] = [
  { id: "system", label: "Auto", swatch: "linear-gradient(135deg, #f6f5f2 50%, #12151d 50%)" },
  { id: "light", label: "Light", swatch: "#f6f5f2" },
  { id: "sepia", label: "Sepia", swatch: "#f3ead8" },
  { id: "blue", label: "Blue", swatch: "#101b2d" },
  { id: "dark", label: "Dark", swatch: "#22262f" },
  { id: "charcoal", label: "Charcoal", swatch: "#2a2a2c" },
  { id: "amoled", label: "AMOLED", swatch: "#000000" },
];

export interface Settings {
  /** ISO date (yyyy-mm-dd) the plan was started, or null before onboarding. */
  startDate: string | null;
  /** The plan day that falls on startDate (1 for a from-the-beginning start). */
  startDay: number;
  translation: Translation;
  themeMode: ThemeMode;
  accent: Accent;
  font: FontChoice;
  /** Legacy coarse scale — kept for backward compat; fontSize overrides it. */
  scale: TextScale;
  /** Font size in px (12–28). Overrides `scale`. */
  fontSize: number;
  /** Line height multiplier (1.0–2.5). */
  lineHeight: number;
  /** Letter spacing in em (-0.05–0.15). */
  letterSpacing: number;
  /** Text alignment for reader / answer content. */
  textAlign: TextAlign;
  /** Show the words of Yeshua in red. */
  redLetters: boolean;
  /** Last position in the standalone Bible tab. */
  lastBookId: number;
  lastChapter: number;
  /** Active reading plan template id. Default = full 365-day Messianic plan. */
  planTemplateId: string;
  /** Custom plan book IDs (used when planTemplateId === 'custom'). */
  customPlanBookIds: number[];
  /** Chapters per day for custom/generated plans. */
  customPlanPace: number;
  /** Daily reminder notification enabled. */
  reminderEnabled: boolean;
  /** 24h time string for daily reminder, e.g. "08:00". */
  reminderTime: string;
  /** Which days to send the reminder. */
  reminderFrequency: "daily" | "weekdays" | "weekends";
}

export interface PlanState {
  settings: Settings;
  /** Completed readings, scoped per plan template: "templateId::day::track". */
  progress: string[];
  /** Study question answers, scoped per plan template: "templateId::day:q:idx" → sanitized HTML. */
  answers: Record<string, string>;
  /** User-added custom study questions, scoped per plan template: "templateId::day". */
  customQuestions: Record<string, string[]>;
  /** Milliseconds since epoch; versions the whole blob for sync. */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  startDate: null,
  startDay: 1,
  translation: "TLV",
  themeMode: "system",
  accent: "deepblue",
  font: "system",
  scale: "m",
  fontSize: 16,
  lineHeight: 1.55,
  letterSpacing: 0,
  textAlign: "left",
  redLetters: true,
  lastBookId: 40,
  lastChapter: 1,
  planTemplateId: "default",
  customPlanBookIds: [],
  customPlanPace: 3,
  reminderEnabled: false,
  reminderTime: "08:00",
  reminderFrequency: "daily",
};

export interface User {
  id: string;
  username: string;
  avatar?: string;
}

// ─── Community / Chat types ──────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  description: string;
  /** Emoji shown as the group's icon; falls back to the name's first letter when unset. */
  icon?: string | null;
  planStartDate: string | null;
  /** Plan day number that corresponds to planStartDate. */
  planStartDay: number;
  inviteCode: string;
  /** Milliseconds-since-epoch the invite code stops working, or null for never. */
  inviteExpiresAt?: number | null;
  /** Max number of times the invite code can be redeemed, or null for unlimited. */
  inviteMaxUses?: number | null;
  inviteUseCount?: number;
  /** The current user's role in this group. */
  role: "admin" | "member";
  /** The main group chat channel id. */
  channelId: string | null;
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  username: string;
  role: "admin" | "member";
}

export interface DmChannel {
  channelId: string;
  type: "dm";
  otherUser: { id: string; username: string };
  lastMessageAt: number | null;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  senderUsername: string;
  /** JSON-stringified EncryptedMessage, GIF JSON, or plain text. */
  content: string;
  sentAt: number;
  /** Milliseconds-since-epoch the message was deleted, or null/undefined if not deleted. */
  deletedAt?: number | null;
  reactions: Reaction[];
}

export interface Reaction {
  messageId?: string;
  emoji: string;
  userId: string;
  username: string;
}

export interface Thread {
  id: string;
  groupId?: string;
  channelId: string;
  name: string;
  emoji: string;
  createdBy: string;
  createdAt: number;
  lastMessageAt: number | null;
}

export interface AppNotification {
  id: string;
  type: "message" | "reaction" | "group_join" | "thread_new";
  channelId: string | null;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}
