// Turning an unlinked mention into a link (LNK-15): on one line of a note,
// the first whole-word, case- and accent-insensitive occurrence of a note's
// title or alias becomes `[[Target]]`, or `[[Target|as written]]` when the
// text differs from the link target. Never inside code, an existing link, a
// tag or frontmatter. Line endings are kept; nothing else on the line moves.

export interface LinkedMention {
  /** The whole note text with the line rewritten. */
  text: string;
  /** The mention as it was written ("kyber", "Kyber Crystal Notes"…). */
  matched: string;
}

/**
 * Rewrites the first mention of one of `names` on line `lineNumber`
 * (1-based) of `text` as a wikilink to `target`, or returns null when the
 * line has no linkable mention (none at all, or only inside code or links).
 */
export function linkMentionOnLine(text: string, lineNumber: number, names: string[], target: string): LinkedMention | null {
  const lines = text.split("\n");
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length || !isLinkableLine(lines, index)) return null;
  const raw = lines[index];
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  const match = firstMention(line, names);
  if (!match) return null;
  const matched = line.slice(match.start, match.end);
  const link = matched === target ? `[[${target}]]` : `[[${target}|${matched}]]`;
  lines[index] = line.slice(0, match.start) + link + line.slice(match.end) + (raw === line ? "" : "\r");
  return { text: lines.join("\n"), matched };
}

/** Outside frontmatter and fenced code. */
function isLinkableLine(lines: string[], index: number): boolean {
  let start = 0;
  if (lines[0]?.replace(/\r$/, "") === "---") {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\r?$/.test(line));
    if (end > 0) {
      if (index <= end) return false;
      start = end + 1;
    }
  }
  let fence: string | null = null;
  for (let i = start; i < index; i++) {
    const trimmed = lines[i].replace(/^[ \t]+/, "");
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
    } else if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
    }
  }
  return fence === null;
}

type Range = [number, number];

/** UTF-16 ranges of a line that a mention may not be linked in: code spans, links, tags, URLs and HTML tags. */
function protectedRanges(line: string): Range[] {
  const ranges: Range[] = [];
  let open: number | null = null;
  for (let offset = line.indexOf("`"); offset >= 0; offset = line.indexOf("`", offset + 1)) {
    if (open === null) open = offset;
    else {
      ranges.push([open, offset + 1]);
      open = null;
    }
  }
  const patterns = [
    /!?\[\[[^\]]*\]\]/g, // [[wikilinks]] and embeds
    /!?\[[^\]]*\]\([^)]*\)/g, // [text](destination)
    /<[^>\s][^>]*>/g, // <autolinks> and HTML tags
    /\bhttps?:\/\/\S+/g, // bare URLs
    /(?<![\p{L}\p{N}])#[\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*/gu, // #tags
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

interface Found {
  start: number;
  end: number;
}

/** The earliest whole-word occurrence of any name (the longest at a tie), outside protected ranges. */
function firstMention(line: string, names: string[]): Found | null {
  const folded = foldWithOffsets(line);
  const protect = protectedRanges(line);
  const inProtected = (start: number, end: number) => protect.some(([s, e]) => s < end && start < e);
  let best: Found | null = null;
  for (const name of names) {
    const needle = fold(name);
    if (needle === "") continue;
    for (let at = folded.text.indexOf(needle); at >= 0; at = folded.text.indexOf(needle, at + 1)) {
      const after = at + needle.length;
      if (!isBoundary(codePointBefore(folded.text, at)) || !isBoundary(folded.text.codePointAt(after))) continue;
      const start = folded.offsets[at];
      let end = after < folded.offsets.length ? folded.offsets[after] : line.length;
      // Keep combining marks that follow the last letter with it.
      while (end < line.length && /\p{M}/u.test(String.fromCodePoint(line.codePointAt(end)!))) end += 1;
      if (inProtected(start, end)) continue;
      if (!best || start < best.start || (start === best.start && end > best.end)) best = { start, end };
      break;
    }
  }
  return best;
}

/** Lowercased with accents removed: "Ébène" → "ebene". */
function fold(text: string): string {
  return text.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "");
}

/** `fold(line)` plus, for each UTF-16 unit of the result, the offset in `line` it came from. */
function foldWithOffsets(line: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  let offset = 0;
  for (const character of line) {
    const piece = fold(character);
    for (let i = 0; i < piece.length; i++) offsets.push(offset);
    text += piece;
    offset += character.length;
  }
  return { text, offsets };
}

function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(index - 2);
  }
  return low;
}

function isBoundary(codePoint: number | undefined): boolean {
  return codePoint === undefined || !/[\p{L}\p{N}]/u.test(String.fromCodePoint(codePoint));
}
