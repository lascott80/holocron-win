// Keyboard and paste helpers for markdown tables, in live preview and source
// mode alike:
//   Tab / ⇧Tab    next / previous cell (tidies; Tab past the last cell adds a row)
//   Return       next row, same column (adds a row at the end; on an empty
//                 last row, leaves the table instead)
//   ⇧Return       leave the table
//   Return after a lone "| a | b |" line adds the "| --- |" row below it
//   Alt+Shift+arrows       move the row or column (Ctrl+Alt+arrows rotates the screen on many Windows PCs)
//   Ctrl+Alt+Shift+arrows  insert a row or column in that direction
//   Alt+Shift+Backspace / Ctrl+Alt+Shift+Backspace  delete the row / column
// Tables are tidied when the cursor leaves them. Cells copied from a
// spreadsheet paste as a table, and "Convert to Table" turns selected CSV or
// tab-separated lines into one.
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { cellAt, findTables, formatTable, nextCell, previousCell, splitRow } from "./tables.js";
import { gridOps, readGrid } from "./tableTools.js";
import { setFocused } from "./focus.js";

// ---------- Helpers ----------

function tableAt(state, pos) {
  if (!state.doc.lineAt(pos).text.includes("|")) return null;
  return findTables(state.doc).find((table) => pos >= table.from && pos <= table.to) ?? null;
}

const asTable = (grid) => {
  const cells = (row) => row.map((text) => ({ text }));
  return { header: cells(grid.header), rows: grid.rows.map(cells), align: grid.align };
};

/**
 * Replaces `table` with `grid` (tidied) and puts the cursor at the start of
 * cell [row][col] (row 0 = header), clamped to the table.
 */
function replaceTable(view, table, grid, row, col) {
  const { text, cellStarts } = formatTable(asTable(grid));
  const r = Math.max(0, Math.min(row, cellStarts.length - 1));
  const c = Math.max(0, Math.min(col, cellStarts[r].length - 1));
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: text },
    selection: EditorSelection.cursor(table.from + cellStarts[r][c]),
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

/** Runs `fn(view, table, grid, here)` if the cursor is in a table cell. */
function inTable(fn) {
  return (view) => {
    const { state } = view;
    if (state.readOnly || state.selection.ranges.length > 1) return false;
    const pos = state.selection.main.head;
    const table = tableAt(state, pos);
    const here = table && cellAt(table, pos);
    if (!here) return false;
    return fn(view, table, readGrid(table), here);
  };
}

// ---------- Commands ----------

/** Return: down a row in the same column, adding a row at the end. */
const nextRow = inTable((view, table, grid, { row, col }) => {
  if (!view.state.selection.main.empty) return false;
  const body = row - 1; // body row index, -1 for the header
  const isLast = body === grid.rows.length - 1;
  if (isLast && body >= 0 && grid.rows[body].every((cell) => !cell.trim())) {
    // An empty last row: drop it and step out below the table.
    const tidied = formatTable(asTable(gridOps.deleteRow(grid, body))).text;
    view.dispatch({
      changes: { from: table.from, to: table.to, insert: `${tidied}\n\n` },
      selection: EditorSelection.cursor(table.from + tidied.length + 2),
      scrollIntoView: true,
      userEvent: "input.table",
    });
    return true;
  }
  const next = isLast ? gridOps.insertRow(grid, grid.rows.length) : grid;
  return replaceTable(view, table, next, row + 1, col);
});

/** ⇧Return: continue writing on a fresh line below the table. */
const leaveTable = inTable((view, table) => {
  const { doc } = view.state;
  const after = doc.lineAt(table.to).number;
  // A blank line keeps the next paragraph from being read as a table row.
  if (after + 1 <= doc.lines && !doc.line(after + 1).text.trim()) {
    view.dispatch({ selection: EditorSelection.cursor(doc.line(after + 1).from), scrollIntoView: true });
  } else {
    view.dispatch({
      changes: { from: table.to, insert: "\n\n" },
      selection: EditorSelection.cursor(table.to + 2),
      scrollIntoView: true,
      userEvent: "input",
    });
  }
  return true;
});

