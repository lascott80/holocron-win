// The sidebar's tag tree (UI-14): "project/alpha" and "project/beta" nest
// under "project", and renaming a tag rewrites it in every note (FOP-13).
// Pure functions over text; the vault does the reading and writing.

import { naturalCompare } from "./paths";

export interface TagNode {
  /** The full tag ("project/alpha"), as first seen in a note. */
  tag: string;
  /** The last segment ("alpha"). */
  name: string;
  /** Notes carrying exactly this tag. */
  count: number;
  /** Notes carrying this tag or one nested under it. */
  total: number;
  children: TagNode[];
}

export type TagSort = "count" | "name";

/** Most nodes the sidebar shows (UI-14). */
export const MAX_TAG_NODES = 1000;

/**
 * Builds the tree from per-tag counts (IDX-04). Parents that no note uses
 * on their own still appear, with a count of 0. `total` counts a note once
 * per subtree even when it carries several nested tags, when `noteTags`
 * (each note's tags) is given; without it, totals are sums of counts. The
 * tree is sorted by `sort` at every level and cut to `limit` nodes in
 * display order.
 */
export function buildTagTree(counts: readonly { tag: string; count: number }[], sort: TagSort = "count", limit = MAX_TAG_NODES, noteTags?: Iterable<readonly string[]>): TagNode[] {
  const roots: TagNode[] = [];
  const byPath = new Map<string, TagNode>();
  const nodeFor = (tag: string): TagNode => {
    const key = tag.toLowerCase();
    let node = byPath.get(key);
    if (node) return node;
    const slash = tag.lastIndexOf("/");
    node = { tag, name: slash < 0 ? tag : tag.slice(slash + 1), count: 0, total: 0, children: [] };
    byPath.set(key, node);
    if (slash < 0) roots.push(node);
    else nodeFor(tag.slice(0, slash)).children.push(node);
    return node;
  };
  for (const { tag, count } of counts) {
    const clean = tag.replace(/^\/+|\/+$/g, "");
    if (clean === "") continue;
    nodeFor(clean).count += count;
  }
  if (noteTags) {
    for (const tags of noteTags) {
      const seen = new Set<string>();
      for (const tag of tags) {
        const parts = tag.replace(/^\/+|\/+$/g, "").split("/");
        for (let depth = 1; depth <= parts.length; depth++) {
          const key = parts.slice(0, depth).join("/").toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const node = byPath.get(key);
          if (node) node.total++;
        }
      }
    }
  } else {
    const sum = (node: TagNode): number => (node.total = node.count + node.children.reduce((n, child) => n + sum(child), 0));
    for (const root of roots) sum(root);
  }
  const compare =
    sort === "name"
      ? (a: TagNode, b: TagNode) => naturalCompare(a.name, b.name)
      : (a: TagNode, b: TagNode) => b.total - a.total || b.count - a.count || naturalCompare(a.name, b.name);
  const sortTree = (nodes: TagNode[]) => {
    nodes.sort(compare);
    for (const node of nodes) sortTree(node.children);
  };
  sortTree(roots);
  // Cut to `limit` nodes in display order (parents before their children).
  let remaining = limit;
  const cut = (nodes: TagNode[]): TagNode[] => {
    const kept: TagNode[] = [];
    for (const node of nodes) {
      if (remaining <= 0) break;
      remaining--;
      node.children = cut(node.children);
      kept.push(node);
    }
    return kept;
  };
  return cut(roots);
}

/** A row of the tree as shown: the node and its depth, parents first. */
export interface TagRow {
  node: TagNode;
  depth: number;
  parent: string | null;
}

/** The rows on screen, given which parents are expanded (lowercased tags). */
export function visibleTagRows(tree: readonly TagNode[], expanded: ReadonlySet<string>): TagRow[] {
  const rows: TagRow[] = [];
  const walk = (nodes: readonly TagNode[], depth: number, parent: string | null) => {
    for (const node of nodes) {
      rows.push({ node, depth, parent });
      if (node.children.length && expanded.has(node.tag.toLowerCase())) walk(node.children, depth + 1, node.tag);
    }
  };
  walk(tree, 0, null);
  return rows;
}

// MARK: Renaming (FOP-13)

/**
 * Whether `name` can be a tag: letters, digits, "-", "_" and "/", not
 * starting with a digit, no empty segments.
 */
export function isValidTagName(name: string): boolean {
  return /^[\p{L}_-][\p{L}\p{N}_-]*(\/[\p{L}\p{N}_-]+)*$/u.test(name) && !/^\p{N}/u.test(name);
}

/** Inline code spans: the same rule the parser uses (an unmatched backtick runs to the end of the line). */
function codeSpanRanges(line: string): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] !== "`") continue;
    if (start < 0) start = index;
    else {
      ranges.push([start, index + 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, line.length]);
  return ranges;
}

/** Wikilinks, markdown links, bare URLs and HTML tags: a "#" inside them is never a tag. */
const PROTECTED = [/!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /<[A-Za-z\/][^<>]*>/g, /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/gi];

