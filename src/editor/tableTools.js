// Table structure editing from the rendered grid: a menu on each column
// header, a handle beside each row, + bars to add a row or column, and a
// right-click menu on any cell. Every action rewrites the table's markdown
// in one transaction (so one ⌘Z undoes it) and leaves the grid showing.
import { isolateHistory } from "@codemirror/commands";
import { findTables, formatTable } from "./tables.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// ---------- Grid operations (pure) ----------

/** The table as plain strings, every row padded to the same width. */
export function readGrid(table) {
  const columns = Math.max(table.header.length, table.align.length, ...table.rows.map((row) => row.length));
  const pad = (cells) => Array.from({ length: columns }, (_, c) => cells[c]?.text ?? "");
  return {
    header: pad(table.header),
    rows: table.rows.map(pad),
    align: Array.from({ length: columns }, (_, c) => table.align[c] ?? null),
  };
}

/** Markdown for a grid, with aligned columns. */
export function writeGrid(grid) {
  const cells = (row) => row.map((text) => ({ text }));
  return formatTable({ header: cells(grid.header), rows: grid.rows.map(cells), align: grid.align }).text;
}

const move = (list, from, to) => {
  const copy = [...list];
  copy.splice(to, 0, ...copy.splice(from, 1));
  return copy;
};

export const gridOps = {
  insertRow: (grid, at) => ({ ...grid, rows: [...grid.rows.slice(0, at), grid.header.map(() => ""), ...grid.rows.slice(at)] }),
  deleteRow: (grid, at) => ({ ...grid, rows: grid.rows.filter((_, r) => r !== at) }),
  moveRow: (grid, from, to) => ({ ...grid, rows: move(grid.rows, from, to) }),
  insertColumn: (grid, at) => {
    const insert = (row, value) => [...row.slice(0, at), value, ...row.slice(at)];
    return { header: insert(grid.header, ""), rows: grid.rows.map((row) => insert(row, "")), align: insert(grid.align, null) };
  },
  deleteColumn: (grid, at) => {
    const remove = (row) => row.filter((_, c) => c !== at);
    return { header: remove(grid.header), rows: grid.rows.map(remove), align: remove(grid.align) };
  },
  moveColumn: (grid, from, to) => ({
    header: move(grid.header, from, to),
    rows: grid.rows.map((row) => move(row, from, to)),
    align: move(grid.align, from, to),
  }),
  align: (grid, col, align) => ({ ...grid, align: grid.align.map((a, c) => (c === col ? align : a)) }),
  /** Sorts body rows by a column (numbers numerically); empty cells go last. */
  sort: (grid, col, descending) => ({
    ...grid,
    rows: [...grid.rows].sort((a, b) => {
      if (!a[col] !== !b[col]) return a[col] ? -1 : 1;
      const order = collator.compare(a[col], b[col]);
      return descending ? -order : order;
    }),
  }),
};

// ---------- Applying edits ----------

/** The table the widget's DOM currently stands for (positions shift as you type above it). */
function tableFor(view, dom) {
  const pos = view.posAtDOM(dom);
  return findTables(view.state.doc).find((table) => pos >= table.from && pos <= table.to) ?? null;
}

function apply(view, dom, edit) {
  if (!dom.isConnected) return; // the table was re-rendered while the menu was open
  const table = tableFor(view, dom);
  if (!table) return;
  const changes = edit === null
    ? { from: table.from, to: Math.min(view.state.doc.length, table.to + 1), insert: "" }
    : { from: table.from, to: table.to, insert: writeGrid(edit(readGrid(table))) };
  view.dispatch({ changes, userEvent: "input.table", annotations: isolateHistory.of("full") });
}

// ---------- Menu ----------

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.cleanup();
  openMenu = null;
}

