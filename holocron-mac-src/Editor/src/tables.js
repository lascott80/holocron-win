// Tables: rendered as a grid until you click into one, which shows the raw
// markdown with the cursor in the clicked cell. While editing, Tab / ⇧Tab
// tidy the column alignment and move between cells; Tab in the last cell
// adds a row. The grid's own row/column controls live in tableTools.js.
import { EditorSelection, Prec, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
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

/** Rewrites a table with padded, aligned columns. Returns text + cell offsets. */
export function formatTable(table, doc) {
  const columns = Math.max(table.header.length, table.align.length, ...table.rows.map((row) => row.length));
  const grid = [table.header, ...table.rows].map((row) => Array.from({ length: columns }, (_, c) => row[c]?.text ?? ""));
  const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...grid.map((row) => row[c].length)));
  const pad = (text, width, align) => {
    const space = width - text.length;
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
  return { text: lines.join("\n"), cellStarts, columns };
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
    const pos = state.selection.main.head;
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
      const blankRow = text.split("\n")[0].replace(/[^|]/g, " ");
      const rowStart = text.length + 1;
      const pipes = [...blankRow].flatMap((char, index) => (char === "|" ? [index] : []));
      formatted.cellStarts.push(pipes.slice(0, -1).map((index) => rowStart + index + 2));
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

export const tables = [
  focusTracking,
  tableDecorations,
  tableClicks,
  Prec.high(keymap.of([
    { key: "Tab", run: moveCell(1) },
    { key: "Shift-Tab", run: moveCell(-1) },
  ])),
];
