// Live views inside a note (§9.5): a ```query fenced block renders the notes
// matching its text as a Holocron search query — each as a link with its
// folder and up to three matching lines — and a ```base block renders a
// base's table or cards (UI-46) inline, read-only. Both show the raw code
// while you're editing inside them (like diagrams); clicking the block's
// header puts the cursor there. Results come from Holocron through
// `configureQueryBlocks` and are run again when the index changes (500 ms
// after the last change) and when the block's text changes.
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { modKey, UI_FONT } from "./platform.js";
import { plainSnippet } from "@core/vaultSearch";

/** Every fenced block whose info string's first word is `language`: its range, the code inside and where the code starts. */
export function findFencedBlocks(doc, language) {
  const open = new RegExp(`^\\s{0,3}(\`{3,}|~{3,})\\s*${language}\\b`, "i");
  const blocks = [];
  for (let n = 1; n <= doc.lines; n++) {
    const match = open.exec(doc.line(n).text);
    if (!match) continue;
    const fence = match[1];
    const close = new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let end = n + 1;
    while (end <= doc.lines && !close.test(doc.line(end).text)) end++;
    if (end > doc.lines) break; // unclosed: leave it as plain code
    const codeFrom = n + 1 <= end - 1 ? doc.line(n + 1).from : doc.line(end).from;
    const codeTo = n + 1 <= end - 1 ? doc.line(end - 1).to : codeFrom;
    blocks.push({ from: doc.line(n).from, to: doc.line(end).to, code: doc.sliceString(codeFrom, codeTo), codeFrom });
    n = end;
  }
  return blocks;
}

/**
 * The search query a ```query block runs: its lines joined with spaces
 * (so a long query can be written over several lines), blank lines and
 * `//` comment lines left out, trimmed.
 */
export function queryText(source) {
  return String(source ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"))
    .join(" ")
    .trim();
}

/** How many notes a result lists, as the header says it. */
export function countLabel(total) {
  return total === 1 ? "1 note" : `${total} notes`;
}

// ---------- Host ----------

let config = {
  /** (query) → Promise<{ hits, total, truncated, error }> (see QueryBlockResult in src/shared/ipc.ts). */
  runQuery: null,
  /** (path, newTab) opens a note by vault path. */
  openLink: () => {},
  /** (element, source) mounts a base view for a ```base block; returns a function that unmounts it. */
  mountBase: null,
};

export function configureQueryBlocks(options) {
  config = { ...config, ...options };
}

/** Results by query text; `revision` tells widgets a newer answer may exist. */
const results = new Map();
let revision = 0;
const views = new Set();
const refresh = StateEffect.define();

function refreshAll() {
  for (const view of views) view.dispatch({ effects: refresh.of(null) });
}

function run(query) {
  if (!config.runQuery) return;
  const entry = results.get(query);
  if (entry?.pending) return;
  results.set(query, { ...(entry ?? {}), pending: true });
  Promise.resolve(config.runQuery(query))
    .then((result) => {
      results.set(query, { result: result ?? { hits: [], total: 0, truncated: false, error: "No results" }, pending: false });
    })
    .catch((error) => {
      results.set(query, { result: { hits: [], total: 0, truncated: false, error: String(error?.message ?? error) }, pending: false });
    })
    .then(() => {
      revision++;
      refreshAll();
    });
}

let indexTimer = null;

/** Notes changed: run every shown query again, 500 ms after the last change. */
export function queryIndexChanged() {
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    indexTimer = null;
    const shown = new Set();
    for (const view of views) {
      for (const block of findFencedBlocks(view.state.doc, "query")) shown.add(queryText(block.code));
    }
    for (const query of results.keys()) if (!shown.has(query)) results.delete(query);
    for (const query of shown) run(query);
  }, 500);
}

// ---------- Rendering ----------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The list a query renders as: a header, then each note with its folder and snippets. */
export function renderQueryResult(query, result, onOpen) {
  const root = element("div", "cm-query");
  const header = element("div", "cm-query-header");
  const count = element("span", "cm-query-count");
  header.appendChild(count);
  header.appendChild(element("span", "cm-query-text", query || "(empty query)"));
  root.appendChild(header);
  if (!result) {
    count.textContent = "Searching…";
    return root;
  }
  if (result.error) {
    count.textContent = "Error";
    root.appendChild(element("div", "cm-query-message", result.error));
    return root;
  }
  count.textContent = countLabel(result.total) + (result.truncated ? " (first 200 shown)" : "");
  if (!result.hits.length) {
    root.appendChild(element("div", "cm-query-message", query ? "No notes match." : "Type a search query inside the block."));
    return root;
  }
  const list = element("div", "cm-query-list");
  for (const hit of result.hits) {
    const item = element("div", "cm-query-item");
    const title = element("a", "cm-query-link", hit.title);
    title.href = "#";
    title.dataset.path = hit.path;
    title.title = hit.path;
    title.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen(hit.path, modKey(event));
    });
    title.addEventListener("mousedown", (event) => event.stopPropagation());
    const row = element("div", "cm-query-title");
    row.appendChild(title);
    if (hit.folder) row.appendChild(element("span", "cm-query-folder", hit.folder));
    item.appendChild(row);
    for (const line of hit.lines.slice(0, 3)) {
      const { text, ranges } = plainSnippet(line.text, line.ranges);
      const snippet = element("div", "cm-query-snippet");
      snippet.title = `Line ${line.line}`;
      let at = 0;
      for (const range of ranges) {
        if (range.location > at) snippet.appendChild(document.createTextNode(text.slice(at, range.location)));
        snippet.appendChild(element("mark", "", text.slice(range.location, range.location + range.length)));
        at = range.location + range.length;
      }
      if (at < text.length) snippet.appendChild(document.createTextNode(text.slice(at)));
      item.appendChild(snippet);
    }
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}

