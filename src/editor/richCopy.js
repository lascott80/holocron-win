// Rich copy: in live preview and reading view, Ctrl+C / Ctrl+X put the
// selection on the clipboard twice — the markdown as text/plain (exactly what
// CodeMirror copies, so pasting into a code editor or a note still gives
// markdown) and the rendered selection as email-safe text/html, so Outlook,
// Teams, Gmail and Word paste it formatted. Source mode copies markdown only.
//
// CodeMirror's own copy handler still does the copying (empty selections copy
// whole lines, cut deletes); a listener on the editor's outer element adds
// the HTML as the event bubbles past it. Local images, Mermaid diagrams and
// code languages that aren't loaded yet can't be awaited inside a copy event,
// so the first HTML has placeholders and a second pass rewrites the clipboard
// through the main process when they're ready (only if nothing newer was
// copied in the meantime).
import DOMPurify from "dompurify";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { STYLES, collectResources, escapeHtml, imageKey, markdownToHtml, mediaLabel } from "./markdownToHtml.js";
import { classifyHref, filterStyle, sanitizerConfig } from "./html.js";
import { assetSource } from "./images.js";
import { codeLanguage } from "./codeblocks.js";
import { codeHeading } from "./modes/tags.js";
import * as mermaidModule from "./mermaid.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Images and diagrams wider than this paste at this width (CSS px). */
const MAX_WIDTH = 640;

// ---------- What CodeMirror copies ----------

/** The text CodeMirror's copy/cut puts on the clipboard: the selections joined by line breaks, or whole lines when nothing is selected. */
export function copiedText(state) {
  const content = [];
  for (const range of state.selection.ranges) if (!range.empty) content.push(state.sliceDoc(range.from, range.to));
  let linewise = false;
  if (!content.length) {
    let upto = -1;
    for (const { from } of state.selection.ranges) {
      const line = state.doc.lineAt(from);
      if (line.number > upto) content.push(line.text);
      upto = line.number;
    }
    linewise = true;
  }
  let text = content.join(state.lineBreak);
  for (const filter of state.facet(EditorView.clipboardOutputFilter)) text = filter(text, state);
  return { text, linewise };
}

// ---------- Code colours (light, REQUIREMENTS §16.6) ----------

const CODE_STYLES = {
  keyword: "color: #8a3fbf;",
  heading: "color: #8a3fbf; font-weight: 700;",
  string: "color: #2e7d32;",
  number: "color: #b8501e;",
  comment: "color: #8a919d; font-style: italic;",
  function: "color: #1f5fbf;",
  type: "color: #8f6b00;",
  property: "color: #0b7285;",
  tag: "color: #c42f35;",
  punctuation: "color: #5f6672;",
  meta: "color: #6a4fc2;",
};

/** The same token groups as codeblocks.js's codeHighlight. */
const codeHighlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: "keyword" },
  { tag: codeHeading, class: "heading" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape, t.inserted], class: "string" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], class: "number" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.standard(t.variableName)], class: "function" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: "type" },
  { tag: [t.propertyName, t.attributeName, t.special(t.variableName), t.definition(t.variableName)], class: "property" },
  { tag: [t.tagName, t.angleBracket, t.deleted, t.invalid], class: "tag" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], class: "punctuation" },
  { tag: [t.meta, t.annotation, t.self, t.labelName], class: "meta" },
]);

/** A code block's HTML with coloured <span>s, or null if its language isn't loaded. */
function highlightCode(code, language) {
  const support = codeLanguage(language)?.support;
  if (!support) return null;
  let tree;
  try {
    tree = support.language.parser.parse(code);
  } catch {
    return null;
  }
  let html = "";
  let pos = 0;
  highlightTree(tree, codeHighlighter, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    const style = classes.split(" ").map((name) => CODE_STYLES[name] ?? "").join(" ").trim();
    html += style ? `<span style="${style}">${escapeHtml(code.slice(from, to))}</span>` : escapeHtml(code.slice(from, to));
    pos = to;
  });
  return html + escapeHtml(code.slice(pos));
}

// ---------- Sanitising ----------

let purifier = null;

function getPurifier() {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "style") {
      const style = filterStyle(data.attrValue);
      if (style) data.attrValue = style;
      else data.keepAttr = false;
    }
  });
  return purifier;
}

/**
 * Cleans the HTML with the notes' sanitiser config (html.js), then makes it
 * work outside Holocron: only http/https/mailto links keep an href, local
 * images become data URIs (or alt text) and players become a file name.
 */
