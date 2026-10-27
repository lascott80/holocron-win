// Formatting commands shared by the keymap and Holocron's Format menu.
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { allHeadings } from "./headingFolds.js";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";

/**
 * Return continues lists and quotes (ED-45). CodeMirror's default turns an empty
 * second item into a blank line ("loose" list) instead of ending the list, so a
 * fresh one-item list couldn't be left with Return; this ends it like any other.
 */
export const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** Replaces markdown()'s own keymap (its addKeymap is off), at the same precedence. */
export const markdownKeys = Prec.high(keymap.of([
  { key: "Enter", run: continueMarkup },
  { key: "Backspace", run: deleteMarkupBackward },
  { key: "Tab", run: (view) => shiftListItem(view, 1), shift: (view) => shiftListItem(view, -1) },
]));

const LIST_MARKER = /^([ \t]*)(?:([-*+])|(\d+)([.)]))( +|$)/;

/** A list item line's indent, marker and content column; null for other lines. */
function listItem(doc, n) {
  const text = doc.line(n).text;
  const match = LIST_MARKER.exec(text);
  if (!match) return null;
  const indentText = match[1];
  return {
    n,
    indentText,
    indent: column(indentText),
    content: column(indentText) + match[0].length - indentText.length + (match[5] ? 0 : 1),
    number: match[3] === undefined ? null : Number(match[3]),
    numberFrom: indentText.length,
    numberTo: indentText.length + (match[3]?.length ?? 0),
  };
}

function column(whitespace) {
  let col = 0;
  for (const ch of whitespace) col = ch === "\t" ? col + 4 - (col % 4) : col + 1;
  return col;
}

const leadingColumn = (doc, n) => column(/^[ \t]*/.exec(doc.line(n).text)[0]);
const isBlank = (doc, n) => doc.line(n).text.trim() === "";

/** The last line of item `n`'s subtree: the lines below it indented past it (blank lines inside included). */
function subtreeEnd(doc, n, indent) {
  let end = n;
  for (let i = n + 1; i <= doc.lines; i++) {
    if (isBlank(doc, i)) continue;
    if (leadingColumn(doc, i) <= indent) break;
    end = i;
  }
  return end;
}

/** The nearest item above line `n` indented at most `maxIndent`, skipping deeper lines; stops at the list's edge. */
function itemAbove(doc, n, maxIndent) {
  for (let i = n - 1; i >= 1; i--) {
    if (isBlank(doc, i)) continue;
    const item = listItem(doc, i);
    if (item && item.indent <= maxIndent) return item;
    if (!item && leadingColumn(doc, i) === 0) return null;
  }
  return null;
}

/** The items sharing item `n`'s parent and indent, top to bottom. */
function siblings(doc, n) {
  const own = listItem(doc, n);
  const group = [own];
  const inGroup = (i, add) => {
    if (isBlank(doc, i)) return true;
    const item = listItem(doc, i);
    const col = leadingColumn(doc, i);
    if (col < own.indent || (!item && col === own.indent)) return false;
    if (item && item.indent === own.indent) add(item);
    return true;
  };
  for (let i = n - 1; i >= 1 && inGroup(i, (item) => group.unshift(item)); i--);
  for (let i = n + 1; i <= doc.lines && inGroup(i, (item) => group.push(item)); i++);
  return group;
}

/**
 * Renumbers the numbered items among `n`'s siblings in order. The count starts
 * at 1 when the first of them is in `fresh` (it just started this group), else
 * at its own number; a lazy list (every item the same number) stays that way.
 */
function renumberChanges(doc, n, fresh) {
  const numbered = siblings(doc, n).filter((item) => item.number !== null);
  if (!numbered.length) return [];
  const lazy = numbered.length > 1 && numbered.every((item) => item.number === numbered[0].number);
  const start = fresh.has(numbered[0].n) ? 1 : numbered[0].number;
  const changes = [];
  numbered.forEach((item, i) => {
    const want = lazy ? start : start + i;
    if (item.number === want) return;
    const from = doc.line(item.n).from;
    changes.push({ from: from + item.numberFrom, to: from + item.numberTo, insert: String(want) });
  });
  return changes;
}

/**
 * Tab / Shift-Tab on list items (direction 1 / -1). Tab nests the item (with
 * its children) under the item above, at that item's content column, so
 * "1. a" + "2. b" becomes "1. a" + "   1. b"; Shift-Tab moves it out to its
 * parent's level. Numbered items are renumbered on both levels. Anything else
 * (no list item, several cursors, nothing to nest under) falls through to the
 * plain indent.
 */