class QueryWidget extends WidgetType {
  constructor(block) {
    super();
    this.query = queryText(block.code);
    this.codeFrom = block.codeFrom;
    this.revision = revision;
  }
  eq(other) {
    return other.query === this.query && other.codeFrom === this.codeFrom && other.revision === this.revision;
  }
  toDOM() {
    const entry = results.get(this.query);
    if (!entry || entry.result === undefined) run(this.query);
    const root = renderQueryResult(this.query, entry?.result ?? null, (path, newTab) => config.openLink(path, newTab));
    root.dataset.pos = String(this.codeFrom);
    return root;
  }
  ignoreEvent(event) {
    // The links handle their own clicks; the header is the editor's (it starts editing).
    return event.target instanceof Element && event.target.closest(".cm-query-link") !== null;
  }
}

class BaseWidget extends WidgetType {
  constructor(block) {
    super();
    this.source = block.code;
    this.codeFrom = block.codeFrom;
  }
  eq(other) {
    return other.source === this.source && other.codeFrom === this.codeFrom;
  }
  toDOM() {
    const root = element("div", "cm-base-block");
    root.dataset.pos = String(this.codeFrom);
    const header = element("div", "cm-query-header cm-base-header");
    header.appendChild(element("span", "cm-query-count", "Base"));
    header.appendChild(element("span", "cm-query-text", "Views over notes inside this note — click here to edit"));
    root.appendChild(header);
    const host = element("div", "cm-base-host");
    root.appendChild(host);
    if (config.mountBase) root.unmount = config.mountBase(host, this.source);
    else host.appendChild(element("div", "cm-query-message", "Base views aren’t available here."));
    return root;
  }
  destroy(dom) {
    dom.unmount?.();
    dom.unmount = null;
  }
  ignoreEvent(event) {
    // Everything inside the mounted view is its own; only the header is the editor's.
    return event.target instanceof Element && event.target.closest(".cm-base-header") === null;
  }
}

function build(state) {
  const decorations = [];
  for (const block of findFencedBlocks(state.doc, "query")) {
    if (isEditing(state, block.from, block.to)) continue;
    decorations.push(Decoration.replace({ widget: new QueryWidget(block), block: true }).range(block.from, block.to));
  }
  for (const block of findFencedBlocks(state.doc, "base")) {
    if (isEditing(state, block.from, block.to)) continue;
    decorations.push(Decoration.replace({ widget: new BaseWidget(block), block: true }).range(block.from, block.to));
  }
  return Decoration.set(decorations, true);
}

const field = StateField.define({
  create: build,
  update(value, transaction) {
    const refreshed = transaction.effects.some((effect) => effect.is(refresh));
    if (!refreshed && !transaction.docChanged && !transaction.selection && !focusChanged(transaction)) return value;
    return build(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The editors showing blocks, so a new answer can refresh them. */
const tracking = ViewPlugin.define((view) => {
  views.add(view);
  return {
    destroy() {
      views.delete(view);
    },
  };
});

const readOnly = (view) => view.state.readOnly || !view.state.facet(EditorView.editable);

/** The query or base block (of this editor, not a nested embed's) whose header an event happened on. */
function headerAt(event, view) {
  if (!(event.target instanceof Element)) return null;
  const header = event.target.closest(".cm-query-header");
  const block = header?.closest(".cm-query, .cm-base-block");
  return block && block.closest(".cm-editor") === view.dom ? block : null;
}

const clicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const block = headerAt(event, view);
    if (!block || readOnly(view)) return false;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: Number(block.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
  mouseover(event, view) {
    const block = headerAt(event, view);
    if (block) block.querySelector(".cm-query-header").title = readOnly(view) ? "" : "Click to edit the block";
    return false;
  },
});

const theme = EditorView.baseTheme({
  ".cm-query, .cm-base-block": {
    margin: "4px 0",
    borderRadius: "8px",
    border: "1px solid var(--hc-border)",
    background: "var(--hc-raised)",
    fontFamily: UI_FONT,
    fontSize: "13px",
    overflow: "hidden",
  },
  ".cm-query-header": {
    display: "flex",
    alignItems: "baseline",
    gap: "10px",
    padding: "6px 12px",
    borderBottom: "1px solid var(--hc-border)",
    color: "var(--hc-muted)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-query-count": { color: "var(--hc-text)", fontWeight: "600", whiteSpace: "nowrap" },
  ".cm-query-text": { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-query-list": { padding: "4px 0" },
  ".cm-query-item": { padding: "6px 12px" },
  ".cm-query-item + .cm-query-item": { borderTop: "1px solid var(--hc-border)" },
  ".cm-query-title": { display: "flex", alignItems: "baseline", gap: "8px", minWidth: "0" },
  ".cm-query-link": { color: "var(--hc-accent)", textDecoration: "none", fontWeight: "500", cursor: "pointer" },
  ".cm-query-link:hover": { textDecoration: "underline" },
  ".cm-query-folder": { color: "var(--hc-muted)", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-query-snippet": { color: "var(--hc-muted)", fontSize: "12.5px", lineHeight: "1.5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "12px" },
  ".cm-query-snippet mark": { background: "rgba(var(--hc-search-match-rgb, 255, 196, 0), 0.3)", color: "var(--hc-text)", borderRadius: "2px", fontWeight: "600" },
  ".cm-query-message": { padding: "10px 12px", color: "var(--hc-muted)" },
  ".cm-base-host": { minHeight: "80px", maxHeight: "480px", overflow: "auto" },
});

export const queryBlocks = [focusTracking, field, tracking, clicks, theme];
