// Properties: the YAML frontmatter at the top of a note, shown as a tidy
// list of fields (tags as pills, dates formatted, booleans as checkboxes)
// until you click into it, which reveals the raw YAML for editing.
import { StateField } from "@codemirror/state";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

// ---------- Locating & parsing ----------

/** The frontmatter block: lines 1…n delimited by --- (or a closing ...). */
export function frontmatterRange(doc) {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text.trimEnd();
    if (text === "---" || text === "...") {
      const first = doc.line(1);
      return { from: first.from, to: line.to, yamlFrom: first.to + 1, yamlTo: Math.max(first.to + 1, line.from - 1) };
    }
  }
  return null;
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitInlineList(inner) {
  const items = [];
  let current = "";
  let quote = null;
  for (const character of inner) {
    if (quote) {
      if (character === quote) quote = null;
      current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === ",") {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) items.push(current);
  return items.map(unquote).filter((item) => item.length);
}

/**
 * A forgiving reader for the frontmatter people actually write:
 * `key: value`, `key: [a, b]`, block lists (`- a`), true/false. Anything
 * nested is kept as raw text.
 */
export function parseProperties(yaml) {
  const properties = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue;
    const match = /^([^:#][^:]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const raw = (match[2] ?? "").trim();
    let value;
    if (raw === "") {
      const items = [];
      const nested = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        const next = lines[++i];
        const item = /^\s*-\s+(.*)$/.exec(next);
        if (item) items.push(unquote(item[1]));
        else if (next.trim()) nested.push(next.trim());
      }
      value = items.length ? items : nested.length ? nested.join(", ") : null;
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      value = splitInlineList(raw.slice(1, -1));
    } else if (/^(true|false)$/i.test(raw)) {
      value = raw.toLowerCase() === "true";
    } else {
      value = unquote(raw);
    }
    properties.push({ key, value });
  }
  return properties;
}

/** Top-level YAML blocks: each key with its continuation lines. */
function yamlBlocks(yaml) {
  const blocks = [];
  for (const line of yaml.split("\n")) {
    const key = /^([^\s#:][^:]*):/.exec(line);
    if (key) blocks.push({ key: key[1].trim(), text: line });
    else if (blocks.length && line.trim()) blocks[blocks.length - 1].text += "\n" + line;
  }
  return blocks;
}

/**
 * Changes that merge template properties into a document's frontmatter:
 * keys the note already has are kept as they are; new ones are added (or a
 * frontmatter block is created at the top).
 */
export function mergeFrontmatterChanges(doc, yaml) {
  const incoming = yamlBlocks(yaml);
  if (!incoming.length) return [];
  const range = frontmatterRange(doc);
  if (!range) {
    return [{ from: 0, insert: "---\n" + incoming.map((b) => b.text).join("\n") + "\n---\n" }];
  }
  const existing = new Set(yamlBlocks(doc.sliceString(range.yamlFrom, range.yamlTo)).map((b) => b.key.toLowerCase()));
  const added = incoming.filter((b) => !existing.has(b.key.toLowerCase()));
  if (!added.length) return [];
  const closing = doc.lineAt(range.to);
  return [{ from: closing.from, insert: added.map((b) => b.text).join("\n") + "\n" }];
}

// ---------- Rendering ----------

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;
const TAG_KEYS = new Set(["tags", "tag"]);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderScalar(text) {
  const wikilink = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(text);
  if (wikilink) {
    const link = element("span", "cm-wikilink", wikilink[2] ?? wikilink[1]);
    link.dataset.target = wikilink[1].trim();
    return link;
  }
  if (/^https?:\/\//i.test(text)) {
    const link = element("span", "cm-md-link", text);
    link.dataset.href = text;
    return link;
  }
  const date = DATE.exec(text);
  if (date) {
    const [, y, m, d, hh, mm] = date;
    const when = new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
    if (!Number.isNaN(when.getTime())) {
      const options = { year: "numeric", month: "short", day: "numeric" };
      if (hh) Object.assign(options, { hour: "numeric", minute: "2-digit" });
      const node = element("span", "cm-property-date", when.toLocaleDateString(undefined, options));
      node.title = text;
      return node;
    }
  }
  return element("span", "cm-property-text", text);
}

class PropertiesWidget extends WidgetType {
  constructor(properties) {
    super();
    this.properties = properties;
    this.key = JSON.stringify(properties);
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM() {
    const root = element("div", "cm-properties");
    root.title = "Click to edit properties";
    if (!this.properties.length) {
      root.appendChild(element("div", "cm-property-empty", "Empty properties — click to edit"));
    }
    for (const { key, value } of this.properties) {
      const row = element("div", "cm-property");
      row.appendChild(element("span", "cm-property-key", key));
      const cell = element("span", "cm-property-value");
      if (value === null || value === "" || (Array.isArray(value) && !value.length)) {
        cell.appendChild(element("span", "cm-property-empty", "Empty"));
      } else if (typeof value === "boolean") {
        const box = element("span", "cm-task-checkbox cm-property-checkbox" + (value ? " is-checked" : ""));
        box.setAttribute("role", "checkbox");
        box.setAttribute("aria-checked", String(value));
        box.setAttribute("aria-label", key);
        box.dataset.key = key;
        cell.appendChild(box);
      } else if (Array.isArray(value) || TAG_KEYS.has(key.toLowerCase())) {
        const items = Array.isArray(value) ? value : String(value).split(/[,\s]+/).filter(Boolean);
        for (const item of items) {
          if (TAG_KEYS.has(key.toLowerCase())) {
            const tag = item.replace(/^#/, "");
            const pill = element("span", "cm-tag", `#${tag}`);
            pill.dataset.tag = tag;
            cell.appendChild(pill);
          } else {
            const pill = element("span", "cm-property-pill");
            pill.appendChild(renderScalar(item));
            cell.appendChild(pill);
          }
        }
      } else {
        cell.appendChild(renderScalar(String(value)));
      }
      row.appendChild(cell);
      root.appendChild(row);
    }
    return root;
  }
  ignoreEvent() {
    return false;
  }
}

// ---------- State ----------

function buildDecorations(state) {
  const range = frontmatterRange(state.doc);
  if (!range) return Decoration.none;
  if (isEditing(state, range.from, range.to)) return Decoration.none;
  const yaml = state.doc.sliceString(range.yamlFrom, range.yamlTo);
  const widget = new PropertiesWidget(parseProperties(yaml));
  return Decoration.set([Decoration.replace({ widget, block: true }).range(range.from, range.to)]);
}

const decorations = StateField.define({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || focusChanged(transaction) ? buildDecorations(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Flips `key: true|false` in the frontmatter. */
function toggleBoolean(view, key) {
  const range = frontmatterRange(view.state.doc);
  if (!range) return false;
  const doc = view.state.doc;
  for (let n = doc.lineAt(range.yamlFrom).number; n < doc.lineAt(range.to).number; n++) {
    const line = doc.line(n);
    const match = /^([^:]+):\s*(true|false)\s*$/i.exec(line.text);
    if (match && match[1].trim() === key) {
      const valueFrom = line.from + line.text.lastIndexOf(match[2]);
      view.dispatch({
        changes: { from: valueFrom, to: valueFrom + match[2].length, insert: match[2].toLowerCase() === "true" ? "false" : "true" },
        userEvent: "input.toggle",
      });
      return true;
    }
  }
  return false;
}

const clicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const panel = event.target.closest(".cm-properties");
    if (!panel) return false;
    // Tags and links are handled by livePreview.js.
    if (event.target.closest(".cm-tag, .cm-wikilink, .cm-md-link")) return false;
    event.preventDefault();
    const box = event.target.closest(".cm-property-checkbox");
    if (box) return toggleBoolean(view, box.dataset.key);
    // Anywhere else: edit the raw YAML (never in reading view).
    if (view.state.readOnly || !view.state.facet(EditorView.editable)) return true;
    const range = frontmatterRange(view.state.doc);
    if (!range) return false;
    view.focus();
    view.dispatch({ selection: { anchor: Math.min(range.yamlFrom, range.to) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
});

export const properties = [focusTracking, decorations, clicks];
