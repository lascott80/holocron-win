// Line-based diff and three-way merge, used to combine edits made in
// Holocron with changes that arrived on disk from another app or device.

/**
 * A region where `other` differs from `base`: base lines
 * `baseStart..<baseEnd` became other lines `otherStart..<otherEnd`.
 */
export interface Hunk {
  baseStart: number;
  baseEnd: number;
  otherStart: number;
  otherEnd: number;
}

export interface Conflict {
  base: string[];
  mine: string[];
  theirs: string[];
}

export interface MergeResult {
  /** The merged text, or `null` when both sides changed the same lines. */
  mergedText: string | null;
  conflicts: Conflict[];
  isClean: boolean;
}

/** A text replacement in UTF-16 offsets (what JavaScript strings use). */
export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Splits text into lines, each keeping its line ending, so joining the
 * pieces gives back the exact original text. "\r\n" is one break (its "\r"
 * stays with the line); a lone "\r" is not a break.
 */
export function lines(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", start)) {
    result.push(text.slice(start, index + 1));
    start = index + 1;
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

function result(mergedText: string | null, conflicts: Conflict[]): MergeResult {
  return { mergedText, conflicts, isClean: mergedText !== null };
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** Three-way merge of `mine` and `theirs`, both edited from `base`. */
export function merge(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs) return result(mine, []);
  if (mine === base) return result(theirs, []);
  if (theirs === base) return result(mine, []);

  const baseLines = lines(base);
  const mineLines = lines(mine);
  const theirLines = lines(theirs);

  // Group hunks from both sides whose base ranges overlap or touch.
  type Tagged = { hunk: Hunk; mine: boolean };
  const tagged: Tagged[] = [
    ...diff(baseLines, mineLines).map((hunk) => ({ hunk, mine: true })),
    ...diff(baseLines, theirLines).map((hunk) => ({ hunk, mine: false })),
  ].sort((a, b) => a.hunk.baseStart - b.hunk.baseStart || a.hunk.baseEnd - b.hunk.baseEnd);

  const groups: Tagged[][] = [];
  let groupEnd = -1;
  for (const item of tagged) {
    if (groups.length > 0 && item.hunk.baseStart <= groupEnd) {
      groups[groups.length - 1].push(item);
      groupEnd = Math.max(groupEnd, item.hunk.baseEnd);
    } else {
      groups.push([item]);
      groupEnd = item.hunk.baseEnd;
    }
  }

  const output: string[] = [];
  const conflicts: Conflict[] = [];
  let basePosition = 0;
  let mineDelta = 0; // mine index − base index outside hunks seen so far
  let theirDelta = 0;
  const growth = (hunks: Hunk[]) =>
    hunks.reduce((sum, h) => sum + (h.otherEnd - h.otherStart) - (h.baseEnd - h.baseStart), 0);

  for (const group of groups) {
    const low = Math.min(...group.map((item) => item.hunk.baseStart));
    const high = Math.max(...group.map((item) => item.hunk.baseEnd));
    output.push(...baseLines.slice(basePosition, low));

    const mineInGroup = group.filter((item) => item.mine).map((item) => item.hunk);
    const theirsInGroup = group.filter((item) => !item.mine).map((item) => item.hunk);
    const mineGrowth = growth(mineInGroup);
    const theirGrowth = growth(theirsInGroup);

    const mineSlice = mineLines.slice(low + mineDelta, high + mineDelta + mineGrowth);
    const theirSlice = theirLines.slice(low + theirDelta, high + theirDelta + theirGrowth);

    if (theirsInGroup.length === 0) {
      output.push(...mineSlice);
    } else if (mineInGroup.length === 0 || sameLines(mineSlice, theirSlice)) {
      output.push(...theirSlice);
    } else {
      conflicts.push({ base: baseLines.slice(low, high), mine: mineSlice, theirs: theirSlice });
      output.push(...mineSlice);
    }

    mineDelta += mineGrowth;
    theirDelta += theirGrowth;
    basePosition = high;
  }
  output.push(...baseLines.slice(basePosition));

  return result(conflicts.length === 0 ? output.join("") : null, conflicts);
}

/**
 * The line-level replacements that turn `oldText` into `newText`, with
 * offsets into `oldText`. Lets the editor apply only what changed, so the
 * cursor and undo history elsewhere in the note are untouched.
 */
export function edits(oldText: string, newText: string): Edit[] {
  const oldLines = lines(oldText);
  const newLines = lines(newText);
  const offsets = [0];
  for (const line of oldLines) offsets.push(offsets[offsets.length - 1] + line.length);
  return diff(oldLines, newLines).map((hunk) => ({
    from: offsets[hunk.baseStart],
    to: offsets[hunk.baseEnd],
    insert: newLines.slice(hunk.otherStart, hunk.otherEnd).join(""),
  }));
}

/** Myers diff: the regions where `other` differs from `base`. */
export function diff(base: readonly string[], other: readonly string[]): Hunk[] {
  // Common prefix and suffix are cheap to strip and keep the search small.
  let prefix = 0;
  while (prefix < base.length && prefix < other.length && base[prefix] === other[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < other.length - prefix &&
    base[base.length - 1 - suffix] === other[other.length - 1 - suffix]
  ) suffix++;

  const a = base.slice(prefix, base.length - suffix);
  const b = other.slice(prefix, other.length - suffix);
  const matches = myersMatches(a, b).map(([x, y]): [number, number] => [x + prefix, y + prefix]);
  matches.push([base.length - suffix, other.length - suffix]);

  const hunks: Hunk[] = [];
  let i = prefix;
  let j = prefix;
  for (const [x, y] of matches) {
    if (x > i || y > j) hunks.push({ baseStart: i, baseEnd: x, otherStart: j, otherEnd: y });
    i = x + 1;
    j = y + 1;
  }
  return hunks;
}

/** Pairs of equal line indices on a shortest edit path, in order. */
function myersMatches(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const maxD = n + m;
  const offset = maxD + 1;
  const v = new Int32Array(2 * maxD + 3);
  // trace[d] holds v[-d-1...d+1] as it was before step d: O(D²) memory.
  const trace: Int32Array[] = [];

  let finalD = 0;
  search: for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])
        ? v[k + 1 + offset]
        : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        finalD = d;
        break search;
      }
    }
  }

  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = finalD; d >= 1; d--) {
    const previous = trace[d];
    const at = (k: number) => previous[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches.push([x, y]);
  }
  return matches.reverse();
}
