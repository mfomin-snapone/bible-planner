# Bible Planner — PWA

A progressive web app for the 365-day whole-Bible reading plan (TLV, Messianic Jewish
perspective). Installable on any device (iPhone, Android, desktop), with an in-app
Bible reader and cross-device sync.

Built like HOI-Notes: Vite + React SPA, an Express API running as a single Vercel
serverless function, and Turso for storage.

## Features

- **Today** — the current day's four readings (Tanakh, Psalms, Proverbs, B'rit
  Chadashah) with checkmarks, the day's theme, and five study questions. Start the
  plan on any date, beginning at any day. A **Catch Me Up** banner appears when
  you fall behind (YouVersion-style: shifts the schedule so today is your first
  unfinished day).
- **In-app Bible reader** — tap any passage to read it right in the app. Six
  translations (TLV, ESV, NASB, KJV, NKJV, NIV), fetched per chapter from the
  bolls.life API. Chapter paging for multi-chapter readings, translation switcher,
  and "Mark as read".
- **Bible tab** — free reading of any book/chapter (remembers your place), with
  previous/next navigation across the whole Bible.
- **Red letters** — the words of Yeshua render in red (toggleable). Verse-level
  dataset built from the public-domain WEB USFM `\wj` markers by
  `../scripts/build-red-letters.js` → `public/red-letters.json`.
- **Reading themes & on-the-fly appearance** — an "Aa" button wherever Scripture is
  shown opens a YouVersion-style sheet: background themes (Auto, Light, Sepia, Blue,
  Dark, AMOLED), six accent colors, font (System/Serif/Rounded/Mono), and text size.
- **Login-first** — lands on a sign-in/register page unless already signed in, with
  a "continue without an account" escape hatch for device-local use.
- **Plan** — searchable list of all 365 days with per-day completion dots.
- **Settings** — the same appearance controls plus translation, start date/day,
  progress stats, and reset.
- **Local-first + sync** — everything works on-device without an account
  (localStorage). Create an account (username + password) to sync progress and
  settings across devices via Turso.
- **PWA** — installable, offline app shell + plan data via service worker.

## Local development

```bash
# Terminal 1 — API on :8787 (uses a local SQLite file; no Turso needed)
cd server && npm install && npm run dev

# Terminal 2 — web app on :5173 (proxies /api to :8787)
npm install && npm run dev
```

## Deploying to Vercel

1. Import the repo in Vercel and set the project **Root Directory** to `web/`.
2. Create a Turso database (`turso db create bible-planner`) and get its URL and
   auth token (`turso db show bible-planner --url`, `turso db tokens create bible-planner`).
3. Set environment variables (Production):
   - `TURSO_DATABASE_URL` — `libsql://…`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET` — generate with `openssl rand -hex 32`
4. Deploy. `vercel.json` handles the rest (SPA build to `dist/`, `/api/*` routed to
   the serverless function).

Tables are created automatically on first boot (`users`, `plan_states`).

## Notes

- `public/plan.json` is a copy of `../data/plan.json`. If the plan data changes,
  re-copy it: `cp ../data/plan.json public/plan.json`.
- Bible text is fetched from bolls.life and never bundled — TLV, ESV, NASB, NKJV,
  and NIV are copyrighted translations.
- The TLV follows Hebrew chapter divisions in Joel (4 chapters) and Malachi (3);
  bolls.life's TLV matches, so plan references line up.
