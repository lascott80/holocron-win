// HTML → markdown for "Paste as Markdown" (pasteMarkdown.js): the reverse of
// rich copy. Clipboard HTML from web pages, Outlook, Word and Teams becomes
// clean markdown in Holocron's conventions — ATX headings, "-" bullets,
// **bold**, *italic*, ~~strike~~, ==highlight==, fenced code, tidy pipe tables
// and [links](https://…).
//
// The HTML is parsed (DOMParser in the app; tests pass their own parser),
// cleaned up for each source's quirks (Word's mso-list paragraphs and XML
// tags, Teams mentions, Google Docs' styled spans, scripts and styles), then
// converted with Turndown using Holocron's rules. Pure and synchronous:
// local images (data: URIs and file:/// temp files from Outlook and Word) are
// saved by the caller first and passed in as `images` (src → embed text).
import TurndownService from "turndown";
import { formatTable } from "./tables.js";

// ---------- Parsing ----------

/** Removes the CF_HTML header and Office conditional comments (VML, Word settings XML). */
function cleanSource(html) {
  return String(html)
    .replace(/^\s*Version:\d[\s\S]*?(?=<)/, "")
    // <!--[if gte mso 9]>…<![endif]--> (but not downlevel-revealed <!--[if !supportLists]-->, whose content shows)
    .replace(/<!--\[if [^\]]*\]>(?!-->)[\s\S]*?<!\[endif\]-->/gi, "");
}

function defaultParse(html) {
  if (typeof DOMParser === "undefined") throw new Error("No HTML parser available");
  return new DOMParser().parseFromString(html, "text/html");
}

// ---------- DOM helpers ----------

const ELEMENT = 1;
const TEXT = 3;

const children = (node) => Array.from(node.childNodes ?? []);
const elements = (root, selector) => Array.from(root.querySelectorAll(selector));
const tag = (node) => (node?.nodeType === ELEMENT ? node.nodeName.toUpperCase() : "");

function hasAncestor(node, names, stop) {
  for (let parent = node.parentNode; parent && parent !== stop; parent = parent.parentNode) {
    if (names.has(tag(parent))) return true;
  }
  return false;
}

