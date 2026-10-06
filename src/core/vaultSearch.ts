// Full-text search across a vault's notes. Pure functions over a snapshot
// of the notes, so it can run in the index worker or the renderer.
//
// Query syntax (Obsidian-style):
// - `kyber crystal` — notes containing every word, anywhere
// - `"kyber crystal"` — the exact phrase
// - `-ilum` — leave out notes containing the word
// - `tag:lore`, `path:Lore/Crystals`, `file:log` — filters
// With "regular expression" on, the whole query is one pattern.
//
// Ranges are `{ location, length }` in UTF-16 code units (JavaScript string
// indices) within the line's original text — the same shape as NSRange.

import { basename, naturalCompare, title as noteTitle } from "./paths";

export interface SearchNote {
  /** Vault path, "/"-separated. */
  path: string;
  /** Raw note text, including frontmatter and code. */
  text: string;
  tags: string[];
}

export interface SearchQuery {
  terms: string[];
  excluded: string[];
  tags: string[];
  paths: string[];
  files: string[];
  matchCase: boolean;
  /** Set in regular-expression mode: the whole query as one pattern. */
  regex: string | null;
}

/** A span of UTF-16 code units: `text.slice(location, location + length)`. */
export interface SearchRange {
  location: number;
  length: number;
}

export interface LineMatch {
  /** 1-based line number. */
  line: number;
  text: string;
  /** Matches within `text`, sorted and non-overlapping. */
  ranges: SearchRange[];
}

export interface SearchHit {
  path: string;
  title: string;
  /** Total matches in the note (lines may hold several). */
  matchCount: number;
  /** Up to `maxLinesPerNote` matching lines, in order. */
  lines: LineMatch[];
  /** The note's title contains every term (or matches the pattern). */
  titleMatches: boolean;
}

export interface SearchOutcome {
  hits: SearchHit[];
  totalMatches: number;
  /** More notes matched than are listed. */
  truncated: boolean;
  error?: string;
}

export const MAX_NOTES = 200;
export const MAX_LINES_PER_NOTE = 20;
export const INVALID_REGEX_MESSAGE = "That isn’t a valid regular expression.";

// MARK: - Parsing

export function emptyQuery(matchCase = false): SearchQuery {
  return { terms: [], excluded: [], tags: [], paths: [], files: [], matchCase, regex: null };
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.excluded.length === 0 &&
    query.tags.length === 0 &&
    query.paths.length === 0 &&
    query.files.length === 0 &&
    !query.regex
  );
}

const EDGE_SPACES = /^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu;

export function parseQuery(
  input: string,
  options: { matchCase?: boolean; useRegex?: boolean } = {},
): SearchQuery {
  const query = emptyQuery(options.matchCase ?? false);
  if (options.useRegex) {
    query.regex = input.replace(EDGE_SPACES, "");
    return query;
  }
  for (const [text, quoted] of tokenize(input)) {
    if (quoted) {
      if (text !== "") query.terms.push(text);
      continue;
    }
    let value: string | null;
    if (text.startsWith("-") && text.length > 1) {
      query.excluded.push(text.slice(1));
    } else if ((value = valueOf("tag:", text)) !== null) {
      query.tags.push(value.startsWith("#") ? value.slice(1) : value);
    } else if ((value = valueOf("path:", text)) !== null) {
      query.paths.push(value);
    } else if ((value = valueOf("file:", text)) !== null) {
      query.files.push(value);
    } else {
      query.terms.push(text);
    }
  }
  return query;
}

const WHITESPACE = /\s/u;

/** Splits on whitespace, keeping "quoted phrases" (and `path:"a b"`) together. */
function tokenize(input: string): [string, boolean][] {
  const tokens: [string, boolean][] = [];
  let current = "";
  let inQuotes = false;
  let wasQuoted = false;
  const flush = () => {
    if (current !== "" || wasQuoted) tokens.push([current, wasQuoted && !current.includes(":")]);
    current = "";
    wasQuoted = false;
  };
  for (const character of input) {
    if (character === '"') {
      inQuotes = !inQuotes;
      wasQuoted = true;
    } else if (!inQuotes && WHITESPACE.test(character)) {
      flush();
    } else {
      current += character;
    }
  }
  flush();
  return tokens;
}

