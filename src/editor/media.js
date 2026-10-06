// Audio, video and PDF embeds: ![[clip.mp4]], ![[song.mp3]], ![[paper.pdf]],
// ![[paper.pdf#page=3]] and the markdown form ![](clip.mp4). Like images,
// each line gets a block widget below it and livePreview.js hides the syntax
// when the cursor isn't on the line. Files load through the vault-confined
// holocron-asset:// scheme, which answers Range requests so players can seek.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { assetSource } from "./images.js";
import { modKey, UI_FONT } from "./platform.js";

const VIDEO_EXT = "mp4|webm|mov|m4v|ogv";
const AUDIO_EXT = "mp3|wav|m4a|ogg|flac|aac|opus";
const PDF_EXT = "pdf";
const MEDIA_EXT = `${VIDEO_EXT}|${AUDIO_EXT}|${PDF_EXT}`;

const EMBED = new RegExp(`!\\[\\[([^\\[\\]|#^\\n]+?\\.(?:${MEDIA_EXT}))(#[^\\[\\]|\\n]*)?(?:\\|([^\\[\\]\\n]*))?\\]\\]`, "gi");
const EMBED_INNER = new RegExp(`^[^\\[\\]|#^\\n]+?\\.(?:${MEDIA_EXT})(?:#[^\\[\\]|\\n]*)?(?:\\|[^\\[\\]\\n]*)?$`, "i");
const MARKDOWN = /!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
const LOCAL_MEDIA = new RegExp(`^(?![a-z][a-z0-9+.-]*:)([^?#]*\\.(?:${MEDIA_EXT}))(#.*)?$`, "i");

/** "video", "audio" or "pdf" for a file name, or null. */
export function mediaKind(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (new RegExp(`^(?:${VIDEO_EXT})$`).test(ext)) return "video";
  if (new RegExp(`^(?:${AUDIO_EXT})$`).test(ext)) return "audio";
  if (ext === PDF_EXT) return "pdf";
  return null;
}

/** Whether the inside of ![[…]] is audio, video or a PDF this module renders. */
export function isMediaEmbed(inner) {
  return EMBED_INNER.test(inner);
}

/** "#page=3" → 3 (PDF embeds), else null. */
export function pdfPage(fragment) {
  const page = /(?:^#|&)page=(\d+)/i.exec(fragment ?? "");
  return page ? Number(page[1]) : null;
}

/**
 * Media references on one line of text, in order: { from, to, kind, target,
 * linkKind ("embed" or "relative"), name, page, width }.
 */
export function findMedia(text) {
  const found = [];
  for (const match of text.matchAll(EMBED)) {
    const target = match[1].trim();
    const size = /^(\d+)(?:x\d+)?$/.exec(match[3]?.trim() ?? "");
    found.push({
      from: match.index,
      to: match.index + match[0].length,
      kind: mediaKind(target),
      target,
      linkKind: "embed",
      name: target.split("/").pop(),
      page: pdfPage(match[2]),
      width: size ? Number(size[1]) : null,
    });
  }
  for (const match of text.matchAll(MARKDOWN)) {
    let raw = match[2];
    try {
      raw = decodeURI(raw);
    } catch {}
    const local = LOCAL_MEDIA.exec(raw);
    if (!local) continue;
    const size = /\|(\d+)(?:x\d+)?$/.exec(match[1]);
    found.push({
      from: match.index,
      to: match.index + match[0].length,
      kind: mediaKind(local[1]),
      target: local[1],
      linkKind: "relative",
      name: (match[1].replace(/\|\d+(?:x\d+)?$/, "") || local[1].split("/").pop()),
      page: pdfPage(local[2]),
      width: size ? Number(size[1]) : null,
    });
  }
  return found.sort((a, b) => a.from - b.from);
}

// ---------- Widget ----------

function missing(name) {
  const box = document.createElement("div");
  box.className = "cm-image-missing cm-media-missing";
  box.textContent = `File not found: ${name}`;
  return box;
}

function playerFor(item, view) {
  const player = document.createElement(item.kind);
  player.className = `cm-media-${item.kind}`;
  player.controls = true;
  player.preload = "metadata";
  player.src = assetSource(item.linkKind, item.target);
  if (item.width && item.kind === "video") player.style.width = `${item.width}px`;
  player.addEventListener("loadedmetadata", () => view.requestMeasure());
  player.addEventListener("error", () => {
    // A load failure (missing file, unknown format) leaves a dead player behind.
    if (!player.error || player.readyState > 0) return;
    player.replaceWith(missing(item.name));
    view.requestMeasure();
  });
  return player;
}

function pdfViewer(item, view, open) {
  const box = document.createElement("div");
  box.className = "cm-media-pdf";
  const header = document.createElement("div");
  header.className = "cm-media-pdf-header";
  const icon = document.createElement("span");
  icon.className = "cm-media-pdf-icon";
  icon.textContent = "PDF";
  const name = document.createElement("span");
  name.className = "cm-media-pdf-name";
  name.textContent = item.name + (item.page ? ` · page ${item.page}` : "");
  const button = document.createElement("button");
  button.className = "cm-media-pdf-open";
  button.type = "button";
  button.textContent = "Open";
  button.title = "Open in the default app";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open(item.target, modKey(event));
  });
  header.append(icon, name, button);
  box.appendChild(header);

  const src = assetSource(item.linkKind, item.target);
  const frame = document.createElement("iframe");
  frame.className = "cm-media-pdf-frame";
  frame.title = item.name;
  frame.src = src + (item.page ? `#page=${item.page}` : "");
  box.appendChild(frame);

  // A cross-origin frame can't report a missing file; ask the scheme first.
  fetch(src, { method: "HEAD" })
    .then((response) => {
      if (response.ok) return;
      box.replaceWith(missing(item.name));
      view.requestMeasure();
    })
    .catch(() => {});
  return box;
}