export function shiftListItem(view, direction) {
  const { state } = view;
  const { doc } = state;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  const firstLine = doc.lineAt(range.from).number;
  let lastLine = doc.lineAt(range.to).number;
  if (lastLine > firstLine && range.to === doc.line(lastLine).from) lastLine--;
  const item = listItem(doc, firstLine);
  if (!item) return false;
  for (let i = firstLine + 1; i <= lastLine; i++) {
    if (!isBlank(doc, i) && leadingColumn(doc, i) < item.indent) return false;
  }

  let newIndentText;
  const previousSibling = itemAbove(doc, firstLine, item.indent);
  if (direction > 0) {
    if (!previousSibling || previousSibling.indent !== item.indent) return false;
    newIndentText = item.indentText + " ".repeat(previousSibling.content - previousSibling.indent);
  } else {
    if (item.indent === 0) return false;
    const parent = itemAbove(doc, firstLine, item.indent - 1);
    newIndentText = parent ? parent.indentText : "";
  }

  // Move the item, the rest of the selection and its children by the same amount.
  const end = subtreeEnd(doc, lastLine, lastLine === firstLine ? item.indent : leadingColumn(doc, lastLine));
  const nextSibling = (() => {
    for (let i = end + 1; i <= doc.lines; i++) {
      if (isBlank(doc, i)) continue;
      const next = listItem(doc, i);
      return next && next.indent === item.indent ? next : null;
    }
    return null;
  })();
  const shift = [];
  for (let i = firstLine; i <= end; i++) {
    const line = doc.line(i);
    if (isBlank(doc, i)) continue;
    if (line.text.startsWith(item.indentText)) {
      shift.push({ from: line.from, to: line.from + item.indentText.length, insert: newIndentText });
    } else if (direction > 0) {
      shift.push({ from: line.from, insert: newIndentText.slice(item.indentText.length) });
    }
  }
  const moved = state.update({ changes: shift });
  const after = moved.state.doc;

  // Renumber where the item went, where it left, and the group its old next sibling now heads or joins.
  const fresh = new Set([firstLine]);
  const anchors = [firstLine];
  if (previousSibling && previousSibling.indent === item.indent) anchors.push(previousSibling.n);
  if (nextSibling) {
    fresh.add(nextSibling.n);
    anchors.push(nextSibling.n);
  }
  const renumber = new Map();
  for (const n of anchors) {
    for (const change of renumberChanges(after, n, fresh)) renumber.set(change.from, change);
  }
  view.dispatch(
    { changes: shift, scrollIntoView: true, userEvent: direction > 0 ? "input.indent" : "delete.dedent" },
    { changes: [...renumber.values()], sequential: true },
  );
  return true;
}

/**
 * Applies line-marker changes ("- ", "- [ ] ", "1. ", "> ", "## "). A cursor
 * where a marker goes in ends up after it, so you can type the item straight away.
 */
function dispatchLineMarkers(view, changes) {
  const set = view.state.changes(changes);
  view.dispatch({ changes: set, selection: view.state.selection.map(set, 1), scrollIntoView: true, userEvent: "input.format" });
}

/** Wraps each selection in `marker`, or unwraps it if already wrapped. */
export function toggleWrap(marker) {
  const len = marker.length;
  return (view) => {
    const { state } = view;
    const isWrapped = (from, to) => {
      if (state.sliceDoc(from - len, from) !== marker || state.sliceDoc(to, to + len) !== marker) return false;
      // Don't treat the inner * of **bold** as italic.
      if (marker === "*") {
        const outer = state.sliceDoc(from - 2, from) === "**" && state.sliceDoc(from - 3, from) !== "***";
        if (outer) return false;
      }
      return true;
    };
    const transaction = state.changeByRange((range) => {
      if (isWrapped(range.from, range.to)) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }
      const selected = state.sliceDoc(range.from, range.to);
      if (selected.length >= 2 * len && selected.startsWith(marker) && selected.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: selected.slice(len, -len) },
          range: EditorSelection.range(range.from, range.to - 2 * len),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      };
    });
    view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** [selection](|) — or [|]() when nothing is selected. */
export function insertLink(view) {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    const cursor = text ? range.from + text.length + 3 : range.from + 1;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(cursor),
    };
  });
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
}

/** A task box's status after a toggle: done ([x]/[X]) → open, anything else ([ ], [!], [/]…) → done. */
export function toggledTaskStatus(status) {
  return status === "x" || status === "X" ? " " : "x";
}

