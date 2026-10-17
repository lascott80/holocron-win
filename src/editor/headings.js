// Finding your way in long notes: a slim trail of the headings you're in,
// pinned above the note while you scroll ("Projects › Kyber › Results"), and
// a `[TOC]` line that renders as a live, clickable table of contents.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { focusChanged, focusTracking, isEditing } from "./focus.js";
import { UI_FONT } from "./platform.js";

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** A line that's only a table-of-contents marker. */
export const TOC_LINE = /^\s*\[(?:TOC|toc)\]\s*$/;

/** A heading's text without markdown: "**Big** [[Note|link]] `code`" → "Big link code". */
export function plainHeading(text) {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|==|`)(.+?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** The note's ATX headings (outside code and frontmatter): { level, text, line (1-based), from }. */
export function noteHeadings(doc) {
  const headings = [];
  let n = 1;
  if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) {
    let end = 2;
    while (end <= doc.lines && !/^(---|\.\.\.)\s*$/.test(doc.line(end).text)) end++;
    if (end <= doc.lines) n = end + 1;
  }
  let fence = null;
  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const marker = FENCE.exec(line.text);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.text.slice(marker[0].length).trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = ATX.exec(line.text);
    if (heading && heading[2].trim()) headings.push({ level: heading[1].length, text: plainHeading(heading[2]), line: n, from: line.from });
  }
  return headings;
}

/** The headings that contain `line`: the nearest one above it and its parents, outermost first. */
export function headingTrail(headings, line) {
  const trail = [];
  for (const heading of headings) {
    if (heading.line > line) break;
    while (trail.length && trail[trail.length - 1].level >= heading.level) trail.pop();
    trail.push(heading);
  }
  return trail;
}

function scrollToHeading(view, from) {
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 44 }) });
  if (view.state.facet(EditorView.editable)) view.focus();
}

// ---------- Heading trail ----------

const trailPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.headings = noteHeadings(view.state.doc);
      this.dom = document.createElement("nav");
      this.dom.className = "cm-heading-trail";
      this.dom.setAttribute("aria-label", "Headings you’re in");
      this.key = "";
      view.dom.appendChild(this.dom);
      this.onScroll = () => this.refresh();
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      this.refresh();
    }
    update(update) {
      if (update.docChanged) this.headings = noteHeadings(update.state.doc);
      if (update.docChanged || update.geometryChanged || update.viewportChanged) this.refresh();
    }
    refresh() {
      const { view } = this;
      // The line at the top of the window, just under the trail itself.
      const top = view.scrollDOM.scrollTop - view.documentPadding.top + 36;
      let line = 1;
      try {
        line = view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, top)).from).number;
      } catch {
        // Not measured yet.
      }
      const trail = headingTrail(this.headings, line);
      // Only once the innermost heading has scrolled out of sight.
      const visible = trail.length > 0 && trail[trail.length - 1].line < line;
      const key = visible ? trail.map((h) => h.from).join(",") : "";
      if (key === this.key) return;
      this.key = key;
      this.dom.replaceChildren();
      this.dom.classList.toggle("is-shown", visible);
      if (!visible) return;
      trail.forEach((heading, i) => {
        if (i) this.dom.appendChild(Object.assign(document.createElement("span"), { className: "cm-heading-trail-sep", textContent: "›" }));
        const crumb = document.createElement("button");
        crumb.type = "button";
        crumb.textContent = heading.text;
        crumb.title = `Go to “${heading.text}”`;
        crumb.addEventListener("mousedown", (event) => event.preventDefault());
        crumb.addEventListener("click", () => scrollToHeading(view, heading.from));
        this.dom.appendChild(crumb);
      });
    }
    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.dom.remove();
    }
  },
);

// ---------- [TOC] ----------

class TocWidget extends WidgetType {
  constructor(headings) {
    super();
    this.headings = headings;
    this.key = headings.map((h) => `${h.level}|${h.text}|${h.from}`).join("\n");
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM(view) {
    const box = document.createElement("nav");
    box.className = "cm-toc";
    box.setAttribute("aria-label", "Table of contents");
    const title = document.createElement("div");
    title.className = "cm-toc-title";
    title.textContent = "Contents";
    box.appendChild(title);
    if (!this.headings.length) {
      box.appendChild(Object.assign(document.createElement("div"), { className: "cm-toc-empty", textContent: "No headings yet." }));
      return box;
    }
    const top = Math.min(...this.headings.map((h) => h.level));
    for (const heading of this.headings) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-toc-item";
      item.style.paddingLeft = `${(heading.level - top) * 16 + 4}px`;
      item.textContent = heading.text;
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      item.addEventListener("click", (event) => {
        event.preventDefault();
        scrollToHeading(view, heading.from);
      });
      box.appendChild(item);
    }
    return box;
  }
  ignoreEvent(event) {
    return event.type !== "mousedown"; // a click on the box (not an item) edits the marker
  }
}

function buildToc(state) {
  const { doc } = state;
  let headings = null;
  const decorations = [];
  let fence = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const marker = FENCE.exec(line.text);
    if (fence) {
      if (marker && marker[1][0] === fence[0]) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (!TOC_LINE.test(line.text) || isEditing(state, line.from, line.to)) continue;
    headings ??= noteHeadings(doc);
    decorations.push(Decoration.replace({ widget: new TocWidget(headings), block: true }).range(line.from, line.to));
  }
  return Decoration.set(decorations);
}

const tocField = StateField.define({
  create: buildToc,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || focusChanged(transaction) ? buildToc(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.baseTheme({
  ".cm-heading-trail": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    zIndex: "4",
    display: "none",
    alignItems: "center",
    gap: "2px",
    padding: "5px 16px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    fontFamily: UI_FONT,
    fontSize: "12px",
    color: "var(--hc-muted)",
    background: "color-mix(in srgb, var(--hc-bg) 88%, transparent)",
    // Clicks go through the bar to what is under it (an image’s Enlarge button…); only its links take them.
    pointerEvents: "none",
    backdropFilter: "blur(6px)",
    borderBottom: "1px solid var(--hc-border)",
  },
  ".cm-heading-trail.is-shown": { display: "flex" },
  ":root.hc-no-heading-trail & .cm-heading-trail": { display: "none !important" },
  ".cm-heading-trail button": {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    padding: "2px 6px",
    border: "0",
    borderRadius: "5px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    pointerEvents: "auto",
  },
  ".cm-heading-trail button:last-child": { color: "var(--hc-text)", flexShrink: "0", maxWidth: "50%" },
  ".cm-heading-trail button:hover": { background: "var(--hc-chip)", color: "var(--hc-text)" },
  ".cm-heading-trail-sep": { color: "var(--hc-faint)" },
  ".cm-toc": {
    display: "flex",
    flexDirection: "column",
    margin: "6px 0 10px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid var(--hc-border)",
    background: "var(--hc-raised)",
    fontFamily: UI_FONT,
    fontSize: "0.92em",
  },
  ".cm-toc-title": { fontSize: "12px", fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--hc-muted)", marginBottom: "4px" },
  ".cm-toc-item": {
    textAlign: "left",
    padding: "2px 4px",
    border: "0",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--hc-accent)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-toc-item:hover": { background: "var(--hc-chip)", textDecoration: "underline" },
  ".cm-toc-empty": { color: "var(--hc-muted)", fontStyle: "italic" },
});

/** Keeps the cursor and scrolled-to lines clear of the trail while it shows. */
const trailMargin = EditorView.scrollMargins.of((view) => {
  const trail = view.plugin(trailPlugin);
  return trail?.dom.classList.contains("is-shown") ? { top: trail.dom.offsetHeight } : null;
});

export const headingNavigation = [focusTracking, trailPlugin, tocField, theme, trailMargin];
