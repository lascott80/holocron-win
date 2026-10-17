// Rewrites link targets inside markdown text, leaving everything else
// byte-for-byte alone. Used to keep links working when notes are renamed
// or moved. Links inside code blocks and inline code are never touched.

import { percentDecode, type LinkKind } from "./noteParser";

/**
 * A link as written: its path part (no #heading / ^block / |alias) and kind.
 * `syntax` says exactly how it was written; HTML attributes and reference
 * definitions are "markdown" kind (paths), property values "wiki" kind (names).
 */
export interface Target {
  path: string;
  kind: LinkKind;
  syntax?: "wiki" | "markdown" | "html" | "reference" | "property";
}

export interface RewriteOptions {
  /**
   * Also visit the other ways a note can point at a file: HTML `src`/`href`
   * attributes (`<img src="…">`, `<video>`, `<a href>`…), reference
   * definitions (`[1]: path.png`) and plain property values in the
   * frontmatter (`cover: map.png`). Off for note links, which only use
   * wikilinks and markdown links.
   */
  extended?: boolean;
}

// [[target#heading|alias]] and ![[embed]]: group 2 is the path part.
const wiki = /(!?\[\[)([^\[\]\n|#^]*)((?:[#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\])/dg;
// [text](path#fragment "title") or [text](<path with spaces>): the
// destination is group 2 (angle-bracket form) or group 3.
const markdown = /(\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))/dg;
// <img …>, <video …>, <a …>…: whole tags, searched for path attributes below.
const htmlTag = /<(?:img|video|audio|source|track|embed|iframe|object|a)\b[^<>]*>/gi;
// src="…", href='…', poster="…", data="…": the value is group 2 or 3.
const htmlAttribute = /\s(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)')/dgi;
// [label]: <path> "title" or [label]: path (not footnotes, [^1]: …).
const reference = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(?:<([^>\n]+)>|(\S+))/d;
// key: value or "- value" in the frontmatter; the value (unquoted) is group 3.
const property = /^(\s*(?:-\s+|[A-Za-z0-9_][^:\n]*:\s+))(["']?)(.*?)\2\s*$/d;

type Range = [start: number, end: number];
type Transform = (target: Target) => string | null | undefined;

/**
 * Returns `text` with each link's path replaced by `transform(target)`
 * (or left alone when it returns null). For markdown links the path is
 * percent-decoded before `transform` sees it, and re-encoded the same
 * way the original was when written back. Returns `text` itself when
 * nothing changed, so CRLF and everything else stays identical.
 */
export function rewrite(text: string, transform: Transform, options: RewriteOptions = {}): string {
  const output: string[] = [];
  let changed = false;
  let fence: string | null = null;
  const lines = text.split("\n");
  // Frontmatter: "---" on the first line until the next "---" (or "...").
  let frontmatterEnd = -1;
  if (options.extended && lines[0]?.replace(/\r$/, "") === "---") {
    frontmatterEnd = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\r?$/.test(line));
  }
  lines.forEach((line, index) => {
    const trimmed = line.replace(/^[ \t]+/, "");
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      output.push(line);
      return;
    }
    if (index > frontmatterEnd && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      fence = trimmed.slice(0, 3);
      output.push(line);
      return;
    }
    let rewritten = rewriteLine(line, transform, options);
    if (index > 0 && index < frontmatterEnd) rewritten = rewriteProperty(rewritten, transform);
    if (rewritten !== line) changed = true;
    output.push(rewritten);
  });
  return changed ? output.join("\n") : text;
}

/** A plain file path or name as a frontmatter value ("cover: map.png"), not already a link. */
function rewriteProperty(line: string, transform: Transform): string {
  const body = line.endsWith("\r") ? line.slice(0, -1) : line;
  const match = property.exec(body);
  if (!match) return line;
  const value = match[3];
  if (value === "" || value.includes("[[") || value.includes("](") || value.includes("://")) return line;
  const replacement = transform({ path: value, kind: "wiki", syntax: "property" });
  if (replacement == null || replacement === value) return line;
  const [start, end] = match.indices![3] as Range;
  // A bare YAML value with ": " or " #" would change meaning; quote it.
  const quoted = match[2] === "" && /: | #|^[\s"'&*!|>%@`[\]{},#?-]/.test(replacement) ? `"${replacement.replace(/"/g, '\\"')}"` : replacement;
  return body.slice(0, start) + quoted + body.slice(end) + (body === line ? "" : "\r");
}

function rewriteLine(line: string, transform: Transform, options: RewriteOptions = {}): string {
  const extended = options.extended === true;
  if (!line.includes("[") && !(extended && line.includes("<"))) return line;
  const codeSpans = inlineCodeRanges(line);
  const inCode = (start: number, end: number) => codeSpans.some(([s, e]) => s < end && start < e);
  const replacements: { range: Range; text: string }[] = [];
  /** A path in a URL-like position (markdown destination, HTML attribute): decoded for `transform`. */
  // `plain`: a bare markdown destination (spaces must be escaped). Otherwise
  // (angle brackets, HTML) a path is re-encoded only if the original was.
  const visitPath = (destination: string, range: Range, syntax: Target["syntax"], plain: boolean) => {
    if (destination.includes(":")) return; // http:, mailto:, data: …
    const hashIndex = destination.indexOf("#");
    const encodedPath = hashIndex < 0 ? destination : destination.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : destination.slice(hashIndex);
    const path = percentDecode(encodedPath) ?? encodedPath;
    if (path === "") return;
    const replacement = transform({ path, kind: "markdown", syntax });
    if (replacement == null) return;
    const wasEncoded = plain ? encodedPath !== path || !path.includes(" ") : encodedPath !== path;
    const written = wasEncoded ? encodeMarkdownPath(replacement) : replacement;
    if (written === encodedPath) return;
    replacements.push({ range, text: written + fragment });
  };

  for (const match of line.matchAll(wiki)) {
    const start = match.index, end = start + match[0].length;
    if (inCode(start, end)) continue;
    const pathRange = match.indices![2] as Range;
    const path = match[2];
    // Keep any spacing around the target, as in "[[ Ilum ]]".
    const [, leading, trimmed, trailing] = /^([\p{Zs}\t]*)(.*?)([\p{Zs}\t]*)$/su.exec(path)!;
    if (trimmed === "") continue;
    const replacement = transform({ path: trimmed, kind: "wiki", syntax: "wiki" });
    if (replacement == null) continue;
    const written = leading + replacement + trailing;
    if (written === path) continue;
    replacements.push({ range: pathRange, text: written });
  }
  for (const match of line.matchAll(markdown)) {
    const start = match.index, end = start + match[0].length;
    if (inCode(start, end)) continue;
    const isAngled = match[2] !== undefined;
    const destinationRange = match.indices![isAngled ? 2 : 3] as Range;
    const destination = (isAngled ? match[2] : match[3])!;
    if (destination.includes(":")) continue; // http:, mailto: …
    const hashIndex = destination.indexOf("#");
    const encodedPath = hashIndex < 0 ? destination : destination.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : destination.slice(hashIndex);
    const path = percentDecode(encodedPath) ?? encodedPath;
    if (path === "") continue;
    const replacement = transform({ path, kind: "markdown", syntax: "markdown" });
    if (replacement == null) continue;
    // <angle brackets> allow raw spaces; otherwise match the original's escaping.
    const wasEncoded = !isAngled && (encodedPath !== path || !path.includes(" "));
    const written = wasEncoded ? encodeMarkdownPath(replacement) : replacement;
    if (written === encodedPath) continue;
    replacements.push({ range: destinationRange, text: written + fragment });
  }
  if (extended) {
    const definition = reference.exec(line);
    if (definition && !inCode(0, definition[0].length)) {
      const isAngled = definition[2] !== undefined;
      visitPath((isAngled ? definition[2] : definition[3])!, definition.indices![isAngled ? 2 : 3] as Range, "reference", !isAngled);
    }
    for (const tag of line.matchAll(htmlTag)) {
      const tagStart = tag.index, tagEnd = tagStart + tag[0].length;
      if (inCode(tagStart, tagEnd)) continue;
      for (const attribute of tag[0].matchAll(htmlAttribute)) {
        const group = attribute[1] !== undefined ? 1 : 2;
        const [start, end] = attribute.indices![group] as Range;
        visitPath(attribute[group]!, [tagStart + start, tagStart + end], "html", false);
      }
    }
  }
  if (replacements.length === 0) return line;

  let result = line;
  for (const { range, text } of replacements.sort((a, b) => b.range[0] - a.range[0])) {
    result = result.slice(0, range[0]) + text + result.slice(range[1]);
  }
  return result;
}

/** UTF-16 ranges of `code spans` (backtick pairs) in a line. */
function inlineCodeRanges(line: string): Range[] {
  const ranges: Range[] = [];
  let start: number | null = null;
  for (let offset = line.indexOf("`"); offset >= 0; offset = line.indexOf("`", offset + 1)) {
    if (start === null) {
      start = offset;
    } else {
      ranges.push([start, offset + 1]);
      start = null;
    }
  }
  return ranges;
}

/** Path characters that can stay unescaped in a markdown link: URL path characters minus `()[]<>` and space. */
const markdownPathAllowed = /^[A-Za-z0-9!$&'*+,\-./:;=@_~]$/;
const encoder = new TextEncoder();

/** Percent-encodes everything else as UTF-8, like `addingPercentEncoding(withAllowedCharacters:)`. */
export function encodeMarkdownPath(path: string): string {
  let result = "";
  for (const character of path) {
    if (markdownPathAllowed.test(character)) {
      result += character;
    } else {
      for (const byte of encoder.encode(character)) result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return result;
}

/**
 * The path from a note in `fromFolder` to `target` (both vault-relative),
 * e.g. from "Lore/Crystals" to "Orders/Saber.md" → "../../Orders/Saber.md".
 */
export function relativePath(fromFolder: string, target: string): string {
  const from = fromFolder.split("/").filter((part) => part !== "");
  const to = target.split("/").filter((part) => part !== "");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const ups: string[] = Array(from.length - common).fill("..");
  return [...ups, ...to.slice(common)].join("/");
}
