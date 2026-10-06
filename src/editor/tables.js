// Tables: rendered as a grid until you click into one, which shows the raw
// markdown with the cursor in the clicked cell. While editing, Tab / ⇧Tab
// tidy the column alignment and move between cells; Tab in the last cell
// adds a row. The grid's own row/column controls live in tableTools.js.
import { EditorSelection, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { renderInline } from "./inline.js";
import { addTableControls } from "./tableTools.js";

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Splits a table row into cells with their document positions. */
export function splitRow(text, lineFrom = 0) {
  const cells = [];
  let start = 0;
  let index = 0;
  // A leading pipe opens the first cell.
  const leading = /^\s*\|/.exec(text);
  if (leading) start = index = leading[0].length;
  let current = start;
  while (index <= text.length) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      index += 2;
      continue;
    }
    if (char === "|" || index === text.length) {
      const raw = text.slice(current, index);
      // Skip the empty "cell" after a trailing pipe.
      if (!(index === text.length && raw.trim() === "" && text.trimEnd().endsWith("|"))) {
        const lead = raw.length - raw.trimStart().length;
        cells.push({
          text: raw.trim(),
          from: lineFrom + current + lead,
          to: lineFrom + current + lead + raw.trim().length,
        });
      }
      current = index + 1;
    }
    index++;
  }
  return cells;
}

function alignments(delimiterText) {
  return splitRow(delimiterText).map(({ text }) => {
    const left = text.startsWith(":");
    const right = text.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

/** Tables in the document: header, delimiter and body rows. */
export function findTables(doc) {
  const tables = [];
  let fence = null;
  for (let n = 1; n < doc.lines; n++) {
    const line = doc.line(n);
    const trimmed = line.text.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }
    if (!line.text.includes("|")) continue;
    const delimiter = doc.line(n + 1);
    if (!DELIMITER.test(delimiter.text) || !delimiter.text.includes("-")) continue;
    const header = splitRow(line.text, line.from);
    if (!header.length) continue;
    let last = n + 1;
    while (last + 1 <= doc.lines && doc.line(last + 1).text.includes("|") && doc.line(last + 1).text.trim()) last++;
    const rows = [];
    for (let r = n + 2; r <= last; r++) {
      const row = doc.line(r);
      rows.push(splitRow(row.text, row.from));
    }
    tables.push({
      from: line.from,
      to: doc.line(last).to,
      firstLine: n,
      lastLine: last,
      header,
      align: alignments(delimiter.text),
      rows,
    });
    n = last;
  }
  return tables;
}

// ---------- Rendering ----------

class TableWidget extends WidgetType {
  constructor(table) {
    super();
    this.table = table;
    this.key = JSON.stringify([table.header, table.rows, table.align].map((part) => JSON.stringify(part)));
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM(view) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    const table = document.createElement("table");
    const columns = Math.max(this.table.header.length, ...this.table.rows.map((row) => row.length));
    const addRow = (parent, cells, tag) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < columns; c++) {
        const cell = cells[c];
        const td = document.createElement(tag);
        if (this.table.align[c]) td.style.textAlign = this.table.align[c];
        if (cell) {
          td.appendChild(renderInline(cell.text));
          td.dataset.pos = String(cell.to);
        } else {
          td.dataset.pos = String(cells[cells.length - 1]?.to ?? this.table.from);
        }
        tr.appendChild(td);
      }
      parent.appendChild(tr);
    };
    const head = document.createElement("thead");
    addRow(head, this.table.header, "th");
    table.appendChild(head);
    const body = document.createElement("tbody");
    for (const row of this.table.rows) addRow(body, row, "td");
    table.appendChild(body);
    wrapper.appendChild(table);
    if (!view.state.readOnly && view.state.facet(EditorView.editable)) {
      wrapper.classList.add("cm-table-editable");
      addTableControls(view, wrapper, this.table);
    }
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

function buildTables(state) {
  const decorations = [];
  for (const table of findTables(state.doc)) {
    if (isEditing(state, table.from, table.to)) {
      for (let n = table.firstLine; n <= table.lastLine; n++) {
        decorations.push(Decoration.line({ class: "cm-table-raw" }).range(state.doc.line(n).from));
      }
      continue;
    }
    decorations.push(Decoration.replace({ widget: new TableWidget(table), block: true }).range(table.from, table.to));
  }
  return Decoration.set(decorations, true);
}

const tableDecorations = StateField.define({
  create: buildTables,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || focusChanged(transaction) ? buildTables(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const tableClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    if (!event.target.closest(".cm-table-widget")) return false;
    if (event.target.closest(".cm-table-control")) return true; // handled by tableTools.js
    if (event.target.closest(".cm-wikilink, .cm-md-link, .cm-tag")) return false; // livePreview opens these
    const cell = event.target.closest("[data-pos]");
    if (!cell) return false;
    event.preventDefault();
    view.focus();
    // Mark focused now so the raw table appears with this click.
    view.dispatch({ selection: { anchor: Number(cell.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
});

// ---------- Editing ----------

// ---------- Display width ----------
// Monospace columns a string takes: East Asian Wide/Fullwidth and emoji count
// 2, combining marks / joiners / variation selectors 0, everything else 1.

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\u1160-\u11FF\uD7B0-\uD7FF]$/u;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\u20E3/u;

function isWide(code) {
  return (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0x303e) || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xa000 && code <= 0xa4cf)
    || (code >= 0xa960 && code <= 0xa97f) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x16fe0 && code <= 0x16fe4) || (code >= 0x17000 && code <= 0x18aff)
    || (code >= 0x1b000 && code <= 0x1b2ff) || (code >= 0x1f200 && code <= 0x1f265) || (code >= 0x20000 && code <= 0x3fffd);
}

function graphemeWidth(cluster) {
  if (EMOJI.test(cluster)) return 2; // emoji, ZWJ sequences, flags, keycaps…
  let width = 0;
  for (const char of cluster) {
    if (!ZERO_WIDTH.test(char)) width += isWide(char.codePointAt(0)) ? 2 : 1;
  }
  return width;
}

/** Columns `text` occupies in a monospace font (used to pad table cells). */
export function displayWidth(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text.length; // plain ASCII: the common case
  let width = 0;
  for (const cluster of segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)) {
    width += graphemeWidth(cluster);
  }
  return width;
}

/** Rewrites a table with padded, aligned columns. Returns text + cell offsets. */
export function formatTable(table, doc) {
  const columns = Math.max(table.header.length, table.align.length, ...table.rows.map((row) => row.length));
  const grid = [table.header, ...table.rows].map((row) => Array.from({ length: columns }, (_, c) => row[c]?.text ?? ""));
  const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...grid.map((row) => displayWidth(row[c]))));
  const pad = (text, width, align) => {
    const space = width - displayWidth(text);
    if (align === "right") return " ".repeat(space) + text;
    if (align === "center") return " ".repeat(Math.floor(space / 2)) + text + " ".repeat(Math.ceil(space / 2));
    return text + " ".repeat(space);
  };
  const lines = [];
  const cellStarts = []; // [row][col] → offset of the cell's text in the result
  let offset = 0;
  const writeRow = (cells, rowIndex) => {
    let line = "|";
    const starts = [];
    cells.forEach((cell, c) => {
      line += " ";
      const padded = pad(cell, widths[c], table.align[c]);
      // Empty cells put the cursor right after "| ", not after the padding.
      starts.push(offset + line.length + (cell ? padded.length - padded.trimStart().length : 0));
      line += padded + " |";
    });
    if (rowIndex !== null) cellStarts[rowIndex] = starts;
    lines.push(line);
    offset += line.length + 1;
  };
  writeRow(grid[0], 0);
  const delimiter = "|" + widths.map((width, c) => {
    const align = table.align[c];
    const dashes = "-".repeat(Math.max(1, width - (align === "center" ? 2 : align ? 1 : 0)));
    return " " + (align === "center" || align === "left" ? ":" : "") + dashes + (align === "center" || align === "right" ? ":" : "") + " ";
  }).join("|") + "|";
  lines.push(delimiter);
  offset += delimiter.length + 1;
  grid.slice(1).forEach((cells, r) => writeRow(cells, r + 1));
  return { text: lines.join("\n"), cellStarts, columns, widths };
}

/** Which cell (row 0 = header) the position is in. */
export function cellAt(table, pos) {
  const rows = [table.header, ...table.rows];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const cell = rows[r][c];
      const next = rows[r][c + 1];
      if (pos >= cell.from - 2 && (next ? pos < next.from - 1 : pos <= cell.to + 2)) return { row: r, col: c };
    }
  }
  return null;
}

