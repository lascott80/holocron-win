// Math (KaTeX), like Obsidian: `$$ … $$` blocks render centred unless you're
// editing inside them (like mermaid); `$…$` renders inline except on active
// lines. Dollar rules follow pandoc so prices don't turn into math. KaTeX
// is loaded the first time a note contains math.
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { activeLines, rawBlocks } from "./livePreview.js";
import { MONO_FONT } from "./platform.js";

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const OPEN = /^\s{0,3}\$\$/;
const CLOSE = /\$\$\s*$/;

/** Every `$$ … $$` block (outside code and frontmatter): its range, the TeX and where the TeX starts. */
export function findDisplayMath(doc) {
  const blocks = [];
  let n = 1;
  if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) {
    let end = 2;
    while (end <= doc.lines && !/^(---|\.\.\.)\s*$/.test(doc.line(end).text)) end++;
    if (end <= doc.lines) n = end + 1;
  }
  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    const fence = FENCE.exec(line.text);
    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      while (n < doc.lines && !close.test(doc.line(n + 1).text)) n++;
      n++;
      continue;
    }
    const open = OPEN.exec(line.text);
    if (!open) continue;
    const sourceFrom = line.from + open[0].length;
    const rest = line.text.slice(open[0].length);
    if (CLOSE.test(rest)) {
      const source = rest.replace(CLOSE, "").trim();
      if (source) blocks.push({ from: line.from, to: line.to, source, sourceFrom });
      continue;
    }
    let end = n + 1;
    while (end <= doc.lines && doc.line(end).text.trim() && !CLOSE.test(doc.line(end).text)) end++;
    if (end > doc.lines || !doc.line(end).text.trim()) continue; // unclosed: leave it as text
    const last = doc.line(end);
    const source = doc.sliceString(sourceFrom, last.to).replace(CLOSE, "").trim();
    if (source) blocks.push({ from: line.from, to: last.to, source, sourceFrom });
    n = end;
  }
  return blocks;
}

const isSpace = (ch) => ch === undefined || /\s/.test(ch);

/**
 * Inline `$…$` spans in one line of text (offsets into it). The opening `$`
 * isn't followed by whitespace; the closing one isn't preceded by whitespace
 * or followed by a digit; `\$` is a literal dollar; `$$` is never inline.
 * Characters in `masked` positions (code etc.) can't be part of math.
 * @param {string} text
 * @param {(index: number) => boolean} [masked]
 */
export function findInlineMath(text, masked = (_index) => false) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "$" || masked(i)) {
      i++;
      continue;
    }
    if (text[i + 1] === "$") {
      while (text[i] === "$") i++;
      continue;
    }
    if (isSpace(text[i + 1])) {
      i++;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < text.length; j++) {
      if (masked(j)) break;
      if (text[j] === "\\") {
        j++;
        continue;
      }
      if (text[j] !== "$") continue;
      if (text[j + 1] === "$") break;
      if (!isSpace(text[j - 1]) && !/[0-9]/.test(text[j + 1] ?? "")) close = j;
      break;
    }
    if (close < 0) {
      i++;
      continue;
    }
    spans.push({ from: i, to: close + 1, source: text.slice(i + 1, close) });
    i = close + 1;
  }
  return spans;
}

/** Where `$` can't start math: code, frontmatter, links' URLs, raw HTML, wikilinks and tables. */
export const NOT_MATH = /^(InlineCode|FencedCode|CodeBlock|Frontmatter|URL|Autolink|HTMLTag|HTMLBlock|CommentBlock|WikiLink|Table)$/;

/** Inline math in the lines of [from, to], skipping code etc. and `$$` blocks. Positions are document offsets. */
export function inlineMathIn(state, from, to, blocks = findDisplayMath(state.doc)) {
  const { doc } = state;
  const tree = syntaxTree(state);
  const spans = [];
  for (let pos = doc.lineAt(from).from; pos <= to; ) {
    const line = doc.lineAt(pos);
    pos = line.to + 1;
    if (!line.text.includes("$") || blocks.some((b) => b.from <= line.from && b.to >= line.to)) continue;
    const excluded = [];
    tree.iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        if (!NOT_MATH.test(node.name)) return;
        excluded.push([node.from - line.from, node.to - line.from]);
        return false;
      },
    });
    const masked = (i) => excluded.some(([a, b]) => i >= a && i < b);
    for (const span of findInlineMath(line.text, masked)) {
      spans.push({ from: line.from + span.from, to: line.from + span.to, source: span.source });
    }
  }
  return spans;
}

