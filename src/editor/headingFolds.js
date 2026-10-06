// Heading folding: each ATX heading gets a chevron in the left margin (on
// hover; always shown when folded) that folds its section — up to the next
// heading of the same or higher level. A folded heading ends with a "…" pill
// that unfolds it. Built on @codemirror/language's fold state, so the cursor
// entering a folded section unfolds it, and folds live in each note's state.
import { codeFolding, foldEffect, foldState, foldedRanges, unfoldEffect } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";

const ATX = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Foldable heading sections, in document order:
 * { header (line start), from (line end), to, level, line }. The body runs
 * from the end of the heading line to just before the next heading of the
 * same or higher level (or the end of the document). Headings in fenced code
 * and frontmatter don't count; sections with only blank lines are left out.
 */
export function headingSections(doc) {
  const headings = [];
  let fence = null;
  let start = 1;
  // Frontmatter: `---` on the first line up to the closing `---` / `...`.
  if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) {
    for (let n = 2; n <= doc.lines; n++) {
      if (/^(---|\.\.\.)\s*$/.test(doc.line(n).text)) {
        start = n + 1;
        break;
      }
    }
  }
  for (let n = start; n <= doc.lines; n++) {
    const line = doc.line(n);
    const fenceMatch = FENCE.exec(line.text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !/\S/.test(line.text.slice(fenceMatch[0].length))) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const atx = ATX.exec(line.text);
    if (atx) headings.push({ line: n, level: atx[1].length, header: line.from, from: line.to });
  }
  const sections = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    let next = i + 1;
    while (next < headings.length && headings[next].level > heading.level) next++;
    const to = next < headings.length ? headings[next].header - 1 : doc.length;
    if (to > heading.from && /\S/.test(doc.sliceString(heading.from, to))) sections.push({ ...heading, to });
  }
  return sections;
}

// Sections are recomputed only when the document changes.
const cache = new WeakMap();
function sectionsOf(doc) {
  let sections = cache.get(doc);
  if (!sections) cache.set(doc, (sections = headingSections(doc)));
  return sections;
}

/** The folded range for the section starting at `from`, if any. */
function foldedAt(state, from) {
  let found = null;
  foldedRanges(state).between(from, from, (a, b) => {
    if (a === from) {
      found = { from: a, to: b };
      return false;
    }
  });
  return found;
}

const isFolded = (state, from) => foldedAt(state, from) !== null;

// ---------- Commands ----------

/** Folds the innermost unfolded heading section around the cursor. */
export function foldHeading(view) {
  const { state } = view;
  if (!state.field(foldState, false)) return false;
  const head = state.selection.main.head;
  const around = sectionsOf(state.doc).filter((s) => s.header <= head && head <= s.to).reverse();
  const section = around.find((s) => !isFolded(state, s.from));
  if (!section) return false;
  view.dispatch({
    effects: foldEffect.of({ from: section.from, to: section.to }),
    // Keep the cursor visible: move it out of the body onto the heading.
    selection: head > section.from ? { anchor: section.from } : undefined,
  });
  return true;
}

/** Unfolds the folded sections on the cursor's line (or the one around it). */
export function unfoldHeading(view) {
  const { state } = view;
  if (!state.field(foldState, false)) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  const effects = [];
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
}

/** Folds every heading section (nested ones too, so unfolding goes level by level). */
export function foldAllHeadings(view) {
  const { state } = view;
  if (!state.field(foldState, false)) return false;
  const sections = sectionsOf(state.doc).filter((s) => !isFolded(state, s.from));
  if (!sections.length) return false;
  const head = state.selection.main.head;
  const outer = sectionsOf(state.doc).find((s) => s.from < head && head <= s.to);
  view.dispatch({
    effects: sections.map((s) => foldEffect.of({ from: s.from, to: s.to })),
    selection: outer ? { anchor: outer.from } : undefined,
  });
  return true;
}

/** Unfolds every folded heading section. */
export function unfoldAll(view) {
  const { state } = view;
  if (!state.field(foldState, false)) return false;
  const effects = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
}

/** Folds or unfolds the section whose heading line ends at `from`. */
function toggleSection(view, from) {
  const folded = foldedAt(view.state, from);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return;
  }
  const section = sectionsOf(view.state.doc).find((s) => s.from === from);
  if (!section) return;
  const head = view.state.selection.main.head;
  view.dispatch({
    effects: foldEffect.of({ from: section.from, to: section.to }),
    selection: head > section.from && head <= section.to ? { anchor: section.from } : undefined,
  });
}

export const headingFoldKeymap = [
  { key: "Mod-Shift-[", run: foldHeading },
  { key: "Mod-Shift-]", run: unfoldHeading },
];

// ---------- Chevron and pill ----------

class HeadingChevron extends WidgetType {
  constructor(from, folded) {
    super();
    this.from = from;
    this.folded = folded;
  }
  eq(other) {
    return other.from === this.from && other.folded === this.folded;
  }
  toDOM(view) {
    const button = document.createElement("span");
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggleSection(view, Number(button.dataset.headingFold));
    });
    button.className = "cm-heading-fold" + (this.folded ? " is-folded" : "");
    button.dataset.headingFold = String(this.from);
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.folded ? "Unfold heading" : "Fold heading");
    button.setAttribute("aria-expanded", String(!this.folded));
    const chevron = document.createElement("span");
    chevron.className = "cm-heading-fold-chevron";
    button.appendChild(chevron);
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

function buildChevrons(view) {
  const { state } = view;
  const widgets = [];
  for (const section of sectionsOf(state.doc)) {
    if (!view.visibleRanges.some((r) => section.header <= r.to && section.from >= r.from)) continue;
    const widget = new HeadingChevron(section.from, isFolded(state, section.from));
    widgets.push(Decoration.widget({ widget, side: -1 }).range(section.header));
  }
  return Decoration.set(widgets);
}

const chevrons = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildChevrons(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || foldedRanges(update.startState) !== foldedRanges(update.state)) {
        this.decorations = buildChevrons(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The "…" after a folded heading; clicking it unfolds. */
function placeholderDOM(view, onclick) {
  const pill = document.createElement("span");
  pill.className = "cm-heading-fold-pill";
  pill.textContent = "…";
  pill.title = "Unfold";
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", "Unfold section");
  pill.addEventListener("mousedown", (event) => event.preventDefault());
  pill.addEventListener("click", onclick);
  return pill;
}

/** Live preview and reading view only (not source mode). */
export const headingFolding = [codeFolding({ placeholderDOM }), chevrons];
