// Inline images: ![[photo.png]], ![[photo.png|300]], ![alt](path.png) and
// ![alt|300](https://…). Each image line gets a block widget below it; the
// raw syntax is hidden by livePreview.js when the cursor isn't on the line.
// Local files load through Holocron's holocron-asset:// scheme, which only
// serves files inside the open vault. Any image in a note (HTML <img> too)
// opens in the full-window viewer: its Expand button, a double-click, or a
// click in reading view.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { ICONS, openImageViewer } from "./diagramViewer.js";

const IMAGE_EXT = "png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif";
const EMBED = new RegExp(`!\\[\\[([^\\[\\]|#^\\n]+?\\.(?:${IMAGE_EXT}))(?:\\|(\\d+)(?:x(\\d+))?)?\\]\\]`, "gi");
const EMBED_INNER = new RegExp(`^[^\\[\\]|#^\\n]+?\\.(?:${IMAGE_EXT})(?:\\|\\d+(?:x\\d+)?)?$`, "i");

/** Whether the inside of ![[…]] is an image this module renders. */
export function isImageEmbed(inner) {
  return EMBED_INNER.test(inner);
}
const MARKDOWN =/!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

let currentNoteId = "";
const hasNativeBridge = Boolean(globalThis.window?.webkit?.messageHandlers?.holocron || globalThis.window?.holocronHost);

/** The open note's id (its file path). */
export function currentNote() {
  return currentNoteId;
}

/** Called by setDocument so relative image paths resolve against the note. */
export function setImageContext(noteId) {
  currentNoteId = noteId ?? "";
}

/**
 * The URL a file is loaded from: http(s)/data URLs as they are, vault files
 * through holocron-asset://<kind>/<target>?from=<note> (kind "embed" for
 * ![[name]], "relative" for paths in ![](path) and HTML src attributes).
 */
export function assetSource(kind, target) {
  if (/^(https?:|data:)/i.test(target)) return target;
  if (!hasNativeBridge) return `/Editor/dev/${target.split("/").pop()}`; // browser dev mode
  return `holocron-asset://${kind}/${encodeURIComponent(target)}?from=${encodeURIComponent(currentNoteId)}`;
}
const source = assetSource;

