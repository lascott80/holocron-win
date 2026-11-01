// The text side of the note composer (FOP-14…FOP-16): the section under a
// heading, promoting headings, appending one note to another, and spotting
// a renamed heading (LNK-16). Pure functions on note text; the vault does
// the files.

import { parse, type Heading } from "./noteParser";

/** The heading section containing a line: the heading line through the line before the next heading of the same or a higher level. */
export interface Section {
  heading: Heading;
  /** Offset of the heading line's start. */
  from: number;
  /** Offset where the next section (or the end of the text) starts. */
  to: number;
  /** The section's lines after the heading, trailing blank lines dropped, headings promoted so the first subheading level becomes H1. */
  body: string;
  /** The text's line ending. */
  eol: "\n" | "\r\n";
}

/** The line ending a text uses: CRLF if its first line break is one. */
export function lineEnding(text: string): "\n" | "\r\n" {
  const index = text.indexOf("\n");
  return index > 0 && text[index - 1] === "\r" ? "\r\n" : "\n";
}

/** The offset of each 1-based line's start, plus the text length as a sentinel. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}

/**
 * The section whose heading is on, or above, 1-based `line`; null when no
 * heading precedes it (frontmatter and code blocks don't count).
 */
export function sectionAt(text: string, line: number): Section | null {
  const headings = parse(text).headings;
  let index = -1;
  for (let i = 0; i < headings.length; i++) if (headings[i].line <= line) index = i;
  if (index < 0) return null;
  const heading = headings[index];
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  const starts = lineStarts(text);
  const from = starts[heading.line - 1];
  const to = next ? starts[next.line - 1] : text.length;
  const eol = lineEnding(text);
  const bodyStart = heading.line < starts.length ? starts[heading.line] : text.length;
  const lines = text.slice(bodyStart, to).split("\n").map((l) => l.replace(/\r$/, ""));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  while (lines.length && lines[0].trim() === "") lines.shift();
  const body = lines.length ? promoteHeadings(lines, heading.level).join(eol) + eol : "";
  return { heading, from, to, body, eol };
}

/**
 * Raises every heading in `lines` by `by` levels (outside fenced code), so a
 * split section's first subheading becomes H1. Left as they are if any
 * heading would go past H1.
 */
export function promoteHeadings(lines: string[], by: number): string[] {
  if (by <= 0) return lines;
  const result: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const trimmed = line.replace(/^[ \t]+/, "");
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      result.push(line);
      continue;
    }
    const match = /^( {0,3})(#{1,6})([ \t]|$)/.exec(line);
    if (!match) {
      result.push(line);
      continue;
    }
    const level = match[2].length - by;
    if (level < 1) return lines;
    result.push(match[1] + "#".repeat(level) + line.slice(match[1].length + match[2].length));
  }
  return result;
}

/** A note's text without its frontmatter block. */
export function bodyWithoutFrontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "").trim() !== "---") return text;
  const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*\r?$/.test(line));
  return close < 0 ? text : lines.slice(close + 1).join("\n");
}

/**
 * `target` with `body` added at the end: one blank line between, an
 * optional `## heading`, the target's line endings throughout, and a final
 * line break. Blank lines around the body are dropped.
 */
export function appendToNote(target: string, body: string, heading: string | null): string {
  const eol = lineEnding(target || body);
  const trimmedTarget = target.replace(/\s+$/, "");
  const lines = body.split(/\r?\n/).map((line) => line.replace(/\s+$/, ""));
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const parts: string[] = [];
  if (heading !== null) parts.push(`## ${heading}`, "");
  parts.push(...lines);
  const addition = parts.join(eol) + eol;
  return trimmedTarget === "" ? addition : trimmedTarget + eol + eol + addition;
}

/**
 * The selection [from, to) in `text`, checking it still holds `selected`.
 * Offsets come from the editor, whose text has "\n" line breaks even when
 * the note uses CRLF; those are mapped back. Null if the text has changed.
 */
export function locateSelection(text: string, from: number, to: number, selected: string): [number, number] | null {
  if (selected === "" || from < 0 || to < from) return null;
  if (text.slice(from, to) === selected) return [from, to];
  if (text.includes("\r\n")) {
    const normalised = text.replace(/\r\n/g, "\n");
    if (normalised.slice(from, to) === selected) {
      let offset = 0;
      let mappedFrom = -1;
      let mappedTo = -1;
      for (let i = 0; i <= text.length; i++) {
        if (offset === from && mappedFrom < 0) mappedFrom = i;
        if (offset === to) {
          mappedTo = i;
          break;
        }
        if (text[i] === "\r" && text[i + 1] === "\n") continue;
        offset++;
      }
      if (mappedFrom >= 0 && mappedTo >= 0) return [mappedFrom, mappedTo];
    }
  }
  const index = text.indexOf(selected);
  if (index >= 0 && text.indexOf(selected, index + 1) < 0) return [index, index + selected.length];
  return null;
}

/** A heading whose text changed between two parses. */
export interface HeadingRename {
  from: string;
  to: string;
}

/**
 * The one heading renamed between `before` and `after`: exactly one text
 * differs and the number of headings is unchanged (LNK-16). Null otherwise.
 */
export function headingRename(before: readonly Heading[], after: readonly Heading[]): HeadingRename | null {
  if (before.length !== after.length) return null;
  let rename: HeadingRename | null = null;
  for (let i = 0; i < before.length; i++) {
    if (before[i].text === after[i].text) continue;
    if (rename) return null;
    rename = { from: before[i].text, to: after[i].text };
  }
  return rename && rename.to !== "" ? rename : null;
}