/** The value after a case-insensitive filter prefix, or null. */
function valueOf(prefix: string, token: string): string | null {
  if (token.length <= prefix.length || token.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  return token.slice(prefix.length);
}

// MARK: - Folding
//
// Case- and accent-insensitive matching compares folded text: lowercased,
// decomposed (NFD) and stripped of combining marks, so "Café" → "cafe".
// Folding is per character, so a match in folded text maps back to the
// original by walking both in step (see `unfoldRanges`).

const ASCII_ONLY = /^[\x00-\x7f]*$/;
const MARKS = /\p{M}/gu;
const FINAL_SIGMA = /ς/g;

/**
 * Folds a whole string with native operations — fast enough to screen every
 * note. Final sigma becomes σ so the result doesn't depend on context and
 * equals the concatenation of each character folded on its own.
 */
function quickFold(text: string): string {
  const lower = text.toLowerCase();
  if (ASCII_ONLY.test(lower)) return lower;
  return lower.normalize("NFD").replace(MARKS, "").replace(FINAL_SIGMA, "σ");
}

const foldedLengths = new Map<number, number>();

/** UTF-16 length of the folded form of the character at `index` (0 for a dropped mark). */
function foldedLength(text: string, index: number): number {
  const code = text.codePointAt(index)!;
  if (code < 0x80) return 1;
  let length = foldedLengths.get(code);
  if (length === undefined) {
    length = quickFold(String.fromCodePoint(code)).length;
    if (foldedLengths.size > 8192) foldedLengths.clear();
    foldedLengths.set(code, length);
  }
  return length;
}

/**
 * Maps sorted, non-overlapping ranges in `quickFold(text)` back to `text`.
 * A range covers every character that produced part of it, plus any
 * dropped accents right after it.
 */
function unfoldRanges(text: string, ranges: SearchRange[]): SearchRange[] {
  if (ASCII_ONLY.test(text)) return ranges;
  const result: SearchRange[] = [];
  let original = 0; // index into `text`
  let folded = 0; // folded offset where the character at `original` begins
  const step = () => {
    folded += foldedLength(text, original);
    original += text.charCodeAt(original) >= 0xd800 && text.charCodeAt(original) <= 0xdbff ? 2 : 1;
  };
  for (const range of ranges) {
    const end = range.location + range.length;
    while (original < text.length && folded + foldedLength(text, original) <= range.location) step();
    const start = original;
    while (original < text.length && folded < end) step();
    while (original < text.length && foldedLength(text, original) === 0) step();
    result.push({ location: start, length: original - start });
  }
  return result;
}

/**
 * Quick folds of note texts from earlier searches, by path, so typing in the
 * search field doesn't refold the vault on every keystroke.
 */
const noteFoldCache = new Map<string, { source: string; folded: string }>();

function foldedNote(note: SearchNote): string {
  const cached = noteFoldCache.get(note.path);
  if (cached && cached.source === note.text) return cached.folded;
  const folded = quickFold(note.text);
  noteFoldCache.set(note.path, { source: note.text, folded });
  return folded;
}

/** Drops cached folds of notes that are gone. */
function pruneFoldCache(notes: readonly SearchNote[]): void {
  if (noteFoldCache.size <= notes.length + 1000) return;
  const present = new Set(notes.map((note) => note.path));
  for (const path of noteFoldCache.keys()) if (!present.has(path)) noteFoldCache.delete(path);
}

// MARK: - Running

export function runSearch(
  query: SearchQuery,
  notes: readonly SearchNote[],
  maxNotes = MAX_NOTES,
  maxLinesPerNote = MAX_LINES_PER_NOTE,
): SearchOutcome {
  const outcome: SearchOutcome = { hits: [], totalMatches: 0, truncated: false };
  if (isEmptyQuery(query)) return outcome;

  // `^`/`$` match at line breaks; lines are searched one at a time.
  let lineRegex: RegExp | null = null;
  let testRegex: RegExp | null = null;
  if (query.regex) {
    const flags = query.matchCase ? "m" : "im";
    try {
      testRegex = compile(query.regex, flags);
      lineRegex = compile(query.regex, flags + "g");
    } catch {
      return { ...outcome, error: INVALID_REGEX_MESSAGE };
    }
  }
  const prepare = query.matchCase ? (text: string) => text : quickFold;
  const terms = query.terms.map(prepare);
  const excluded = query.excluded.map(prepare);
  const tags = query.tags.map((tag) => tag.toLowerCase());
  const paths = query.paths.map((path) => path.toLowerCase());
  const files = query.files.map((file) => file.toLowerCase());
  // NSString's range(of: "") finds nothing, so an empty term never matches.
  const contains = (haystack: string, needle: string) => needle !== "" && haystack.includes(needle);

  const candidates: { note: SearchNote; screened: string; hit: SearchHit }[] = [];
  for (const note of notes) {
    if (!passesFilters(note, tags, paths, files)) continue;
    const title = noteTitle(note.path);
    // Screen with the quick fold; offsets are only worked out for matching lines.
    const needsText = terms.length > 0 || excluded.length > 0;
    const screened = !needsText ? "" : query.matchCase ? note.text : foldedNote(note);

    if (excluded.some((word) => contains(screened, word))) continue;

    let titleMatches: boolean;
    let matchCount: number;
    // First pass: counts only. Lines are built afterwards for the notes kept.
    if (testRegex && lineRegex) {
      titleMatches = testRegex.test(title);
      if (!titleMatches && !testRegex.test(note.text)) continue;
      ({ matchCount } = regexLines(note.text, lineRegex, 0));
    } else {
      // Every term must appear in the note's text or its name.
      const foldedTitle = prepare(title);
      if (terms.some((term) => !contains(screened, term) && !contains(foldedTitle, term))) continue;
      titleMatches = terms.length > 0 && terms.every((term) => contains(foldedTitle, term));
      matchCount = terms.length > 0 ? termLines(note.text, screened, !query.matchCase, terms, 0).matchCount : 0;
    }
    // Filter-only queries (e.g. "tag:lore") list notes without lines.
    const hasTextQuery = lineRegex !== null || terms.length > 0;
    if (hasTextQuery && matchCount === 0 && !titleMatches) continue;

    outcome.totalMatches += matchCount;
    candidates.push({ note, screened, hit: { path: note.path, title, matchCount, lines: [], titleMatches } });
  }

  // Rank every match, then keep the best `maxNotes` (not merely the first found).
  candidates.sort((a, b) => {
    if (a.hit.titleMatches !== b.hit.titleMatches) return a.hit.titleMatches ? -1 : 1;
    if (a.hit.matchCount !== b.hit.matchCount) return b.hit.matchCount - a.hit.matchCount;
    return naturalCompare(a.hit.path, b.hit.path);
  });
  outcome.truncated = candidates.length > maxNotes;
  for (const { note, screened, hit } of candidates.slice(0, maxNotes)) {
    if (lineRegex) hit.lines = regexLines(note.text, lineRegex, maxLinesPerNote).lines;
    else if (terms.length > 0) hit.lines = termLines(note.text, screened, !query.matchCase, terms, maxLinesPerNote).lines;
    outcome.hits.push(hit);
  }
  if (!query.matchCase) pruneFoldCache(notes);
  return outcome;
}

/** Parses and runs in one step. */
export function search(
  input: string,
  notes: readonly SearchNote[],
  options: { matchCase?: boolean; useRegex?: boolean } = {},
): SearchOutcome {
  return runSearch(parseQuery(input, options), notes);
}

/** Unicode mode when the pattern allows it (\p{L} etc.), else legacy syntax. */
function compile(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags + "u");
  } catch {
    return new RegExp(pattern, flags);
  }
}