/** Return at the end of a lone "| a | b |" line: make it a table header. */
function completeHeader(view) {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || !range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const text = line.text.trim();
  if (range.head !== line.to || !/^\|.*\|$/.test(text) || text.length < 3) return false;
  if (DELIMITER_LIKE.test(text) || tableAt(state, range.head) || inCode(state, line.from)) return false;
  const header = splitRow(line.text).map((cell) => cell.text);
  if (!header.some(Boolean)) return false;
  const grid = { header, rows: [header.map(() => "")], align: header.map(() => null) };
  const { text: table, cellStarts } = formatTable(asTable(grid));
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: table },
    selection: EditorSelection.cursor(line.from + cellStarts[1][0]),
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

const DELIMITER_LIKE = /^\|[\s:|-]*\|$/;

function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

const moveRow = (delta) => inTable((view, table, grid, { row, col }) => {
  const body = row - 1;
  const target = body + delta;
  if (body < 0 || target < 0 || target >= grid.rows.length) return true; // header, or already at the edge
  return replaceTable(view, table, gridOps.moveRow(grid, body, target), target + 1, col);
});

const moveColumn = (delta) => inTable((view, table, grid, { row, col }) => {
  const target = col + delta;
  if (target < 0 || target >= grid.header.length) return true;
  return replaceTable(view, table, gridOps.moveColumn(grid, col, target), row, target);
});

const insertRow = (below) => inTable((view, table, grid, { row, col }) => {
  const at = below ? row : Math.max(0, row - 1); // body index to insert at
  return replaceTable(view, table, gridOps.insertRow(grid, at), at + 1, col);
});

const insertColumn = (right) => inTable((view, table, grid, { row, col }) => {
  const at = right ? col + 1 : col;
  return replaceTable(view, table, gridOps.insertColumn(grid, at), row, at);
});

const deleteRow = inTable((view, table, grid, { row, col }) => {
  if (row === 0) return true; // the header stays
  return replaceTable(view, table, gridOps.deleteRow(grid, row - 1), Math.min(row, grid.rows.length - 1), col);
});

const deleteColumn = inTable((view, table, grid, { row, col }) => {
  if (grid.header.length < 2) return true;
  return replaceTable(view, table, gridOps.deleteColumn(grid, col), row, Math.min(col, grid.header.length - 2));
});

// ---------- Tidy when leaving ----------

/** Lines up a table's columns once the cursor leaves it (or the editor loses focus). */
const tidyOnLeave = EditorState.transactionFilter.of((transaction) => {
  if (transaction.docChanged || transaction.startState.readOnly) return transaction;
  const blurred = transaction.effects.some((effect) => effect.is(setFocused) && !effect.value);
  if (!transaction.selection && !blurred) return transaction;
  const before = transaction.startState.selection.main.head;
  const table = tableAt(transaction.startState, before);
  if (!table) return transaction;
  const after = transaction.newSelection.main.head;
  if (!blurred && after >= table.from && after <= table.to) return transaction;
  const tidied = formatTable(table).text;
  if (tidied === transaction.startState.doc.sliceString(table.from, table.to)) return transaction;
  return [transaction, { changes: { from: table.from, to: table.to, insert: tidied }, sequential: true }];
});

// ---------- Paste & convert ----------

/** Splits delimited text into rows of cells, honouring "quoted" cells. */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && !cell) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

/** Markdown for rows of cells (the first row is the header). */
export function rowsToTable(rows) {
  const columns = Math.max(...rows.map((cells) => cells.length));
  const clean = (value) => (value ?? "").trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const pad = (cells) => Array.from({ length: columns }, (_, c) => clean(cells[c]));
  return formatTable(asTable({ header: pad(rows[0]), rows: rows.slice(1).map(pad), align: Array(columns).fill(null) })).text;
}

/** Rows from a spreadsheet copy (tab-separated, same width, 2+ columns), or null. */
function spreadsheetRows(text) {
  if (!text.includes("\t")) return null;
  const rows = parseDelimited(text.replace(/\n$/, ""), "\t");
  if (rows.length < 2 || rows[0].length < 2 || rows.some((cells) => cells.length !== rows[0].length)) return null;
  return rows;
}