/** Shows a menu of { label, run, disabled, checked } items ("-" = separator) at a point. */
function showMenu(view, items, x, y) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "cm-table-menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    if (item === "-") {
      if (menu.lastChild && !menu.lastChild.classList.contains("cm-table-menu-separator")) {
        const separator = document.createElement("div");
        separator.className = "cm-table-menu-separator";
        menu.appendChild(separator);
      }
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-table-menu-item";
    button.setAttribute("role", "menuitem");
    button.disabled = Boolean(item.disabled);
    if (item.destructive) button.classList.add("cm-table-menu-destructive");
    const check = document.createElement("span");
    check.className = "cm-table-menu-check";
    check.textContent = item.checked ? "✓" : "";
    button.append(check, item.label);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      closeMenu();
      item.run();
    });
    menu.appendChild(button);
  }
  if (menu.lastChild?.classList.contains("cm-table-menu-separator")) menu.lastChild.remove();
  view.dom.appendChild(menu);

  // Keep the menu inside the window.
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y}px`;

  const outside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const key = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
  };
  const scroller = view.scrollDOM;
  window.addEventListener("mousedown", outside, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", closeMenu);
  scroller.addEventListener("scroll", closeMenu);
  openMenu = {
    cleanup() {
      menu.remove();
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", closeMenu);
      scroller.removeEventListener("scroll", closeMenu);
    },
  };
}

function columnItems(view, dom, grid, col) {
  const columns = grid.header.length;
  const edit = (fn) => () => apply(view, dom, fn);
  return [
    { label: "Align Left", checked: !grid.align[col] || grid.align[col] === "left", run: edit((g) => gridOps.align(g, col, null)) },
    { label: "Align Center", checked: grid.align[col] === "center", run: edit((g) => gridOps.align(g, col, "center")) },
    { label: "Align Right", checked: grid.align[col] === "right", run: edit((g) => gridOps.align(g, col, "right")) },
    "-",
    { label: "Sort A → Z", disabled: grid.rows.length < 2, run: edit((g) => gridOps.sort(g, col, false)) },
    { label: "Sort Z → A", disabled: grid.rows.length < 2, run: edit((g) => gridOps.sort(g, col, true)) },
    "-",
    { label: "Insert Column Left", run: edit((g) => gridOps.insertColumn(g, col)) },
    { label: "Insert Column Right", run: edit((g) => gridOps.insertColumn(g, col + 1)) },
    { label: "Move Column Left", disabled: col === 0, run: edit((g) => gridOps.moveColumn(g, col, col - 1)) },
    { label: "Move Column Right", disabled: col >= columns - 1, run: edit((g) => gridOps.moveColumn(g, col, col + 1)) },
    "-",
    { label: "Delete Column", destructive: true, disabled: columns < 2, run: edit((g) => gridOps.deleteColumn(g, col)) },
  ];
}

/** Row items; `row` is a body row index, or -1 for the header. */
function rowItems(view, dom, grid, row) {
  const edit = (fn) => () => apply(view, dom, fn);
  if (row < 0) return [{ label: "Insert Row Below", run: edit((g) => gridOps.insertRow(g, 0)) }];
  return [
    { label: "Insert Row Above", run: edit((g) => gridOps.insertRow(g, row)) },
    { label: "Insert Row Below", run: edit((g) => gridOps.insertRow(g, row + 1)) },
    { label: "Move Row Up", disabled: row === 0, run: edit((g) => gridOps.moveRow(g, row, row - 1)) },
    { label: "Move Row Down", disabled: row >= grid.rows.length - 1, run: edit((g) => gridOps.moveRow(g, row, row + 1)) },
    "-",
    { label: "Delete Row", destructive: true, run: edit((g) => gridOps.deleteRow(g, row)) },
  ];
}

const deleteTableItem = (view, dom) => ({ label: "Delete Table", destructive: true, run: () => apply(view, dom, null) });

// ---------- Controls ----------

function control(className, label, onPress) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-table-control ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.tabIndex = -1;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onPress(button);
  });
  return button;
}

const below = (button) => {
  const rect = button.getBoundingClientRect();
  return [rect.left, rect.bottom + 4];
};

/**
 * Adds the editing controls to a rendered table. `wrapper` holds the
 * <table>; rows are <tr> elements in header-then-body order.
 */
export function addTableControls(view, wrapper, table) {
  const grid = () => readGrid(tableFor(view, wrapper) ?? table);
  const frame = document.createElement("div");
  frame.className = "cm-table-frame";
  const element = wrapper.querySelector("table");
  element.replaceWith(frame);
  frame.appendChild(element);

  element.querySelectorAll("thead th").forEach((th, col) => {
    th.appendChild(control("cm-table-col-button", "Column options", (button) => {
      showMenu(view, [...columnItems(view, wrapper, grid(), col), "-", deleteTableItem(view, wrapper)], ...below(button));
    }));
  });
  element.querySelectorAll("tr").forEach((tr, index) => {
    const row = index - 1; // -1 = header
    tr.firstElementChild?.appendChild(control("cm-table-row-button", row < 0 ? "Header row options" : "Row options", (button) => {
      showMenu(view, [...rowItems(view, wrapper, grid(), row), "-", deleteTableItem(view, wrapper)], ...below(button));
    }));
  });

  const addColumn = control("cm-table-add cm-table-add-column", "Add column", () => {
    apply(view, wrapper, (g) => gridOps.insertColumn(g, g.header.length));
  });
  addColumn.textContent = "+";
  const addRow = control("cm-table-add cm-table-add-row", "Add row", () => {
    apply(view, wrapper, (g) => gridOps.insertRow(g, g.rows.length));
  });
  addRow.textContent = "+";
  frame.append(addColumn, addRow);

  wrapper.addEventListener("contextmenu", (event) => {
    const cell = event.target instanceof Element ? event.target.closest("th, td") : null;
    if (!cell) return;
    event.preventDefault();
    const tr = cell.parentElement;
    const row = [...element.querySelectorAll("tr")].indexOf(tr) - 1;
    const col = [...tr.children].indexOf(cell);
    const g = grid();
    showMenu(view, [...rowItems(view, wrapper, g, row), "-", ...columnItems(view, wrapper, g, col), "-", deleteTableItem(view, wrapper)], event.clientX, event.clientY);
  });
}