/** Replaces an element with its children. */
function unwrap(node) {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function remove(node) {
  node.parentNode?.removeChild(node);
}

/** A new element named `name` holding `node`'s children, in its place. */
function rename(node, name) {
  const replacement = node.ownerDocument.createElement(name);
  for (const attribute of ["href", "src", "alt", "start", "class", "align", "colspan", "type", "checked"]) {
    if (node.hasAttribute?.(attribute)) replacement.setAttribute(attribute, node.getAttribute(attribute));
  }
  while (node.firstChild) replacement.appendChild(node.firstChild);
  node.parentNode.replaceChild(replacement, node);
  return replacement;
}

/** The element's inline style as a map of lower-case properties. */
function styleOf(node) {
  const style = {};
  for (const declaration of String(node.getAttribute?.("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    style[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim().toLowerCase();
  }
  return style;
}

function textNodes(root) {
  const found = [];
  const walk = (node) => {
    for (const child of children(node)) {
      if (child.nodeType === TEXT) found.push(child);
      else if (child.nodeType === ELEMENT) walk(child);
    }
  };
  walk(root);
  return found;
}

// ---------- Styles that mean formatting ----------

const MONOSPACE = /^(?:consolas|courier new|courier|cascadia (?:code|mono)|menlo|monaco|lucida console|source code pro|fira code|jetbrains mono|sf mono|monospace)$/;

function rgb(value) {
  if (!value) return null;
  const named = { yellow: [255, 255, 0], gold: [255, 215, 0], khaki: [240, 230, 140], lightyellow: [255, 255, 224] };
  if (named[value]) return named[value];
  let match = /^#([0-9a-f]{3})$/.exec(value);
  if (match) return [...match[1]].map((c) => parseInt(c + c, 16));
  match = /^#([0-9a-f]{6})/.exec(value);
  if (match) return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
  match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?/.exec(value);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return alpha < 0.2 ? null : [1, 2, 3].map((i) => Number(match[i]));
  }
  return null;
}

/** Yellow-ish backgrounds (Word/Outlook highlighter, Holocron's own ==highlight==). */
function isHighlightColour(value) {
  const colour = rgb(String(value ?? "").split(/\s+/).find((part) => rgb(part)) ?? value);
  return Boolean(colour && colour[0] >= 200 && colour[1] >= 180 && colour[2] <= 175);
}

function formattingOf(node) {
  const style = styleOf(node);
  const weight = style["font-weight"];
  const decoration = `${style["text-decoration"] ?? ""} ${style["text-decoration-line"] ?? ""}`;
  const family = (style["font-family"] ?? "").split(",")[0]?.replace(/["']/g, "").trim();
  return {
    bold: weight ? /^(bold|bolder|[6-9]00)$/.test(weight) : null,
    notBold: weight ? /^(normal|lighter|[1-4]00)$/.test(weight) : false,
    italic: /^(italic|oblique)/.test(style["font-style"] ?? ""),
    notItalic: style["font-style"] === "normal",
    strike: decoration.includes("line-through"),
    highlight: isHighlightColour(style["mso-highlight"]) || isHighlightColour(style["background-color"]) || isHighlightColour(style.background),
    monospace: Boolean(family && MONOSPACE.test(family)),
    pre: /^pre/.test(style["white-space"] ?? ""),
  };
}

// ---------- Clean-up ----------

const DROP = new Set([
  "SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH",
  "CANVAS", "BUTTON", "SELECT", "TEXTAREA", "VIDEO", "AUDIO", "SOURCE", "TRACK", "MAP", "AREA", "XML", "BASE", "DIALOG",
]);
const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const CODE_PARENTS = new Set(["PRE", "CODE", "CODEBLOCK", "KBD", "SAMP"]);
const TASK_CHARS = { "☐": " ", "□": " ", "☑": "x", "☒": "x", "✅": "x", "✔": "x", "✓": "x" };
const TASK_START = /^[\s\u00a0]*([☐□☑☒✅✔✓])\uFE0F?[\s\u00a0]*/;

function dropJunk(root) {
  for (const node of elements(root, "*")) {
    if (!node.parentNode) continue;
    const name = tag(node);
    const style = styleOf(node);
    if (DROP.has(name) || node.hasAttribute("hidden") || style.display === "none" || style["mso-hide"] === "all") {
      remove(node);
    } else if (name.includes(":")) {
      // Office XML: <o:p> holds a paragraph's &nbsp;, <v:…>/<w:…>/<m:…> are drawing/settings XML, others (smart tags) wrap text.
      if (/^(V|W|M|XML|O):/.test(name) && (name !== "O:P" || !node.textContent.trim())) remove(node);
      else unwrap(node);
    } else if (name === "INPUT" && (node.getAttribute("type") ?? "").toLowerCase() !== "checkbox") {
      remove(node);
    } else if (name === "CODEBLOCK") {
      // Teams' code blocks: as <pre>, their whitespace survives Turndown. The class is the language.
      const pre = rename(node, "pre");
      const language = (pre.getAttribute("class") ?? "").trim();
      if (/^[\w+#-]+$/.test(language) && !/^language-/.test(language)) pre.setAttribute("class", `language-${language}`);
    }
  }
  // Comments (StartFragment markers, Word's leftovers) carry nothing.
  const walk = (node) => {
    for (const child of children(node)) {
      if (child.nodeType === 8) remove(child);
      else if (child.nodeType === ELEMENT) walk(child);
    }
  };
  walk(root);
}

/** Teams' @mentions are spans with a schema.skype.com itemtype: plain "@Name". */
function convertMentions(root) {
  for (const node of elements(root, "[itemtype]")) {
    if (!/schema\.skype\.com\/Mention/i.test(node.getAttribute("itemtype") ?? "")) continue;
    const name = node.textContent.replace(/\s+/g, " ").trim();
    node.parentNode.replaceChild(node.ownerDocument.createTextNode(name.startsWith("@") ? name : `@${name}`), node);
  }
}

/** Word's paragraph styles that have a markdown equivalent. */
function convertWordStyles(root) {
  for (const node of elements(root, "p")) {
    const classes = (node.getAttribute("class") ?? "").toLowerCase();
    if (/\bmsotitle\b/.test(classes)) rename(node, "h1");
    else if (/\bmso(intense)?quote\b/.test(classes)) {
      const quote = node.ownerDocument.createElement("blockquote");
      node.parentNode.replaceChild(quote, node);
      quote.appendChild(node);
    }
  }
}

/** Bullets Word draws in its own list paragraphs ("·" Symbol, "o" Courier, "§" Wingdings…). */
const ORDERED_MARKER = /^\(?(\d{1,4}|[a-z]{1,2}|[ivxlcdm]{1,6})[.)]$/i;
const LEADING_MARKER = /^[\s\u00a0]*((?:[·•▪◦‣∙●○■□oØü§\-–*])|\(?(?:\d{1,4}|[a-z]{1,2}|[ivxlcdm]{1,6})[.)])[\s\u00a0]+/i;

/** A list item hidden in a paragraph: Word's mso-list paragraphs, or "☐ task" lines. */
function paragraphListItem(node) {
  const style = node.getAttribute("style") ?? "";
  const list = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(style);
  if (list) {
    let marker = "";
    const ignore = elements(node, "span").find((span) => /mso-list:\s*ignore/i.test(span.getAttribute("style") ?? ""));
    if (ignore) {
      marker = ignore.textContent;
      remove(ignore);
    } else {
      const first = textNodes(node).find((text) => text.nodeValue.trim());
      const match = first && LEADING_MARKER.exec(first.nodeValue);
      if (match) {
        marker = match[1];
        first.nodeValue = first.nodeValue.slice(match[0].length);
      }
    }
    marker = marker.replace(/[\s\u00a0]+/g, "");
    const ordered = ORDERED_MARKER.exec(marker);
    const number = ordered && /^\d+$/.test(ordered[1]) ? Number(ordered[1]) : 1;
    return { node, list: list[1], level: Number(list[2]), ordered: Boolean(ordered), start: number, task: TASK_CHARS[marker] ?? null };
  }
  // Checklists written as paragraphs (Loop, OneNote, Holocron's own ☐/☑ HTML outside a list).
  const first = textNodes(node).find((text) => text.nodeValue.trim());
  const task = first && TASK_START.exec(first.nodeValue);
  if (task && !elements(node, "p, div, ul, ol, table, pre, li").length) {
    first.nodeValue = first.nodeValue.slice(task[0].length);
    return { node, list: "task", level: 1, ordered: false, start: 1, task: TASK_CHARS[task[1]] };
  }
  return null;
}

function checkbox(doc, state) {
  const input = doc.createElement("input");
  input.setAttribute("type", "checkbox");
  if (state === "x") input.setAttribute("checked", "");
  return input;
}

/** Turns runs of list paragraphs into real (nested) <ul>/<ol> lists. */
function convertParagraphLists(root) {
  const items = [];
  for (const node of elements(root, "p, div")) {
    if (tag(node) === "DIV" && elements(node, "p, div").length) continue;
    if (hasAncestor(node, new Set(["LI", "PRE", "TABLE"]), root)) continue;
    const item = paragraphListItem(node);
    if (item) items.push(item);
  }
  // Group items that follow each other as siblings.
  const runs = [];
  for (const item of items) {
    const run = runs.at(-1);
    const previous = run?.at(-1).node;
    let sibling = previous?.nextSibling;
    while (sibling && sibling.nodeType !== ELEMENT && !(sibling.nodeType === TEXT && sibling.nodeValue.trim())) sibling = sibling.nextSibling;
    if (run && sibling === item.node) run.push(item);
    else runs.push([item]);
  }
  for (const run of runs) {
    const doc = run[0].node.ownerDocument;
    const container = doc.createElement("div");
    const stack = [];
    for (const item of run) {
      const name = item.ordered ? "ol" : "ul";
      while (stack.length && stack.at(-1).level > item.level) stack.pop();
      if (stack.length && stack.at(-1).level === item.level && stack.at(-1).name !== name) stack.pop();
      if (!stack.length || stack.at(-1).level < item.level) {
        const list = doc.createElement(name);
        if (item.ordered && item.start !== 1) list.setAttribute("start", String(item.start));
        const parent = stack.length ? stack.at(-1).list.lastChild ?? stack.at(-1).list : container;
        parent.appendChild(list);
        stack.push({ level: item.level, name, list });
      }
      const li = doc.createElement("li");
      if (item.task) li.appendChild(checkbox(doc, item.task));
      while (item.node.firstChild) li.appendChild(item.node.firstChild);
      stack.at(-1).list.appendChild(li);
    }
    const first = run[0].node;
    while (container.firstChild) first.parentNode.insertBefore(container.firstChild, first);
    for (const item of run) remove(item.node);
  }
}

/** "☐ text" / "☑ text" list items (Holocron's and others' HTML) → checkboxes. */
function convertTaskCharacters(root) {
  for (const li of elements(root, "li")) {
    if (elements(li, "input").length) continue;
    const first = textNodes(li).find((text) => text.nodeValue.trim());
    const match = first && TASK_START.exec(first.nodeValue);
    if (!match) continue;
    first.nodeValue = first.nodeValue.slice(match[0].length);
    li.insertBefore(checkbox(li.ownerDocument, TASK_CHARS[match[1]]), li.firstChild);
  }
}

/** Styled spans (Google Docs, Word, Outlook) → <strong>/<em>/<del>/<mark>/<code>. */
function convertStyledSpans(root) {
  for (const node of elements(root, "span, font, b, strong, i, em")) {
    const name = tag(node);
    const format = formattingOf(node);
    if ((name === "B" || name === "STRONG") && format.notBold) {
      unwrap(node); // Google Docs wraps everything in <b style="font-weight:normal">
      continue;
    }
    if ((name === "I" || name === "EM") && format.notItalic) {
      unwrap(node);
      continue;
    }
    if (name !== "SPAN" && name !== "FONT") continue;
    if (!node.textContent.trim() || hasAncestor(node, CODE_PARENTS, null)) continue;
    const wrappers = [];
    if (format.monospace) wrappers.push("code");
    else {
      if (format.bold && !hasAncestor(node, new Set([...HEADINGS, "TH", "B", "STRONG"]), null)) wrappers.push("strong");
      if (format.italic && !hasAncestor(node, new Set(["I", "EM"]), null)) wrappers.push("em");
      if (format.strike && !hasAncestor(node, new Set(["S", "DEL", "STRIKE"]), null)) wrappers.push("del");
      if (format.highlight && !hasAncestor(node, new Set(["MARK"]), null)) wrappers.push("mark");
    }
    if (!wrappers.length) continue;
    const doc = node.ownerDocument;
    let inner = node;
    for (const wrapper of wrappers) {
      const element = doc.createElement(wrapper);
      while (inner.firstChild) element.appendChild(inner.firstChild);
      inner.appendChild(element);
      inner = element;
    }
  }
}

const SAME = { B: "strong", STRONG: "strong", I: "em", EM: "em", S: "del", STRIKE: "del", DEL: "del", MARK: "mark", CODE: "code" };

/** One name per format, no format nested in itself, adjacent runs merged (Word splits runs: <b>Hel</b><b>lo</b>). */
function normaliseInline(root) {
  for (const node of elements(root, "b, i, s, strike")) rename(node, SAME[tag(node)]);
  for (const node of elements(root, "strong, em, del, mark, code")) {
    const name = tag(node);
    if (hasAncestor(node, new Set([name]), null)) unwrap(node);
    else if (name === "STRONG" && hasAncestor(node, new Set([...HEADINGS, "TH"]), null)) unwrap(node);
  }
  // A header row typed in bold (Word, Excel): the header is bold already.
  for (const table of elements(root, "table")) {
    const first = ownRows(table)[0];
    for (const cell of first ? cellsOf(first) : []) {
      const text = cell.textContent.trim();
      for (const strong of elements(cell, "strong")) if (text && strong.textContent.trim() === text) unwrap(strong);
    }
  }
  for (const node of elements(root, "strong, em, del, mark, code")) {
    if (!node.parentNode) continue;
    let next = node.nextSibling;
    while (next && tag(next) === tag(node) && !hasAncestor(node, new Set(["PRE"]), null)) {
      while (next.firstChild) node.appendChild(next.firstChild);
      const after = next.nextSibling;
      remove(next);
      next = after;
    }
  }
}

/** Non-breaking spaces become spaces, invisible characters go (outside code). */
function normaliseText(root) {
  for (const text of textNodes(root)) {
    if (hasAncestor(text, CODE_PARENTS, null)) continue;
    text.nodeValue = text.nodeValue.replace(/\u00a0/g, " ").replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "");
  }
}

// ---------- Analysis ----------

const PLAIN_ELEMENTS = new Set(["HTML", "HEAD", "BODY", "P", "DIV", "SPAN", "BR", "FONT", "SECTION", "ARTICLE", "MAIN", "CENTER", "O:P"]);

/**
 * Whether the HTML carries nothing markdown could add (only text, <p>, <div>,
 * <span>, <br>), or is a code editor's coloured copy (VS Code: monospace with
 * white-space: pre) — then the clipboard's text/plain is pasted as it is.
 */
function isTriviallyPlain(root) {
  for (const node of elements(root, "*")) {
    const name = tag(node);
    const format = formattingOf(node);
    if (format.pre && format.monospace) return true;
    if (!PLAIN_ELEMENTS.has(name)) return false;
    if (name === "SPAN" || name === "FONT") {
      if (format.bold || format.italic || format.strike || format.highlight) return false;
    }
  }
  return true;
}

/** The image an <img> src refers to: "data", "file", "remote" or "other". */
export function imageKind(src) {
  const value = String(src ?? "").trim();
  if (/^data:image\/[\w.+-]+;base64,/i.test(value)) return "data";
  if (/^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) return "file";
  if (/^https?:\/\//i.test(value)) return "remote";
  return "other";
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/i;

/** A file:/// URL (or a bare Windows path) as a Windows path, or null. */
export function fileUrlToPath(url) {
  const value = String(url ?? "").trim();
  if (/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) return value.replace(/\//g, "\\");
  const match = /^file:(?:\/\/([^/]*))?(\/.*)$/i.exec(value);
  if (!match) return null;
  let path;
  try {
    path = decodeURIComponent(match[2].replace(/[?#].*$/, ""));
  } catch {
    return null;
  }
  const host = match[1] ?? "";
  if (host && host.toLowerCase() !== "localhost") return `\\\\${host}${path.replace(/\//g, "\\")}`;
  if (/^\/[a-z]:/i.test(path)) path = path.slice(1);
  return path.replace(/\//g, "\\");
}

/**
 * Parses and cleans clipboard HTML. Returns the cleaned root plus what the
 * paste needs to decide: `holocron` (Holocron's own rich copy, whose
 * text/plain is the original markdown), `plain` (nothing worth converting),
 * `onlyImages` (just pictures, e.g. "Copy image" in a browser) and the local
 * `images` that must be saved as attachments before converting.
 */
export function analyzeHtml(html, options = {}) {
  const source = String(html ?? "");
  const holocron = /\bdata-holocron-copy\b/.test(source);
  const doc = (options.parse ?? defaultParse)(cleanSource(source));
  const root = doc.body ?? doc.documentElement ?? doc;
  dropJunk(root);
  const plain = isTriviallyPlain(root);
  convertMentions(root);
  convertWordStyles(root);
  convertParagraphLists(root);
  convertTaskCharacters(root);
  convertStyledSpans(root);
  normaliseInline(root);
  normaliseText(root);
  const images = [];
  const seen = new Set();
  for (const img of elements(root, "img")) {
    const src = (img.getAttribute("src") ?? "").trim();
    const kind = imageKind(src);
    if (seen.has(src) || (kind !== "data" && kind !== "file")) continue;
    if (kind === "file") {
      const path = fileUrlToPath(src);
      if (!path || !IMAGE_FILE.test(path)) continue;
      seen.add(src);
      images.push({ src, kind, path });
    } else {
      seen.add(src);
      const mime = /^data:(image\/[\w.+-]+);/i.exec(src)[1].toLowerCase();
      images.push({ src, kind, mime, data: src.slice(src.indexOf(",") + 1) });
    }
  }
  const text = root.textContent.replace(/\s+/g, "");
  const onlyImages = elements(root, "img").length > 0 && !text && !elements(root, "table, hr, pre, input").length;
  return { root, holocron, plain, onlyImages, images };
}

// ---------- Escaping ----------

/**
 * Escapes text so it stays text, without Turndown's blanket escaping (which
 * turns C:\Users into C:\\Users and snake_case into snake\_case): only
 * characters that would start markdown syntax where they stand.
 */
export function escapeMarkdownText(text) {
  return text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\*(?=\S)|(?<=\S)\*/g, "\\*")
    .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "\\_")
    .replace(/~~/g, "\\~\\~")
    .replace(/==(?=\S)|(?<=\S)==/g, "\\=\\=")
    .replace(/\[(?=\[|\^)/g, "\\[")
    .replace(/\](?=[([])/g, "\\]")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<")
    .replace(/^(\s*)([-+*])(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)(-{3,}|_{3,})\s*$/, "$1\\$2")
    .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)>/, "$1\\>")
    .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
}

// ---------- Links and images ----------

/** Outlook's Safe Links wrap every URL; paste the real one. */
function unwrapSafeLink(url) {
  try {
    const parsed = new URL(url);
    if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(parsed.hostname)) {
      const inner = parsed.searchParams.get("url");
      if (inner && /^(https?:|mailto:)/i.test(inner)) return inner;
    }
  } catch {}
  return url;
}

/** http(s) and mailto links survive; javascript:, file:, relative and #anchor links lose their href. */
export function safeHref(href) {
  const value = String(href ?? "").trim();
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  return unwrapSafeLink(value);
}

const linkDestination = (url) => url.replace(/[ ()<>]/g, (ch) => ({ " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" })[ch]);
const escapeLabel = (text) => text.replace(/([[\]])/g, "\\$1");

// ---------- Code ----------

const CODE_BLOCKS = new Set(["DIV", "P", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

/** A code block's text: <br> and line <div>s become newlines. */
function codeText(node) {
  let out = "";
  const walk = (parent) => {
    for (const child of children(parent)) {
      if (child.nodeType === TEXT) out += child.nodeValue;
      else if (child.nodeType === ELEMENT) {
        const name = tag(child);
        if (name === "BR") out += "\n";
        else if (CODE_BLOCKS.has(name)) {
          if (out && !out.endsWith("\n")) out += "\n";
          walk(child);
          if (!out.endsWith("\n")) out += "\n";
        } else walk(child);
      }
    }
  };
  walk(node);
  return out.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

const NO_LANGUAGE = new Set(["none", "plain", "plaintext", "text", "nohighlight", "no-highlight", "txt"]);

/** The language of a code block from its (or its <code>'s or wrapper's) class: language-x, lang-x, highlight-source-x, brush: x. */
export function codeLanguage(node) {
  const candidates = [node, ...elements(node, "code"), node.parentNode, node.parentNode?.parentNode].filter((n) => n?.getAttribute);
  for (const candidate of candidates) {
    const data = candidate.getAttribute("data-lang") ?? candidate.getAttribute("data-language");
    if (data && /^[\w+#.-]+$/.test(data)) return normaliseLanguage(data);
    const classes = candidate.getAttribute("class") ?? "";
    const match = /(?:^|\s)(?:language|lang|highlight-source|highlight)-([\w+#.-]+)/i.exec(classes) ?? /brush:\s*([\w+#.-]+)/i.exec(classes);
    if (match) return normaliseLanguage(match[1]);
  }
  return "";
}

const normaliseLanguage = (language) => (NO_LANGUAGE.has(language.toLowerCase()) ? "" : language.toLowerCase());

// ---------- Tables ----------

const CELL = "\uE000";
const ROW = "\uE001";
const HEADER = "\uE002";

function ownRows(table) {
  const rows = [];
  for (const child of children(table)) {
    if (tag(child) === "TR") rows.push(child);
    else if (["THEAD", "TBODY", "TFOOT"].includes(tag(child))) rows.push(...children(child).filter((row) => tag(row) === "TR"));
  }
  return rows;
}

const cellsOf = (row) => children(row).filter((cell) => tag(cell) === "TD" || tag(cell) === "TH");

/** A table with two or more columns; one-column tables are page layout (email templates). */
function isDataTable(table) {
  return ownRows(table).some((row) => cellsOf(row).reduce((sum, cell) => sum + Math.max(1, Number(cell.getAttribute("colspan")) || 1), 0) >= 2);
}

function insideDataTable(node) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (tag(parent) === "TABLE" && isDataTable(parent)) return true;
  }
  return false;
}

const cellText = (content) => content.trim().replace(/\n{2,}/g, "\n").replace(/\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|");

function cellAlign(cell) {
  const align = (cell?.getAttribute("align") ?? styleOf(cell ?? { getAttribute: () => null })["text-align"] ?? "").toLowerCase();
  return align === "center" ? "center" : align === "right" ? "right" : null;
}

// ---------- Turndown ----------

function trimNewlines(text) {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

function createTurndown(options) {
  const lookup = (src) => (options.images instanceof Map ? options.images.get(src) : options.images?.[src]) ?? null;
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    br: "",
    linkStyle: "inlined",
  });
  service.escape = escapeMarkdownText;

  service.addRule("heading", {
    filter: (node) => HEADINGS.has(tag(node)),
    replacement: (content, node) => {
      const text = content.replace(/\s*\n+\s*/g, " ").trim();
      return text ? `\n\n${"#".repeat(Number(tag(node)[1]))} ${text}\n\n` : "";
    },
  });
  service.addRule("div", {
    filter: (node) => tag(node) === "DIV",
    replacement: (content) => `\n${content}\n`,
  });
  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const parent = node.parentNode;
      let prefix = "- ";
      if (tag(parent) === "OL") {
        const start = Number(parent.getAttribute("start")) || 1;
        const index = children(parent).filter((child) => tag(child) === "LI").indexOf(node);
        prefix = `${start + Math.max(0, index)}. `;
      }
      let text = trimNewlines(content);
      if (!/^\s*(`{3,}|~{3,})/m.test(text)) text = text.replace(/\n[ \t]*\n+/g, "\n");
      text = text.replace(/^\[( |x)\]\s*/, "[$1] ").replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
      let next = node.nextSibling;
      while (next && next.nodeType === TEXT && !next.nodeValue.trim()) next = next.nextSibling;
      return prefix + text + (next ? "\n" : "");
    },
  });
  service.addRule("checkbox", {
    filter: (node) => tag(node) === "INPUT" && (node.getAttribute("type") ?? "").toLowerCase() === "checkbox",
    replacement: (_content, node) => (node.hasAttribute("checked") ? "[x] " : "[ ] "),
  });
  service.addRule("codeBlock", {
    filter: "pre",
    replacement: (_content, node) => {
      const code = codeText(node);
      if (!code.trim()) return "";
      const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return `\n\n${fence}${codeLanguage(node)}\n${code}\n${fence}\n\n`;
    },
  });
  service.addRule("strikethrough", {
    filter: ["del", "s", "strike"],
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  });
  service.addRule("highlight", {
    filter: "mark",
    replacement: (content) => (content.trim() ? `==${content}==` : content),
  });
  service.addRule("htmlInline", {
    filter: ["sup", "sub", "kbd", "u"],
    replacement: (content, node) => {
      const name = tag(node).toLowerCase();
      return content.trim() ? `<${name}>${content}</${name}>` : content;
    },
  });
  service.addRule("link", {
    filter: (node) => tag(node) === "A",
    replacement: (content, node) => {
      const href = safeHref(node.getAttribute("href"));
      const text = content.replace(/\s*\n+\s*/g, " ");
      if (!href || !text.trim()) return text;
      if (/^!\[\[[^\]]*\]\]$/.test(text.trim())) return text; // an attachment embed can't be a link
      const visible = node.textContent.trim();
      if (visible === href || `mailto:${visible}` === href) return visible.includes(" ") ? `[${text}](${linkDestination(href)})` : visible;
      return `[${text}](${linkDestination(href)})`;
    },
  });
  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const src = (node.getAttribute("src") ?? "").trim();
      const alt = (node.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
      const resolved = lookup(src);
      if (resolved) return resolved;
      if (imageKind(src) === "remote") return `![${escapeLabel(alt)}](${linkDestination(src)})`;
      return alt ? escapeMarkdownText(alt) : "";
    },
  });

  // Tables: cells and rows are joined with private-use markers, which the table rule turns into a tidy pipe table.
  service.addRule("tableCell", {
    filter: ["td", "th"],
    replacement: (content, node) => content + CELL.repeat(Math.max(1, Math.min(50, Number(node.getAttribute("colspan")) || 1))),
  });
  service.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const header = tag(node.parentNode) === "THEAD" || (cellsOf(node).length > 0 && cellsOf(node).every((cell) => tag(cell) === "TH"));
      return (header ? HEADER : "") + content + ROW;
    },
  });
  service.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement: (content) => content,
  });
  service.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const rows = content
        .split(ROW)
        .map((row) => row.trim())
        .filter((row) => row.replace(HEADER, ""))
        .map((row) => {
          const cells = row.replace(HEADER, "").split(CELL);
          if (cells.length > 1) cells.pop();
          return cells;
        });
      if (!rows.length) return "";
      if (!isDataTable(node)) {
        // Layout table: its cells are just blocks.
        return `\n\n${rows.map((cells) => cells.map((cell) => cell.trim()).filter(Boolean).join("\n\n")).filter(Boolean).join("\n\n")}\n\n`;
      }
      if (insideDataTable(node)) {
        return rows.map((cells) => cells.map((cell) => cellText(cell)).filter(Boolean).join(" ")).join("<br>");
      }
      const grid = rows.map((cells) => cells.map(cellText)).filter((cells, index) => index === 0 || cells.some(Boolean));
      const columns = Math.max(...grid.map((cells) => cells.length));
      const pad = (cells) => Array.from({ length: columns }, (_, c) => ({ text: cells[c] ?? "" }));
      const firstRow = ownRows(node)[0];
      const align = Array.from({ length: columns }, (_, c) => cellAlign(cellsOf(firstRow ?? node)[c]));
      const { text } = formatTable({ header: pad(grid[0]), rows: grid.slice(1).map(pad), align });
      return `\n\n${text}\n\n`;
    },
  });
  return service;
}

// ---------- Tidying the result ----------

/** Trailing spaces off, at most one blank line in a row — outside fenced code. */
function tidy(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let fence = null;
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.trim().slice(marker[1].length).trim()) fence = null;
      continue;
    }
    if (marker) fence = marker[1];
    const trimmed = line.replace(/[ \t]+$/, "");
    if (!trimmed && (!out.length || out.at(-1) === "")) continue;
    out.push(trimmed);
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

// ---------- Entry points ----------

/** Markdown for an analysed (cleaned) HTML fragment; `images` maps local srcs to embed text. */
export function markdownFromAnalysis(analysis, options = {}) {
  const service = createTurndown(options);
  return tidy(service.turndown(analysis.root));
}

/**
 * Converts clipboard HTML to markdown. Options: `images` (Map or object: img
 * src → markdown to use, e.g. "![[Pasted image 20250101120000.png]]"),
 * `parse` (html → Document; defaults to DOMParser).
 */
export function htmlToMarkdown(html, options = {}) {
  return markdownFromAnalysis(analyzeHtml(html, options), options);
}
