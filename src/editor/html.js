// Raw HTML in notes, rendered safely (like VS Code's markdown preview).
// - HTML blocks (CommonMark's rules, from the markdown parser's HTMLBlock
//   nodes) render as sanitised HTML in a block widget unless you're editing
//   inside them; clicking the widget shows the source (like tables and
//   Mermaid). Blocks that render to nothing (a lone <div align="center"> or
//   </div>, an HTML comment) are hidden instead.
// - Inline tags (<span style>, <a href>, <abbr title>, <img>, …) are styled
//   in place by livePreview.js using pairInlineTags/inlineMark/inlineImage.
// - <!-- comments --> are hidden unless you're editing them (like %% %%).
// Everything goes through DOMPurify with an allow-list of tags, attributes
// and CSS properties. Links never navigate: http/https/mailto go to the
// system browser and relative paths open as notes, through the editor's
// usual link handling. Local images and media load via holocron-asset://.
import DOMPurify from "dompurify";
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { focusChanged, focusTracking, isEditing, setFocused } from "./focus.js";
import { assetSource } from "./images.js";
import { MONO_FONT } from "./platform.js";

// ---------- Allow-lists ----------

const ALLOWED_TAGS = [
  "a", "abbr", "article", "aside", "audio", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center",
  "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
  "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "mark",
  "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "source", "span", "strike", "strong",
  "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var",
  "video", "wbr",
];

const ALLOWED_ATTR = [
  "align", "valign", "alt", "title", "src", "href", "width", "height", "colspan", "rowspan", "scope", "span",
  "style", "color", "face", "size", "bgcolor", "border", "cellpadding", "cellspacing", "start", "reversed", "type",
  "controls", "loop", "muted", "poster", "open", "datetime", "lang", "dir",
];

/** Never allowed, even if a later edit widens the lists above. */
const FORBID_TAGS = [
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select",
  "option", "textarea", "style", "link", "meta", "base", "svg", "math", "template", "noscript", "portal", "track",
  "picture", "canvas", "dialog",
];
const FORBID_ATTR = ["srcset", "srcdoc", "formaction", "action", "ping", "background", "xlink:href", "autoplay", "id", "name", "class"];