/** Cycles each selected line: text → "- [ ] text" → "- [x] text" → "- [ ] text" (custom statuses → "[x]"). */
export function toggleTask(view) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const task = /^(\s*(?:[-*+]|\d+[.)]) \[)([^\]\n])\](?=\s|$)/.exec(line.text);
        const bullet = /^(\s*)([-*+]|\d+[.)]) /.exec(line.text);
        if (task) {
          const at = line.from + task[1].length;
          changes.push({ from: at, to: at + 1, insert: toggledTaskStatus(task[2]) });
        } else if (bullet && /[-*+]/.test(bullet[2])) {
          changes.push({ from: line.from + bullet[0].length, insert: "[ ] " });
        } else {
          const indent = /^\s*/.exec(line.text)[0].length;
          changes.push({ from: line.from + indent, insert: "- [ ] " });
        }
      }
      pos = line.to + 1;
    }
  }
  dispatchLineMarkers(view, changes);
  return true;
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)]) /;
const DONE_TASK = /^\s*(?:[-*+]|\d+[.)]) \[[xX-]\](?=\s|$)/;

/**
 * Moves the finished items ([x] and cancelled [-]) of the list around the
 * cursor below the open ones, keeping each group's order and each item's
 * nested lines with it. The cursor stays on its item.
 */
export function moveDoneTasksDown(view) {
  const { state } = view;
  const { doc } = state;
  const cursorLine = doc.lineAt(state.selection.main.head).number;
  const inList = (n) => n >= 1 && n <= doc.lines && doc.line(n).text.trim() !== "" && (LIST_ITEM.test(doc.line(n).text) || /^\s/.test(doc.line(n).text));
  if (!inList(cursorLine)) return false;
  let first = cursorLine;
  let last = cursorLine;
  while (inList(first - 1)) first--;
  while (inList(last + 1)) last++;
  while (first <= last && !LIST_ITEM.test(doc.line(first).text)) first++; // an indented paragraph above isn't the list
  if (first > last) return false;

  const lines = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n).text);
  const base = Math.min(...lines.filter((line) => LIST_ITEM.test(line)).map((line) => LIST_ITEM.exec(line)[1].length));
  const items = []; // { lines, start (line number) }
  lines.forEach((line, i) => {
    const match = LIST_ITEM.exec(line);
    if ((match && match[1].length === base) || items.length === 0) items.push({ lines: [line], start: first + i });
    else items[items.length - 1].lines.push(line);
  });
  const isDone = (item) => DONE_TASK.test(item.lines[0]);
  const ordered = [...items.filter((item) => !isDone(item)), ...items.filter(isDone)];
  if (ordered.every((item, i) => item === items[i])) return true;

  const from = doc.line(first).from;
  const insert = ordered.map((item) => item.lines.join("\n")).join("\n");
  // Follow the cursor's item to its new place.
  const mine = items.findLast((item) => item.start <= cursorLine);
  const column = state.selection.main.head - doc.line(cursorLine).from;
  let lineOffset = 0;
  for (const item of ordered) {
    if (item === mine) break;
    lineOffset += item.lines.length;
  }
  const newLines = insert.split("\n");
  const target = lineOffset + (cursorLine - mine.start);
  let anchor = from;
  for (let i = 0; i < target; i++) anchor += newLines[i].length + 1;
  anchor += Math.min(column, newLines[target].length);
  view.dispatch({
    changes: { from, to: doc.line(last).to, insert },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

/**
 * Moves the section of the heading on `fromLine` (the heading and everything
 * up to the next heading of the same or a higher level) to just before the
 * heading on `beforeLine`, or to the end of the note when that's null
 * (UI-43). Returns null when nothing would move (unknown lines, a drop inside
 * the section itself, or onto its own place); otherwise the changes and where
 * the moved heading ends up.
 */
export function moveSectionChanges(state, fromLine, beforeLine) {
  const { doc } = state;
  const headings = allHeadings(doc);
  const index = headings.findIndex((heading) => heading.line === fromLine);
  if (index < 0) return null;
  const heading = headings[index];
  const next = headings.slice(index + 1).find((other) => other.level <= heading.level);
  const start = heading.header;
  const end = next ? next.header : doc.length;
  let target = doc.length;
  if (beforeLine !== null) {
    const before = headings.find((other) => other.line === beforeLine);
    if (!before) return null;
    target = before.header;
  }
  if (target >= start && target <= end) return null;
  let body = doc.sliceString(start, end);
  if (!body.endsWith("\n")) body += "\n";
  // Moving to the end of a note without a final newline: start on a line of its own.
  let insert = body;
  if (target === doc.length && doc.length > 0 && doc.sliceString(doc.length - 1) !== "\n") insert = "\n" + body.slice(0, -1);
  const changes = state.changes([
    { from: start, to: end },
    { from: target, insert },
  ]);
  const at = changes.mapPos(target, -1) + (insert.startsWith("\n") && !body.startsWith("\n") ? 1 : 0);
  return { changes, at };
}

export function moveSection(view, fromLine, beforeLine) {
  const move = moveSectionChanges(view.state, fromLine, beforeLine);
  if (!move) return false;
  view.dispatch({
    changes: move.changes,
    selection: { anchor: move.at },
    effects: EditorView.scrollIntoView(move.at, { y: "start", yMargin: 48 }),
    userEvent: "move.section",
  });
  return true;
}

/** Sets the heading level of each selected line (0 removes the heading). */
export function setHeading(level) {
  return (view) => {
    const { state } = view;
    const changes = [];
    const seen = new Set();
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head);
      if (seen.has(line.number)) continue;
      seen.add(line.number);
      const existing = /^#{1,6} /.exec(line.text);
      changes.push({
        from: line.from,
        to: line.from + (existing ? existing[0].length : 0),
        insert: level > 0 ? "#".repeat(level) + " " : "",
      });
    }
    dispatchLineMarkers(view, changes);
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleStrikethrough = toggleWrap("~~");
export const toggleCode = toggleWrap("`");

export const toggleHighlight = toggleWrap("==");

/**
 * Toggles a line prefix ("- ", "1. ", "> ") on every selected line: adds it
 * (replacing any other list marker) unless all lines already have it.
 */
function toggleLinePrefix(kind) {
  const patterns = {
    bullet: /^(\s*)[-*+] (?!\[[ xX]\] )/,
    numbered: /^(\s*)\d+[.)] /,
    quote: /^(\s*)> ?/,
  };
  const anyMarker = /^(\s*)(?:[-*+] (?:\[[^\]]\] )?|\d+[.)] |> ?)/;
  return (view) => {
    const { state } = view;
    const lines = [];
    for (const range of state.selection.ranges) {
      for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
        if (!lines.includes(n)) lines.push(n);
      }
    }
    const allHave = lines.every((n) => patterns[kind].test(state.doc.line(n).text));
    const changes = lines.map((n, index) => {
      const line = state.doc.line(n);
      if (allHave) {
        const match = patterns[kind].exec(line.text);
        return { from: line.from + match[1].length, to: line.from + match[0].length, insert: "" };
      }
      const existing = anyMarker.exec(line.text);
      const indent = existing ? existing[1].length : /^\s*/.exec(line.text)[0].length;
      const prefix = kind === "bullet" ? "- " : kind === "numbered" ? `${index + 1}. ` : "> ";
      return { from: line.from + indent, to: line.from + (existing ? existing[0].length : indent), insert: prefix };
    });
    dispatchLineMarkers(view, changes);
    return true;
  };
}

