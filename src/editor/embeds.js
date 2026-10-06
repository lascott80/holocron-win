// Note embeds: ![[Note]], ![[Note#Heading]] and ![[Note#^block-id]] render
// the other note's content in a read-only box below the line (![[#Heading]]
// and ![[#^id]] embed part of the open note itself). Content comes from Holocron
// (so unsaved edits in other tabs show up) and is cached here; embeds inside
// an embed stay plain links, so notes can't embed each other forever.
import { EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { modKey } from "./platform.js";

/** How deeply nested this editor is: 0 for the main editor, 1 inside an embed. */
export const embedDepth = Facet.define({ combine: (values) => (values.length ? Math.max(...values) : 0) });

const EMBED = /!\[\[([^[\]\n]+)\]\]/g;
const FILE_EXTENSION = /\.(?!md$|markdown$)[a-z0-9]{1,5}$/i; // images and attachments are not note embeds

/**
 * The inside of ![[…]] as a note embed: { target, heading } ("" target = this
 * note; heading keeps its "#", e.g. "#Intro" or "#^id"), or null if it isn't
 * one (images, attachments, nothing to embed). livePreview hides exactly these.
 */
export function parseEmbed(inner) {
  const link = inner.split("|")[0];
  const hash = link.indexOf("#");
  const target = (hash < 0 ? link : link.slice(0, hash)).trim();
  const heading = hash < 0 ? null : link.slice(hash).trim();
  if (target && FILE_EXTENSION.test(target)) return null;
  if (!target && !/^#\^?\s*[^\s^#]/.test(heading ?? "")) return null;
  if (heading === "#" || heading === "#^") return { target, heading: null };
  return { target, heading };
}

let config = { request: () => {}, nestedExtensions: () => [], openLink: () => {}, currentNote: () => "" };

/** Cache of embed content, keyed by "target|fromNote". */
const cache = new Map(); // key → { result, stale, requested }
const waiting = new Map(); // request id → key
let nextRequestId = 1;
const views = new Set();
const refresh = StateEffect.define();

export function configureEmbeds(options) {
  config = { ...config, ...options };
}

const listeners = new Set();

function refreshAll() {
  for (const view of views) view.dispatch({ effects: refresh.of(null) });
  for (const listener of listeners) listener();
}

/** Holocron's answer to a request: { title, path, text } or null if missing. */
export function resolveEmbed(id, result) {
  const key = waiting.get(id);
  if (!key) return;
  waiting.delete(id);
  const entry = cache.get(key);
  const changed = !entry || entry.result === undefined || JSON.stringify(entry.result) !== JSON.stringify(result);
  cache.set(key, { result, stale: false, requested: false });
  if (changed) refreshAll();
}

/** Notes changed: fetch embeds again, keeping what's shown until the new text arrives. */
export function invalidateEmbeds() {
  for (const [key, entry] of cache) {
    cache.set(key, { ...entry, stale: true });
    request(key);
  }
}

function request(key) {
  const entry = cache.get(key) ?? {};
  if (entry.requested) return;
  cache.set(key, { ...entry, requested: true });
  const id = nextRequestId++;
  waiting.set(id, key);
  const [target, from] = key.split("|");
  config.request({ id, target, from });
}

// ---------- Content ----------

/** The note's body without frontmatter, or just one heading's section. */
export function embedSection(text, heading) {
  let body = text;
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(body);
  if (frontmatter) body = body.slice(frontmatter[0].length);
  if (!heading) return body.replace(/^\s*\n/, "");

  // ![[Note#^block-id]]: the paragraph or list item carrying that id.
  if (/^#?\^/.test(heading)) {
    const id = heading.replace(/^#?\^/, "").trim();
    const lines = body.split("\n");
    const at = lines.findIndex((line) => new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(line) || line.trim() === `^${id}`);
    if (at < 0) return null;
    const strip = (line) => line.replace(/\s\^[A-Za-z0-9-]+\s*$/, "");
    if (lines[at].trim() === `^${id}`) {
      // The id on its own line names the block just above it (blank lines between are allowed).
      let end = at;
      while (end > 0 && !lines[end - 1].trim()) end--;
      let start = end;
      while (start > 0 && lines[start - 1].trim()) start--;
      return lines.slice(start, end).join("\n");
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(lines[at])) return strip(lines[at]);
    let start = at;
    while (start > 0 && lines[start - 1].trim() && !/^\s*([-*+]|\d+[.)]|#)\s/.test(lines[start - 1])) start--;
    return lines.slice(start, at + 1).map(strip).join("\n");
  }

  const wanted = heading.replace(/^#/, "").trim().toLowerCase();
  const lines = body.split("\n");
  let start = -1;
  let level = 0;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    if (start < 0) {
      const plain = match[2].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`~=]/g, "").trim().toLowerCase();
      if (plain === wanted) {
        start = i;
        level = match[1].length;
      }
    } else if (match[1].length <= level) {
      return lines.slice(start, i).join("\n").trimEnd();
    }
  }
  return start < 0 ? null : lines.slice(start).join("\n").trimEnd();
}

// ---------- Widget ----------

/** The box an embed renders as: a header linking to the note, and its content. */
function embedBox(target, heading, key, self = null) {
  // `self`: { title, text } of the open note, for ![[#Heading]] / ![[#^id]].
  const entry = self ? { result: self } : cache.get(key);
  if (!entry || entry.result === undefined) request(key);

  const box = document.createElement("div");
  box.className = "cm-embed";
  const header = document.createElement("div");
  header.className = "cm-embed-header";
  const title = document.createElement("span");
  title.className = "cm-embed-title";
  const result = entry?.result;
  title.textContent = (result?.title ?? target) + (heading ? ` › ${heading.replace(/^#/, "")}` : "");
  header.appendChild(title);
  header.title = "Open note";
  header.addEventListener("mousedown", (event) => {
    event.preventDefault();
    config.openLink(target + (heading ?? ""), modKey(event));
  });
  box.appendChild(header);

  const body = document.createElement("div");
  body.className = "cm-embed-body";
  box.appendChild(body);

  if (!entry || entry.result === undefined) {
    body.appendChild(message("Loading…"));
  } else if (result === null) {
    body.appendChild(message(`“${target}” doesn’t exist yet. Click the title to create it.`));
  } else {
    const section = embedSection(result.text ?? "", heading);
    if (section === null) {
      body.appendChild(message(`No heading “${heading.replace(/^#/, "")}” in this note.`));
    } else if (!section.trim()) {
      body.appendChild(message("This note is empty."));
    } else {
      const nested = new EditorView({
        state: EditorState.create({ doc: section, extensions: config.nestedExtensions() }),
        parent: body,
      });
      box.nestedView = nested;
    }
  }
  return box;
}

/**
 * A live preview of a note (for hover previews): updates itself when the
 * content arrives. Call `close()` when done with it.
 */
export function notePreview(target, heading) {
  const key = `${target}|${config.currentNote()}`;
  const container = document.createElement("div");
  let shownVersion = null;
  const render = () => {
    const entry = cache.get(key);
    const version = entry?.result === undefined ? "loading" : JSON.stringify(entry.result);
    if (version === shownVersion) return;
    shownVersion = version;
    container.firstChild?.nestedView?.destroy();
    container.replaceChildren(embedBox(target, heading, key));
  };
  render();
  listeners.add(render);
  return {
    dom: container,
    close() {
      listeners.delete(render);
      container.firstChild?.nestedView?.destroy();
    },
  };
}

class EmbedWidget extends WidgetType {
  constructor(target, heading, key, self = null) {
    super();
    this.target = target;
    this.heading = heading;
    this.key = key;
    this.self = self;
    const entry = cache.get(key);
    this.version = self
      ? JSON.stringify([self.title, embedSection(self.text, heading)])
      : entry?.result === undefined ? "loading" : JSON.stringify(entry.result);
  }
  eq(other) {
    return other.key === this.key && other.heading === this.heading && other.version === this.version;
  }
  get estimatedHeight() {
    return 160;
  }
  toDOM() {
    return embedBox(this.target, this.heading, this.key, this.self);
  }
  destroy(dom) {
    dom.nestedView?.destroy();
  }
  ignoreEvent() {
    // Clicks inside go to the embedded editor (or the header), not the note.
    return true;
  }
}

function message(text) {
  const node = document.createElement("div");
  node.className = "cm-embed-message";
  node.textContent = text;
  return node;
}

// ---------- Decorations ----------

function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

/** Note embeds on a line of text (images and other files excluded). */
export function findEmbeds(text) {
  const embeds = [];
  for (const match of text.matchAll(EMBED)) {
    const embed = parseEmbed(match[1]);
    if (embed) embeds.push({ from: match.index, to: match.index + match[0].length, ...embed });
  }
  return embeds;
}

/** The open note's title, from its id (file path). */
function noteTitle(id) {
  return (id.split(/[\\/]/).pop() || "This note").replace(/\.(md|markdown)$/i, "");
}

function buildEmbeds(state) {
  if (state.facet(embedDepth) > 0) return Decoration.none;
  const from = config.currentNote();
  const widgets = [];
  let self = null; // this note's text, for ![[#Heading]] / ![[#^id]]
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes("![[")) continue;
    for (const embed of findEmbeds(line.text)) {
      if (inCode(state, line.from + embed.from)) continue;
      const key = `${embed.target}|${from}`;
      if (!embed.target) self ??= { title: noteTitle(from), text: state.doc.toString() };
      const widget = new EmbedWidget(embed.target, embed.heading, key, embed.target ? null : self);
      widgets.push(Decoration.widget({ widget, block: true, side: 2 }).range(line.to));
    }
  }
  return Decoration.set(widgets, true);
}

const embedField = StateField.define({
  create: buildEmbeds,
  update(value, transaction) {
    if (transaction.docChanged || transaction.effects.some((effect) => effect.is(refresh))) {
      return buildEmbeds(transaction.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const tracker = ViewPlugin.define((view) => {
  views.add(view);
  return { destroy: () => views.delete(view) };
});

export const noteEmbeds = [embedField, tracker];

/** Re-scans embeds after the open note changed (its id affects lookups). */
export function refreshEmbeds() {
  refreshAll();
}
