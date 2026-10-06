// Daily notes, Obsidian-compatible: one note per day at
// `<folder>/<date in format>.md`, optionally created from a template.
// Formats use Moment.js tokens (YYYY-MM-DD) like Obsidian; a "/" in the
// format makes subfolders (YYYY/MM/YYYY-MM-DD). Dates are formatted in the
// local time zone with the Gregorian calendar and en-US names, so file names
// don't depend on the system language.

import { basename, withoutExtension } from "./paths";

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((name) => name.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = WEEKDAYS.map((name) => name.slice(0, 3));
const MERIDIEMS = ["AM", "PM"];

/** Moment tokens, longest first within each family. */
const TOKENS = [
  "YYYY", "YY",
  "MMMM", "MMM", "MM", "M",
  "DDDD", "DD", "Do", "D",
  "dddd", "ddd",
  "HH", "H", "hh", "h",
  "mm", "m", "ss", "s",
  "A", "a",
  "ww", "w", "gggg", "Q",
] as const;
type Token = (typeof TOKENS)[number];

type Part = { literal: string } | { token: Token };

/** Splits a Moment format into tokens and literal text. Text in [brackets] is literal, as is any other character. */
function compile(format: string): Part[] {
  const parts: Part[] = [];
  let literal = "";
  const flush = () => {
    if (literal) parts.push({ literal });
    literal = "";
  };
  let i = 0;
  while (i < format.length) {
    if (format[i] === "[") {
      const close = format.indexOf("]", i + 1);
      if (close >= 0) {
        literal += format.slice(i + 1, close);
        i = close + 1;
        continue;
      }
    }
    const token = TOKENS.find((t) => format.startsWith(t, i));
    if (token) {
      flush();
      parts.push({ token });
      i += token.length;
      continue;
    }
    const char = String.fromCodePoint(format.codePointAt(i)!);
    literal += char;
    i += char.length;
  }
  flush();
  return parts;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st… */
function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** A local date from components; months and days may overflow. Unlike `new Date(y, …)`, years below 100 stay as given. */
function makeDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  date.setHours(hour, minute, second, 0);
  return date;
}

function dayOfYear(date: Date): number {
  const y = date.getFullYear();
  return Math.round((Date.UTC(y, date.getMonth(), date.getDate()) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** US week numbering (en_US): weeks start on Sunday; week 1 contains January 1. */
function week(date: Date): { week: number; weekYear: number } {
  const year = date.getFullYear();
  const saturday = makeDate(year, date.getMonth(), date.getDate() + 6 - date.getDay());
  if (saturday.getFullYear() > year) return { week: 1, weekYear: year + 1 };
  const jan1 = makeDate(year, 0, 1).getDay();
  return { week: Math.floor((dayOfYear(date) - 1 + jan1) / 7) + 1, weekYear: year };
}

function formatToken(token: Token, date: Date): string {
  const hour = date.getHours();
  switch (token) {
    case "YYYY": return pad(date.getFullYear(), 4);
    case "YY": return pad(date.getFullYear() % 100, 2);
    case "MMMM": return MONTHS[date.getMonth()]!;
    case "MMM": return MONTHS_SHORT[date.getMonth()]!;
    case "MM": return pad(date.getMonth() + 1, 2);
    case "M": return String(date.getMonth() + 1);
    case "DDDD": return pad(dayOfYear(date), 3);
    case "DD": return pad(date.getDate(), 2);
    case "Do": return ordinal(date.getDate());
    case "D": return String(date.getDate());
    case "dddd": return WEEKDAYS[date.getDay()]!;
    case "ddd": return WEEKDAYS_SHORT[date.getDay()]!;
    case "HH": return pad(hour, 2);
    case "H": return String(hour);
    case "hh": return pad(hour % 12 || 12, 2);
    case "h": return String(hour % 12 || 12);
    case "mm": return pad(date.getMinutes(), 2);
    case "m": return String(date.getMinutes());
    case "ss": return pad(date.getSeconds(), 2);
    case "s": return String(date.getSeconds());
    case "A":
    case "a": return MERIDIEMS[hour < 12 ? 0 : 1]!;
    case "ww": return pad(week(date).week, 2);
    case "w": return String(week(date).week);
    case "gggg": return pad(week(date).weekYear, 4);
    case "Q": return String(Math.floor(date.getMonth() / 3) + 1);
  }
}

/** Formats `date` with a Moment.js format ("YYYY-MM-DD", "dddd, MMMM Do"…). */
export function formatDate(date: Date, format: string): string {
  return compile(format)
    .map((part) => ("literal" in part ? part.literal : formatToken(part.token, date)))
    .join("");
}

interface Fields {
  year?: number;
  shortYear?: number;
  month?: number; // 0-based
  day?: number;
  dayOfYear?: number;
  weekday?: number;
  hour24?: number;
  hour12?: number;
  pm?: boolean;
  minute?: number;
  second?: number;
  week?: number;
  weekYear?: number;
  quarter?: number;
}

/** Digit widths and the field each numeric token sets. */
const NUMERIC: Partial<Record<Token, [min: number, max: number, field: keyof Fields]>> = {
  YYYY: [4, 4, "year"], YY: [2, 2, "shortYear"],
  MM: [2, 2, "month"], M: [1, 2, "month"],
  DDDD: [3, 3, "dayOfYear"], DD: [2, 2, "day"], Do: [1, 2, "day"], D: [1, 2, "day"],
  HH: [2, 2, "hour24"], H: [1, 2, "hour24"], hh: [2, 2, "hour12"], h: [1, 2, "hour12"],
  mm: [2, 2, "minute"], m: [1, 2, "minute"], ss: [2, 2, "second"], s: [1, 2, "second"],
  ww: [2, 2, "week"], w: [1, 2, "week"], gggg: [4, 4, "weekYear"], Q: [1, 1, "quarter"],
};

/** Names a token can match, and the field it sets to the matched index. */
const NAMED: Partial<Record<Token, [names: string[], field: keyof Fields]>> = {
  MMMM: [MONTHS, "month"], MMM: [MONTHS_SHORT, "month"],
  dddd: [WEEKDAYS, "weekday"], ddd: [WEEKDAYS_SHORT, "weekday"],
  A: [MERIDIEMS, "pm"], a: [MERIDIEMS, "pm"],
};

/** Builds a date from parsed fields; missing ones default as in ICU (1970-01-01 00:00). */
function build(f: Fields): Date {
  let year = f.year ?? 1970;
  if (f.year === undefined && f.shortYear !== undefined) {
    // ICU's two-digit year window: 80 years back to 20 years ahead.
    const start = new Date().getFullYear() - 80;
    year = start - (start % 100) + f.shortYear;
    if (year < start) year += 100;
  }
  const hour = f.hour24 ?? (f.hour12 !== undefined ? (f.hour12 % 12) + (f.pm ? 12 : 0) : f.pm ? 12 : 0);
  const minute = f.minute ?? 0;
  const second = f.second ?? 0;
  if (f.day !== undefined) {
    return makeDate(year, f.month ?? 0, f.day, hour, minute, second);
  }
  let date: Date;
  if (f.dayOfYear !== undefined) {
    return makeDate(year, 0, f.dayOfYear, hour, minute, second);
  } else if (f.week !== undefined) {
    const weekYear = f.weekYear ?? year;
    const jan1 = makeDate(weekYear, 0, 1).getDay();
    date = makeDate(weekYear, 0, 1 - jan1 + (f.week - 1) * 7, hour, minute, second);
  } else {
    const month = f.month ?? (f.quarter !== undefined ? (f.quarter - 1) * 3 : 0);
    date = makeDate(year, month, 1, hour, minute, second);
  }
  if (f.weekday !== undefined) date.setDate(date.getDate() - date.getDay() + f.weekday);
  return date;
}

/**
 * Parses text written in a Moment format. Strict: only succeeds if
 * formatting the result reproduces `text` exactly ("2026-13-45" fails).
 */
export function parseDate(text: string, format: string): Date | null {
  const parts = compile(format);

  const walk = (index: number, position: number, fields: Fields): Date | null => {
    if (index === parts.length) {
      if (position !== text.length) return null;
      const date = build(fields);
      return formatDate(date, format) === text ? date : null;
    }
    const part = parts[index]!;
    if ("literal" in part) {
      return text.startsWith(part.literal, position) ? walk(index + 1, position + part.literal.length, fields) : null;
    }
    const numeric = NUMERIC[part.token];
    if (numeric) {
      const [min, max, field] = numeric;
      for (let width = max; width >= min; width--) {
        const digits = text.slice(position, position + width);
        if (digits.length !== width || !/^[0-9]+$/.test(digits)) continue;
        let value = Number(digits);
        if (field === "month") value -= 1;
        let end = position + width;
        if (part.token === "Do") {
          if (!/^(st|nd|rd|th)/.test(text.slice(end, end + 2))) continue;
          end += 2;
        }
        const date = walk(index + 1, end, { ...fields, [field]: value });
        if (date) return date;
      }
      return null;
    }
    const [names, field] = NAMED[part.token]!;
    for (let i = 0; i < names.length; i++) {
      if (!text.startsWith(names[i]!, position)) continue;
      const date = walk(index + 1, position + names[i]!.length, { ...fields, [field]: field === "pm" ? i === 1 : i });
      if (date) return date;
    }
    return null;
  };

  return walk(0, 0, {});
}

/** Resolves "." and ".." segments and stray slashes; never climbs above the vault root. */
function normalizeFolder(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** The vault-relative path of the daily note for `date`. */
export function dailyNotePath(date: Date, folder: string, format: string): string {
  const name = formatDate(date, format || DEFAULT_DAILY_FORMAT);
  const normalized = normalizeFolder(folder);
  return (normalized ? normalized + "/" : "") + name + ".md";
}

/** The day (local midnight) a vault-relative path is the daily note for, if it is one. */
export function dailyNoteDate(path: string, folder: string, format: string): Date | null {
  const normalized = normalizeFolder(folder);
  let name = withoutExtension(path);
  if (normalized) {
    if (!name.startsWith(normalized + "/")) return null;
    name = name.slice(normalized.length + 1);
  }
  const date = parseDate(name, format || DEFAULT_DAILY_FORMAT);
  return date && makeDate(date.getFullYear(), date.getMonth(), date.getDate());
}

const trimSpaces = (text: string) => text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");

/**
 * Fills in {{title}}, {{date}}, {{date:FORMAT}}, {{time}}, {{time:FORMAT}},
 * {{yesterday}} and {{tomorrow}} (the neighbouring days' note names, handy
 * for [[links]]; with :FORMAT, those days in that format). Other
 * placeholders are left as they are.
 */
export function renderPlaceholders(template: string, date: Date, title: string, dateFormat: string): string {
  const dayFormat = dateFormat || DEFAULT_DAILY_FORMAT;
  const noteName = (day: Date) => basename(formatDate(day, dayFormat));
  const addDays = (days: number) =>
    makeDate(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds());
  const pattern = /\{\{\s*(title|date|time|yesterday|tomorrow)\s*(?::([^}]*))?\}\}/g;
  return template.replace(pattern, (_match, name: string, rawFormat: string | undefined) => {
    const format = rawFormat === undefined ? undefined : trimSpaces(rawFormat);
    const named = (day: Date) => (format === undefined ? noteName(day) : formatDate(day, format));
    switch (name) {
      case "title": return title;
      case "date": return named(date);
      case "time": return formatDate(date, format ?? "HH:mm");
      case "yesterday": return named(addDays(-1));
      default: return named(addDays(1));
    }
  });
}
