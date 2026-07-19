/**
 * Hebrew calendar arithmetic for Messianic holiday display.
 *
 * Algorithm source: standard Hebrew calendar rules (Hillel II).
 * EPOCH = JDN of 1 Tishrei 1 AM = 347,997 (verified against multiple
 * known Rosh Hashanah dates: 5780–5786).
 *
 * JDN day-of-week mapping (verified): JDN % 7 → 0=Mon, 1=Tue, 2=Wed,
 * 3=Thu, 4=Fri, 5=Sat, 6=Sun
 *
 * Internal d-day mapping (d=1 = first day in the Molad count = Sunday,
 * i.e. the day before the Molad Tohu on Monday):
 *   d%7 → 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 */

const EPOCH = 347997;

function isLeapYear(year: number): boolean {
  return ((7 * year + 1) % 19) < 7;
}

/** Days elapsed from the Hebrew epoch to the start of `year`. */
function elapsedDays(year: number): number {
  const y = year - 1;
  const m = 235 * Math.floor(y / 19) + 12 * (y % 19) + Math.floor((7 * (y % 19) + 1) / 19);
  const p = 204 + 793 * (m % 1080);
  const h = 5 + 12 * m + 793 * Math.floor(m / 1080) + Math.floor(p / 1080);
  let d = 1 + 29 * m + Math.floor(h / 24);
  const q = 1080 * (h % 24) + (p % 1080);

  // Postponement rules (Dechiyot):
  // 1. Molad Zakein: conjunction at or after 18:00
  if (q >= 19440) {
    d++;
  } else if (d % 7 === 2 && q >= 9924 && !isLeapYear(year)) {
    // 2. GaTaRaD: Tuesday conjunction ≥ 9h204p in a non-leap year → Thursday
    d += 2;
  } else if (d % 7 === 1 && q >= 16789 && isLeapYear(year - 1)) {
    // 3. BeTaKPaF: Monday conjunction ≥ 15h589p after a leap year
    d++;
  }
  // 4. ADU: cannot fall on Sunday(0), Wednesday(3), or Friday(5)
  if (d % 7 === 0 || d % 7 === 3 || d % 7 === 5) d++;
  return d;
}

function yearLength(year: number): number {
  return elapsedDays(year + 1) - elapsedDays(year);
}

function daysInMonth(month: number, year: number): number {
  const len = yearLength(year);
  switch (month) {
    case 1:  return 30; // Nisan
    case 2:  return 29; // Iyar
    case 3:  return 30; // Sivan
    case 4:  return 29; // Tammuz
    case 5:  return 30; // Av
    case 6:  return 29; // Elul
    case 7:  return 30; // Tishrei
    case 8:  return (len === 353 || len === 383) ? 29 : 30; // Cheshvan
    case 9:  return (len === 355 || len === 385) ? 30 : 29; // Kislev
    case 10: return 29; // Tevet
    case 11: return 30; // Shevat
    case 12: return isLeapYear(year) ? 30 : 29; // Adar I / Adar
    case 13: return 29; // Adar II (leap only)
    default: return 0;
  }
}

function gregorianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function jdnToHebrew(jdn: number): { year: number; month: number; day: number } {
  const elapsed = jdn - EPOCH + 1;
  let year = Math.floor(elapsed / 365.25) + 1;
  while (elapsedDays(year + 1) <= elapsed) year++;
  while (elapsedDays(year) > elapsed) year--;

  const yearStart = EPOCH + elapsedDays(year) - 1;
  const months = monthOrderForYear(year);

  let remaining = jdn - yearStart + 1;
  let month = 7;
  for (const m of months) {
    const dim = daysInMonth(m, year);
    if (remaining <= dim) { month = m; break; }
    remaining -= dim;
  }
  return { year, month, day: remaining };
}