function passesFilters(note: SearchNote, tags: string[], paths: string[], files: string[]): boolean {
  if (paths.length > 0) {
    const path = note.path.toLowerCase();
    if (!paths.every((filter) => path.includes(filter))) return false;
  }
  if (files.length > 0) {
    const file = basename(note.path).toLowerCase();
    if (!files.every((filter) => file.includes(filter))) return false;
  }
  if (tags.length > 0) {
    const noteTags = note.tags.map((tag) => tag.toLowerCase());
    for (const wanted of tags) {
      if (!noteTags.some((tag) => tag === wanted || tag.startsWith(wanted + "/"))) return false;
    }
  }
  return true;
}

/** Lines split on \n, \r\n or \r; a trailing break adds no empty line. */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function regexLines(text: string, regex: RegExp, maxLines: number): { lines: LineMatch[]; matchCount: number } {
  const lines: LineMatch[] = [];
  let matchCount = 0;
  const all = splitLines(text);
  for (let index = 0; index < all.length; index++) {
    const line = all[index]!;
    const ranges: SearchRange[] = [];
    for (const match of line.matchAll(regex)) {
      if (match[0].length > 0) ranges.push({ location: match.index, length: match[0].length });
    }
    if (ranges.length === 0) continue;
    matchCount += ranges.length;
    if (lines.length < maxLines) lines.push({ line: index + 1, text: line, ranges });
  }
  return { lines, matchCount };
}

/**
 * Every occurrence of each term, searched once over the whole (folded)
 * `haystack`, then grouped by line with overlaps merged (e.g. "kyber" and
 * "kyber crystal"). Folding keeps line breaks, so lines correspond one to
 * one; only lines that are listed are refolded to map ranges back.
 */
