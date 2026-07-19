#!/usr/bin/env node
/**
 * Builds web/public/red-letters.json — a verse-level "words of Yeshua" dataset —
 * from the public-domain World English Bible USFM source, which marks the words
 * of Jesus with \wj ... \wj* spans.
 *
 * Usage:
 *   node scripts/build-red-letters.js [path-to-extracted-usfm-dir]
 *
 * Without an argument, downloads https://ebible.org/Scriptures/eng-web_usfm.zip
 * to a temp dir first (requires `unzip` on PATH).
 *
 * Output shape: { "<bollsBookId>": { "<chapter>": [verse, ...] } }
 * Verse-level granularity is translation-independent, so the same dataset is used
 * for every translation in the reader.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "web", "public", "red-letters.json");

// USFM book code → bolls.life book id (standard Protestant order).
const BOOK_IDS = {
  MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45, "1CO": 46, "2CO": 47,
  GAL: 48, EPH: 49, PHP: 50, COL: 51, "1TH": 52, "2TH": 53, "1TI": 54, "2TI": 55,
  TIT: 56, PHM: 57, HEB: 58, JAS: 59, "1PE": 60, "2PE": 61, "1JN": 62, "2JN": 63,
  "3JN": 64, JUD: 65, REV: 66,
};

let usfmDir = process.argv[2];
if (!usfmDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "web-usfm-"));
  const zip = path.join(tmp, "eng-web_usfm.zip");
  console.log("Downloading WEB USFM…");
  execSync(`curl -sf -o ${zip} https://ebible.org/Scriptures/eng-web_usfm.zip`);
  execSync(`unzip -o -q ${zip} -d ${tmp}`);
  usfmDir = tmp;
}

const result = {};
for (const file of fs.readdirSync(usfmDir)) {
  const code = file.match(/^\d+-([1-3A-Z]{3})eng-web\.usfm$/)?.[1];
  const bookId = code && BOOK_IDS[code];
  if (!bookId) continue;

  const text = fs.readFileSync(path.join(usfmDir, file), "utf8");
  let chapter = 0;
  let verse = 0;
  let wjOpen = false;
  const chapters = {};

  // Walk the file token-by-token; a verse is "red" if any \wj span intersects it.
  for (const token of text.split(/(\\c\s+\d+|\\v\s+\d+|\\wj\*|\\wj\s?)/)) {
    const c = token.match(/^\\c\s+(\d+)/);
    const v = token.match(/^\\v\s+(\d+)/);
    if (c) {
      chapter = parseInt(c[1], 10);
    } else if (v) {
      verse = parseInt(v[1], 10);
      if (wjOpen) (chapters[chapter] ??= new Set()).add(verse);
    } else if (/^\\wj\s?$/.test(token)) {
      wjOpen = true;
      if (chapter && verse) (chapters[chapter] ??= new Set()).add(verse);
    } else if (token === "\\wj*") {
      wjOpen = false;
    }
  }

  const out = {};
  for (const [ch, verses] of Object.entries(chapters)) {
    out[ch] = [...verses].sort((a, b) => a - b);
  }
  if (Object.keys(out).length > 0) result[bookId] = out;
}

fs.writeFileSync(OUT, JSON.stringify(result));
const books = Object.keys(result).length;
const verses = Object.values(result)
  .flatMap((c) => Object.values(c))
  .reduce((n, v) => n + v.length, 0);
console.log(`Wrote ${OUT}: ${books} books, ${verses} red-letter verses.`);