function hebrewToJDN(year: number, month: number, day: number): number {
  const yearStart = EPOCH + elapsedDays(year) - 1;
  const months = monthOrderForYear(year);
  let offset = 0;
  for (const m of months) {
    if (m === month) break;
    offset += daysInMonth(m, year);
  }
  return yearStart + offset + day - 1;
}

/** Month order starting from Tishrei (the way the Hebrew year runs). */
function monthOrderForYear(year: number): number[] {
  const base = [7, 8, 9, 10, 11, 12];
  if (isLeapYear(year)) base.push(13);
  return [...base, 1, 2, 3, 4, 5, 6];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<number, string> = {
  1: "Nisan", 2: "Iyar", 3: "Sivan", 4: "Tammuz",
  5: "Av", 6: "Elul", 7: "Tishrei", 8: "Cheshvan",
  9: "Kislev", 10: "Tevet", 11: "Shevat", 12: "Adar", 13: "Adar II",
};

export type HolidayType = "major" | "minor" | "fast" | "shabbat" | "rosh_chodesh" | "modern";

export interface HebrewHoliday {
  name: string;
  hebrewName?: string;
  type: HolidayType;
}

export interface HebrewDateInfo {
  year: number;
  month: number;
  day: number;
  /** Display name of the month (handles Adar I in leap years). */
  monthName: string;
  holidays: HebrewHoliday[];
}

/**
 * Returns the Hebrew date and any observed holidays for a Gregorian date.
 */
export function getHebrewDateInfo(gYear: number, gMonth: number, gDay: number): HebrewDateInfo {
  const jdn = gregorianToJDN(gYear, gMonth, gDay);
  const { year, month, day } = jdnToHebrew(jdn);
  // JDN % 7: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  const dow = jdn % 7;
  const isLeap = isLeapYear(year);
  const holidays: HebrewHoliday[] = [];

  // ── Shabbat ─────────────────────────────────────────────────────────────
  if (dow === 5) {
    holidays.push({ name: "Shabbat", hebrewName: "שַׁבָּת", type: "shabbat" });
  }

  // ── Rosh Chodesh ────────────────────────────────────────────────────────
  if (day === 1 && month !== 7) {
    const mName =
      isLeap && month === 12 ? "Adar I" :
      isLeap && month === 13 ? "Adar II" :
      MONTH_NAMES[month];
    holidays.push({ name: `Rosh Chodesh ${mName}`, type: "rosh_chodesh" });
  }
  // 30th of a full month = first day of Rosh Chodesh for the next month
  if (day === 30) {
    const nextM = month === 6 ? 7 : month === 13 ? 1 : month + 1;
    if (nextM !== 7) {
      const nextName =
        isLeap && nextM === 13 ? "Adar II" :
        isLeap && nextM === 12 ? "Adar I" :
        MONTH_NAMES[nextM];
      if (nextName) {
        holidays.push({ name: `Rosh Chodesh ${nextName}`, type: "rosh_chodesh" });
      }
    }
  }

  // ── Month-by-month holidays ──────────────────────────────────────────────
  switch (month) {
    // ── Tishrei ──────────────────────────────────────────────────────────
    case 7:
      if (day === 1 || day === 2)
        holidays.push({ name: "Rosh Hashanah", hebrewName: "רֹאשׁ הַשָּׁנָה", type: "major" });

      if (day === 3 && dow !== 5)
        holidays.push({ name: "Fast of Gedaliah", hebrewName: "צוֹם גְּדַלְיָה", type: "fast" });
      if (day === 4 && hebrewToJDN(year, 7, 3) % 7 === 5)
        holidays.push({ name: "Fast of Gedaliah", hebrewName: "צוֹם גְּדַלְיָה", type: "fast" });

      if (day === 10)
        holidays.push({ name: "Yom Kippur", hebrewName: "יוֹם כִּפּוּר", type: "major" });

      if (day >= 15 && day <= 20)
        holidays.push({ name: `Sukkot (Day ${day - 14})`, hebrewName: "סֻכּוֹת", type: "major" });
      if (day === 21) {
        holidays.push({ name: "Sukkot (Day 7)", hebrewName: "סֻכּוֹת", type: "major" });
        holidays.push({ name: "Hoshana Rabbah", hebrewName: "הוֹשַׁעְנָא רַבָּה", type: "major" });
      }
      if (day === 22)
        holidays.push({ name: "Shemini Atzeret", hebrewName: "שְׁמִינִי עֲצֶרֶת", type: "major" });
      if (day === 23)
        holidays.push({ name: "Simchat Torah", hebrewName: "שִׂמְחַת תּוֹרָה", type: "major" });
      break;

    // ── Kislev ───────────────────────────────────────────────────────────
    case 9:
      if (day >= 25)
        holidays.push({ name: `Hanukkah (Day ${day - 24})`, hebrewName: "חֲנֻכָּה", type: "major" });
      break;

    // ── Tevet ────────────────────────────────────────────────────────────
    case 10: {
      const kislevLen = daysInMonth(9, year);
      // If Kislev has 29 days → days 6-8 of Hanukkah are Tevet 1-3
      // If Kislev has 30 days → days 7-8 are Tevet 1-2
      const hanukkahStartInTevet = kislevLen === 29 ? 6 : 7;
      if (day >= 1 && day <= (kislevLen === 29 ? 3 : 2))
        holidays.push({
          name: `Hanukkah (Day ${hanukkahStartInTevet + day - 1})`,
          hebrewName: "חֲנֻכָּה",
          type: "major",
        });
      if (day === 10)
        holidays.push({ name: "Fast of 10 Tevet", hebrewName: "עֲשָׂרָה בְּטֵבֵת", type: "fast" });
      break;
    }

    // ── Shevat ───────────────────────────────────────────────────────────
    case 11:
      if (day === 15)
        holidays.push({ name: "Tu BiShvat", hebrewName: "טוּ בִּשְׁבָט", type: "minor" });
      break;

    // ── Adar / Adar I ────────────────────────────────────────────────────
    case 12:
      if (!isLeap) {
        if (day === 11 && hebrewToJDN(year, 12, 13) % 7 === 5)
          // Ta'anit Esther moved from Shabbat 13 → Thursday 11
          holidays.push({ name: "Ta'anit Esther", hebrewName: "תַּעֲנִית אֶסְתֵּר", type: "fast" });
        if (day === 13 && dow !== 5)
          holidays.push({ name: "Ta'anit Esther", hebrewName: "תַּעֲנִית אֶסְתֵּר", type: "fast" });
        if (day === 14)
          holidays.push({ name: "Purim", hebrewName: "פּוּרִים", type: "major" });
        if (day === 15)
          holidays.push({ name: "Shushan Purim", type: "minor" });
      } else {
        // Adar I in a leap year
        if (day === 14)
          holidays.push({ name: "Purim Katan", hebrewName: "פּוּרִים קָטָן", type: "minor" });
        if (day === 15)
          holidays.push({ name: "Shushan Purim Katan", type: "minor" });
      }
      break;

    // ── Adar II (leap years only) ─────────────────────────────────────────
    case 13:
      if (day === 11 && hebrewToJDN(year, 13, 13) % 7 === 5)
        holidays.push({ name: "Ta'anit Esther", hebrewName: "תַּעֲנִית אֶסְתֵּר", type: "fast" });
      if (day === 13 && dow !== 5)
        holidays.push({ name: "Ta'anit Esther", hebrewName: "תַּעֲנִית אֶסְתֵּר", type: "fast" });
      if (day === 14)
        holidays.push({ name: "Purim", hebrewName: "פּוּרִים", type: "major" });
      if (day === 15)
        holidays.push({ name: "Shushan Purim", type: "minor" });
      break;

    // ── Nisan ────────────────────────────────────────────────────────────
    case 1:
      if (day === 14)
        holidays.push({ name: "Erev Pesach", hebrewName: "עֶרֶב פֶּסַח", type: "major" });
      if (day >= 15 && day <= 22)
        holidays.push({
          name: `Passover / Pesach (Day ${day - 14})`,
          hebrewName: "פֶּסַח",
          type: "major",
        });
      if (day === 27) {
        // Adjusted: if Fri → Thu (26), if Sun → Mon (28)
        const baseJDN = hebrewToJDN(year, 1, 27);
        const baseDow = baseJDN % 7;
        const actualJDN =
          baseDow === 4 ? baseJDN - 1 : // Friday → Thursday
          baseDow === 6 ? baseJDN + 1 : // Sunday → Monday
          baseJDN;
        if (jdn === actualJDN)
          holidays.push({ name: "Yom HaShoah", hebrewName: "יוֹם הַשּׁוֹאָה", type: "modern" });
      }
      break;

    // ── Iyar ─────────────────────────────────────────────────────────────
    case 2: {
      // Yom Hazikaron (before) and Yom Ha'Atzmaut (5 Iyar) with adjustments:
      //   5 Iyar on Fri → Thu; on Sat → Thu; on Sun → Mon
      const baseJDN = hebrewToJDN(year, 2, 5);
      const baseDow  = baseJDN % 7;
      let haatzmautJDN: number;
      if (baseDow === 4 || baseDow === 5) {
        haatzmautJDN = baseJDN - (baseDow === 4 ? 1 : 2); // Thu or Thu-2
      } else if (baseDow === 6) {
        haatzmautJDN = baseJDN + 1; // Mon
      } else {
        haatzmautJDN = baseJDN;
      }
      const hazikronJDN = haatzmautJDN - 1;
      if (jdn === hazikronJDN)
        holidays.push({ name: "Yom Hazikaron", hebrewName: "יוֹם הַזִּכָּרוֹן", type: "modern" });
      if (jdn === haatzmautJDN)
        holidays.push({ name: "Yom Ha'Atzmaut", hebrewName: "יוֹם הָעַצְמָאוּת", type: "modern" });
      if (day === 18)
        holidays.push({ name: "Lag B'Omer", hebrewName: "לַ\"ג בָּעֹמֶר", type: "minor" });
      if (day === 28)
        holidays.push({ name: "Yom Yerushalayim", hebrewName: "יוֹם יְרוּשָׁלַיִם", type: "modern" });
      break;
    }

    // ── Sivan ────────────────────────────────────────────────────────────
    case 3:
      if (day === 6 || day === 7)
        holidays.push({ name: "Shavuot", hebrewName: "שָׁבוּעוֹת", type: "major" });
      break;

    // ── Tammuz ───────────────────────────────────────────────────────────
    case 4:
      if (day === 17 && dow !== 5)
        holidays.push({ name: "Fast of 17 Tammuz", hebrewName: "שִׁבְעָה עָשָׂר בְּתַמּוּז", type: "fast" });
      if (day === 18 && hebrewToJDN(year, 4, 17) % 7 === 5)
        holidays.push({ name: "Fast of 17 Tammuz", hebrewName: "שִׁבְעָה עָשָׂר בְּתַמּוּז", type: "fast" });
      break;

    // ── Av ───────────────────────────────────────────────────────────────
    case 5:
      if (day === 9 && dow !== 5)
        holidays.push({ name: "Tisha B'Av", hebrewName: "תִּשְׁעָה בְּאָב", type: "fast" });
      if (day === 10 && hebrewToJDN(year, 5, 9) % 7 === 5)
        holidays.push({ name: "Tisha B'Av", hebrewName: "תִּשְׁעָה בְּאָב", type: "fast" });
      if (day === 15)
        holidays.push({ name: "Tu B'Av", hebrewName: "טוּ בְּאָב", type: "minor" });
      break;
  }

  return {
    year,
    month,
    day,
    monthName:
      isLeap && month === 12 ? "Adar I" :
      isLeap && month === 13 ? "Adar II" :
      MONTH_NAMES[month] ?? `Month ${month}`,
    holidays,
  };
}