/** Local audio, video and PDF files are rendered by media.js, not as images. */
const MEDIA_TARGET = /^(?![a-z][a-z0-9+.-]*:)[^?#]*\.(mp4|webm|mov|m4v|ogv|mp3|wav|m4a|ogg|flac|aac|opus|pdf)([?#].*)?$/i;

/** The file name in a path or URL, for the viewer's title: "Attachments/a b.png" → "a b.png". */
export function imageName(target) {
  const path = String(target ?? "").split(/[?#]/)[0].replace(/\/+$/, "");
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Image references on one line of text, in order. */
export function findImages(text) {
  const images = [];
  for (const match of text.matchAll(EMBED)) {
    images.push({
      from: match.index,
      to: match.index + match[0].length,
      src: source("embed", match[1]),
      alt: match[1],
      name: imageName(match[1]),
      width: match[2] ? Number(match[2]) : null,
    });
  }
  for (const match of text.matchAll(MARKDOWN)) {
    let alt = match[1];
    let width = null;
    const sized = /^(.*)\|(\d+)(?:x\d+)?$/.exec(alt);
    if (sized) {
      alt = sized[1];
      width = Number(sized[2]);
    }
    let target = match[2];
    try {
      target = decodeURI(target);
    } catch {}
    if (MEDIA_TARGET.test(target)) continue;
    const name = imageName(target);
    // Alt text that says something (not just the file name) is shown as a caption.
    const caption = alt.trim() && alt.trim() !== name && alt.trim() !== target ? alt.trim() : null;
    images.push({ from: match.index, to: match.index + match[0].length, src: source("relative", target), alt, name, caption, width });
  }
  return images.sort((a, b) => a.from - b.from);
}

/** A URL as the browser writes it, so an <img>'s src compares with assetSource's. */
function normalUrl(url) {
  const a = document.createElement("a");
  a.href = url;
  return a.href;
}

/**
 * Opens `img` (any image shown in the editor) in the viewer; focus returns
 * to the editor. ← and → step through the note's other images.
 */
function expandImage(view, img) {
  const src = img.currentSrc || img.src;
  if (!src) return;
  const name = img.dataset.name || imageName(img.dataset.source || img.getAttribute("alt") || src);
  const all = noteImages(view.state).map((image) => ({ src: image.src, name: image.name }));
  const index = all.findIndex((image) => normalUrl(image.src) === normalUrl(src));
  const items = index >= 0 ? all : [{ src, name }];
  void openImageViewer({
    items,
    index: Math.max(0, index),
    returnFocus(previous) {
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus();
      else view.focus();
    },
  });
}

/** The image under a pointer event, if it's one this note shows (not a diagram or a toolbar). */
function imageAt(event, view) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || target.closest(".cm-editor") !== view.dom) return null;
  if (target.closest(".cm-mermaid, .cm-image-toolbar") || !target.complete || target.naturalWidth === 0) return null;
  return target;
}

const readOnly = (view) => view.state.readOnly || !view.state.facet(EditorView.editable);

/**
 * Expand buttons, double-click, and click in reading view open images in the
 * viewer. Listens on the editor's DOM directly: widgets such as html.js's
 * ignore events, so CodeMirror's own handlers never see clicks on their images.
 */
export const imageViewer = [
  ViewPlugin.define((view) => {
    const onDoubleClick = (event) => {
      const img = imageAt(event, view);
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      expandImage(view, img);
    };
    // Reading view and embeds can't edit, so a click is enough there.
    const onClick = (event) => {
      if (event.button !== 0 || !readOnly(view)) return;
      const img = imageAt(event, view);
      if (!img || img.closest("a")) return;
      event.preventDefault();
      event.stopPropagation();
      expandImage(view, img);
    };
    // Images without their own Enlarge button (HTML <img>, which a click
    // would open for editing) get a floating one while hovered.
    const floating = document.createElement("div");
    floating.className = "cm-image-float";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = ICONS.expand;
    button.title = "Enlarge image";
    button.setAttribute("aria-label", "Enlarge image");
    floating.appendChild(button);
    let hovered = null;
    const hide = () => {
      hovered = null;
      floating.classList.remove("is-shown");
    };
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const img = hovered;
      hide();
      if (img?.isConnected) expandImage(view, img);
    });
    const onMouseOver = (event) => {
      if (floating.contains(event.target)) return;
      const img = imageAt(event, view);
      if (!img) {
        hide();
        return;
      }
      if (img.closest(".cm-image-frame")) {
        if (!img.title) img.title = readOnly(view) ? "Click to enlarge" : "Double-click to enlarge";
        return;
      }
      if (readOnly(view) && !img.title) img.title = "Click to enlarge";
      hovered = img;
      const box = img.getBoundingClientRect();
      const host = view.dom.getBoundingClientRect();
      floating.style.top = `${box.top - host.top + 6}px`;
      floating.style.left = `${box.right - host.left - 34}px`;
      floating.classList.add("is-shown");
      shownAt = view.scrollDOM.scrollTop;
    };
    const onMouseLeave = () => hide();
    view.dom.appendChild(floating);
    view.dom.addEventListener("dblclick", onDoubleClick);
    view.dom.addEventListener("click", onClick);
    view.dom.addEventListener("mouseover", onMouseOver);
    view.dom.addEventListener("mouseleave", onMouseLeave);
    // Only a real scroll hides it, not the editor nudging its scroll position while measuring.
    let shownAt = 0;
    const onScroll = () => {
      if (Math.abs(view.scrollDOM.scrollTop - shownAt) > 4) hide();
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return {
      update(update) {
        if (update.docChanged || update.geometryChanged) hide();
      },
      destroy() {
        floating.remove();
        view.dom.removeEventListener("dblclick", onDoubleClick);
        view.dom.removeEventListener("click", onClick);
        view.dom.removeEventListener("mouseover", onMouseOver);
        view.dom.removeEventListener("mouseleave", onMouseLeave);
        view.scrollDOM.removeEventListener("scroll", onScroll);
      },
    };
  }),
  EditorView.baseTheme({
    ".cm-image-frame": { position: "relative", alignSelf: "flex-start", maxWidth: "100%", lineHeight: "0" },
    ".cm-image-frame .cm-image": { display: "block", transition: "filter 150ms" },
    ".cm-image-caption": {
      lineHeight: "1.4",
      padding: "6px 2px 0",
      fontSize: "0.86em",
      color: "var(--hc-muted)",
      textAlign: "center",
    },
    // Galleries: consecutive image-only lines (or several images on one line).
    ".cm-image-block.cm-image-gallery": { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "8px" },
    ".cm-image-block.cm-image-gallery .cm-image-frame": { alignSelf: "stretch" },
    ".cm-image-block.cm-image-gallery .cm-image": { width: "100%", height: "170px", objectFit: "cover", borderRadius: "6px" },
    ".cm-image-gallery .cm-image-caption": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    // Resize handle (live preview only).
    ".cm-image-resize": {
      position: "absolute",
      right: "-5px",
      bottom: "-5px",
      width: "14px",
      height: "14px",
      borderRadius: "4px",
      border: "2px solid var(--hc-accent)",
      background: "var(--hc-bg)",
      cursor: "nwse-resize",
      opacity: "0",
      transition: "opacity 120ms",
      touchAction: "none",
    },
    ".cm-image-frame:has(.cm-image-caption) .cm-image-resize": { bottom: "calc(1.4em + 6px - 5px)" },
    ".cm-image-frame:hover .cm-image-resize, .cm-image-resize.is-dragging": { opacity: "1" },
    "&.cm-mode-reading .cm-image-resize": { display: "none" },
    // Settings › Images in dark themes. Hovering shows the image as it is.
    ":root.hc-dark.hc-images-dim & .cm-content img:not(:hover)": { filter: "brightness(0.78) contrast(1.06)" },
    ":root.hc-dark.hc-images-invert & .cm-content img.cm-image-light:not(:hover)": { filter: "invert(0.92) hue-rotate(180deg)" },
    ".cm-mode-reading .cm-content img": { cursor: "zoom-in" },
    ".cm-image-toolbar": {
      position: "absolute",
      top: "6px",
      right: "6px",
      display: "flex",
      opacity: "0",
      transition: "opacity 120ms",
      pointerEvents: "none",
    },
    ".cm-image-frame:hover .cm-image-toolbar, .cm-image-toolbar:focus-within": { opacity: "1", pointerEvents: "auto" },
    ".cm-image-float": { position: "absolute", zIndex: "5", display: "flex", opacity: "0", transition: "opacity 120ms", pointerEvents: "none" },
    ".cm-image-float.is-shown, .cm-image-float:focus-within": { opacity: "1", pointerEvents: "auto" },
    ".cm-image-toolbar button, .cm-image-float button": {
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
    ".cm-image-toolbar button:hover, .cm-image-float button:hover": { color: "var(--hc-text)", background: "var(--hc-chip)" },
    ".cm-image-toolbar button:focus-visible, .cm-image-float button:focus-visible": { outline: "2px solid var(--hc-accent)", outlineOffset: "1px" },
    ".cm-image-toolbar svg, .cm-image-float svg": { width: "16px", height: "16px", maxWidth: "none" },
  }),
];

/**
 * An image's markdown with its display width set (or removed with null):
 * "![[a.png]]" → "![[a.png|300]]", "![Alt](a.png)" → "![Alt|300](a.png)".
 */
export function withImageWidth(syntax, width) {
  const size = width ? `|${Math.round(width)}` : "";
  const embed = /^!\[\[([^\]|]+?)(?:\|\d+(?:x\d+)?)?\]\]$/.exec(syntax);
  if (embed) return `![[${embed[1]}${size}]]`;
  const markdown = /^!\[([^\]\n]*)\](\(.*\))$/.exec(syntax);
  if (!markdown) return syntax;
  return `![${markdown[1].replace(/\|\d+(?:x\d+)?$/, "")}${size}]${markdown[2]}`;
}