class MediaWidget extends WidgetType {
  constructor(items, open) {
    super();
    this.items = items;
    this.open = open;
    this.key = items.map((i) => `${i.kind}|${i.linkKind}|${i.target}|${i.page}|${i.width}|${assetSource(i.linkKind, i.target)}`).join("\n");
  }
  eq(other) {
    return other.key === this.key;
  }
  get estimatedHeight() {
    return this.items.some((i) => i.kind === "pdf") ? 640 : this.items.some((i) => i.kind === "video") ? 320 : 60;
  }
  toDOM(view) {
    const block = document.createElement("div");
    block.className = "cm-media-block";
    for (const item of this.items) {
      block.appendChild(item.kind === "pdf" ? pdfViewer(item, view, this.open) : playerFor(item, view));
    }
    return block;
  }
  ignoreEvent() {
    return true; // players and the PDF viewer handle their own clicks
  }
}

function insideCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

function buildMedia(state, open) {
  const widgets = [];
  const { doc } = state;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("![")) continue;
    const items = findMedia(line.text).filter((item) => !insideCode(state, line.from + item.from));
    if (items.length) {
      widgets.push(Decoration.widget({ widget: new MediaWidget(items, open), block: true, side: 1 }).range(line.to));
    }
  }
  return Decoration.set(widgets);
}

const mediaTheme = EditorView.baseTheme({
  ".cm-media-block": { display: "flex", flexDirection: "column", gap: "8px", padding: "6px 0 10px" },
  ".cm-media-video": { maxWidth: "100%", maxHeight: "70vh", borderRadius: "6px", alignSelf: "flex-start", backgroundColor: "#000" },
  ".cm-media-audio": { width: "100%", maxWidth: "520px", height: "40px" },
  ".cm-media-pdf": {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--hc-border)",
    borderRadius: "8px",
    overflow: "hidden",
    backgroundColor: "var(--hc-raised)",
    resize: "vertical",
    height: "600px",
    minHeight: "160px",
  },
  ".cm-media-pdf-header": {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "6px 10px",
    borderBottom: "1px solid var(--hc-border)",
    fontFamily: UI_FONT,
    fontSize: "13px",
    color: "var(--hc-text)",
  },
  ".cm-media-pdf-icon": {
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.04em",
    color: "#fff",
    backgroundColor: "#D9534F",
    borderRadius: "4px",
    padding: "2px 5px",
  },
  ".cm-media-pdf-name": { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-media-pdf-open": {
    fontFamily: UI_FONT,
    fontSize: "12px",
    color: "var(--hc-muted)",
    background: "transparent",
    border: "1px solid var(--hc-strong-border)",
    borderRadius: "5px",
    padding: "2px 10px",
    cursor: "pointer",
  },
  ".cm-media-pdf-open:hover": { color: "var(--hc-text)" },
  ".cm-media-pdf-frame": { flex: "1", width: "100%", border: "0", backgroundColor: "#525659" },
});

/** Audio, video and PDF embeds; `onOpenLink(target, newTab)` opens a file in its default app. */
export function mediaEmbeds({ onOpenLink }) {
  const field = StateField.define({
    create: (state) => buildMedia(state, onOpenLink),
    update(value, transaction) {
      return transaction.docChanged ? buildMedia(transaction.state, onOpenLink) : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, mediaTheme];
}
