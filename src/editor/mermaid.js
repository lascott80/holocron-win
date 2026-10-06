// Mermaid diagrams: a ```mermaid fenced block renders as its diagram unless
// you're editing inside it (like tables). Clicking the diagram shows the
// code; its Expand button (or a click in reading view) opens the full-window
// viewer. Mermaid itself is large, so it's loaded the first time a note
// contains a diagram. Diagrams follow the light/dark appearance.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { UI_FONT } from "./platform.js";
import { ICONS, openDiagramViewer, svgSize } from "./diagramViewer.js";

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
let configuredStyle = null;
let renderCount = 0;
/** "theme variables\ncode" → {svg} or {error}; diagrams don't re-render on every keystroke elsewhere. */
const cache = new Map();

/** The editor's appearance from the <html> class: "light" or "dark". */
function currentTheme() {
  return globalThis.document?.documentElement.classList.contains("hc-light") ? "light" : "dark";
}

const isDark = (theme) => theme.startsWith("dark");

/**
 * Mermaid's "base" theme coloured from Holocron's palette (the --hc-* variables).
 * With `live` false the built-in palette for `theme` is used instead, so an
 * export can be light while the app is dark.
 */
function themeVariables(theme, live = true) {
  const css = live ? getComputedStyle(document.documentElement) : null;
  const dark = isDark(theme);
  const v = (name, darkFallback, lightFallback) => css?.getPropertyValue(`--hc-${name}`).trim() || (dark ? darkFallback : lightFallback);
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

// Mermaid's config is global, so each (initialize, render) pair runs alone:
// an image export's config never leaks into an on-screen render.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * Renders (or fetches from the cache) a diagram. `forImage` draws labels as
 * SVG text instead of HTML (<foreignObject> would taint a canvas).
 */
async function renderDiagram(code, theme, { live = true, forImage = false } = {}) {
  const variables = themeVariables(theme, live);
  const style = JSON.stringify(variables) + (forImage ? "\nimage" : "");
  const key = `${style}\n${code}`;
  if (cache.has(key)) return cache.get(key);
  mermaidModule ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidModule;
  const result = await serial(async () => {
    if (cache.has(key)) return cache.get(key);
    if (configuredStyle !== style) {
      // initialize() starts from Mermaid's defaults, so the image flags don't stick.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict", // no click handlers or raw HTML in labels
        theme: "base",
        themeVariables: variables,
        fontFamily: UI_FONT,
        ...(forImage ? { htmlLabels: false, flowchart: { htmlLabels: false } } : {}),
      });
      configuredStyle = style;
    }
    const id = `holocron-mermaid-${++renderCount}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return { svg };
    } catch (error) {
      // A failed render can leave its scratch element behind.
      document.getElementById(`d${id}`)?.remove();
      return { error: String(error?.message ?? error).split("\n").slice(0, 4).join("\n") };
    }
  });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

const PNG_PADDING = 16; // around the diagram, before scaling
const MAX_CANVAS = 16384;

/** The SVG's root tag given a fixed pixel size (Mermaid's is width="100%" with a max-width). */
function withSize(svg, width, height) {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => tag
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, "")
    .replace(/^<svg/i, `<svg width="${width}" height="${height}"`));
}

/**
 * A diagram as a PNG: `{ dataUrl, width, height }` (width/height in PNG pixels,
 * i.e. `scale` × the diagram's size plus a small margin). "light" always uses
 * the light palette on white; "dark" uses the dark palette on the editor
 * background. Rejects if Mermaid can't draw the code.
 */
export async function diagramImage(code, { theme = "light", scale = 2 } = {}) {
  const live = isDark(theme) === isDark(currentTheme());
  const { svg, error } = await renderDiagram(code, theme, { live, forImage: true });
  if (!svg) throw new Error(`Mermaid couldn’t draw this diagram: ${error}`);
  const size = svgSize(svg);
  if (!(size.width > 0 && size.height > 0)) throw new Error("The diagram has no size");
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withSize(svg, size.width, size.height))}`;
  await image.decode();
  const outerW = size.width + 2 * PNG_PADDING;
  const outerH = size.height + 2 * PNG_PADDING;
  const ratio = Math.min(scale, MAX_CANVAS / outerW, MAX_CANVAS / outerH);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(outerW * ratio);
  canvas.height = Math.round(outerH * ratio);
  const context = canvas.getContext("2d");
  const background = !isDark(theme)
    ? "#FFFFFF"
    : (live && getComputedStyle(document.documentElement).getPropertyValue("--hc-bg").trim()) || "#0F1115";
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, PNG_PADDING * ratio, PNG_PADDING * ratio, size.width * ratio, size.height * ratio);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

// For smoke scripts (scripts/smoke-diagram-viewer.mjs).
if (globalThis.window) globalThis.window.holocronDiagramImage = diagramImage;

function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? "image/png" });
}

