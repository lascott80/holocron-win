// Quick Open: fuzzy matching and ranking of notes (QO-01, QO-02).

import { naturalCompare, stem, withoutExtension } from "./paths";

export interface FuzzyResult {
  score: number;
  /** Offsets in the candidate that matched, for highlighting (code points, as from `Array.from`). */
  indices: number[];
}

const IMPOSSIBLE = -(2 ** 40);
const isLowercase = (c: string) => /\p{Lowercase}/u.test(c);
const isUppercase = (c: string) => /\p{Uppercase}/u.test(c);
const isLetter = (c: string) => /\p{Alphabetic}/u.test(c);

/**
 * Subsequence fuzzy matching: every query character must appear in order
 * (case-insensitive, whitespace in the query ignored). Matches at word
 * starts and runs of consecutive characters score higher; shorter
 * candidates win ties. Null if the query isn't a subsequence.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyResult | null {
  const needle = Array.from(query).filter((c) => !/\s/u.test(c)).map((c) => c.toLowerCase());
  if (needle.length === 0) return { score: 0, indices: [] };
  const original = Array.from(candidate);
  const haystack = original.map((c) => c.toLowerCase());
  const n = needle.length, m = haystack.length;
  if (n > m) return null;

  // Quick reject: not a subsequence at all.
  let probe = 0;
  for (const c of haystack) if (probe < n && c === needle[probe]) probe++;
  if (probe !== n) return null;

  const bonus = (j: number): number => {
    if (j === 0) return 12;
    const previous = original[j - 1]!, current = original[j]!;
    if (" -_/.".includes(previous)) return 10;
    if (isLowercase(previous) && isUppercase(current)) return 8;
    if (!isLetter(previous) && isLetter(current)) return 6;
    return 0;
  };

  // best[i][j]: best score with needle[i] matched at haystack[j].
  const best = Array.from({ length: n }, () => new Array<number>(m).fill(IMPOSSIBLE));
  const from = Array.from({ length: n }, () => new Array<number>(m).fill(-1));

  for (let j = 0; j < m; j++) {
    if (haystack[j] === needle[0]) best[0]![j] = 1 + bonus(j) - Math.min(j, 8);
  }
  for (let i = 1; i < n; i++) {
    const previous = best[i - 1]!, row = best[i]!;
    let runningBest = IMPOSSIBLE; // max of previous[k] for k < j-1
    let runningIndex = -1;
    for (let j = i; j < m; j++) {
      if (j >= 2 && previous[j - 2]! > runningBest) {
        runningBest = previous[j - 2]!;
        runningIndex = j - 2;
      }
      if (haystack[j] !== needle[i]) continue;
      const consecutive = previous[j - 1]! > IMPOSSIBLE ? previous[j - 1]! + 8 : IMPOSSIBLE;
      const gapped = runningBest > IMPOSSIBLE ? runningBest - 2 : IMPOSSIBLE;
      if (consecutive >= gapped && consecutive > IMPOSSIBLE) {
        row[j] = consecutive + 1 + bonus(j);
        from[i]![j] = j - 1;
      } else if (gapped > IMPOSSIBLE) {
        row[j] = gapped + 1 + bonus(j);
        from[i]![j] = runningIndex;
      }
    }
  }

  const last = best[n - 1]!;
  let end = 0;
  for (let j = 1; j < m; j++) if (last[j]! > last[end]!) end = j;
  if (!(last[end]! > IMPOSSIBLE)) return null;
  const indices = [end];
  let j = end;
  for (let i = n - 1; i > 0; i--) {
    j = from[i]![j]!;
    indices.push(j);
  }
  return { score: last[end]! * 4 - m, indices: indices.reverse() };
}

export interface QuickOpenNote {
  path: string;
  aliases: string[];
  tags: string[];
}

export type QuickOpenField = { kind: "title" } | { kind: "alias"; alias: string } | { kind: "path" };

export interface QuickOpenHit {
  path: string;
  field: QuickOpenField;
  indices: number[];
  score: number;
}

const trimSpaces = (text: string) => text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");

function ranked(a: QuickOpenHit, b: QuickOpenHit): number {
  return b.score - a.score || naturalCompare(a.path, b.path);
}

/**
 * Ranks notes for the quick open palette. `recent` lists recently opened
 * paths, most recent first; they rank higher.
 * - "kyb" fuzzy-matches titles, then aliases, then paths (without extension).
 * - "#tag" lists notes with that tag (or a nested tag under it); "#" alone, every tagged note.
 * - An empty query lists recent notes.
 */
export function quickOpenSearch(notes: QuickOpenNote[], recent: string[], query: string, limit = 50): QuickOpenHit[] {
  const recencyBonus = (path: string) => {
    const position = recent.indexOf(path);
    return position < 0 ? 0 : Math.max(0, 20 - position * 2);
  };

  const trimmed = trimSpaces(query);
  if (trimmed === "") {
    const known = new Set(notes.map((note) => note.path));
    return recent
      .filter((path) => known.has(path))
      .slice(0, limit)
      .map((path) => ({ path, field: { kind: "title" }, indices: [], score: 0 }));
  }
  if (trimmed.startsWith("#")) {
    const tag = trimmed.slice(1).toLowerCase();
    return notes
      .filter((note) => note.tags.some((t) => tag === "" || t.toLowerCase() === tag || t.toLowerCase().startsWith(tag + "/")))
      .map((note): QuickOpenHit => ({ path: note.path, field: { kind: "title" }, indices: [], score: recencyBonus(note.path) }))
      .sort(ranked)
      .slice(0, limit);
  }

  const hits: QuickOpenHit[] = [];
  for (const note of notes) {
    const candidates: QuickOpenHit[] = [];
    const title = fuzzyMatch(trimmed, stem(note.path));
    if (title) candidates.push({ path: note.path, field: { kind: "title" }, indices: title.indices, score: title.score + 40 });
    for (const alias of note.aliases) {
      const match = fuzzyMatch(trimmed, alias);
      if (match) candidates.push({ path: note.path, field: { kind: "alias", alias }, indices: match.indices, score: match.score + 20 });
    }
    if (candidates.length === 0) {
      const match = fuzzyMatch(trimmed, withoutExtension(note.path));
      if (match) candidates.push({ path: note.path, field: { kind: "path" }, indices: match.indices, score: match.score });
    }
    // The first of equally good fields wins, as in Swift's max(by:).
    const winner = candidates.reduce<QuickOpenHit | null>((a, b) => (a === null || b.score > a.score ? b : a), null);
    if (winner) hits.push({ ...winner, score: winner.score + recencyBonus(note.path) });
  }
  return hits.sort(ranked).slice(0, limit);
}
