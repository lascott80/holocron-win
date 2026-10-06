// Markdown → clean, email-safe HTML for rich copy (richCopy.js): what live
// preview shows, as HTML that pastes well into Outlook, Teams, Gmail and
// Word. Inline `style` attributes only (no classes or <style>), light colours
// whatever the app's theme (paste targets are white), and no fonts forced on
// body text so a paste adopts the destination's font.
//
// Pure and synchronous: images and diagrams that need loading are passed in
// already resolved (`images`, `diagrams`); anything missing gets a text
// placeholder. Raw HTML goes through `sanitize` (richCopy passes DOMPurify
// with the notes' sanitiser config); without one it's shown as text.
import { Marked } from "marked";
import { EMOJI } from "./emojiData.js";

const MONO = "Consolas, 'Cascadia Mono', monospace";
const MUTED = "#6b7280";
const RAISED = "#f4f5f7";
const BORDER = "#cdd1d7";

export const STYLES = {
  p: "margin: 0 0 10px 0;",
  heading: (depth) => `font-size: ${["1.6em", "1.35em", "1.17em", "1.05em", "1em", "0.95em"][depth - 1]}; font-weight: 600; line-height: 1.25; margin: ${depth <= 2 ? "18px" : "14px"} 0 8px 0;`,
  code: `font-family: ${MONO}; font-size: 0.9em; background-color: ${RAISED}; border-radius: 4px; padding: 1px 4px;`,
  pre: `font-family: ${MONO}; font-size: 0.9em; line-height: 1.45; background-color: ${RAISED}; border: 1px solid #e3e5e9; border-radius: 6px; padding: 12px; margin: 0 0 10px 0; white-space: pre-wrap;`,
  blockquote: `margin: 0 0 10px 0; padding: 0 0 0 12px; border-left: 3px solid ${BORDER}; color: #3a3f47;`,
  link: "color: #1f6fbf; text-decoration: underline;",
  mark: "background-color: #fff3a3; color: inherit;",
  hr: `border: 0; border-top: 1px solid ${BORDER}; margin: 14px 0;`,
  table: "border-collapse: collapse; margin: 0 0 10px 0;",
  cell: `border: 1px solid ${BORDER}; padding: 6px 12px; vertical-align: top;`,
  th: `background-color: ${RAISED}; font-weight: 600;`,
  list: (nested) => (nested ? "margin: 2px 0 2px 0; padding-left: 24px;" : "margin: 0 0 10px 0; padding-left: 24px;"),
  task: "list-style-type: none;",
  muted: `color: ${MUTED};`,
  displayMath: `font-family: ${MONO}; font-size: 0.95em; text-align: center; background-color: ${RAISED}; border-radius: 6px; padding: 8px 12px; margin: 0 0 10px 0;`,
  img: "max-width: 100%; height: auto;",
  footnotes: `font-size: 0.9em; color: ${MUTED}; border-top: 1px solid #e3e5e9; margin: 14px 0 0 0; padding: 6px 0 0 0;`,
};

/** Callout families (REQUIREMENTS ED-17, light colours from §16.5): [border, title]. */
const CALLOUT_COLOURS = {
  blue: [[31, 111, 191], [26, 95, 166]],
  green: [[31, 157, 92], [26, 115, 64]],
  purple: [[118, 84, 214], [98, 66, 186]],
  yellow: [[196, 146, 0], [128, 92, 0]],
  red: [[196, 47, 53], [168, 38, 43]],
  gray: [[107, 114, 128], [75, 81, 92]],
};
const CALLOUT_FAMILY = {
  green: ["tip", "hint", "success", "check", "done"],
  purple: ["question", "help", "faq", "example"],
  yellow: ["warning", "caution", "attention"],
  red: ["failure", "fail", "missing", "danger", "error", "bug"],
  gray: ["quote", "cite"],
};

const hex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
/** The colour at `alpha` over white (Outlook doesn't do rgba). */
const tint = (rgb, alpha) => hex(rgb.map((c) => 255 - (255 - c) * alpha));