/** The line with code spans, links, URLs and HTML tags blanked to spaces (same length), like the parser does. */
function maskProtected(line: string): string {
  const ranges = codeSpanRanges(line);
  for (const pattern of PROTECTED) {
    for (const match of line.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  if (ranges.length === 0) return line;
  const chars = [...line];
  for (const [from, to] of ranges) for (let at = from; at < to; at++) chars[at] = " ";
  return chars.join("");
}

/** The same shape `parse` accepts: a "#" at the start or after whitespace, then tag characters. */
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_\-\/]+)/gu;

/** `tag` renamed when it is `from` or nested under it (case-insensitive); null when it isn't. */
export function renamedTag(tag: string, from: string, to: string): string | null {
  const lower = tag.toLowerCase();
  const wanted = from.toLowerCase();
  if (lower === wanted) return to;
  if (lower.startsWith(wanted + "/")) return to + tag.slice(from.length);
  return null;
}

function renameInlineTags(line: string, from: string, to: string, counter: { count: number }): string {
  if (!line.includes("#")) return line;
  // Match on the masked line, rewrite the original at the same offsets.
  let result = "";
  let last = 0;
  for (const match of maskProtected(line).matchAll(INLINE_TAG)) {
    const renamed = renamedTag(match[2], from, to);
    if (renamed === null) continue;
    const at = match.index + match[1].length;
    counter.count++;
    result += line.slice(last, at) + "#" + renamed;
    last = at + match[2].length + 1;
  }
  return last === 0 ? line : result + line.slice(last);
}

/** One frontmatter list value ("lore", "#lore", "'lore'", '"lore"'), renamed if it is the tag; quotes and "#" kept. */
function renameValue(raw: string, from: string, to: string, counter: { count: number }): string {
  const match = /^([\p{Zs}\t]*)(["']?)(#*)(.*?)(\2)([\p{Zs}\t]*)$/u.exec(raw);
  if (!match) return raw;
  const [, lead, quote, hashes, inner, , trail] = match;
  const renamed = renamedTag(inner, from, to);
  if (renamed === null) return raw;
  counter.count++;
  return `${lead}${quote}${hashes}${renamed}${quote}${trail}`;
}

/** `tags: [a, b]`, `tags: a, b` or `tags: a` (NOTE-03). */
function renameInlineList(value: string, from: string, to: string, counter: { count: number }): string {
  const bracketed = value.startsWith("[") && value.endsWith("]");
  const inner = bracketed ? value.slice(1, -1) : value;
  const renamed = inner
    .split(",")
    .map((item) => renameValue(item, from, to, counter))
    .join(",");
  return bracketed ? `[${renamed}]` : renamed;
}

export interface TagRenameResult {
  text: string;
  /** Tags rewritten (inline and frontmatter together); 0 means the text is unchanged. */
  count: number;
}

/**
 * Rewrites `#from` (and every `#from/x`) to `#to` in a note's text:
 * inline tags outside code spans, fenced code, links and URLs, and the
 * frontmatter `tags:`/`tag:` values in every accepted form (NOTE-03).
 * Matching is case-insensitive; `to` is written as given. Lines and their
 * endings are kept; nothing else changes.
 */
export function renameTagInText(text: string, from: string, to: string): TagRenameResult {
  const counter = { count: 0 };
  const lines = text.split("\n");
  // Work on each line without its "\r"; put it back when the line is rebuilt.
  const bare = lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const set = (index: number, value: string) => {
    if (value !== bare[index]) lines[index] = lines[index].endsWith("\r") ? value + "\r" : value;
  };

  let index = 0;
  if (bare[0]?.trim() === "---") {
    let end = 1;
    while (end < bare.length && bare[end].trim() !== "---" && bare[end].trim() !== "...") end++;
    if (end < bare.length) {
      let at = 1;
      while (at < end) {
        const line = bare[at];
        const key = /^(tags?)([\p{Zs}\t]*:)([\p{Zs}\t]*)(.*)$/iu.exec(line);
        if (!key) {
          at++;
          continue;
        }
        const [, name, colon, gap, value] = key;
        if (value.trim() !== "") {
          set(at, name + colon + gap + renameInlineList(value, from, to, counter));
          at++;
          continue;
        }
        at++;
        // A "- item" block list under it.
        while (at < end) {
          const item = /^([\p{Zs}\t]*-[\p{Zs}\t]+)(.*)$/u.exec(bare[at]);
          if (!item) break;
          set(at, item[1] + renameValue(item[2], from, to, counter));
          at++;
        }
      }
      index = end + 1;
    }
  }

  let fence: string | null = null;
  for (; index < bare.length; index++) {
    const line = bare[index];
    const trimmed = line.replace(/^[ \t]+/, "");
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }
    set(index, renameInlineTags(line, from, to, counter));
  }
  return { text: counter.count ? lines.join("\n") : text, count: counter.count };
}
