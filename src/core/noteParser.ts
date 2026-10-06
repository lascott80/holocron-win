// Extracts headings, links, tags and aliases from markdown text, and
// resolves link targets to notes.

import { isNote, stem } from "./paths";

export interface Heading {
  level: number;
  text: string;
  /** 1-based line number. */
  line: number;
}

/**
 * `wiki`: `[[Target]]`, resolved by name or vault path.
 * `markdown`: `[text](relative/path.md)`, resolved relative to the note's folder.
 */
export type LinkKind = "wiki" | "markdown";

export interface Link {
  target: string;
  kind: LinkKind;
  /** 1-based line number. */
  line: number;
  /** The line the link sits on, for showing in backlinks. */
  context: string;
}

export interface Property {
  key: string;
  values: string[];
}

/** What Holocron knows about a note's content: its structure and connections. */
export interface NoteInfo {
  headings: Heading[];
  links: Link[];
  /**
   * Tags without the leading "#", in first-seen order, no duplicates
   * (compared case-insensitively). Includes frontmatter `tags:`.
   */
  tags: string[];
  /** Frontmatter `aliases:`. */
  aliases: string[];
  /** Every frontmatter field, in order. Lists keep their items; nested YAML is kept as text. */
  properties: Property[];
  /** Whitespace-separated words in the body (outside code blocks and frontmatter). */
  wordCount: number;
}

/**
 * Trims spaces and tabs (Swift's `.whitespaces`: Unicode Zs plus tab),
 * not newlines or "\r".
 */
export function trimWhitespace(text: string): string {
  return text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");
}

function trimChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Splits on "\n", dropping empty pieces (Swift's default `split`). */
function splitNonEmpty(text: string, separator: string): string[] {
  return text.split(separator).filter((part) => part !== "");
}

// [[target#heading|alias]] and ![[embed]]: group 1 is the path, group 2 the fragment.
const wikiLinkPattern = /!?\[\[([^\[\]\n|#^]*)([#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g;
/**
 * Group 1 is "!" for images, which aren't links; the destination is
 * group 2 for the <angle bracket> form (spaces allowed), else group 3.
 */
const markdownLinkPattern = /(!?)\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;
/** Group 1 is the start of line or the whitespace before the tag. */
const tagPattern = /(^|\s)#([\p{L}\p{N}_\-\/]+)/gu;

/**
 * Parses a note. Content in code blocks and inline code is ignored. Lines
 * end at "\n"; a trailing "\r" (CRLF) is dropped from each line.
 */
export function parse(text: string): NoteInfo {
  const info: NoteInfo = { headings: [], links: [], tags: [], aliases: [], properties: [], wordCount: 0 };
  const seenTags = new Set<string>();
  const addTag = (tag: string) => {
    const trimmed = tag.replace(/^[#\p{Zs}\t]+|[#\p{Zs}\t]+$/gu, "");
    const key = trimmed.toLowerCase();
    if (trimmed === "" || seenTags.has(key)) return;
    seenTags.add(key);
    info.tags.push(trimmed);
  };

  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  let index = 0;

  // Frontmatter
  if (trimWhitespace(lines[0]) === "---") {
    let end = 1;
    while (end < lines.length) {
      const trimmed = trimWhitespace(lines[end]);
      if (trimmed === "---" || trimmed === "...") break;
      end++;
    }
    if (end < lines.length) {
      const yaml = lines.slice(1, end);
      for (const tag of [...frontmatterList("tags", yaml), ...frontmatterList("tag", yaml)]) addTag(tag);
      info.aliases = [...frontmatterList("aliases", yaml), ...frontmatterList("alias", yaml)];
      info.properties = frontmatterProperties(yaml);
      index = end + 1;
    }
  }

  let fence: string | null = null;
  while (index < lines.length) {
    const line = lines[index];
    const lineNumber = index + 1;
    index++;
    const trimmed = line.replace(/^[ \t]+/, "");

    // Fenced code blocks
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }

    info.wordCount += line.split(/\s+/u).filter((word) => word !== "").length;
    const content = removingInlineCode(line);

    const heading = parseHeading(content, lineNumber);
    if (heading) info.headings.push(heading);

    const context = trimWhitespace(line);
    for (const match of content.matchAll(wikiLinkPattern)) {
      const target = trimWhitespace(match[1]);
      if (target !== "" || match[2] !== undefined) {
        info.links.push({ target: target + (match[2] ?? ""), kind: "wiki", line: lineNumber, context });
      }
    }
    for (const match of content.matchAll(markdownLinkPattern)) {
      if (match[1] !== "") continue;
      const destination = match[2] ?? match[3] ?? "";
      if (destination.includes(":")) continue;
      const decoded = percentDecode(destination);
      if (decoded === null || !isNote(decoded.split("#")[0])) continue;
      info.links.push({ target: decoded, kind: "markdown", line: lineNumber, context });
    }
    for (const match of content.matchAll(tagPattern)) {
      const tag = match[2];
      if (/[^\p{N}\/]/u.test(tag)) addTag(tag);
    }
  }
  return info;
}

/** Percent-decodes, or null when the escapes aren't valid UTF-8 (like Swift's `removingPercentEncoding`). */
export function percentDecode(text: string): string | null {
  if (!text.includes("%")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

function parseHeading(line: string, number: number): Heading | null {
  if (!line.startsWith("#")) return null;
  const level = /^#*/.exec(line)![0].length;
  if (level > 6) return null;
  const rest = line.slice(level);
  if (!(rest === "" || rest[0] === " " || rest[0] === "\t")) return null;
  let text = trimWhitespace(rest);
  // Optional closing #s
  text = trimWhitespace(text.replace(/#+$/, ""));
  if (text === "") return null;
  return { level, text: plainText(text), line: number };
}

/**
 * Strips the markdown most likely to appear in a heading so it reads
 * cleanly in the outline: [[a|b]] → b, [a](x) → a, **b** → b.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|\*|_|`)/g, "");
}

/** Replaces `code spans` with spaces so their content isn't parsed. */
function removingInlineCode(line: string): string {
  if (!line.includes("`")) return line;
  let result = "";
  let inCode = false;
  for (const character of line) {
    if (character === "`") {
      inCode = !inCode;
      result += " ";
    } else {
      result += inCode ? " " : character;
    }
  }
  return result;
}

const isWhitespaceChar = (character: string | undefined) => character !== undefined && /\s/u.test(character);

function cleanItem(item: string): string {
  return trimChars(trimWhitespace(item), "\"'");
}

/**
 * Every top-level `key: value` in the frontmatter (the lines between the
 * `---` markers), matching what the editor's properties panel shows.
 */
export function frontmatterProperties(yaml: readonly string[]): Property[] {
  const properties: Property[] = [];
  let index = 0;
  while (index < yaml.length) {
    const line = yaml[index];
    index++;
    const first = line[0];
    const colon = line.indexOf(":");
    if (first === undefined || isWhitespaceChar(first) || first === "#" || colon < 0) continue;
    const key = trimWhitespace(line.slice(0, colon));
    const raw = trimWhitespace(line.slice(colon + 1));
    if (key === "") continue;
    let values: string[] = [];
    if (raw === "") {
      const nested: string[] = [];
      while (index < yaml.length && (isWhitespaceChar(yaml[index][0]) || trimWhitespace(yaml[index]) === "")) {
        const next = trimWhitespace(yaml[index]);
        index++;
        if (next.startsWith("- ")) values.push(cleanItem(next.slice(2)));
        else if (next !== "") nested.push(next);
      }
      if (values.length === 0 && nested.length > 0) values = [nested.join(", ")];
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      values = splitNonEmpty(raw.slice(1, -1), ",").map(cleanItem).filter((value) => value !== "");
    } else {
      values = [cleanItem(raw)];
    }
    properties.push({ key, values });
  }
  return properties;
}

/** Reads `key: [a, b]`, `key: a, b`, `key: a` or a `- a` block list. */
function frontmatterList(key: string, yaml: readonly string[]): string[] {
  const start = yaml.findIndex((line) => line.toLowerCase().startsWith(key + ":"));
  if (start < 0) return [];
  const value = trimWhitespace(yaml[start].slice(key.length + 1));
  if (value !== "") {
    const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
    return splitNonEmpty(inner, ",").map(cleanItem).filter((item) => item !== "");
  }
  const items: string[] = [];
  for (const line of yaml.slice(start + 1)) {
    const trimmed = trimWhitespace(line);
    if (!trimmed.startsWith("- ")) break;
    items.push(cleanItem(trimmed.slice(2)));
  }
  return items.filter((item) => item !== "");
}

/** Number of "/"-separated non-empty components. */
function depth(path: string): number {
  return splitNonEmpty(path, "/").length;
}

/**
 * Resolves link targets to notes, the same way for the editor, backlinks
 * and quick open. Works on vault-relative paths ("Lore/Ilum.md").
 */
export class LinkResolver {
  private readonly paths: Set<string>;
  private readonly lowercasedPaths = new Map<string, string>();
  /** Lowercased note name → paths with that name, nearest the root first. */
  private readonly byName = new Map<string, string[]>();

  constructor(paths: Iterable<string>) {
    const all = [...paths];
    this.paths = new Set(all);
    for (const path of all) {
      this.lowercasedPaths.set(path.toLowerCase(), path);
      const name = stem(path).toLowerCase();
      const list = this.byName.get(name);
      if (list) list.push(path);
      else this.byName.set(name, [path]);
    }
    for (const list of this.byName.values()) {
      list.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
    }
  }

  /** The path part of a link target: drops "#Heading", "^block" and surrounding whitespace. */
  static linkPath(target: string): string {
    const cut = target.search(/[#^]/);
    return trimWhitespace(cut < 0 ? target : target.slice(0, cut));
  }

  /**
   * Resolves a `[[wikilink]]` target. Returns null for links to a heading
   * in the same note ("#Heading") and for missing notes.
   *
   * A bare name matches across the whole vault, nearest the root first; the
   * linking note's folder is deliberately not preferred (as on the Mac).
   */
  resolveWiki(rawTarget: string): string | null {
    const target = LinkResolver.linkPath(rawTarget);
    if (target === "") return null;
    const lowered = target.toLowerCase();
    if (lowered.includes("/")) {
      const relative = lowered.startsWith("/") ? lowered.slice(1) : lowered;
      if (isNote(relative)) return this.lowercasedPaths.get(relative) ?? null;
      return this.lowercasedPaths.get(relative + ".md") ?? this.lowercasedPaths.get(relative + ".markdown") ?? null;
    }
    const name = isNote(lowered) ? stem(lowered) : lowered;
    return this.byName.get(name)?.[0] ?? null;
  }

  /** Resolves a `[text](path.md)` link written in the note at `sourcePath`. */
  resolveMarkdown(rawTarget: string, sourcePath: string): string | null {
    const target = LinkResolver.linkPath(rawTarget);
    if (target === "") return null;
    const components = target.startsWith("/") ? [] : splitNonEmpty(sourcePath, "/").slice(0, -1);
    for (const part of splitNonEmpty(target, "/")) {
      if (part === ".") continue;
      if (part === "..") components.pop();
      else components.push(part);
    }
    const joined = components.join("/");
    return this.paths.has(joined) ? joined : this.lowercasedPaths.get(joined.toLowerCase()) ?? null;
  }

  resolve(link: Pick<Link, "target" | "kind">, sourcePath: string): string | null {
    return link.kind === "wiki" ? this.resolveWiki(link.target) : this.resolveMarkdown(link.target, sourcePath);
  }
}
