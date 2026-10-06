// Inline images: ![[photo.png]], ![[photo.png|300]], ![alt](path.png) and
// ![alt|300](https://…). Each image line gets a block widget below it; the
// raw syntax is hidden by livePreview.js when the cursor isn't on the line.
// Local files load through Holocron's holocron-asset:// scheme, which only
// serves files inside the open vault.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

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

function source(kind, target) {
  if (/^(https?:|data:)/i.test(target)) return target;
  if (!hasNativeBridge) return `/Editor/dev/${target.split("/").pop()}`; // browser dev mode
  return `holocron-asset://${kind}/${encodeURIComponent(target)}?from=${encodeURIComponent(currentNoteId)}`;
}

/** Image references on one line of text, in order. */
export function findImages(text) {
  const images = [];
  for (const match of text.matchAll(EMBED)) {
    images.push({ from: match.index, to: match.index + match[0].length, src: source("embed", match[1]), alt: match[1], width: match[2] ? Number(match[2]) : null });
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
    images.push({ from: match.index, to: match.index + match[0].length, src: source("relative", target), alt, width });
  }
  return images.sort((a, b) => a.from - b.from);
}

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
      const img = document.createElement("img");
      img.className = "cm-image";
      img.src = image.src;
      img.alt = image.alt;
      img.draggable = false;
      if (image.width) img.style.width = `${image.width}px`;
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => {
        const missing = document.createElement("div");
        missing.className = "cm-image-missing";
        missing.textContent = `Image not found: ${image.alt || image.src}`;
        img.replaceWith(missing);
        view.requestMeasure();
      });
      block.appendChild(img);
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