// ---------- Light images (Settings › Images in dark themes › Invert light ones) ----------

/** src → whether the image is mostly white or transparent (a screenshot or diagram), once worked out. */
const lightImages = new Map();

/** Whether pixel data (RGBA) is mostly white or transparent: what glares on a dark background. */
export function isMostlyLight(data) {
  let light = 0;
  let luminance = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    // Transparent pixels show the page behind; on a dark theme dark ink there vanishes, so count them as light.
    const lum = alpha < 0.1 ? 1 : (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    luminance += lum;
    if (lum > 0.85) light++;
  }
  return pixels > 0 && light / pixels > 0.6 && luminance / pixels > 0.7;
}

async function classifyLight(img, src) {
  if (lightImages.has(src)) {
    img.classList.toggle("cm-image-light", lightImages.get(src));
    return;
  }
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: 24, resizeHeight: 24, resizeQuality: "low" });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, 24, 24);
    bitmap.close?.();
    const light = isMostlyLight(context.getImageData(0, 0, 24, 24).data);
    lightImages.set(src, light);
    img.classList.toggle("cm-image-light", light);
  } catch {
    lightImages.set(src, false); // remote images without CORS: leave them alone
  }
}

// ---------- Widget ----------

const MIN_WIDTH = 48;

class ImageWidget extends WidgetType {
  /** `images` carry `lineOffset` (lines before the widget's line) and `index` (among findImages on that line). */
  constructor(images, gallery) {
    super();
    this.images = images;
    this.gallery = gallery;
    this.key = `${gallery}\n` + images.map((i) => `${i.src}|${i.width}|${i.caption ?? ""}|${i.lineOffset}|${i.index}`).join("\n");
  }
  eq(other) {
    return other.key === this.key;
  }
  get estimatedHeight() {
    return this.gallery ? 180 * Math.ceil(this.images.length / 3) : 240 * this.images.length;
  }
  toDOM(view) {
    const block = document.createElement("div");
    block.className = this.gallery ? "cm-image-block cm-image-gallery" : "cm-image-block";
    for (const image of this.images) {
      const frame = document.createElement("div");
      frame.className = "cm-image-frame";
      const img = document.createElement("img");
      img.className = "cm-image";
      img.src = image.src;
      img.alt = image.alt;
      img.dataset.name = image.name ?? "";
      img.draggable = false;
      if (image.width && !this.gallery) img.style.width = `${image.width}px`;
      img.addEventListener("load", () => {
        view.requestMeasure();
        void classifyLight(img, image.src);
      });
      img.addEventListener("error", () => {
        const missing = document.createElement("div");
        missing.className = "cm-image-missing";
        missing.textContent = `Image not found: ${image.alt || image.src}`;
        frame.replaceWith(missing);
        view.requestMeasure();
      });
      const toolbar = document.createElement("div");
      toolbar.className = "cm-image-toolbar";
      const expand = document.createElement("button");
      expand.type = "button";
      expand.innerHTML = ICONS.expand;
      expand.title = "Enlarge image";
      expand.setAttribute("aria-label", "Enlarge image");
      // Keep the editor from seeing the press (it would move the cursor).
      expand.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      expand.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        expandImage(view, img);
      });
      toolbar.appendChild(expand);
      frame.append(img, toolbar);
      if (image.caption) {
        const caption = document.createElement("div");
        caption.className = "cm-image-caption";
        caption.textContent = image.caption;
        frame.appendChild(caption);
      }
      if (!this.gallery) frame.appendChild(this.resizeHandle(view, block, img, image));
      block.appendChild(frame);
    }
    return block;
  }
  /** Dragging the corner sets the image's width in the note; double-clicking it goes back to the natural size. */
  resizeHandle(view, block, img, image) {
    const handle = document.createElement("div");
    handle.className = "cm-image-resize";
    handle.title = "Drag to resize · Double-click for the original size";
    let drag = null;
    const editable = () => !view.state.readOnly && view.state.facet(EditorView.editable);
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !editable()) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, width: img.getBoundingClientRect().width, max: block.getBoundingClientRect().width };
      handle.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const width = Math.min(drag.max, Math.max(MIN_WIDTH, drag.width + event.clientX - drag.x));
      img.style.width = `${Math.round(width)}px`;
      drag.result = width;
    });
    const end = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { result } = drag;
      drag = null;
      handle.classList.remove("is-dragging");
      if (result) setImageWidth(view, block, image, result);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (editable()) setImageWidth(view, block, image, null);
    });
    return handle;
  }
  ignoreEvent() {
    return false;
  }
}

