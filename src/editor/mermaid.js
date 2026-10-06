// Mermaid diagrams: a ```mermaid fenced block renders as its diagram unless
// you're editing inside it (like tables). Clicking the diagram shows the
// code. Mermaid itself is large, so it's loaded the first time a note
// contains a diagram. Diagrams follow the light/dark appearance.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { UI_FONT } from "./platform.js";

/** Redraws diagrams for a new appearance: "dark" or "light", optionally ":<accent>". */
export const setMermaidTheme = StateEffect.define();

const OPEN = /^\s{0,3}(`{3,}|~{3,})\s*mermaid\b/i;

/** Every ```mermaid block: its range, the code inside and where the code starts. */
export function findMermaidBlocks(doc) {
  const blocks = [];
  for (let n = 1; n <= doc.lines; n++) {
    const open = OPEN.exec(doc.line(n).text);
    if (!open) continue;
    const fence = open[1];
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

// ---------- Rendering ----------

let mermaidModule = null;
let configuredTheme = null;
let renderCount = 0;
/** "theme variables\ncode" → {svg} or {error}; diagrams don't re-render on every keystroke elsewhere. */
const cache = new Map();

/** Mermaid's "base" theme coloured from Holocron's palette (the --hc-* variables). */
function themeVariables(theme) {
  const css = getComputedStyle(document.documentElement);
  const dark = theme.startsWith("dark");
  const v = (name, darkFallback, lightFallback) => css.getPropertyValue(`--hc-${name}`).trim() || (dark ? darkFallback : lightFallback);
  const accent = v("accent", "#5AB4FF", "#1F6FBF");
  const text = v("text", "#D8DBE0", "#2A2E35");
  const surface = v("chip", "#1E222A", "#EBEDF0");
  const raised = v("raised", "#161A20", "#F4F5F7");
  const panel = v("panel", "#1A1D23", "#FFFFFF");
  const border = v("strong-border", "#343A45", "#CDD1D7");
  return {
    darkMode: dark,
    background: raised,
    fontFamily: UI_FONT,
    fontSize: "14px",
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: accent,
    secondaryColor: panel,
    tertiaryColor: raised,
    lineColor: v("muted", "#8A919D", "#6B7280"),
    textColor: text,
    mainBkg: surface,
    nodeBorder: accent,
    clusterBkg: raised,
    clusterBorder: border,
    edgeLabelBackground: raised,
    actorBkg: surface,
    actorBorder: accent,
    actorTextColor: text,
    signalColor: text,
    signalTextColor: text,
    noteBkgColor: panel,
    noteTextColor: text,
    noteBorderColor: border,
  };
}

async function renderDiagram(code, theme) {
  const variables = themeVariables(theme);
  const style = JSON.stringify(variables);
  const key = `${style}\n${code}`;
  if (cache.has(key)) return cache.get(key);
  mermaidModule ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidModule;
  if (configuredTheme !== style) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict", // no click handlers or raw HTML in labels
      theme: "base",
      themeVariables: variables,
      fontFamily: UI_FONT,
    });
    configuredTheme = style;
  }
  let result;
  try {
    const { svg } = await mermaid.render(`holocron-mermaid-${++renderCount}`, code);
    result = { svg };
  } catch (error) {
    result = { error: String(error?.message ?? error).split("\n").slice(0, 4).join("\n") };
    // A failed render can leave its scratch element behind.
    document.getElementById(`dholocron-mermaid-${renderCount}`)?.remove();
  }
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

class MermaidWidget extends WidgetType {
  constructor(block, theme) {
    super();
    this.code = block.code;
    this.codeFrom = block.codeFrom;
    this.theme = theme;
  }
  eq(other) {
    return other.code === this.code && other.theme === this.theme && other.codeFrom === this.codeFrom;
  }
  toDOM(view) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-mermaid";
    wrapper.dataset.pos = String(this.codeFrom);
    wrapper.title = "Click to edit the diagram";
    const show = ({ svg, error }) => {
      wrapper.replaceChildren();
      if (svg) {
        wrapper.innerHTML = svg; // sanitised by Mermaid (securityLevel "strict")
      } else {
        const message = document.createElement("div");
        message.className = "cm-mermaid-error";
        message.textContent = `Mermaid couldn’t draw this diagram: ${error}`;
        wrapper.appendChild(message);
      }
      view.requestMeasure();
    };
    const cached = cache.get(`${JSON.stringify(themeVariables(this.theme))}\n${this.code}`);
    if (cached) show(cached);
    else {
      const loading = document.createElement("div");
      loading.className = "cm-mermaid-loading";
      loading.textContent = "Drawing diagram…";
      wrapper.appendChild(loading);
      void renderDiagram(this.code, this.theme).then(show);
    }
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

function currentTheme() {
  return globalThis.document?.documentElement.classList.contains("hc-light") ? "light" : "dark";
}

function build(state, theme) {
  const decorations = [];
  for (const block of findMermaidBlocks(state.doc)) {
    if (!block.code.trim() || isEditing(state, block.from, block.to)) continue;
    decorations.push(Decoration.replace({ widget: new MermaidWidget(block, theme), block: true }).range(block.from, block.to));
  }
  return Decoration.set(decorations, true);
}

const mermaidField = StateField.define({
  create: (state) => ({ theme: currentTheme(), decorations: build(state, currentTheme()) }),
  update(value, transaction) {
    let theme = value.theme;
    for (const effect of transaction.effects) if (effect.is(setMermaidTheme)) theme = effect.value;
    if (theme === value.theme && !transaction.docChanged && !transaction.selection && !focusChanged(transaction)) return value;
    return { theme, decorations: build(transaction.state, theme) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const mermaidClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const diagram = event.target.closest(".cm-mermaid");
    if (!diagram || view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: Number(diagram.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
});

const mermaidTheme = EditorView.baseTheme({
  ".cm-mermaid": {
    display: "flex",
    justifyContent: "center",
    padding: "16px",
    margin: "4px 0",
    borderRadius: "8px",
    border: "1px solid var(--hc-border)",
    background: "var(--hc-raised)",
    overflowX: "auto",
    cursor: "pointer",
  },
  ".cm-mode-reading .cm-mermaid": { cursor: "default" },
  ".cm-mermaid svg": { maxWidth: "100%", height: "auto" },
  ".cm-mermaid-loading": { color: "var(--hc-muted)", fontFamily: UI_FONT, fontSize: "13px" },
  ".cm-mermaid-error": {
    color: "var(--hc-muted)",
    fontFamily: UI_FONT,
    fontSize: "13px",
    whiteSpace: "pre-wrap",
    alignSelf: "flex-start",
  },
});

export const mermaidDiagrams = [focusTracking, mermaidField, mermaidClicks, mermaidTheme];