function sanitizeForClipboard(html, images) {
  const clean = getPurifier().sanitize(html, { ...sanitizerConfig(), RETURN_DOM_FRAGMENT: false });
  // An inert document, so nothing loads while it's fixed up.
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${clean}</body>`, "text/html");
  for (const a of doc.querySelectorAll("a")) {
    const href = classifyHref(a.getAttribute("href"));
    if (href?.kind === "url") {
      a.setAttribute("href", href.url);
      if (!a.hasAttribute("style")) a.setAttribute("style", STYLES.link);
    } else a.removeAttribute("href");
  }
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (/^(?:https?:\/\/|data:image\/)/i.test(src)) continue;
    const image = src ? images[imageKey("relative", src)] : null;
    if (image) {
      img.setAttribute("src", image.src);
      if (!img.hasAttribute("width") && !img.hasAttribute("height") && image.width) {
        img.setAttribute("width", String(Math.round(image.width)));
        if (image.height) img.setAttribute("height", String(Math.round(image.height)));
      }
    } else {
      const alt = doc.createElement("em");
      alt.setAttribute("style", STYLES.muted);
      alt.textContent = `[Image: ${img.getAttribute("alt") || src.split("/").pop() || "image"}]`;
      img.replaceWith(alt);
    }
  }
  for (const media of doc.querySelectorAll("video, audio")) {
    const src = media.getAttribute("src") ?? media.querySelector("source")?.getAttribute("src") ?? "";
    media.replaceWith(doc.createTextNode(mediaLabel(src) ?? `▶ ${src.split("/").pop() || "media"}`));
  }
  return doc.body.innerHTML;
}

// ---------- Images and diagrams ----------

/** Recently loaded images (asset URL → { src, width, height } or null if missing) and diagrams (code → same). */
const imageCache = new Map();
const diagramCache = new Map();
const remember = (cache, key, value) => {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > 20) cache.delete(cache.keys().next().value);
};

const fitted = (width, height) => (width > MAX_WIDTH ? { width: MAX_WIDTH, height: (height * MAX_WIDTH) / width } : { width, height });

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A vault image as a data URI at its paste size. Formats mail clients can't show (SVG, WebP…) are converted to PNG. */
async function loadImage(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.size > MAX_IMAGE_BYTES) return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 150;
    let src;
    if (/^image\/(?:png|jpeg|gif)$/i.test(blob.type)) src = await readAsDataUrl(blob);
    else {
      const scale = blob.type.includes("svg") ? 2 : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      src = canvas.toDataURL("image/png");
    }
    return { src, ...fitted(width, height) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadDiagram(code) {
  // Drawn at 2x for sharpness; width/height are the PNG's pixels, so halve them for CSS size.
  const result = await mermaidModule.diagramImage(code, { theme: "light", scale: 2 });
  return result?.dataUrl ? { src: result.dataUrl, ...fitted(result.width / 2, result.height / 2) } : null;
}

const canDrawDiagrams = () => typeof mermaidModule.diagramImage === "function";

// ---------- Building the HTML ----------

/** The clipboard HTML for a copy, with whatever images and diagrams are already loaded. */
function buildHtml(copy) {
  const images = {};
  for (const image of copy.resources.images) {
    const loaded = imageCache.get(copy.urls.get(image.key));
    if (loaded) images[image.key] = loaded;
  }
  const diagrams = {};
  for (const code of copy.resources.diagrams) {
    const loaded = diagramCache.get(code);
    if (loaded) diagrams[code] = loaded;
  }
  return markdownToHtml(copy.text, {
    images,
    diagrams,
    sanitize: (html) => sanitizeForClipboard(html, images),
    highlight: highlightCode,
    stripFrontmatter: copy.startsAtTop,
    context: copy.context,
  });
}

/** Loads what the first HTML lacked; true if anything new arrived. */
async function loadResources(copy) {
  const tasks = [];
  for (const image of copy.resources.images) {
    const url = copy.urls.get(image.key);
    if (imageCache.has(url)) continue;
    tasks.push(loadImage(url).catch(() => null).then((result) => remember(imageCache, url, result)));
  }
  if (canDrawDiagrams()) {
    for (const code of copy.resources.diagrams) {
      if (diagramCache.has(code)) continue;
      tasks.push(loadDiagram(code).catch(() => null).then((result) => remember(diagramCache, code, result)));
    }
  }
  for (const language of copy.resources.languages) {
    const description = codeLanguage(language);
    if (description && !description.support) tasks.push(description.load().catch(() => null));
  }
  await Promise.all(tasks);
  return tasks.length > 0;
}

let copyCount = 0;

/**
 * The rich-copy extension (live preview and reading view). `post` sends
 * `{ type: "copyRich", text, html }` to the app, which rewrites the
 * clipboard once images and diagrams have loaded.
 */
export function richCopy({ post }) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.pending = null;
        this.finish = this.finish.bind(this);
        view.dom.addEventListener("copy", this.finish);
        view.dom.addEventListener("cut", this.finish);
      }

      destroy() {
        this.view.dom.removeEventListener("copy", this.finish);
        this.view.dom.removeEventListener("cut", this.finish);
      }

      /** Runs before CodeMirror's handler (which may delete a cut selection): note what's being copied. */
      start(view) {
        const { text } = copiedText(view.state);
        const first = view.state.selection.ranges[0];
        this.pending = { text, startsAtTop: view.state.doc.lineAt(first.from).number === 1, context: view.state.doc.toString() };
      }

      /** After CodeMirror has put the markdown on the clipboard: add the HTML. */
      finish(event) {
        const pending = this.pending;
        this.pending = null;
        const data = event.clipboardData;
        if (!pending || !event.defaultPrevented || !data) return;
        this.addHtml(data, { ...pending, text: data.getData("text/plain") || pending.text });
      }

      /** Puts the HTML for `copy.text` on the clipboard now and again once everything has loaded. */
      addHtml(data, copy) {
        const { text } = copy;
        if (!text.trim()) return;
        const seq = ++copyCount;
        try {
          copy.resources = collectResources(text, { stripFrontmatter: copy.startsAtTop });
          copy.urls = new Map(copy.resources.images.map((image) => [image.key, assetSource(image.kind, image.target)]));
          data.setData("text/html", buildHtml(copy));
        } catch (error) {
          console.error("Rich copy failed:", error);
          return;
        }
        void loadResources(copy).then((loaded) => {
          if (!loaded || seq !== copyCount) return;
          post({ type: "copyRich", text, html: buildHtml(copy) });
        }).catch((error) => console.error("Rich copy failed:", error));
      }

      /**
       * Reading view can't take focus, so the selection is the page's own
       * (CodeMirror doesn't see it): copy the markdown under it ourselves.
       */
      copyReading(event, view) {
        const range = readingSelection(view);
        if (!range || !event.clipboardData) return false;
        const text = view.state.sliceDoc(range.from, range.to);
        if (!text.trim()) return false;
        event.clipboardData.clearData();
        event.clipboardData.setData("text/plain", text);
        this.addHtml(event.clipboardData, { text, startsAtTop: range.from === 0, context: view.state.doc.toString() });
        return true;
      }
    },
    {
      eventHandlers: {
        copy(event, view) {
          if (!view.state.facet(EditorView.editable)) return this.copyReading(event, view);
          this.start(view);
          return false;
        },
        cut(event, view) {
          if (!view.state.facet(EditorView.editable)) return this.copyReading(event, view);
          this.start(view);
          return false;
        },
      },
    },
  );
}

/**
 * The document range under the page's selection in a view that can't take
 * focus (reading view), clamped to the note: selecting the whole window
 * copies the whole note. null if the selection doesn't touch the editor.
 */
function readingSelection(view) {
  const selection = view.root.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const content = view.contentDOM;
  if (!range.intersectsNode(content)) return null;
  const at = (node, offset, fallback, side) => {
    if (!content.contains(node)) return fallback;
    try {
      // Inside a block widget (table, diagram, math, HTML…): the whole block.
      let child = node.nodeType === 1 ? node : node.parentNode;
      while (child && child.parentNode !== content) child = child.parentNode;
      if (child && child.nodeType === 1 &&!child.classList.contains("cm-line")) {
        const block = view.lineBlockAt(view.posAtDOM(child, 0));        return side < 0 ? block.from : block.to;
      }
      return view.posAtDOM(node, offset);
    } catch {
      return fallback;
    }
  };
  // Nothing visible before/after the selection: take hidden text there too (comments, footnote lines…).
  const visible = (setRange) => {
    const rest = document.createRange();
    rest.selectNodeContents(content);
    setRange(rest);
    return rest.toString().trim() !== "";
  };
  const from = visible((r) => r.setEnd(range.startContainer, range.startOffset)) ? at(range.startContainer, range.startOffset, 0, -1) : 0;
  const to = visible((r) => r.setStart(range.endContainer, range.endOffset))
    ? at(range.endContainer, range.endOffset, view.state.doc.length, 1)
    : view.state.doc.length;
  return to > from ? { from, to } : null;
}

/** "Copy as Markdown": the selection (or line) as text only, even in live preview. */
export function copyMarkdown(onCopy) {
  return (view) => {
    const reading = view.contentDOM && !view.state.facet(EditorView.editable) ? readingSelection(view) : null;
    const text = reading ? view.state.sliceDoc(reading.from, reading.to) : copiedText(view.state).text;
    if (!text) return false;
    ++copyCount; // a rich copy still loading mustn't replace this
    onCopy(text);
    return true;
  };
}
