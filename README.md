# Whole-Bible 365-Day Reading Plan — Messianic Jewish Perspective (TLV)

A one-year, four-track daily reading plan covering the entire Bible in the **Tree of
Life Version (TLV)**, with daily reflection questions written from a Messianic
Jewish perspective — affirming the ongoing place of Torah and Jewish life while
tracing how the Tanakh anticipates Yeshua the Messiah.

## Files

- `data/plan.json` — the full 365-day plan. This is the file to use.
- `data/schedule.json` — just the day-by-day passage references (no themes/questions), useful if you want to regenerate content differently.
- `scripts/build-schedule.js` — the script that generated `schedule.json` (deterministic, re-runnable).
- `web/` — **the app**: an installable PWA (Vite + React + Turso on Vercel) with an
  in-app Bible reader and cross-device sync. See [web/README.md](web/README.md).
- `ios/` — an earlier native SwiftUI iOS prototype, superseded by the PWA (kept for
  reference; safe to delete).

## iOS app (superseded prototype)

> The PWA in `web/` replaced this — it runs on iPhone (installable from Safari),
> Android, and desktop, and adds cross-device sync. The native app remains
> functional if you ever want it.

`ios/BiblePlanner.xcodeproj` is a SwiftUI app (iOS 17+, iPhone & iPad) that bundles
`plan.json` and provides:

- **Today** — the current day's four readings with per-track checkmarks, plus the
  day's theme and five study questions. First launch asks for a start date and a
  starting day (begin at Day 1 or jump in anywhere — the schedule shifts to match).
  If you fall behind, a banner offers **Catch Me Up** (YouVersion-style): it shifts
  the schedule so today becomes your first unfinished day.
- **Reader** — tap any passage to read it in an in-app reader (loads the passage on
  BibleGateway in reader mode; internet required). Six translations: TLV, ESV, NASB,
  KJV, NKJV, NIV. Your preferred translation is a Settings choice; long-press a
  passage to open it in any other translation. (Translation text is licensed, so it
  streams from BibleGateway rather than shipping inside the app.)
- **Plan** — a browsable, searchable list of all 365 days with completion indicators
  and a "Today" jump button.
- **Settings** — overall progress stats, translation choice, start date / start day
  adjustment, Catch Me Up, a progress reset, and appearance options: six accent
  themes, font style (System / Serif / Rounded / Monospaced), text size (S–XL), and
  light/dark/system color scheme.

Reading progress, the schedule, translation, and appearance choices all persist
locally in `UserDefaults`. Open the
project in Xcode (16 or later) and run, or build from the command line:

```
xcodebuild -project ios/BiblePlanner.xcodeproj -scheme BiblePlanner \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

Note: `ios/BiblePlanner/plan.json` is a bundled copy of `data/plan.json`. If you
edit the plan data, re-copy it: `cp data/plan.json ios/BiblePlanner/plan.json`.

## Structure

Each day has **four parallel reading tracks**, in the "Bible-in-a-year" style:

| Track | What it is | Pace |
|---|---|---|
| `tanakh` | Torah, Nevi'im, and Ketuvim (minus Psalms & Proverbs) read straight through in traditional **Tanakh order** (not the Christian Old Testament order) — ends, fittingly, on 2 Chronicles 36, the traditional close of the Hebrew Bible | ~2 chapters/day (748 chapters ÷ 365 days) |
| `psalm` | The Psalms, read one chapter a day, cycling from Psalm 1 | Cycles through twice, plus part of a third pass, over the year |
| `proverbs` | Proverbs, one chapter a day, matching the classic "a proverb a day" tradition | Cycles ~11.8 times over the year |
| `brit_chadashah` | The B'rit Chadashah (New Covenant Scriptures), Matthew through Revelation | Read fully once, then Matthew–Acts is re-read to round out the year |

Each day also has:
- `theme` — a short title specific to that day's actual readings
- `questions` — exactly 5 questions, always in this order:
  1. **observation** — a concrete detail to notice in the day's Tanakh/Psalm/Proverbs reading
  2. **word_study** — a Hebrew (or Greek) word, name, or phrase drawn from the day's text
  3. **messianic_connection** — how the day's readings connect to Yeshua / Messianic hope
  4. **application** — how the passage should shape the reader's life this week
  5. **discussion** — a deeper question suited for a small group or chavurah

## Terminology conventions (TLV / Messianic Jewish)

Yeshua (not Jesus), Messiah/Mashiach (not Christ), Adonai/HaShem (not "the LORD"),
Torah, Tanakh, B'rit Chadashah (not "Old/New Testament"), Ruach ha-Kodesh (Holy
Spirit), and Hebrew names for B'rit Chadashah authors (Kefa, Sha'ul, Ya'akov,
Yochanan, Y'hudah). The plan intentionally avoids supersessionist framing — Israel's
covenants are treated as standing, not replaced.

## Versification note

Chapter divisions follow standard versification **except** two books where the TLV
follows the traditional Hebrew/Jewish chapter division rather than the English one:

- **Joel** has 4 chapters (English Bibles usually have 3; Hebrew 3:1–4:21 = English 2:28–3:21)
- **Malachi** has 3 chapters (English Bibles usually have 4; Hebrew 3:19–24 = English 4:1–6)

If you're pairing this plan against a specific TLV print/digital edition, double-check
those two books' chapter numbers against your copy before publishing further.

## Regenerating

```
node scripts/build-schedule.js   # rebuilds data/schedule.json from chapter-count data
```

Content (`theme` + `questions`) in `data/plan.json` was authored separately per day
and is not regenerated by the script.
