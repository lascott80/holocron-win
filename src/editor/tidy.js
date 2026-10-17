// Format › Tidy Note (Ctrl+Alt+L): normalises a note's markdown without
// changing what it says. Code blocks, $$ maths, HTML blocks, %% comments and
// the frontmatter are never touched. One undoable change.
//
// - a blank line around headings, one space after the #s
// - at most one blank line in a row
// - "-" for every bullet ("*" and "+" become "-"); horizontal rules stay
// - ordered lists renumbered 1, 2, 3… from each list's first number
// - trailing spaces removed (a two-space hard break before more text is kept)
// - tables' pipes aligned
// - exactly one newline at the end
import { Text } from "@codemirror/state";
import { findTables, formatTable } from "./tables.js";

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+(?=\S)/;
const BULLET = /^(\s*)[*+]([ \t]+)/;
const ORDERED = /^(\s*)(\d{1,9})([.)])([ \t]+)/;
const RULE = /^\s{0,3}([*_-])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const HTML_BLOCK = /^\s{0,3}<(?:[a-zA-Z][\w-]*|!--)/;

const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, "    ").length;

/** The tidied markdown (the same string if there's nothing to tidy). */
export function tidyMarkdown(input) {
  const crlf = input.includes("\r\n");
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  // Frontmatter stays exactly as it is.
  if (lines[0] === "---") {
    const end = lines.findIndex((line, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      out.push(...lines.slice(0, end + 1));
      i = end + 1;
    }
  }
  const contentStart = out.length;

  /** Lines (indices into `out`) that must stay untouched by later passes. */
  const frozen = new Set();
  let fence = null;
  let math = false;
  let html = false;
  let comment = false;
  // Ordered-list numbering: indent → next number.
  let counters = new Map();

  for (; i < lines.length; i++) {
    let line = lines[i];
    const next = lines[i + 1];

    // Protected blocks: copy verbatim.
    if (fence) {
      out.push(line);
      frozen.add(out.length - 1);
      const marker = FENCE.exec(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      continue;
    }
    if (math || comment || html) {
      out.push(line);
      frozen.add(out.length - 1);
      if (math && /\$\$\s*$/.test(line)) math = false;
      if (comment && line.includes("%%")) comment = false;
      if (html && !line.trim()) html = false;
      continue;
    }
    const marker = FENCE.exec(line);
    if (marker) {
      fence = marker[1];
      counters = new Map();
      out.push(line);
      frozen.add(out.length - 1);
      continue;
    }
    if (/^\s{0,3}\$\$/.test(line)) {
      math = !/^\s{0,3}\$\$.*\$\$\s*$/.test(line) || line.trim() === "$$";
      out.push(line);
      frozen.add(out.length - 1);
      continue;
    }
    if (/^\s*%%/.test(line)) {
      comment = (line.match(/%%/g) ?? []).length % 2 === 1;
      out.push(line);
      frozen.add(out.length - 1);
      continue;
    }
    if (HTML_BLOCK.test(line) && (out.length === contentStart || !out[out.length - 1].trim())) {
      html = Boolean(next?.trim());
      out.push(line);
      frozen.add(out.length - 1);
      continue;
    }

    // Trailing whitespace: keep a hard break (2+ spaces) only before more text.
    const hardBreak = / {2,}$/.test(line) && next !== undefined && next.trim() !== "" && !HEADING.test(line);
    line = line.replace(/[ \t]+$/, "") + (hardBreak && line.trim() ? "  " : "");

    // Blank lines: at most one in a row, none at the top.
    if (!line.trim()) {
      if (out.length > contentStart && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      line = line.replace(HEADING, `${heading[1]} `);
      if (out.length > contentStart && out[out.length - 1] !== "") out.push("");
      out.push(line);
      if (next !== undefined && next.trim() !== "") out.push("");
      counters = new Map();
      continue;
    }

    // Lists.
    const indent = indentOf(line);
    if (!RULE.test(line)) line = line.replace(BULLET, "$1-$2");
    const ordered = ORDERED.exec(line);
    for (const level of [...counters.keys()]) {
      // A deeper list ends at a line that isn't inside it; a list ends at a bullet or text at its own indent.
      if (level > indent || (level === indent && !ordered)) counters.delete(level);
    }
    if (ordered) {
      const number = counters.get(indent) ?? Number(ordered[2]);
      line = `${ordered[1]}${number}${ordered[3]}${ordered[4]}${line.slice(ordered[0].length)}`;
      counters.set(indent, number + 1);
    } else if (!LIST_ITEM.test(line) && indent === 0) {
      counters = new Map(); // a paragraph ends every list
    }
    out.push(line);
  }

  // No blank lines at the end; then exactly one newline.
  while (out.length > contentStart && out[out.length - 1] === "" && !frozen.has(out.length - 1)) out.pop();
  let text = out.join("\n");
  text = alignTables(text, frozen);
  if (text.trim() && !text.endsWith("\n")) text += "\n";
  if (!text.trim()) text = input.trim() ? text : input;
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Aligns every table's pipes (tables.js's own formatter), outside frozen lines. */
function alignTables(text, frozen) {
  const doc = Text.of(text.split("\n"));
  const tables = findTables(doc).filter((table) => {
    for (let n = table.firstLine; n <= table.lastLine; n++) if (frozen.has(n - 1)) return false;
    return true;
  });
  let result = text;
  for (const table of tables.reverse()) {
    const formatted = formatTable(table, doc).text;
    result = result.slice(0, table.from) + formatted + result.slice(table.to);
  }
  return result;
}

/** The editor command: replaces only the changed middle of the note, so the cursor stays put elsewhere. */
export function tidyNote(view) {
  const before = view.state.doc.toString();
  const after = tidyMarkdown(before);
  if (after === before) return false;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  view.dispatch({
    changes: { from: start, to: endBefore, insert: after.slice(start, endAfter) },
    userEvent: "input.tidy",
    scrollIntoView: false,
  });
  return true;
}