/** URLs DOMPurify may keep: http(s), mailto, data:image and relative paths (rewritten afterwards). */
const SAFE_URI = /^(?:(?:https?|mailto):|data:image\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** The DOMPurify configuration for notes' HTML. */
export function sanitizerConfig() {
  return {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: [...FORBID_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: SAFE_URI,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  };
}

// ---------- CSS filter ----------

const STYLE_PROPERTIES = /^(?:color|background-color|text-align|text-decoration(?:-(?:line|color|style|thickness))?|text-transform|text-indent|font(?:-(?:family|size|style|weight|variant))?|letter-spacing|word-spacing|line-height|vertical-align|white-space|(?:max-|min-)?(?:width|height)|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|border-radius|border-collapse|border-spacing|list-style-type|opacity)$/;
const STYLE_FORBIDDEN = /url\s*\(|image-set|expression|javascript:|vbscript:|@import|behavior|binding|\\|\/\*|[<>{}]|attr\s*\(|env\s*\(/i;
const STYLE_VALUE = /^[\w\s#%.,()+\-'"!/]*$/;

/**
 * Keeps only safe, layout-neutral declarations of an inline style: colours,
 * fonts, text alignment, sizes, margins (never negative), padding and
 * borders. No positioning, no url(), no expressions. "" if nothing is left.
 */
export function filterStyle(style) {
  const kept = [];
  for (const declaration of String(style ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value || !STYLE_PROPERTIES.test(property)) continue;
    if (STYLE_FORBIDDEN.test(value) || !STYLE_VALUE.test(value)) continue;
    if (property.startsWith("margin") && /(^|[\s(,])-\s*\.?\d/.test(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join("; ");
}

// ---------- URLs ----------

/**
 * Where an <a href> goes: { kind: "url", url } for http/https/mailto (opened
 * in the browser), { kind: "link", target } for a note path, "#Heading" or
 * [[Target]] (opened like a wikilink), or null for anything else
 * (javascript:, file:, data:…).
 */
export function classifyHref(href) {
  let value = String(href ?? "").trim();
  if (!value) return null;
  if (/^(?:https?:\/\/|mailto:)/i.test(value)) return { kind: "url", url: value };
  const wiki = /^\[\[([^\]]+)\]\]$/.exec(value);
  if (wiki) value = wiki[1].split("|")[0].trim();
  else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\\\")) return null;
    try {
      value = decodeURI(value);
    } catch {}
    value = value.replace(/^\.\//, "");
  }
  return value ? { kind: "link", target: value } : null;
}

/**
 * The URL an <img>/<video>/<audio>/<source> src loads from: http(s) as is,
 * data:image/… for images, vault paths via holocron-asset:// ("relative" to
 * the note), anything else null.
 */
export function rewriteSrc(src, tag = "img") {
  const value = String(src ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return tag === "img" ? value : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\\\")) return null;
  let path = value.replace(/[?#].*$/, "");
  try {
    path = decodeURI(path);
  } catch {}
  return path ? assetSource("relative", path) : null;
}

// ---------- Tags ----------

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 0xfffd);
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 0xfffd);
    return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }[lower] ?? whole;
  });
}

/** `<span style="x">` → { name: "span", closing: false, selfClosing: false, attrs: { style: "x" } }, or null. */
export function parseTag(text) {
  const match = TAG.exec(text);
  if (!match) return null;
  const attrs = {};
  for (const attr of match[3].matchAll(ATTRIBUTE)) {
    const name = attr[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "");
  }
  return { name: match[2].toLowerCase(), closing: match[1] === "/", selfClosing: match[4] === "/", attrs };
}

/** Inline tags livePreview renders in place (besides its own plain <kbd>, <mark>, … handling). */
const INLINE_TAGS = new Set([
  "a", "span", "font", "abbr", "q", "cite", "code", "em", "strong", "var", "samp", "dfn", "time", "big", "tt",
  "kbd", "mark", "sup", "sub", "u", "b", "i", "s", "small", "ins", "del",
]);
/** Tags livePreview already handles when written without attributes. */
const PLAIN_TAGS = new Set(["kbd", "mark", "sup", "sub", "u", "b", "i", "s", "small", "ins", "del"]);
const VOID_TAGS = new Set(["img"]);
/** Elements drawn whole (sanitised) when written inside a paragraph: <video …></video>. */
const ELEMENT_TAGS = new Set(["video", "audio"]);

/**
 * Pairs inline HTML tags (the parser's HTMLTag nodes: { from, to, text,
 * group }, in document order; `group` is the enclosing block, so tags only
 * pair within a paragraph). Returns
 *   { type: "pair", name, attrs, openFrom, openTo, closeFrom, closeTo },
 *   { type: "void", name: "img", attrs, from, to } and
 *   { type: "element", name: "video" | "audio", openFrom, openTo, closeFrom, closeTo }
 *   (drawn whole, from the source between openFrom and closeTo).
 * Unknown tags, unmatched tags and plain <kbd>-style tags are left out.
 */
export function pairInlineTags(tags) {
  const result = [];
  const stacks = new Map();
  for (const tag of tags) {
    const parsed = parseTag(tag.text);
    if (!parsed || !INLINE_TAGS.has(parsed.name) && !VOID_TAGS.has(parsed.name) && !ELEMENT_TAGS.has(parsed.name)) continue;
    const { name, attrs, closing } = parsed;
    if (VOID_TAGS.has(name)) {
      if (!closing) result.push({ type: "void", name, attrs, from: tag.from, to: tag.to });
      continue;
    }
    if (!stacks.has(tag.group)) stacks.set(tag.group, []);
    const stack = stacks.get(tag.group);
    if (!closing) {
      if (parsed.selfClosing) continue;
      if (PLAIN_TAGS.has(name) && Object.keys(attrs).length === 0) continue;
      stack.push({ name, attrs, from: tag.from, to: tag.to });
      continue;
    }
    let index = stack.length - 1;
    while (index >= 0 && stack[index].name !== name) index--;
    if (index < 0) continue;
    const open = stack[index];
    stack.length = index;
    const type = ELEMENT_TAGS.has(name) ? "element" : "pair";
    result.push({ type, name, attrs: open.attrs, openFrom: open.from, openTo: open.to, closeFrom: tag.from, closeTo: tag.to });
  }
  // Nothing inside a whole element is styled separately.
  const elements = result.filter((tag) => tag.type === "element");
  if (elements.length) {
    const inside = (tag) => elements.some((e) => e !== tag && (tag.openFrom ?? tag.from) >= e.openFrom && (tag.closeTo ?? tag.to) <= e.closeTo);
    return result.filter((tag) => !inside(tag)).sort((a, b) => (a.openFrom ?? a.from) - (b.openFrom ?? b.from));
  }
  return result.sort((a, b) => (a.openFrom ?? a.from) - (b.openFrom ?? b.from));
}

/**
 * The mark decoration spec for an inline tag's content, e.g.
 * <span style="color: red"> → { tagName: "span", attributes: { style: "color: red" } }.
 * Links get livePreview's link classes so clicking opens them; an unsafe
 * link gets no mark (its text shows plain).
 */
export function inlineMark(name, attrs = {}) {
  const attributes = {};
  const style = attrs.style ? filterStyle(attrs.style) : "";
  if (attrs.title) attributes.title = attrs.title;
  if (name === "a") {
    const href = classifyHref(attrs.href);
    if (!href) return null;
    if (style) attributes.style = style;
    if (href.kind === "url") return { class: "cm-md-link", attributes: { ...attributes, "data-href": href.url } };
    return { class: "cm-wikilink", attributes: { ...attributes, "data-target": href.target } };
  }
  if (name === "font") {
    const parts = [];
    if (attrs.color) parts.push(`color: ${attrs.color}`);
    if (attrs.face) parts.push(`font-family: ${attrs.face}`);
    const size = { 1: "0.63em", 2: "0.82em", 3: "1em", 4: "1.13em", 5: "1.5em", 6: "2em", 7: "3em" }[String(attrs.size ?? "").trim()];
    if (size) parts.push(`font-size: ${size}`);
    const fontStyle = filterStyle([...parts, style].join("; "));
    return fontStyle ? { tagName: "span", attributes: { ...attributes, style: fontStyle } } : { tagName: "span", attributes };
  }
  if (style) attributes.style = style;
  if (PLAIN_TAGS.has(name)) return { class: `cm-html-${name}`, attributes };
  if (name === "code") return { class: "cm-inline-code", attributes };
  if (name === "strong") return { tagName: "strong", class: "cm-html-b", attributes };
  if (name === "big") return { tagName: "span", class: "cm-html-big", attributes };
  if (name === "tt") return { tagName: "span", class: "cm-html-tt", attributes };
  return { tagName: name, attributes };
}

// ---------- Sanitising ----------

let purifier = null;

/** Rewrites what DOMPurify kept: links to data attributes, sources to safe URLs. */
function finishElement(node) {
  const tag = node.nodeName.toLowerCase();
  if (tag === "a") {
    const href = classifyHref(node.getAttribute("href"));
    node.removeAttribute("href");
    if (href?.kind === "url") {
      node.className = "cm-md-link";
      node.dataset.href = href.url;
      if (!node.title) node.title = href.url;
    } else if (href?.kind === "link") {
      node.className = "cm-wikilink";
      node.dataset.target = href.target;
    }
    return;
  }
  if (tag === "img" || tag === "video" || tag === "audio" || tag === "source") {
    if (tag === "img" && node.hasAttribute("src")) node.dataset.source = node.getAttribute("src");
    for (const attribute of ["src", "poster"]) {
      if (!node.hasAttribute(attribute)) continue;
      const url = rewriteSrc(node.getAttribute(attribute), attribute === "poster" ? "img" : tag);
      if (url) node.setAttribute(attribute, url);
      else node.removeAttribute(attribute);
    }
    if (tag === "video" || tag === "audio") {
      node.setAttribute("controls", "");
      node.setAttribute("preload", "metadata");
    }
    if (tag === "img") {
      node.setAttribute("draggable", "false");
      node.setAttribute("loading", "lazy");
    }
  }
}

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
  purifier.addHook("afterSanitizeAttributes", finishElement);
  return purifier;
}

/** Notes' HTML as a safe DocumentFragment (renderer only). */
export function sanitizeHtml(html) {
  return getPurifier().sanitize(html, sanitizerConfig());
}

// ---------- Finding blocks ----------

/** Whether HTML would show nothing: only tags, comments and whitespace (no images, media, rules or tables). */
export function isInvisibleHtml(html) {
  const withoutComments = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    // Elements whose content the sanitiser drops along with them.
    .replace(/<(script|style|iframe|noscript|template|textarea|svg|math|object|select)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  if (/<(?:img|video|audio|hr|table|br)\b/i.test(withoutComments)) return false;
  return !withoutComments.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, "").trim();
}

/**
 * Top-level HTML blocks and HTML comment blocks, from the syntax tree:
 * { from, to (whole lines), html, invisible }. <details>/<summary> blocks
 * and lone <br>s are left to livePreview and folds.js.
 */
export function findHtmlBlocks(state) {
  const { doc } = state;
  const blocks = [];
  const tree = syntaxTree(state);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "HTMLBlock" && node.name !== "CommentBlock") continue;
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(Math.max(node.from, node.to)).to;
    const html = doc.sliceString(from, to);
    if (/<\/?(?:details|summary)\b/i.test(html)) continue;
    if (/^\s*(?:<br\s*\/?>\s*)+$/i.test(html)) continue;
    blocks.push({ from, to, html, invisible: isInvisibleHtml(html) });
  }
  return blocks;
}

// ---------- Widgets ----------

function missingImage(img, view) {
  const missing = document.createElement("span");
  missing.className = "cm-image-missing cm-html-missing";
  missing.textContent = `Image not found: ${img.getAttribute("alt") || img.dataset.source || ""}`;
  img.replaceWith(missing);
  view.requestMeasure();
}

function watchImage(img, view, source) {
  if (source) img.dataset.source = source;
  img.addEventListener("load", () => view.requestMeasure());
  img.addEventListener("error", () => {
    if (img.src.startsWith("holocron-asset:")) missingImage(img, view);
  });
}

class HtmlBlockWidget extends WidgetType {
  constructor(block) {
    super();
    this.html = block.html;
    this.from = block.from;
    this.source = assetSource("relative", ""); // changes with the open note
  }
  eq(other) {
    return other.html === this.html && other.from === this.from && other.source === this.source;
  }
  get estimatedHeight() {
    return 24 * this.html.split("\n").length;
  }
  toDOM(view) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-html-block";
    wrapper.dataset.pos = String(this.from);
    wrapper.appendChild(sanitizeHtml(this.html));
    for (const img of wrapper.querySelectorAll("img")) watchImage(img, view, img.dataset.source);
    for (const media of wrapper.querySelectorAll("video, audio")) {
      media.addEventListener("loadedmetadata", () => view.requestMeasure());
    }
    return wrapper;
  }
  ignoreEvent(event) {
    // Media controls and <details> toggles work by themselves.
    return event.target instanceof Element && Boolean(event.target.closest("video, audio, summary"));
  }
}

class InlineImageWidget extends WidgetType {
  constructor(attrs) {
    super();
    this.attrs = attrs;
    this.src = rewriteSrc(attrs.src, "img");
    this.key = JSON.stringify([attrs, this.src]);
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM(view) {
    if (!this.src) {
      const alt = document.createElement("span");
      alt.className = "cm-html-alt";
      alt.textContent = this.attrs.alt ?? "";
      return alt;
    }
    const img = document.createElement("img");
    img.className = "cm-html-img";
    img.src = this.src;
    img.alt = this.attrs.alt ?? "";
    img.draggable = false;
    if (this.attrs.title) img.title = this.attrs.title;
    for (const dimension of ["width", "height"]) {
      const value = /^\s*(\d+(?:\.\d+)?)(px|%)?\s*$/.exec(this.attrs[dimension] ?? "");
      if (value) img.style[dimension] = `${value[1]}${value[2] ?? "px"}`;
    }
    const style = filterStyle(this.attrs.style);
    if (style) img.style.cssText += `; ${style}`;
    if (this.attrs.align && /^(left|right)$/i.test(this.attrs.align)) img.style.float = this.attrs.align.toLowerCase();
    watchImage(img, view, this.attrs.src);
    return img;
  }
  ignoreEvent() {
    return false;
  }
}

/** The widget livePreview shows for an inline <img …>. */
export function inlineImage(attrs) {
  return new InlineImageWidget(attrs);
}

class InlineElementWidget extends WidgetType {
  constructor(html) {
    super();
    this.html = html;
    this.source = assetSource("relative", "");
  }
  eq(other) {
    return other.html === this.html && other.source === this.source;
  }
  toDOM(view) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-html-inline";
    wrapper.appendChild(sanitizeHtml(this.html));
    for (const media of wrapper.querySelectorAll("video, audio")) {
      media.addEventListener("loadedmetadata", () => view.requestMeasure());
    }
    return wrapper;
  }
  ignoreEvent(event) {
    return event.target instanceof Element && Boolean(event.target.closest("video, audio"));
  }
}

/** The widget livePreview shows for a whole inline element such as <video …></video>. */
export function inlineElement(html) {
  return new InlineElementWidget(html);
}

// ---------- Decorations ----------

function build(state) {
  const { doc } = state;
  const decorations = [];
  for (const block of findHtmlBlocks(state)) {
    if (isEditing(state, block.from, block.to)) continue;
    if (block.invisible) {
      // Collapse the lines entirely (like %% comments); the last line of the
      // note can't be a block replacement, so it's just emptied.
      if (doc.lineAt(block.to).number < doc.lines) decorations.push(Decoration.replace({ block: true }).range(block.from, block.to));
      else if (block.to > block.from) decorations.push(Decoration.replace({}).range(block.from, block.to));
      continue;
    }
    decorations.push(Decoration.replace({ widget: new HtmlBlockWidget(block), block: true }).range(block.from, block.to));
  }
  // Inline <!-- comments -->.
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "HTMLBlock" || node.name === "CommentBlock" || /^(FencedCode|CodeBlock|Frontmatter)$/.test(node.name)) return false;
      if (node.name !== "Comment") return;
      if (isEditing(state, node.from, node.to)) decorations.push(Decoration.mark({ class: "cm-comment" }).range(node.from, node.to));
      else decorations.push(Decoration.replace({}).range(node.from, node.to));
    },
  });
  return Decoration.set(decorations, true);
}