function termLines(
  original: string,
  haystack: string,
  folding: boolean,
  terms: string[],
  maxLines: number,
): { lines: LineMatch[]; matchCount: number } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const term of terms) {
    // Lines never contain a break, so such a term can't match within one.
    if (term === "" || term.includes("\n") || term.includes("\r")) continue;
    let from = 0;
    for (;;) {
      const found = haystack.indexOf(term, from);
      if (found < 0) break;
      from = found + term.length;
      starts.push(found);
      ends.push(from);
    }
  }
  if (starts.length === 0) return { lines: [], matchCount: 0 };

  const order = starts.map((_, index) => index);
  if (terms.length > 1) order.sort((a, b) => starts[a]! - starts[b]! || ends[a]! - ends[b]!);
  const lines: LineMatch[] = [];
  let matchCount = 0;
  const foldedLine = new LineCursor(haystack);
  const originalLine = folding ? new LineCursor(original) : foldedLine;
  let current: SearchRange[] = [];
  const finishLine = () => {
    if (current.length === 0) return;
    matchCount += current.length;
    if (lines.length < maxLines) {
      const text = original.slice(originalLine.start, originalLine.end);
      lines.push({ line: foldedLine.number, text, ranges: folding ? unfoldRanges(text, current) : current });
    }
    current = [];
  };
  for (const index of order) {
    const start = starts[index]!;
    const end = ends[index]!;
    if (start >= foldedLine.end && !foldedLine.atEnd) {
      finishLine();
      while (start >= foldedLine.end && !foldedLine.atEnd) {
        foldedLine.advance();
        if (originalLine !== foldedLine && lines.length < maxLines) originalLine.advance();
      }
    }
    const location = start - foldedLine.start;
    const last = current[current.length - 1];
    if (last && location <= last.location + last.length) {
      last.length = Math.max(last.length, end - foldedLine.start - last.location);
    } else {
      current.push({ location, length: end - start });
    }
  }
  finishLine();
  return { lines, matchCount };
}

/** Walks the lines of a text (breaks: \n, \r\n, \r) without splitting it. */
class LineCursor {
  number = 1;
  start = 0;
  end: number;
  private nextNewline: number;
  private nextReturn: number;

  constructor(private readonly text: string) {
    this.nextNewline = text.indexOf("\n");
    this.nextReturn = text.indexOf("\r");
    this.end = this.findEnd();
  }

  get atEnd(): boolean {
    return this.end >= this.text.length;
  }

  advance(): void {
    const text = this.text;
    this.start = this.end + (text.charCodeAt(this.end) === 13 && text.charCodeAt(this.end + 1) === 10 ? 2 : 1);
    this.number++;
    this.end = this.findEnd();
  }

  private findEnd(): number {
    if (this.nextNewline >= 0 && this.nextNewline < this.start) this.nextNewline = this.text.indexOf("\n", this.start);
    if (this.nextReturn >= 0 && this.nextReturn < this.start) this.nextReturn = this.text.indexOf("\r", this.start);
    const newline = this.nextNewline < 0 ? this.text.length : this.nextNewline;
    return this.nextReturn >= 0 && this.nextReturn < newline ? this.nextReturn : newline;
  }
}

// MARK: - Snippets

export interface Snippet {
  /** The trimmed line, with "…" where text was cut. */
  text: string;
  /** Matches within `text`. */
  ranges: SearchRange[];
}

export const SNIPPET_LEAD = 24;
export const SNIPPET_LENGTH = 240;

const SPACE = /[\t\p{Zs}]/u;
const MARK = /\p{M}/u;

/**
 * The matching line, trimmed to start shortly before the first match (at a
 * word boundary) and to at most 240 characters, with ranges adjusted to it.
 */
export function snippet(lineText: string, ranges: readonly SearchRange[]): Snippet {
  const firstMatch = ranges[0]?.location ?? 0;
  let start = Math.max(0, firstMatch - SNIPPET_LEAD);
  if (start > 0) {
    // Begin at the next word boundary so the snippet doesn't start mid-word.
    let space = -1;
    for (let i = start; i < firstMatch; i++) {
      if (SPACE.test(lineText[i]!)) {
        space = i;
        break;
      }
    }
    start = space >= 0 ? space + 1 : characterStart(lineText, start);
  }
  let end = Math.min(lineText.length, start + SNIPPET_LENGTH);
  if (end < lineText.length && isLowSurrogate(lineText.charCodeAt(end))) end--;

  const prefix = start > 0 ? "…" : "";
  const adjusted: SearchRange[] = [];
  for (const range of ranges) {
    if (range.location < start || range.location >= end) continue;
    const length = Math.min(range.length, end - range.location);
    adjusted.push({ location: range.location - start + prefix.length, length });
  }
  const text = prefix + lineText.slice(start, end) + (end < lineText.length ? "…" : "");
  return { text, ranges: adjusted };
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Steps back to the start of the user-perceived character containing `index`. */
function characterStart(text: string, index: number): number {
  let i = index;
  for (;;) {
    if (i > 0 && isLowSurrogate(text.charCodeAt(i))) {
      i--;
    } else if (i > 0 && MARK.test(String.fromCodePoint(text.codePointAt(i)!))) {
      i--;
    } else {
      return i;
    }
  }
}
