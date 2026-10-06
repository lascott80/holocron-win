// Formatting commands shared by the keymap and Holocron's Format menu.
import { EditorSelection } from "@codemirror/state";

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
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
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
    view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
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
    view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
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
