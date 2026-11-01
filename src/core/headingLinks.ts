// Rewrites the heading part of links — `[[Note#Heading|alias]]` and
// `[text](Note.md#heading)` — leaving everything else byte-for-byte alone.
// Used when a heading is renamed (LNK-16) and when a section is split into
// its own note (FOP-16). Links inside code are never touched.

import { encodeMarkdownPath, inlineCodeRanges } from "./linkRewriter";
import { percentDecode, plainText, type LinkKind } from "./noteParser";

/** A link to a heading, as written. */
export interface FragmentLink {
  /** The path part: raw for wikilinks ("" for `[[#Heading]]`, the current note), percent-decoded for markdown links. */
  path: string;
  /** The text after "#", without any `|alias` (markdown: percent-decoded). */
  fragment: string;
  kind: LinkKind;
}

/** What to write instead: the path and/or fragment to replace (an empty fragment drops the "#"). */
export interface FragmentRewrite {
  path?: string;
  fragment?: string;
}

type Range = [start: number, end: number];
type Transform = (link: FragmentLink) => FragmentRewrite | null | undefined;

// [[path#fragment|alias]] and ![[…]]: group 2 is the path, group 3 the fragment.
const wiki = /(!?\[\[)([^\[\]\n|#^]*)#([^\[\]\n|]*)((?:\|[^\[\]\n]*)?\]\])/dg;
// [text](path#fragment "title") or [text](<path#fragment>): the destination is group 2 or 3.
const markdown = /(\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))/dg;

/**
 * Returns `text` with every heading link's path and fragment replaced by
 * what `transform` returns (or left alone for null). Block links
 * (`[[Note#^id]]`) are never offered. Returns `text` itself when nothing
 * changed, so CRLF and everything else stays identical.
 */
export function rewriteFragmentLinks(text: string, transform: Transform): string {
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
    const rewritten = line.includes("#") ? rewriteLine(line, transform) : line;
    if (rewritten !== line) changed = true;
    output.push(rewritten);
  }
  return changed ? output.join("\n") : text;
}

function rewriteLine(line: string, transform: Transform): string {
  const codeSpans = inlineCodeRanges(line);
  const inCode = (start: number, end: number) => codeSpans.some(([s, e]) => s < end && start < e);
  const replacements: { range: Range; text: string }[] = [];

  for (const match of line.matchAll(wiki)) {
    const start = match.index, end = start + match[0].length;
    if (inCode(start, end)) continue;
    const fragment = match[3];
    if (fragment.startsWith("^")) continue; // a block link
    const [, leading, path, trailing] = /^([\p{Zs}\t]*)(.*?)([\p{Zs}\t]*)$/su.exec(match[2])!;
    const replacement = transform({ path, fragment: fragment.trim(), kind: "wiki" });
    if (replacement == null) continue;
    const newPath = replacement.path ?? path;
    const newFragment = replacement.fragment ?? fragment;
    const written = leading + newPath + trailing + (newFragment === "" ? "" : "#" + newFragment);
    const [pathStart] = match.indices![2] as Range;
    const [, fragmentEnd] = match.indices![3] as Range;
    if (written === line.slice(pathStart, fragmentEnd)) continue;
    replacements.push({ range: [pathStart, fragmentEnd], text: written });
  }

  for (const match of line.matchAll(markdown)) {
    const start = match.index, end = start + match[0].length;
    if (inCode(start, end)) continue;
    const isAngled = match[2] !== undefined;
    const destination = (isAngled ? match[2] : match[3])!;
    if (destination.includes(":")) continue; // http:, mailto: …
    const hashIndex = destination.indexOf("#");
    if (hashIndex < 0) continue;
    const encodedPath = destination.slice(0, hashIndex);
    const encodedFragment = destination.slice(hashIndex + 1);
    const path = percentDecode(encodedPath) ?? encodedPath;
    const fragment = percentDecode(encodedFragment) ?? encodedFragment;
    if (fragment === "" || fragment.startsWith("^")) continue;
    const replacement = transform({ path, fragment, kind: "markdown" });
    if (replacement == null) continue;
    const newPath = replacement.path ?? path;
    const newFragment = replacement.fragment ?? fragment;
    // <angle brackets> allow raw spaces; otherwise match the original's escaping.
    const pathWasEncoded = !isAngled && (encodedPath !== path || !path.includes(" "));
    const fragmentWasEncoded = encodedFragment !== fragment || (!isAngled && newFragment.includes(" "));
    const writtenPath = pathWasEncoded ? encodeMarkdownPath(newPath) : newPath;
    const writtenFragment = newFragment === "" ? "" : "#" + (fragmentWasEncoded ? encodeMarkdownPath(newFragment) : newFragment);
    const written = writtenPath + writtenFragment;
    if (written === destination) continue;
    replacements.push({ range: match.indices![isAngled ? 2 : 3] as Range, text: written });
  }

  if (replacements.length === 0) return line;
  let result = line;
  for (const { range, text } of replacements.sort((a, b) => b.range[0] - a.range[0])) {
    result = result.slice(0, range[0]) + text + result.slice(range[1]);
  }
  return result;
}

const normalise = (text: string) => plainText(text).trim().toLowerCase();
/** Obsidian-style slug: lowercase, spaces to hyphens ("old-heading"). */
const slug = (text: string) => normalise(text).replace(/\s+/g, "-");

/** The heading a fragment names: the last part of "Parent#Child". */
export function fragmentHeading(fragment: string): string {
  const parts = fragment.split("#");
  return parts[parts.length - 1].trim();
}

/**
 * Whether a link fragment names `heading` (its plain text): case-insensitive,
 * markup ignored (LNK-09), and the hyphenated "old-heading" form markdown
 * links often use.
 */
export function fragmentMatchesHeading(fragment: string, heading: string): boolean {
  const last = fragmentHeading(fragment);
  if (last === "") return false;
  return normalise(last) === normalise(heading) || slug(last) === slug(heading);
}

/**
 * The fragment to write for `newHeading` in place of one that named
 * `oldHeading`: the heading's text, or for a markdown link written in the
 * hyphenated lowercase form ("old-heading"), that form of the new name; a
 * "Parent#Child" prefix is kept.
 */
export function renamedFragment(fragment: string, oldHeading: string, newHeading: string, kind: LinkKind): string {
  const parts = fragment.split("#");
  const last = parts[parts.length - 1].trim();
  const hyphenated = kind === "markdown" && last !== oldHeading && last === slug(oldHeading);
  parts[parts.length - 1] = hyphenated ? slug(newHeading) : newHeading;
  return parts.join("#");
}