const htmlField = StateField.define({
  create: build,
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection && !focusChanged(transaction)
      && syntaxTree(transaction.startState) === syntaxTree(transaction.state)) return value;
    return build(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const htmlClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const block = event.target.closest(".cm-html-block");
    if (!block) return false;
    if (event.target.closest(".cm-wikilink, .cm-md-link")) return false; // livePreview opens these
    event.preventDefault();
    if (view.state.readOnly || !view.state.facet(EditorView.editable)) return true;
    view.focus();
    view.dispatch({ selection: { anchor: Number(block.dataset.pos) }, effects: setFocused.of(true), scrollIntoView: true });
    return true;
  },
  click(event) {
    // Nothing in a note may navigate the window (main blocks it too).
    if (event.target instanceof Element && event.target.closest(".cm-html-block a, .cm-content a")) event.preventDefault();
    return false;
  },
});

const htmlTheme = EditorView.baseTheme({
  ".cm-html-block": {
    padding: "4px 0",
    margin: "2px 0",
    overflowX: "auto",
    contain: "paint",
    cursor: "text",
    lineHeight: "1.6",
  },
  ".cm-mode-reading .cm-html-block": { cursor: "default" },
  ".cm-html-block > :first-child": { marginTop: "0" },
  ".cm-html-block > :last-child": { marginBottom: "0" },
  ".cm-html-block p": { margin: "0.5em 0" },
  ".cm-html-block img, .cm-html-block video": { maxWidth: "100%", height: "auto" },
  ".cm-html-block img": { borderRadius: "4px", verticalAlign: "middle" },
  ".cm-html-block table": { borderCollapse: "collapse", margin: "6px 0" },
  ".cm-html-block th, .cm-html-block td": { border: "1px solid var(--hc-strong-border)", padding: "4px 10px", verticalAlign: "top" },
  ".cm-html-block th": { backgroundColor: "var(--hc-raised)", fontWeight: "600" },
  ".cm-html-block code": {
    fontFamily: MONO_FONT,
    fontSize: "0.88em",
    padding: "1px 5px",
    borderRadius: "4px",
    backgroundColor: "var(--hc-chip)",
  },
  ".cm-html-block pre": {
    fontFamily: MONO_FONT,
    fontSize: "0.88em",
    padding: "10px 14px",
    borderRadius: "6px",
    backgroundColor: "var(--hc-raised)",
    overflowX: "auto",
  },
  ".cm-html-block pre code": { padding: "0", backgroundColor: "transparent" },
  ".cm-html-block kbd": {
    fontFamily: MONO_FONT,
    fontSize: "0.82em",
    padding: "1px 6px",
    border: "1px solid var(--hc-strong-border)",
    borderBottomWidth: "2px",
    borderRadius: "4px",
    backgroundColor: "var(--hc-chip)",
  },
  ".cm-html-block mark": { backgroundColor: "var(--hc-highlight, rgba(232, 193, 90, 0.32))", color: "inherit", borderRadius: "3px" },
  ".cm-html-block blockquote": { margin: "6px 0", paddingLeft: "14px", borderLeft: "3px solid var(--hc-strong-border)", color: "var(--hc-quote)" },
  ".cm-html-block hr": { border: "0", borderTop: "1px solid var(--hc-strong-border)", margin: "12px 0" },
  ".cm-html-block a": { textDecoration: "none" },
  ".cm-html-block abbr[title]": { textDecoration: "underline dotted", cursor: "help" },
  ".cm-html-block .cm-html-missing": { display: "inline-block" },
  ".cm-html-img": { maxWidth: "100%", verticalAlign: "middle", borderRadius: "4px" },
  ".cm-html-inline video, .cm-html-inline audio": { maxWidth: "100%", verticalAlign: "middle" },
  ".cm-html-big": { fontSize: "1.17em" },
  ".cm-html-tt": { fontFamily: MONO_FONT, fontSize: "0.9em" },
  "abbr[title]": { textDecoration: "underline dotted", cursor: "help" },
});

/** HTML blocks and comments (inline tags are styled by livePreview). */
export const htmlRendering = [focusTracking, htmlField, htmlClicks, htmlTheme];