/** Writes an image's new width into the note (one undoable change). */
function setImageWidth(view, block, image, width) {
  const { doc } = view.state;
  let line;
  try {
    line = doc.line(doc.lineAt(view.posAtDOM(block)).number + image.lineOffset);
  } catch {
    return;
  }
  const found = findImages(line.text)[image.index];
  if (!found) return;
  const syntax = line.text.slice(found.from, found.to);
  const insert = withImageWidth(syntax, width);
  if (insert === syntax) return;
  view.dispatch({ changes: { from: line.from + found.from, to: line.from + found.to, insert }, userEvent: "input.resize" });
}

function insideCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

/** A line's images outside code, each with its index among all of findImages' results. */
function lineImages(state, line) {
  if (!line.text.includes("![")) return [];
  return findImages(line.text)
    .map((image, index) => ({ ...image, index }))
    .filter((image) => !insideCode(state, line.from + image.from));
}

/** Whether a line holds nothing but its images (and spaces). */
function onlyImages(text, images) {
  let rest = text;
  for (const image of [...images].sort((a, b) => b.from - a.from)) rest = rest.slice(0, image.from) + rest.slice(image.to);
  return rest.trim() === "";
}

/**
 * One widget per line with images, below it; consecutive lines holding only
 * images (or a line with several) become one gallery below the last of them.
 */