/** Opens the full-window viewer for a rendered diagram; focus goes back to `view` on close. */
function expandDiagram(view, svg, code, theme) {
  openDiagramViewer({
    svg,
    label: "Diagram viewer",
    copyImage: async () => dataUrlToBlob((await diagramImage(code, { theme })).dataUrl),
    returnFocus(previous) {
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus();
      else view.focus();
    },
  });
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
    const show = ({ svg, error }) => {
      wrapper.replaceChildren();
      wrapper.expand = null;
      if (svg) {
        wrapper.innerHTML = svg; // sanitised by Mermaid (securityLevel "strict")
        wrapper.expand = () => expandDiagram(view, svg, this.code, this.theme);
        const toolbar = document.createElement("div");
        toolbar.className = "cm-mermaid-toolbar";
        const expand = document.createElement("button");
        expand.type = "button";
        expand.className = "cm-mermaid-expand";
        expand.innerHTML = ICONS.expand;
        expand.title = "Expand diagram";
        expand.setAttribute("aria-label", "Expand diagram");
        // Keep the editor from seeing the press (it would start editing the code).
        expand.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        expand.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          wrapper.expand?.();
        });
        toolbar.appendChild(expand);
        wrapper.appendChild(toolbar);
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
  ignoreEvent(event) {
    // The toolbar handles its own events (keys on the focused button too).
    return event.target instanceof Element && event.target.closest(".cm-mermaid-toolbar") !== null;
  }
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

const readOnly = (view) => view.state.readOnly || !view.state.facet(EditorView.editable);

/** The diagram (of this editor, not a nested embed's) an event happened on. */
function diagramAt(event, view) {
  if (!(event.target instanceof Element) || event.target.closest(".cm-mermaid-toolbar")) return null;
  const diagram = event.target.closest(".cm-mermaid");
  return diagram && diagram.closest(".cm-editor") === view.dom ? diagram : null;
}

const mermaidClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const diagram = diagramAt(event, view);
    if (!diagram || readOnly(view)) return false;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: Number(diagram.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
  // Reading view and embeds can't edit, so a click expands the diagram instead.
  click(event, view) {
    if (event.button !== 0 || !readOnly(view)) return false;
    const diagram = diagramAt(event, view);
    if (!diagram?.expand) return false;
    diagram.expand();
    return true;
  },
  mouseover(event, view) {
    const diagram = diagramAt(event, view);
    if (diagram) diagram.title = !diagram.expand ? "" : readOnly(view) ? "Click to expand the diagram" : "Click to edit the diagram";
    return false;
  },
});

const mermaidTheme = EditorView.baseTheme({
  ".cm-mermaid": {
    position: "relative",
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
  ".cm-mode-reading .cm-mermaid": { cursor: "zoom-in" },
  ".cm-mermaid svg": { maxWidth: "100%", height: "auto" },
  ".cm-mermaid-toolbar": {
    position: "absolute",
    top: "6px",
    right: "6px",
    display: "flex",
    opacity: "0",
    transition: "opacity 120ms",
    pointerEvents: "none",
  },
  ".cm-mermaid:hover .cm-mermaid-toolbar, .cm-mermaid-toolbar:focus-within": { opacity: "1", pointerEvents: "auto" },
  ".cm-mermaid-toolbar button": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    padding: "0",
    border: "1px solid var(--hc-border)",
    borderRadius: "6px",
    background: "var(--hc-panel)",
    color: "var(--hc-muted)",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
  },
  ".cm-mermaid-toolbar button:hover": { color: "var(--hc-text)", background: "var(--hc-chip)" },
  ".cm-mermaid-toolbar button:focus-visible": { outline: "2px solid var(--hc-accent)", outlineOffset: "1px" },
  ".cm-mermaid-toolbar svg": { width: "16px", height: "16px", maxWidth: "none" },
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