/** Inserts a table at the cursor on lines of its own, with blank lines around it. */
function insertBlock(view, from, to, table) {
  const { doc } = view.state;
  const start = doc.lineAt(from);
  const end = doc.lineAt(to);
  const textBefore = doc.sliceString(start.from, from);
  const prefix = textBefore.trim() ? "\n\n" : start.number > 1 && doc.line(start.number - 1).text.trim() ? "\n" : "";
  const textAfter = doc.sliceString(to, end.to);
  const suffix = textAfter.trim() ? "\n\n" : end.number < doc.lines && doc.line(end.number + 1).text.trim() ? "\n" : "";
  const insert = prefix + table + suffix;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + prefix.length + table.length),
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

const tablePaste = EditorView.domEventHandlers({
  paste(event, view) {
    if (view.state.readOnly) return false;
    const rows = spreadsheetRows(event.clipboardData?.getData("text/plain") ?? "");
    if (!rows) return false;
    const { from, to } = view.state.selection.main;
    if (tableAt(view.state, from) || inCode(view.state, from)) return false;
    event.preventDefault();
    insertBlock(view, from, to, rowsToTable(rows));
    return true;
  },
});

/** Turns the selected CSV or tab-separated lines into a table. */
export function convertToTable(view) {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || range.empty) return false;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const text = state.doc.sliceString(first.from, last.to);
  const delimiter = text.includes("\t") ? "\t" : text.includes(";") && !text.includes(",") ? ";" : ",";
  const rows = parseDelimited(text, delimiter);
  if (!rows.length || Math.max(...rows.map((cells) => cells.length)) < 2) return false;
  insertBlock(view, first.from, last.to, rowsToTable(rows));
  return true;
}

// ---------- Exports ----------

export const tableCommands = {
  tableMoveRowUp: moveRow(-1),
  tableMoveRowDown: moveRow(1),
  tableMoveColumnLeft: moveColumn(-1),
  tableMoveColumnRight: moveColumn(1),
  tableInsertRowAbove: insertRow(false),
  tableInsertRowBelow: insertRow(true),
  tableInsertColumnLeft: insertColumn(false),
  tableInsertColumnRight: insertColumn(true),
  tableDeleteRow: deleteRow,
  tableDeleteColumn: deleteColumn,
  convertToTable,
};

export const tableEditing = [
  tidyOnLeave,
  tablePaste,
  Prec.high(keymap.of([
    { key: "Tab", run: nextCell },
    { key: "Shift-Tab", run: previousCell },
    { key: "Enter", run: (view) => completeHeader(view) || nextRow(view), shift: leaveTable },
    { key: "Alt-Shift-ArrowUp", run: moveRow(-1) }, { key: "Ctrl-Alt-Shift-ArrowUp", run: insertRow(false) },
    { key: "Alt-Shift-ArrowDown", run: moveRow(1) }, { key: "Ctrl-Alt-Shift-ArrowDown", run: insertRow(true) },
    { key: "Alt-Shift-ArrowLeft", run: moveColumn(-1) }, { key: "Ctrl-Alt-Shift-ArrowLeft", run: insertColumn(false) },
    { key: "Alt-Shift-ArrowRight", run: moveColumn(1) }, { key: "Ctrl-Alt-Shift-ArrowRight", run: insertColumn(true) },
    { key: "Alt-Shift-Backspace", run: deleteRow }, { key: "Ctrl-Alt-Shift-Backspace", run: deleteColumn },
  ])),
];

/** A rows × columns table with the cursor in the first header cell. */
export function insertSizedTable(view, rows, columns) {
  const grid = {
    header: Array.from({ length: columns }, (_, c) => `Column ${c + 1}`),
    rows: Array.from({ length: rows }, () => Array(columns).fill("")),
    align: Array(columns).fill(null),
  };
  const { from, to } = view.state.selection.main;
  insertBlock(view, from, to, formatTable(asTable(grid)).text);
  // Select the first header so typing replaces it.
  const table = tableAt(view.state, view.state.selection.main.head - 1);
  if (table) {
    const cell = table.header[0];
    view.dispatch({ selection: EditorSelection.range(cell.from, cell.to) });
  }
  return true;
}