export const toggleBulletList = toggleLinePrefix("bullet");
export const toggleNumberedList = toggleLinePrefix("numbered");
export const toggleQuote = toggleLinePrefix("quote");

/** Wraps the selected lines in a ``` block, or inserts an empty one. */
export function insertCodeBlock(view) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  if (from !== to) {
    view.dispatch({
      changes: [
        { from: first.from, insert: "```\n" },
        { from: last.to, insert: "\n```" },
      ],
      selection: { anchor: first.from + 3 },
      scrollIntoView: true,
      userEvent: "input.format",
    });
    return true;
  }
  const lead = first.text.trim() ? "\n" : "";
  const at = first.text.trim() ? first.to : first.from;
  view.dispatch({
    changes: { from: at, insert: `${lead}\`\`\`\n\n\`\`\`` },
    selection: { anchor: at + lead.length + 3 },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

/** Inserts a note callout, with the selection (if any) as its body. */
export function insertCallout(view) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const body = from === to ? "" : state.doc.sliceString(first.from, last.to).split("\n").map((line) => "> " + line).join("\n");
  const block = `> [!note]\n${body || "> "}`;
  const at = from === to && first.text.trim() ? first.to : first.from;
  const lead = from === to && first.text.trim() ? "\n\n" : "";
  view.dispatch({
    changes: { from: at, to: from === to ? at : last.to, insert: lead + block },
    selection: { anchor: at + lead.length + block.length },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

/** Inserts a --- divider on its own line. */
export function insertDivider(view) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const at = line.text.trim() ? line.to : line.from;
  const insert = (line.text.trim() ? "\n\n" : "") + "---\n";
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}