// ---------- Rendering ----------

let katex = null;
let katexLoading = null;
/** "display\nsource" → HTML; formulas don't re-render on every keystroke. */
const cache = new Map();

function loadKatex() {
  katexLoading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => {
    katex = module.default;
  });
  return katexLoading;
}

function renderTeX(source, displayMode) {
  const key = `${displayMode ? 1 : 0}\n${source}`;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(source, {
        displayMode,
        throwOnError: false,
        output: "htmlAndMathml",
        trust: false, // no \href, \url, \htmlClass…
        strict: "ignore",
      });
    } catch {
      html = null;
    }
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(key, html);
  }
  return html;
}

class MathWidget extends WidgetType {
  constructor(source, displayMode, pos) {
    super();
    this.source = source;
    this.displayMode = displayMode;
    this.pos = pos;
  }
  eq(other) {
    return other.source === this.source && other.displayMode === this.displayMode && other.pos === this.pos;
  }
  toDOM(view) {
    const wrapper = document.createElement(this.displayMode ? "div" : "span");
    wrapper.className = this.displayMode ? "cm-math cm-math-display" : "cm-math cm-math-inline";
    wrapper.dataset.pos = String(this.pos);
    const fill = () => {
      const html = renderTeX(this.source, this.displayMode);
      if (html === null) {
        wrapper.textContent = this.source;
        wrapper.classList.add("cm-math-error");
      } else {
        wrapper.innerHTML = html; // KaTeX output only (trust: false)
      }
    };
    if (katex) fill();
    else {
      wrapper.textContent = this.source;
      wrapper.classList.add("cm-math-loading");
      void loadKatex().then(() => {
        wrapper.classList.remove("cm-math-loading");
        fill();
        view.requestMeasure();
      });
    }
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

function buildBlocks(state) {
  const blocks = findDisplayMath(state.doc);
  const decorations = [];
  const editing = [];
  for (const block of blocks) {
    if (isEditing(state, block.from, block.to)) {
      editing.push(block);
      continue;
    }
    const widget = new MathWidget(block.source, true, block.sourceFrom);
    decorations.push(Decoration.replace({ widget, block: true }).range(block.from, block.to));
  }
  return { blocks, editing, decorations: Decoration.set(decorations, true) };
}

const displayMathField = StateField.define({
  create: buildBlocks,
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection && !focusChanged(transaction)) return value;
    return buildBlocks(transaction.state);
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    // A block being edited is raw on every line, not just the cursor's.
    rawBlocks.of((state) => state.field(field).editing),
  ],
});

function buildInline(view) {
  const active = activeLines(view);
  const { state } = view;
  const blocks = state.field(displayMathField).blocks;
  const decorations = [];
  for (const { from, to } of view.visibleRanges) {
    for (const span of inlineMathIn(state, from, to, blocks)) {
      if (active.has(state.doc.lineAt(span.from).number)) continue;
      const widget = new MathWidget(span.source, false, span.from + 1);
      decorations.push(Decoration.replace({ widget }).range(span.from, span.to));
    }
  }
  return Decoration.set(decorations, true);
}

const inlineMath = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildInline(view);
    }
    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildInline(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const mathClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const math = event.target.closest(".cm-math");
    if (!math || view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: Number(math.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
});

const mathTheme = EditorView.baseTheme({
  ".cm-math": { cursor: "pointer" },
  ".cm-mode-reading .cm-math": { cursor: "default" },
  ".cm-math-display": {
    display: "block",
    textAlign: "center",
    padding: "4px 0",
    overflowX: "auto",
    overflowY: "hidden",
  },
  ".cm-math-display .katex-display": { margin: "0.5em 0" },
  ".cm-math-inline .katex": { fontSize: "1.1em" },
  ".cm-math-loading, .cm-math-error": { color: "var(--hc-muted)", fontFamily: MONO_FONT, fontSize: "0.9em" },
  ".cm-math-display.cm-math-loading, .cm-math-display.cm-math-error": { whiteSpace: "pre-wrap" },
});

export const math = [focusTracking, displayMathField, inlineMath, mathClicks, mathTheme];
