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
    images.push({ from: match.index, to: match.index + match[0].length, src: source("relative", target), alt, name: imageName(target), width });
  }
  return images.sort((a, b) => a.from - b.from);
}

/** Opens `img` (any image shown in the editor) in the viewer; focus returns to the editor. */
function expandImage(view, img) {
  const src = img.currentSrc || img.src;
  if (!src) return;
  void openImageViewer({
    src,
    name: img.dataset.name || imageName(img.dataset.source || img.getAttribute("alt") || src),
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
    };
    const onMouseLeave = () => hide();
    view.dom.appendChild(floating);
    view.dom.addEventListener("dblclick", onDoubleClick);
    view.dom.addEventListener("click", onClick);
    view.dom.addEventListener("mouseover", onMouseOver);
    view.dom.addEventListener("mouseleave", onMouseLeave);
    view.scrollDOM.addEventListener("scroll", hide, { passive: true });
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
        view.scrollDOM.removeEventListener("scroll", hide);
      },
    };
  }),
  EditorView.baseTheme({
    ".cm-image-frame": { position: "relative", alignSelf: "flex-start", maxWidth: "100%", lineHeight: "0" },
    ".cm-image-frame .cm-image": { display: "block" },
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

class ImageWidget extends WidgetType {
  constructor(images) {
    super();
    this.images = images;
    this.key = images.map((i) => `${i.src}|${i.width}`).join("\n");
  }
  eq(other) {
    return other.key === this.key;
  }
  get estimatedHeight() {
    return 240;
  }
  toDOM(view) {
    const block = document.createElement("div");
    block.className = "cm-image-block";
    for (const image of this.images) {
      const frame = document.createElement("div");
      frame.className = "cm-image-frame";
      const img = document.createElement("img");
      img.className = "cm-image";
      img.src = image.src;
      img.alt = image.alt;
      img.dataset.name = image.name ?? "";
      img.draggable = false;
      if (image.width) img.style.width = `${image.width}px`;
      img.addEventListener("load", () => view.requestMeasure());
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
      block.appendChild(frame);
    }
    return block;
  }
  ignoreEvent() {
    return false;
  }
}

function insideCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

function buildImageWidgets(state) {
  const widgets = [];
  const { doc } = state;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("![")) continue;
    const images = findImages(line.text).filter((image) => !insideCode(state, line.from + image.from));
    if (images.length) {
      widgets.push(Decoration.widget({ widget: new ImageWidget(images), block: true, side: 1 }).range(line.to));
    }
  }
  return Decoration.set(widgets);
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
