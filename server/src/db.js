import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isHostedDeployment } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.TURSO_DATABASE_URL && isHostedDeployment) {
  // A local SQLite file doesn't survive across serverless deployments/cold starts, so falling
  // back silently here would make accounts and progress "disappear" after every redeploy.
  throw new Error(
    "[Bible-Planner] TURSO_DATABASE_URL must be set in production. Set TURSO_DATABASE_URL and " +
      "TURSO_AUTH_TOKEN as environment variables (scoped to Production) and redeploy.",
  );
}

const url =
  process.env.TURSO_DATABASE_URL ||
  `file:${path.join(__dirname, "..", "data", "bible-planner.db")}`;
export const dbMode = url.startsWith("file:") ? "local-file" : "turso";
export const dbHost = url.startsWith("file:")
  ? null
  : url.replace(/^libsql:\/\//, "").split("?")[0];

if (url.startsWith("file:")) {
  fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true });
  console.warn(
    `[Bible-Planner] Using local SQLite file at ${url} — data will NOT survive a redeploy.`,
  );
} else {
  // Log the host only — never the auth token or full URL.
  console.log(`[Bible-Planner] Connecting to Turso at ${dbHost}`);
}

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plan_states (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // E2E encryption: each user's RSA-OAEP public key (JWK string)
  `CREATE TABLE IF NOT EXISTS user_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    public_key_jwk TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // Groups / study communities
  `CREATE TABLE IF NOT EXISTS groups_data (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    plan_start_date TEXT,
    plan_start_day INTEGER DEFAULT 1,
    invite_code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups_data(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    encrypted_key TEXT,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
  )`,
  // Chat channels: type = 'group' | 'dm'
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    group_id TEXT REFERENCES groups_data(id),
    created_at INTEGER NOT NULL
  )`,
  // Participants in DM channels (always exactly 2); group channels use group_members
  `CREATE TABLE IF NOT EXISTS channel_participants (
    channel_id TEXT NOT NULL REFERENCES channels(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    encrypted_key TEXT,
    PRIMARY KEY (channel_id, user_id)
  )`,
  // Encrypted messages
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    sent_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, sent_at DESC)`,
  // Emoji reactions on messages
  `CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  )`,
  // Named discussion threads (sub-channels within a group)
  `CREATE TABLE IF NOT EXISTS threads (
    id         TEXT PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES groups_data(id),
    channel_id TEXT NOT NULL REFERENCES channels(id),
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '💬',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
  )`,
  // In-app notifications
  `CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    type       TEXT NOT NULL,
    channel_id TEXT,
    data       TEXT NOT NULL DEFAULT '{}',
    read       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC)`,
];

for (const sql of SCHEMA_STATEMENTS) {
  await db.execute(sql);
}