function calloutColours(type) {
  const lower = type.toLowerCase();
  const family = Object.keys(CALLOUT_FAMILY).find((name) => CALLOUT_FAMILY[name].includes(lower)) ?? "blue";
  const [base, title] = CALLOUT_COLOURS[family];
  return { border: hex(base), background: tint(base, 0.1), title: hex(title) };
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
}

/** Like escapeHtml but keeps entities such as &amp;nbsp; (markdown decodes them). */
const escapeText = (text) => String(text).replace(/&(?!#?\w+;)/g, "&amp;").replace(/[<>"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);

// ---------- Emoji ----------

const SHORTCODE = /:([a-z0-9_+-]+):/g;

/** `:rocket:` → 🚀 with emoji.js's boundary rules (so 10:30:00 and URLs stay). */
export function emojify(text) {
  let lastEnd = -1;
  return text.replace(SHORTCODE, (whole, name, from) => {
    const before = text[from - 1] ?? "";
    const to = from + whole.length;
    if ((from !== lastEnd && /[\w/:]/.test(before)) || /\w/.test(text[to] ?? "") || !Object.hasOwn(EMOJI, name)) return whole;
    lastEnd = to;
    return EMOJI[name];
  });
}

// ---------- Targets ----------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i;
const PDF_EXT = /\.pdf$/i;

/** "▶ clip.mp4" / "🎵 song.mp3" / "📄 paper.pdf", or null for other files. */
export function mediaLabel(name) {
  const path = name.replace(/[?#].*$/, "");
  const file = path.split("/").pop();
  if (VIDEO_EXT.test(path)) return `▶ ${file}`;
  if (AUDIO_EXT.test(path)) return `🎵 ${file}`;
  if (PDF_EXT.test(path)) return `📄 ${file}`;
  return null;
}

/** The key an image is looked up by in `images`: kind "embed" (![[x]]) or "relative" (![](x), <img src>). */
export function imageKey(kind, target) {
  let path = String(target).trim();
  if (kind === "relative") {
    path = path.replace(/[?#].*$/, "");
    try {
      path = decodeURI(path);
    } catch {}
  }
  return `${kind}:${path}`;
}

const isRemote = (src) => /^https?:\/\//i.test(src);
const isDataImage = (src) => /^data:image\//i.test(src);

/** `<img>` srcs in a piece of raw HTML. */
function htmlImageSources(html) {
  const found = [];
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);
    if (src) found.push(src[1] ?? src[2] ?? src[3]);
  }
  return found;
}

// ---------- Preparing the text ----------

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;

/** Splits text into fenced-code and other segments, so syntax isn't touched inside code. */
function segments(text) {
  const lines = text.split("\n");
  const parts = [];
  let current = { code: false, lines: [] };
  const push = () => current.lines.length && parts.push({ code: current.code, text: current.lines.join("\n") });
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]);
    if (!fence) {
      current.lines.push(lines[i]);
      continue;
    }
    push();
    const close = new RegExp(`^\\s{0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
    const code = [lines[i]];
    while (++i < lines.length) {
      code.push(lines[i]);
      if (close.test(lines[i])) break;
    }
    parts.push({ code: true, text: code.join("\n") });
    current = { code: false, lines: [] };
  }
  push();
  return parts;
}

/** Footnote definitions in a note (label → text), outside code. */
function footnoteDefinitions(text) {
  const definitions = new Map();
  for (const part of segments(text)) {
    if (part.code) continue;
    for (const match of part.text.matchAll(FOOTNOTE_DEF)) if (!definitions.has(match[1])) definitions.set(match[1], match[2]);
  }
  return definitions;
}

/** Footnote labels in order of first reference (outside code): label → number. */
function footnoteNumbers(text) {
  const numbers = new Map();
  for (const part of segments(text)) {
    if (part.code) continue;
    for (const match of part.text.replace(FOOTNOTE_DEF, "").matchAll(FOOTNOTE_REF)) {
      if (!numbers.has(match[1])) numbers.set(match[1], numbers.size + 1);
    }
  }
  return numbers;
}

/**
 * The markdown as marked should see it: CRLF → LF, frontmatter removed (when
 * `stripFrontmatter`), %% comments, footnote definitions and block ids
 * dropped outside fenced code.
 */
export function prepareMarkdown(markdown, { stripFrontmatter = true } = {}) {
  let text = String(markdown).replace(/\r\n?/g, "\n");
  if (stripFrontmatter) {
    const front = /^---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
    if (front) text = text.slice(front[0].length);
  }
  return segments(text)
    .map((part) => {
      if (part.code) return part.text;
      return part.text
        .replace(/%%[\s\S]*?%%/g, "")
        .replace(FOOTNOTE_DEF, "")
        .replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, "")
        .replace(/^\^[A-Za-z0-9-]+[ \t]*$/gm, "");
    })
    .join("\n");
}

// ---------- Marked extensions ----------

const CLOSE_MATH = /\$\$\s*$/;
const isSpace = (ch) => ch === undefined || /\s/.test(ch);

/** `$$ … $$` on their own lines (no blank line inside), or `$$x$$` on one line. */
const displayMath = {
  name: "displayMath",
  level: "block",
  start(src) {
    const match = /^ {0,3}\$\$/m.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const open = /^ {0,3}\$\$/.exec(src);
    if (!open) return undefined;
    const lines = src.split("\n");
    const rest = lines[0].slice(open[0].length);
    let end = 0;
    let source;
    if (CLOSE_MATH.test(rest)) source = rest.replace(CLOSE_MATH, "");
    else {
      end = 1;
      while (end < lines.length && lines[end].trim() && !CLOSE_MATH.test(lines[end])) end++;
      if (end >= lines.length || !lines[end].trim()) return undefined;
      source = [rest, ...lines.slice(1, end), lines[end].replace(CLOSE_MATH, "")].join("\n");
    }
    source = source.trim();
    if (!source) return undefined;
    const raw = lines.slice(0, end + 1).join("\n") + (end + 1 < lines.length ? "\n" : "");
    return { type: "displayMath", raw, text: source };
  },
};

/** Pandoc-style `$…$`: no space after the opening `$`, none before the closing one, no digit after it. */
const inlineMath = {
  name: "inlineMath",
  level: "inline",
  start(src) {
    const index = src.indexOf("$");
    return index >= 0 ? index : undefined;
  },
  tokenizer(src) {
    if (src[0] !== "$" || src[1] === "$" || isSpace(src[1])) return undefined;
    for (let j = 1; j < src.length && src[j] !== "\n"; j++) {
      if (src[j] === "\\") {
        j++;
        continue;
      }
      if (src[j] !== "$") continue;
      if (src[j + 1] === "$" || isSpace(src[j - 1]) || /[0-9]/.test(src[j + 1] ?? "")) return undefined;
      return { type: "inlineMath", raw: src.slice(0, j + 1), text: src.slice(1, j) };
    }
    return undefined;
  },
};

/** `> [!type]± Title` and the quote lines after it. */
const callout = {
  name: "callout",
  level: "block",
  childTokens: ["titleTokens", "tokens"],
  start(src) {
    const match = /^ {0,3}> ?\[![\w-]+\]/m.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^ {0,3}> ?\[!([\w-]+)\][+-]?[ \t]*([^\n]*)(?:\n|$)((?: {0,3}>[^\n]*(?:\n|$))*)/.exec(src);
    if (!match) return undefined;
    const body = match[3].replace(/^ {0,3}> ?/gm, "");
    const token = { type: "callout", raw: match[0], kind: match[1], title: match[2].trim(), titleTokens: [], tokens: [] };
    this.lexer.inline(token.title, token.titleTokens);
    this.lexer.blockTokens(body, token.tokens);
    return token;
  },
};

/** `==highlight==` (`===` isn't one). */
const highlight = {
  name: "highlight",
  level: "inline",
  start(src) {
    const index = src.indexOf("==");
    return index >= 0 ? index : undefined;
  },
  tokenizer(src) {
    const match = /^==(?!=)([^\n]*?[^=\n])==(?!=)/.exec(src);
    if (!match) return undefined;
    return { type: "highlight", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
  },
};

/** `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `![[embed]]`. */
const wikilink = {
  name: "wikilink",
  level: "inline",
  start(src) {
    const index = src.search(/!?\[\[/);
    return index >= 0 ? index : undefined;
  },
  tokenizer(src) {
    const match = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src);
    if (!match) return undefined;
    const bar = match[2].indexOf("|");
    const target = (bar >= 0 ? match[2].slice(0, bar) : match[2]).trim();
    const alias = bar >= 0 ? match[2].slice(bar + 1).trim() : "";
    const hash = target.search(/[#^]/);
    const path = (hash >= 0 ? target.slice(0, hash) : target).trim();
    const fragment = hash >= 0 ? target.slice(hash) : "";
    return { type: "wikilink", raw: match[0], embed: match[1] === "!", target, path, fragment, alias };
  },
};

/** `[^1]` footnote references. */
const footnoteRef = {
  name: "footnoteRef",
  level: "inline",
  start(src) {
    const index = src.indexOf("[^");
    return index >= 0 ? index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\^([^\]\s]+)\]/.exec(src);
    return match ? { type: "footnoteRef", raw: match[0], label: match[1] } : undefined;
  },
};

const EXTENSIONS = [displayMath, callout, inlineMath, highlight, wikilink, footnoteRef];

// ---------- Rendering ----------

function imgTag(image, alt) {
  const size = (image.width ? ` width="${Math.round(image.width)}"` : "") + (image.height ? ` height="${Math.round(image.height)}"` : "");
  return `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(alt)}"${size} style="${STYLES.img}">`;
}

/** Drops the bottom margin of a box's last block, so quotes and callouts don't end in a gap. */
const withoutLastMargin = (html) => html.replace(/margin: 0 0 10px 0;(?![\s\S]*margin: 0 0 10px 0;)/, "margin: 0;");

const placeholder = (text) => `<em style="${STYLES.muted}">[${escapeHtml(text)}]</em>`;

/** `alt|300` / `alt|300x200` → { alt, width }. */
function sizedAlt(alt) {
  const sized = /^(.*)\|(\d+)(?:x\d+)?$/.exec(alt);
  return sized ? { alt: sized[1], width: Number(sized[2]) } : { alt, width: null };
}

/** An image scaled to `width` (if given), keeping its aspect ratio. */
function resized(image, width) {
  if (!width || !image.width) return image;
  return { ...image, width, height: image.height ? (image.height * width) / image.width : undefined };
}

function createMarked(options, state) {
  const { images = {}, diagrams = {}, sanitize = null, highlight: highlightCode = null } = options;
  let listDepth = 0;
  const lookupImage = (kind, target) => images[imageKey(kind, target)] ?? null;

  const renderer = {
    heading({ tokens, depth }) {
      return `<h${depth} style="${STYLES.heading(depth)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    paragraph({ tokens }) {
      return `<p style="${STYLES.p}">${this.parser.parseInline(tokens)}</p>\n`;
    },
    blockquote({ tokens }) {
      return `<blockquote style="${STYLES.blockquote}">\n${withoutLastMargin(this.parser.parse(tokens))}</blockquote>\n`;
    },
    hr() {
      return `<hr style="${STYLES.hr}">\n`;
    },
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        const diagram = diagrams[text];
        if (diagram?.src) return `<p style="${STYLES.p}">${imgTag(diagram, "Diagram")}</p>\n`;
        return `<p style="${STYLES.p}">${placeholder("Diagram")}</p>\n`;
      }
      const body = (language && highlightCode?.(text, language)) || escapeHtml(text);
      return `<pre style="${STYLES.pre}">${body}</pre>\n`;
    },
    codespan({ text }) {
      return `<code style="${STYLES.code}">${escapeHtml(text)}</code>`;
    },
    list(token) {
      const tag = token.ordered ? "ol" : "ul";
      const start = token.ordered && token.start !== "" && token.start !== 1 ? ` start="${Number(token.start)}"` : "";
      listDepth++;
      const items = token.items.map((item) => this.listitem(item)).join("");
      listDepth--;
      return `<${tag}${start} style="${STYLES.list(listDepth > 0)}">\n${items}</${tag}>\n`;
    },
    listitem(item) {
      const style = item.task ? ` style="${STYLES.task}"` : "";
      return `<li${style}>${this.parser.parse(item.tokens).trim()}</li>\n`;
    },
    checkbox({ checked }) {
      // Email clients strip <input>, so tasks are boxes drawn as characters.
      return checked ? "☑ " : "☐ ";
    },
    table(token) {
      const cell = (c) => {
        const tag = c.header ? "th" : "td";
        const align = c.align ? ` text-align: ${c.align};` : c.header ? " text-align: left;" : "";
        return `<${tag} style="${STYLES.cell}${c.header ? ` ${STYLES.th}` : ""}${align}">${this.parser.parseInline(c.tokens)}</${tag}>`;
      };
      const head = `<tr>${token.header.map(cell).join("")}</tr>`;
      const body = token.rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("\n");
      return `<table style="${STYLES.table}">\n<thead>${head}</thead>\n${body ? `<tbody>\n${body}\n</tbody>\n` : ""}</table>\n`;
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (/^(?:https?:|mailto:)/i.test(href ?? "")) return `<a href="${escapeHtml(href)}" style="${STYLES.link}">${label}</a>`;
      return label; // note links and other schemes don't work outside the vault
    },
    image({ href, text }) {
      const { alt, width } = sizedAlt(text ?? "");
      const src = String(href ?? "");
      const media = mediaLabel(src);
      if (media && !IMAGE_EXT.test(src.replace(/[?#].*$/, ""))) return escapeHtml(media);
      if (isRemote(src) || isDataImage(src)) return imgTag({ src, width }, alt);
      const image = lookupImage("relative", src);
      if (image) return imgTag(resized(image, width), alt);
      return placeholder(`Image: ${alt || src.split("/").pop()}`);
    },
    strong({ tokens }) {
      return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    },
    em({ tokens }) {
      return `<em>${this.parser.parseInline(tokens)}</em>`;
    },
    del({ tokens }) {
      return `<s>${this.parser.parseInline(tokens)}</s>`;
    },
    br() {
      return "<br>";
    },
    html({ text }) {
      const html = text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
      if (!html.trim()) return "";
      return sanitize ? html : escapeHtml(html);
    },
    text(token) {
      if (token.tokens) return this.parser.parseInline(token.tokens);
      return emojify(token.escaped ? token.text : escapeText(token.text));
    },
  };

  const extensionRenderers = {
    displayMath: ({ text }) => `<p style="${STYLES.displayMath}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>\n`,
    inlineMath: ({ text }) => `<code style="${STYLES.code}">${escapeHtml(text)}</code>`,
    callout(token) {
      const colours = calloutColours(token.kind);
      const title = token.title ? this.parser.parseInline(token.titleTokens) : escapeHtml(token.kind[0].toUpperCase() + token.kind.slice(1).toLowerCase());
      const body = withoutLastMargin(this.parser.parse(token.tokens).trim());
      return `<table style="border-collapse: collapse; width: 100%; margin: 0 0 10px 0;"><tr><td style="border-left: 4px solid ${colours.border}; background-color: ${colours.background}; padding: 10px 14px;">`
        + `<p style="margin: 0${body ? " 0 6px 0" : ""}; font-weight: 600; color: ${colours.title};">${title}</p>${body}</td></tr></table>\n`;
    },
    highlight({ tokens }) {
      return `<mark style="${STYLES.mark}">${this.parser.parseInline(tokens)}</mark>`;
    },
    wikilink(token) {
      const { embed, path, fragment, alias } = token;
      if (embed) {
        if (IMAGE_EXT.test(path)) {
          const image = lookupImage("embed", path);
          const width = /^\d+(?:x\d+)?$/.test(alias) ? Number(alias.split("x")[0]) : null;
          const name = path.split("/").pop();
          return image ? imgTag(resized(image, width), name) : placeholder(`Image: ${name}`);
        }
        const media = mediaLabel(path);
        if (media) return escapeHtml(media);
        // Note embeds: just the title (and section), not the content.
        const heading = fragment.replace(/^#\^?|^\^/, "");
        return `<em>${escapeHtml([path, heading].filter(Boolean).join(" › ") || token.target)}</em>`;
      }
      // Vault links don't work in an email, so they're plain text (the label live preview shows).
      const label = alias || (path ? `${path}${fragment}` : fragment.replace(/^#\^?|^\^/, ""));
      return emojify(escapeHtml(label));
    },
    footnoteRef({ label }) {
      state.usedFootnotes.add(label);
      return `<sup>${state.footnoteNumbers.get(label) ?? "?"}</sup>`;
    },
  };

  const marked = new Marked({ gfm: true, breaks: true, async: false });
  marked.use({
    renderer,
    extensions: EXTENSIONS.map((extension) => ({ ...extension, renderer: extensionRenderers[extension.name] })),
  });
  return marked;
}

/**
 * The selection's markdown as email-safe HTML.
 * Options:
 * - images: { [imageKey(kind, target)]: { src, width?, height? } } — local images as data URIs.
 * - diagrams: { [mermaid code]: { src, width, height } } — rendered diagrams.
 * - sanitize(html) → html: cleans the result (raw HTML in notes); without it raw HTML is escaped.
 * - highlight(code, language) → HTML or null: syntax colours for code blocks.
 * - stripFrontmatter (default true): the text starts at the top of the note.
 * - context: the whole note, for footnote numbers and definitions outside the selection.
 */
export function markdownToHtml(markdown, options = {}) {
  const text = prepareMarkdown(markdown, options);
  const context = options.context ?? String(markdown);
  const state = { footnoteNumbers: footnoteNumbers(context), usedFootnotes: new Set() };
  const marked = createMarked(options, state);
  let html = marked.parse(text);
  if (state.usedFootnotes.size) {
    const definitions = new Map([...footnoteDefinitions(context), ...footnoteDefinitions(String(markdown))]);
    const notes = [...state.usedFootnotes]
      .filter((label) => definitions.has(label) && state.footnoteNumbers.has(label))
      .sort((a, b) => state.footnoteNumbers.get(a) - state.footnoteNumbers.get(b))
      .map((label) => `<p style="margin: 0 0 4px 0;">${state.footnoteNumbers.get(label)}. ${marked.parseInline(definitions.get(label))}</p>`);
    if (notes.length) html += `<div style="${STYLES.footnotes}">${notes.join("")}</div>\n`;
  }
  html = `<div>${html.trim()}</div>`;
  return options.sanitize ? options.sanitize(html) : html;
}

/**
 * What the HTML for `markdown` needs loaded: local images (image keys with
 * their kind and target), Mermaid diagrams (code) and code-block languages.
 */
export function collectResources(markdown, options = {}) {
  const text = prepareMarkdown(markdown, options);
  const marked = createMarked({}, { footnoteNumbers: new Map(), usedFootnotes: new Set() });
  const images = new Map();
  const diagrams = new Set();
  const languages = new Set();
  const addImage = (kind, target) => {
    const key = imageKey(kind, target);
    if (!images.has(key)) images.set(key, { key, kind, target: key.slice(kind.length + 1) });
  };
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, (token) => {
    if (token.type === "wikilink" && token.embed && IMAGE_EXT.test(token.path)) addImage("embed", token.path);
    else if (token.type === "image") {
      const src = String(token.href ?? "");
      if (!isRemote(src) && !isDataImage(src) && !/^[a-z][a-z0-9+.-]*:/i.test(src) && IMAGE_EXT.test(src.replace(/[?#].*$/, ""))) addImage("relative", src);
    } else if (token.type === "code") {
      const language = (token.lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") diagrams.add(token.text);
      else if (language) languages.add(language);
    } else if (token.type === "html") {
      for (const src of htmlImageSources(token.text)) {
        if (src && !isRemote(src) && !isDataImage(src) && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")) addImage("relative", src);
      }
    }
  });
  return { images: [...images.values()], diagrams: [...diagrams], languages: [...languages] };
}
