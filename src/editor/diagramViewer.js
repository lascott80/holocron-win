// Full-window viewer for a rendered diagram (Mermaid's "Expand"): the SVG is
// fitted to the window, then zoomed (Ctrl+wheel, pinch, buttons, keys) and
// panned (wheel, drag, arrows). It lives on document.body, outside the editor,
// so it carries its own stylesheet built from the --hc-* variables.
import { UI_FONT } from "./platform.js";

// ---------- Pure view math (tested) ----------

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** Fitting may enlarge a small diagram, but no more than this. */
export const MAX_FIT_SCALE = 4;

/** Width and height of an SVG string, from its viewBox (else width/height attributes). */
export function svgSize(svg) {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const box = /\bviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*["']/i.exec(root);
  if (box) return { width: Number(box[1]), height: Number(box[2]) };
  const attr = (name) => Number(new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(px)?["']`, "i").exec(root)?.[1]);
  const width = attr("width");
  const height = attr("height");
  return width > 0 && height > 0 ? { width, height } : { width: 0, height: 0 };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The transform that centres content (cw × ch) in a view (vw × vh) with `margin` around it. */
export function fitTransform(contentW, contentH, viewW, viewH, margin = 24, maxScale = MAX_FIT_SCALE) {
  if (!(contentW > 0 && contentH > 0)) return { scale: 1, x: viewW / 2, y: viewH / 2 };
  const room = (size) => Math.max(1, size - 2 * margin);
  const scale = Math.min(room(viewW) / contentW, room(viewH) / contentH, maxScale);
  return { scale, x: (viewW - contentW * scale) / 2, y: (viewH - contentH * scale) / 2 };
}

/** Scales by `factor` (clamped to [min, max]) keeping the point (px, py) of the view still. */
export function zoomAt(transform, factor, px, py, min = MIN_SCALE, max = MAX_SCALE) {
  const scale = clamp(transform.scale * factor, min, max);
  const ratio = scale / transform.scale;
  return { scale, x: px - (px - transform.x) * ratio, y: py - (py - transform.y) * ratio };
}

/** Sets an absolute scale, zooming about the view's centre. */
export function zoomTo(transform, scale, viewW, viewH, min = MIN_SCALE, max = MAX_SCALE) {
  return zoomAt(transform, scale / transform.scale, viewW / 2, viewH / 2, min, max);
}

/** Moves by (dx, dy), keeping at least `keep` px of the content (cw × ch) inside the view. */
export function panBy(transform, dx, dy, contentW, contentH, viewW, viewH, keep = 48) {
  const w = contentW * transform.scale;
  const h = contentH * transform.scale;
  const axis = (value, size, view) => {
    const min = Math.min(keep - size, view - keep);
    return clamp(value, min, Math.max(min, view - keep));
  };
  return { scale: transform.scale, x: axis(transform.x + dx, w, viewW), y: axis(transform.y + dy, h, viewH) };
}

/** Wheel delta in pixels (line and page modes are converted). */
export function wheelPixels(delta, deltaMode, pageSize = 800) {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * pageSize : delta;
}

/**
 * Zoom factor for a Ctrl+wheel delta. Chromium reports a touchpad pinch as
 * Ctrl+wheel with scale = e^(−deltaY/100), so pinches track the fingers;
 * a mouse notch (deltaY ≈ 100) is capped at 1.25×.
 */
export function wheelZoomFactor(deltaY) {
  return clamp(Math.exp(-deltaY / 100), 1 / 1.25, 1.25);
}

// ---------- Overlay ----------

const STYLE_ID = "hc-diagram-viewer-style";
const CSS = `
.hc-diagram-viewer {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  display: flex; padding: 24px; box-sizing: border-box;
  font-family: ${UI_FONT}; font-size: 13px; color: var(--hc-text, #D8DBE0);
  animation: hc-diagram-viewer-in 120ms ease-out;
}
.hc-diagram-viewer.is-closing { animation: hc-diagram-viewer-out 120ms ease-in forwards; }
@keyframes hc-diagram-viewer-in { from { opacity: 0; } }
@keyframes hc-diagram-viewer-out { to { opacity: 0; } }
.hc-diagram-viewer-panel {
  position: relative; flex: 1; min-width: 0; min-height: 0;
  background: var(--hc-bg, #0F1115);
  border: 1px solid var(--hc-border, #23272F);
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25);
  outline: none;
}
.hc-diagram-viewer-stage { position: absolute; inset: 0; cursor: grab; touch-action: none; user-select: none; }
.hc-diagram-viewer-stage.is-dragging { cursor: grabbing; }
.hc-diagram-viewer-content { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.hc-diagram-viewer-content.is-animating { transition: transform 120ms ease-out; }
.hc-diagram-viewer-content svg { display: block; max-width: none !important; }
.hc-diagram-viewer-toolbar {
  position: absolute; top: 12px; right: 12px; display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: 8px;
  background: var(--hc-panel, #1A1D23); border: 1px solid var(--hc-border, #23272F);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.hc-diagram-viewer-toolbar button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; min-width: 28px; padding: 0 6px; border: 0; border-radius: 6px;
  background: transparent; color: var(--hc-text, #D8DBE0);
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.hc-diagram-viewer-toolbar button:hover { background: var(--hc-chip, #1E222A); }
.hc-diagram-viewer-toolbar button:focus-visible { outline: 2px solid var(--hc-accent, #5AB4FF); outline-offset: -2px; }
.hc-diagram-viewer-toolbar button svg { width: 16px; height: 16px; flex: none; }
.hc-diagram-viewer-toolbar .hc-diagram-viewer-percent { min-width: 52px; font-variant-numeric: tabular-nums; }
.hc-diagram-viewer-toolbar .hc-diagram-viewer-copy { min-width: 112px; justify-content: flex-start; }
.hc-diagram-viewer-toolbar .is-done { color: var(--hc-synced, #3DD68C); }
.hc-diagram-viewer-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--hc-border, #23272F); }
.hc-diagram-viewer-hint {
  position: absolute; left: 16px; bottom: 12px; pointer-events: none;
  color: var(--hc-muted, #8A919D); font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .hc-diagram-viewer, .hc-diagram-viewer.is-closing { animation: none; }
  .hc-diagram-viewer-content.is-animating { transition: none; }
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const icon = (paths) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  expand: icon('<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/>'),
  minus: icon('<path d="M3.5 8h9"/>'),
  plus: icon('<path d="M3.5 8h9M8 3.5v9"/>'),
  fit: icon('<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/>'),
  copy: icon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5"/>'),
  check: icon('<path d="M3 8.5 6.5 12 13 4.5"/>'),
  close: icon('<path d="M4 4l8 8M12 4l-8 8"/>'),
};

const FIT_TOP = 36;
const FIT_BOTTOM = 16;
const FIT_SIDE = 28;

let openViewer = null;

/** Whether a viewer is open (for tests and smoke scripts). */
export function isDiagramViewerOpen() {
  return openViewer !== null;
}

/**
 * Opens the viewer on `svg` (a rendered SVG string). `copyImage()` resolves to
 * a PNG Blob for the "Copy image" button; `returnFocus` gets focus back on close.
 */
export function openDiagramViewer({ svg, copyImage, returnFocus, label = "Diagram" }) {
  openViewer?.close(true);
  injectStyle();
  const previous = document.activeElement;
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const root = document.createElement("div");
  root.className = "hc-diagram-viewer";
  root.addEventListener("mousedown", (event) => event.stopPropagation());
  const panel = document.createElement("div");
  panel.className = "hc-diagram-viewer-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", label);
  panel.tabIndex = -1;
  const stage = document.createElement("div");
  stage.className = "hc-diagram-viewer-stage";
  const content = document.createElement("div");
  content.className = "hc-diagram-viewer-content";
  content.innerHTML = svg; // already sanitised by Mermaid
  const svgElement = content.querySelector("svg");
  const size = svgSize(svg);
  if (svgElement && size.width > 0) {
    // Draw at the diagram's own size; the wrapper's transform does the scaling.
    svgElement.setAttribute("width", String(size.width));
    svgElement.setAttribute("height", String(size.height));
    svgElement.style.maxWidth = "none";
    svgElement.style.width = `${size.width}px`;
    svgElement.style.height = `${size.height}px`;
  }
  stage.appendChild(content);

  const toolbar = document.createElement("div");
  toolbar.className = "hc-diagram-viewer-toolbar";
  toolbar.setAttribute("role", "toolbar");
  const button = (html, title, onClick, className = "") => {
    const element = document.createElement("button");
    element.type = "button";
    element.innerHTML = html;
    element.title = title;
    element.setAttribute("aria-label", title.replace(/ \(.*\)$/, ""));
    if (className) element.className = className;
    element.addEventListener("click", onClick);
    toolbar.appendChild(element);
    return element;
  };
  const separator = () => toolbar.appendChild(Object.assign(document.createElement("div"), { className: "hc-diagram-viewer-sep" }));

  const hint = document.createElement("div");
  hint.className = "hc-diagram-viewer-hint";
  hint.textContent = "Scroll to pan · Ctrl+scroll to zoom · Esc to close";

  panel.append(stage, toolbar, hint);
  root.appendChild(panel);

  // ----- View state -----
  let transform = { scale: 1, x: 0, y: 0 };
  let fitted = true; // refit on resize until the user zooms or pans
  const view = () => ({ width: stage.clientWidth, height: stage.clientHeight });
  // Fitting leaves room for the toolbar above and the hint below.
  const fitView = () => {
    const { width, height } = view();
    const t = fitTransform(size.width, size.height, width, height - FIT_TOP - FIT_BOTTOM, FIT_SIDE);
    return { ...t, y: t.y + FIT_TOP };
  };
  const fitScale = () => fitView().scale;
  const minScale = () => Math.min(MIN_SCALE * 2, fitScale());
  const apply = (next, animate = false) => {
    transform = next;
    content.classList.toggle("is-animating", animate && !reduceMotion);
    content.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    percent.textContent = `${Math.round(transform.scale * 100)}%`;
  };
  const fit = (animate = false) => {
    fitted = true;
    apply(fitView(), animate);
  };
  const zoom = (factor, x, y, animate = false) => {
    fitted = false;
    apply(zoomAt(transform, factor, x, y, minScale(), MAX_SCALE), animate);
  };
  const zoomCentre = (factor) => {
    const { width, height } = view();
    zoom(factor, width / 2, height / 2, true);
  };
  const actualSize = () => {
    const { width, height } = view();
    fitted = false;
    // 100% about the centre of what's visible, so the current spot stays put.
    apply(zoomTo(transform, 1, width, height, minScale(), MAX_SCALE), true);
  };
  const pan = (dx, dy, animate = false) => {
    const { width, height } = view();
    fitted = false;
    apply(panBy(transform, dx, dy, size.width, size.height, width, height), animate);
  };

  button(ICONS.minus, "Zoom out (−)", () => zoomCentre(1 / 1.25));
  const percent = button("100%", "Actual size (1)", actualSize, "hc-diagram-viewer-percent");
  button(ICONS.plus, "Zoom in (+)", () => zoomCentre(1.25));
  button(ICONS.fit, "Fit to window (0)", () => fit(true));
  separator();
  const copyButton = button(`${ICONS.copy}<span>Copy image</span>`, "Copy image", () => void copy(), "hc-diagram-viewer-copy");
  separator();
  button(ICONS.close, "Close (Esc)", () => close());
  toolbar.title = "Scroll to pan · Ctrl+scroll or pinch to zoom · Drag to move";

  let copyTimer = 0;
  const copy = async () => {
    const label = copyButton.querySelector("span");
    const done = (text, ok) => {
      copyButton.innerHTML = `${ok ? ICONS.check : ICONS.copy}<span>${text}</span>`;
      copyButton.classList.toggle("is-done", ok);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyButton.innerHTML = `${ICONS.copy}<span>Copy image</span>`;
        copyButton.classList.remove("is-done");
      }, 1200);
    };
    if (label) label.textContent = "Copying…";
    try {
      const blob = await copyImage();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      done("Copied", true);
    } catch (error) {
      console.warn("Copy image failed:", error);
      done("Couldn’t copy", false);
    }
  };

  // ----- Pointer: drag to pan, double-click to zoom -----
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    pan(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (event) => {
    const box = stage.getBoundingClientRect();
    zoom(2, event.clientX - box.left, event.clientY - box.top, true);
  });

  // ----- Wheel: pan; Ctrl+wheel (and touchpad pinch, which sets ctrlKey) zooms at the cursor -----
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const { height } = view();
    let dx = wheelPixels(event.deltaX, event.deltaMode, height);
    let dy = wheelPixels(event.deltaY, event.deltaMode, height);
    if (event.ctrlKey || event.metaKey) {
      const box = stage.getBoundingClientRect();
      zoom(wheelZoomFactor(dy), event.clientX - box.left, event.clientY - box.top);
      return;
    }
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0];
    pan(-dx, -dy);
  }, { passive: false });

  // ----- Keyboard -----
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      // Trap focus: cycle through the toolbar.
      const items = [...toolbar.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
      event.preventDefault();
      items[next].focus();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 200 : 60;
    const actions = {
      "+": () => zoomCentre(1.25),
      "=": () => zoomCentre(1.25),
      "-": () => zoomCentre(1 / 1.25),
      "_": () => zoomCentre(1 / 1.25),
      "0": () => fit(true),
      "1": actualSize,
      ArrowLeft: () => pan(step, 0, true),
      ArrowRight: () => pan(-step, 0, true),
      ArrowUp: () => pan(0, step, true),
      ArrowDown: () => pan(0, -step, true),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  // Clicking the dimmed backdrop closes.
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  // ----- Window listeners (removed on close) -----
  const onResize = () => {
    if (fitted) fit();
    else apply(transform);
  };
  const onFocusIn = (event) => {
    if (!root.contains(event.target)) panel.focus();
  };
  // Keys typed while focus is (briefly) elsewhere still belong to the viewer.
  const onKeyDown = (event) => {
    if (!root.contains(event.target) && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  window.addEventListener("resize", onResize);
  document.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("keydown", onKeyDown, true);

  let closed = false;
  function close(immediate = false) {
    if (closed) return;
    closed = true;
    openViewer = null;
    clearTimeout(copyTimer);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("focusin", onFocusIn, true);
    window.removeEventListener("keydown", onKeyDown, true);
    const remove = () => root.remove();
    if (immediate || reduceMotion) remove();
    else {
      root.classList.add("is-closing");
      root.style.pointerEvents = "none";
      setTimeout(remove, 120);
    }
    if (immediate) return;
    if (returnFocus) returnFocus(previous);
    else if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }

  document.body.appendChild(root);
  fit();
  panel.focus();
  openViewer = { close };
  return { close };
}
