// Properties: the YAML frontmatter at the top of a note, shown as a tidy
// list of fields (tags as pills, dates formatted, booleans as checkboxes)
// that can be edited in place (ED-24…ED-26, ED-75): click a value to change
// it, add and remove list items and properties, or open the raw YAML.
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
      if (!items.length && nested.length) {
        properties.push({ key, value, nested: true });
        continue;
      }
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


// ---------- Editing (ED-75) ----------

/** Where `key`'s lines sit in the document: [from, to) plus whether its list is written as a block. */
function propertyBlock(doc, key) {
  const range = frontmatterRange(doc);
  if (!range) return null;
  const first = doc.lineAt(range.yamlFrom).number;
  const closing = doc.lineAt(range.to).number;
  for (let n = first; n < closing; n++) {
    const line = doc.line(n);
    const match = /^([^\s#:][^:]*):/.exec(line.text);
    if (!match || match[1].trim() !== key) continue;
    let last = n;
    // Continuation: indented lines, or "- item" lines (YAML lets a block list start at column 0).
    while (last + 1 < closing && /^(\s|-\s|-$)/.test(doc.line(last + 1).text)) last++;
    const blockList = last > n && /^\s*-/.test(doc.line(n + 1).text);
    return { from: line.from, to: doc.line(last).to, blockList };
  }
  return null;
}

const NEEDS_QUOTES = /^[\s\-?:,[\]{}#&*!|>'"%@`]|\s$|: | #|^(true|false|yes|no|null|~)$/i;

/** A scalar as YAML: plain when that reads back the same, otherwise double-quoted. */
export function yamlScalar(text) {
  const value = String(text);
  if (value === "") return "";
  return NEEDS_QUOTES.test(value) || value.includes('"') ? JSON.stringify(value) : value;
}

/** The YAML for one property. Lists keep the block style (`- item`) when `blockList`. */
export function serializeProperty(key, value, { blockList = false } = {}) {
  if (typeof value === "boolean") return `${key}: ${value}`;
  if (Array.isArray(value)) {
    const items = value.map((item) => yamlScalar(item.trim())).filter((item) => item !== "");
    if (blockList && items.length) return `${key}:\n${items.map((item) => `  - ${item}`).join("\n")}`;
    return `${key}: [${items.join(", ")}]`;
  }
  if (value === null || value === undefined || value === "") return `${key}:`;
  return `${key}: ${yamlScalar(value)}`;
}

/** Changes that set `key` to `value`: rewrites its lines, or adds it (creating the frontmatter if needed). */
export function setPropertyChanges(doc, key, value) {
  const block = propertyBlock(doc, key);
  if (block) return [{ from: block.from, to: block.to, insert: serializeProperty(key, value, block) }];
  const range = frontmatterRange(doc);
  const text = serializeProperty(key, value);
  if (!range) return [{ from: 0, insert: `---\n${text}\n---\n` }];
  return [{ from: doc.lineAt(range.to).from, insert: text + "\n" }];
}

/** Changes that delete `key` and its lines. */
export function removePropertyChanges(doc, key) {
  const block = propertyBlock(doc, key);
  if (!block) return [];
  return [{ from: block.from, to: Math.min(doc.length, block.to + 1) }];
}

// ---------- Rendering ----------

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const TAG_KEYS = new Set(["tags", "tag"]);
const LIST_KEYS = /^(tags|tag|aliases|alias|cssclasses)$/i;
const PROPERTY_TYPES = [["text", "Text"], ["list", "List"], ["checkbox", "Checkbox"], ["date", "Date"]];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, title) {
  const node = element("button", className, text);
  node.type = "button";
  if (title) {
    node.title = title;
    node.setAttribute("aria-label", title);
  }
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

// After an edit the panel is redrawn; this names the field to put the cursor back in.
let pendingFocus = null;

function apply(view, changes) {
  if (!changes.length) return;
  view.dispatch({ changes, userEvent: "input.properties" });
}

function todayISO() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

class PropertiesWidget extends WidgetType {
  constructor(properties, canEdit) {
    super();
    this.properties = properties;
    this.canEdit = canEdit;
    this.key = JSON.stringify([properties, canEdit]);
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM(view) {
    const root = element("div", "cm-properties");
    const set = (key, value) => apply(view, setPropertyChanges(view.state.doc, key, value));
    if (!this.properties.length && !this.canEdit) root.appendChild(element("div", "cm-property-empty", "No properties"));
    for (const property of this.properties) root.appendChild(this.row(view, property, set));
    if (this.canEdit) root.appendChild(this.footer(view, set));
    if (pendingFocus) {
      const wanted = pendingFocus;
      requestAnimationFrame(() => {
        const target = [...root.querySelectorAll("[data-focus-key]")].find(
          (node) => node.dataset.focusKey === wanted.key && node.dataset.focusPart === wanted.part,
        );
        if (!target) return;
        pendingFocus = null;
        if (wanted.part === "edit") target.dispatchEvent(new CustomEvent("hc-edit"));
        else target.focus();
      });
    }
    return root;
  }

  row(view, { key, value, nested }, set) {
    const row = element("div", "cm-property");
    row.appendChild(element("span", "cm-property-key", key)).title = key;
    const cell = row.appendChild(element("span", "cm-property-value"));
    const isTags = TAG_KEYS.has(key.toLowerCase());
    if (nested) {
      cell.appendChild(element("span", "cm-property-text cm-property-nested", String(value)));
      cell.title = "Nested YAML: use Edit YAML to change it";
    } else if (typeof value === "boolean") {
      const box = cell.appendChild(element("span", "cm-task-checkbox cm-property-checkbox" + (value ? " is-checked" : "")));
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", String(value));
      box.setAttribute("aria-label", key);
      box.addEventListener("mousedown", (event) => {
        event.preventDefault();
        set(key, !value);
      });
    } else if (Array.isArray(value) || isTags) {
      this.list(cell, key, Array.isArray(value) ? value : String(value ?? "").split(/[,\s]+/).filter(Boolean), isTags, set);
    } else {
      this.scalar(view, cell, key, value === null ? "" : String(value), set);
    }
    if (this.canEdit) {
      const remove = row.appendChild(button("cm-property-remove", "×", `Remove the “${key}” property`));
      remove.addEventListener("mousedown", (event) => {
        event.preventDefault();
        apply(view, removePropertyChanges(view.state.doc, key));
      });
    }
    return row;
  }

  /** Tags and other lists: pills (× removes one) and a field at the end that adds. */
  list(cell, key, items, isTags, set) {
    items.forEach((item, index) => {
      const pill = cell.appendChild(element("span", isTags ? "cm-tag" : "cm-property-pill"));
      if (isTags) {
        const tag = item.replace(/^#/, "");
        pill.textContent = `#${tag}`;
        pill.dataset.tag = tag;
      } else {
        pill.appendChild(renderScalar(item));
      }
      if (!this.canEdit) return;
      const remove = pill.appendChild(button("cm-property-pill-remove", "×", `Remove “${item}”`));
      remove.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        pendingFocus = { key, part: "add" };
        set(key, items.filter((_, i) => i !== index));
      });
    });
    if (!this.canEdit) {
      if (!items.length) cell.appendChild(element("span", "cm-property-empty", "Empty"));
      return;
    }
    const add = cell.appendChild(element("input", "cm-property-input cm-property-add"));
    add.placeholder = items.length ? "" : "Add…";
    add.setAttribute("aria-label", `Add to ${key}`);
    add.dataset.focusKey = key;
    add.dataset.focusPart = "add";
    const commit = () => {
      const added = add.value
        .split(",")
        .map((part) => (isTags ? part.trim().replace(/^#/, "") : part.trim()))
        .filter(Boolean);
      add.value = "";
      if (!added.length) return;
      pendingFocus = { key, part: "add" };
      set(key, [...items, ...added]);
    };
    add.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === "," || event.key === "Tab") && add.value.trim()) {
        event.preventDefault();
        commit();
      } else if (event.key === "Backspace" && add.value === "" && items.length) {
        event.preventDefault();
        pendingFocus = { key, part: "add" };
        set(key, items.slice(0, -1));
      } else if (event.key === "Escape") {
        add.value = "";
        add.blur();
      }
    });
    add.addEventListener("blur", () => {
      if (add.value.trim()) commit();
    });
  }

  /** A text or date value: shown rendered (links still open), edited in a field when clicked. */
  scalar(view, cell, key, text, set) {
    const shown = text === "" ? element("span", "cm-property-empty", "Empty") : renderScalar(text);
    cell.appendChild(shown);
    if (!this.canEdit) return;
    cell.classList.add("is-editable");
    cell.dataset.focusKey = key;
    cell.dataset.focusPart = "edit";
    const isDate = DATE.test(text);
    const withTime = isDate && /[ T]\d{2}:\d{2}$/.test(text);
    const startEditing = () => {
      if (cell.querySelector("input")) return;
      const input = element("input", "cm-property-input");
      if (isDate) {
        input.type = withTime ? "datetime-local" : "date";
        input.value = withTime ? text.replace(" ", "T") : text;
      } else {
        input.value = text;
      }
      input.setAttribute("aria-label", key);
      cell.replaceChildren(input);
      input.focus();
      if (!isDate) input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const next = withTime ? input.value.replace("T", " ") : input.value;
        if (save && next !== text) set(key, next);
        else cell.replaceChildren(shown);
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          view.focus();
        }
      });
      input.addEventListener("blur", () => finish(true));
    };
    cell.addEventListener("hc-edit", startEditing);
    cell.addEventListener("mousedown", (event) => {
      // Links and tags open (livePreview.js handles those); anywhere else edits.
      if (event.target instanceof Element && event.target.closest(".cm-wikilink, .cm-md-link, .cm-tag, input")) return;
      event.preventDefault();
      startEditing();
    });
  }

  footer(view, set) {
    const footer = element("div", "cm-property-footer");
    const addButton = footer.appendChild(button("cm-property-action", "+ Add property"));
    const yamlButton = footer.appendChild(button("cm-property-action cm-property-yaml", "Edit YAML", "Show the properties as YAML"));
    yamlButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const range = frontmatterRange(view.state.doc);
      view.focus();
      if (range) view.dispatch({ selection: { anchor: Math.min(range.yamlFrom, range.to) }, effects: setFocused.of(true), scrollIntoView: true });
    });
    addButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const form = element("span", "cm-property-new");
      const name = form.appendChild(element("input", "cm-property-input cm-property-name"));
      name.placeholder = "Name";
      name.setAttribute("aria-label", "Property name");
      const type = form.appendChild(element("select", "cm-property-type"));
      type.setAttribute("aria-label", "Property type");
      for (const [value, label] of PROPERTY_TYPES) type.appendChild(Object.assign(element("option", "", label), { value }));
      name.addEventListener("input", () => {
        if (LIST_KEYS.test(name.value.trim())) type.value = "list";
      });
      const cancel = () => {
        footer.replaceChildren(addButton, yamlButton);
        view.focus();
      };
      const create = () => {
        const key = name.value.trim().replace(/:+$/, "");
        if (!key) return cancel();
        const existing = this.properties.find((property) => property.key === key);
        if (existing) {
          pendingFocus = { key, part: Array.isArray(existing.value) ? "add" : "edit" };
          view.dispatch({ effects: [] });
          return;
        }
        const initial = { text: "", list: [], checkbox: false, date: todayISO() }[type.value];
        pendingFocus = { key, part: type.value === "list" ? "add" : "edit" };
        set(key, initial);
      };
      for (const control of [name, type]) {
        control.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            create();
          } else if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            cancel();
          }
        });
      }
      footer.replaceChildren(form, yamlButton);
      name.focus();
    });
    return footer;
  }

  // The panel handles its own clicks and keys: the editor mustn't move its cursor into the YAML.
  // Clicks on tags and links still reach livePreview.js, which opens them.
  ignoreEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    return !(event.type === "mousedown" && target?.closest(".cm-tag, .cm-wikilink, .cm-md-link") && !target.closest("button"));
  }
}

// ---------- State ----------

function buildDecorations(state) {
  const range = frontmatterRange(state.doc);
  if (!range) return Decoration.none;
  if (isEditing(state, range.from, range.to)) return Decoration.none;
  const yaml = state.doc.sliceString(range.yamlFrom, range.yamlTo);
  const widget = new PropertiesWidget(parseProperties(yaml), !state.readOnly);
  return Decoration.set([Decoration.replace({ widget, block: true }).range(range.from, range.to)]);
}

const decorations = StateField.define({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || focusChanged(transaction) ? buildDecorations(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const properties = [focusTracking, decorations];
