// Rewrites link targets inside markdown text, leaving everything else
// byte-for-byte alone. Used to keep links working when notes are renamed
// or moved. Links inside code blocks and inline code are never touched.

import { percentDecode, type LinkKind } from "./noteParser";

/** A link as written: its path part (no #heading / ^block / |alias) and kind. */
export interface Target {
  path: string;
  kind: LinkKind;
}

// [[target#heading|alias]] and ![[embed]]: group 2 is the path part.
const wiki = /(!?\[\[)([^\[\]\n|#^]*)((?:[#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\])/dg;
// [text](path#fragment "title") or [text](<path with spaces>): the
// destination is group 2 (angle-bracket form) or group 3.
const markdown = /(\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))/dg;

type Range = [start: number, end: number];

/**
 * Returns `text` with each link's path replaced by `transform(target)`
 * (or left alone when it returns null). For markdown links the path is
 * percent-decoded before `transform` sees it, and re-encoded the same
 * way the original was when written back. Returns `text` itself when
 * nothing changed, so CRLF and everything else stays identical.
 */
export function rewrite(text: string, transform: (target: Target) => string | null | undefined): string {
  const output: string[] = [];
  let changed = false;
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/^[ \t]+/, "");
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      output.push(line);
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      output.push(line);
      continue;
    }
    const rewritten = rewriteLine(line, transform);
    if (rewritten !== line) changed = true;
    output.push(rewritten);
  }
  return changed ? output.join("\n") : text;
}

function rewriteLine(line: string, transform: (target: Target) => string | null | undefined): string {
  if (!line.includes("[")) return line;
  const codeSpans = inlineCodeRanges(line);
  const inCode = (start: number, end: number) => codeSpans.some(([s, e]) => s < end && start < e);
  const replacements: { range: Range; text: string }[] = [];

  for (const match of line.matchAll(wiki)) {
    const start = match.index, end = start + match[0].length;
    if (inCode(start, end)) continue;
    const pathRange = match.indices![2] as Range;
    const path = match[2];
    // Keep any spacing around the target, as in "[[ Ilum ]]".
    const [, leading, trimmed, trailing] = /^([\p{Zs}\t]*)(.*?)([\p{Zs}\t]*)$/su.exec(path)!;
    if (trimmed === "") continue;
    const replacement = transform({ path: trimmed, kind: "wiki" });
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
    const replacement = transform({ path, kind: "markdown" });
    if (replacement == null) continue;
    // <angle brackets> allow raw spaces; otherwise match the original's escaping.
    const wasEncoded = !isAngled && (encodedPath !== path || !path.includes(" "));
    const written = wasEncoded ? encodeMarkdownPath(replacement) : replacement;
    if (written === encodedPath) continue;
    replacements.push({ range: destinationRange, text: written + fragment });
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