function buildImageWidgets(state) {
  const widgets = [];
  const { doc } = state;
  let run = []; // consecutive image-only lines: { number, images }
  const flush = () => {
    if (!run.length) return;
    const last = run[run.length - 1];
    const images = run.flatMap(({ number, images }) => images.map((image) => ({ ...image, lineOffset: number - last.number })));
    widgets.push(Decoration.widget({ widget: new ImageWidget(images, images.length > 1), block: true, side: 1 }).range(doc.line(last.number).to));
    run = [];
  };
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const images = lineImages(state, line);
    if (!images.length) {
      flush();
      continue;
    }
    if (onlyImages(line.text, images)) {
      run.push({ number: n, images });
      continue;
    }
    flush();
    run.push({ number: n, images });
    flush();
  }
  flush();
  return Decoration.set(widgets);
}

/** Every image in the note outside code, in order: what the viewer steps through. */
export function noteImages(state) {
  const images = [];
  for (let n = 1; n <= state.doc.lines; n++) images.push(...lineImages(state, state.doc.line(n)));
  return images;
}

export const inlineImages = StateField.define({
  create: buildImageWidgets,
  update(value, transaction) {
    return transaction.docChanged ? buildImageWidgets(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Pasting image data (e.g. a screenshot) hands it to Holocron to save. */
export function imagePaste(onImage) {
  return EditorView.domEventHandlers({
    paste(event) {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      if (!files.length) return false;
      event.preventDefault();
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = String(reader.result).split(",")[1] ?? "";
          onImage({ name: file.name, mime: file.type, data: base64 });
        };
        reader.readAsDataURL(file);
      }
      return true;
    },
  });
}