function moveCell(direction) {
  return (view) => {
    const { state } = view;
    if (state.readOnly || state.selection.ranges.length > 1) return false;
    const pos = state.selection.main.head;
    if (!state.doc.lineAt(pos).text.includes("|")) return false; // not in a table: Tab indents
    const table = findTables(state.doc).find((t) => pos >= t.from && pos <= t.to);
    if (!table) return false;
    const here = cellAt(table, pos) ?? { row: 0, col: 0 };
    const formatted = formatTable(table, state.doc);
    let { row, col } = here;
    const lastRow = formatted.cellStarts.length - 1;
    col += direction;
    if (col >= formatted.columns) {
      col = 0;
      row += 1;
    } else if (col < 0) {
      col = formatted.columns - 1;
      row -= 1;
    }
    let text = formatted.text;
    if (row > lastRow) {
      // Tab past the last cell: add an empty row with the same column widths.
      const rowStart = text.length + 1;
      const starts = [];
      let blankRow = "|";
      for (const width of formatted.widths) {
        starts.push(rowStart + blankRow.length + 1);
        blankRow += " ".repeat(width + 2) + "|";
      }
      formatted.cellStarts.push(starts);
      text += "\n" + blankRow;
    }
    if (row < 0) {
      row = 0;
      col = 0;
    }
    const target = table.from + formatted.cellStarts[row][col];
    view.dispatch({
      changes: { from: table.from, to: table.to, insert: text },
      selection: EditorSelection.cursor(target),
      scrollIntoView: true,
      userEvent: "input.table",
    });
    return true;
  };
}

/** A 3×2 table skeleton with the cursor in the first header cell. */
export function insertTable(view) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.trim() ? "\n\n" : "";
  const skeleton = "| Column | Column | Column |\n| ------ | ------ | ------ |\n|        |        |        |\n";
  const insertAt = line.text.trim() ? line.to : line.from;
  view.dispatch({
    changes: { from: insertAt, insert: prefix + skeleton },
    selection: EditorSelection.range(insertAt + prefix.length + 2, insertAt + prefix.length + 8),
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

/** Tab / ⇧Tab between cells. In tableEditing (all modes, source included); outside tables they fall through to indent. */
export const nextCell = moveCell(1);
export const previousCell = moveCell(-1);

export const tables = [
  focusTracking,
  tableDecorations,
  tableClicks,
];
