// Frontmatter properties as the editor's panel and the Base view edit them
// (ED-75, UI-46): locating the block, a forgiving reader, YAML writing that
// only quotes when it must, and the one-property rewrite both the editor
// (through its document) and main (atomic file writes) apply. Pure string
// functions, so a note's CRLF line endings survive a rewrite untouched.

export type PropertyValue = string | string[] | boolean | null;

export interface ParsedProperty {
  key: string;
  value: PropertyValue;
  /** Nested YAML, kept as text and shown read-only. */
  nested?: boolean;
}

export type PropertyKind = "text" | "list" | "number" | "checkbox" | "date" | "datetime";

/** One edit to apply to the text: replace [from, to) with `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Where the frontmatter sits: the whole block and the YAML inside, as string offsets. */
export interface FrontmatterRange {
  from: number;
  to: number;
  yamlFrom: number;
  yamlTo: number;
}

/** Lines with their offsets; a trailing "\r" stays part of the line (`text` keeps it, `clean` drops it). */
function lines(text: string): { from: number; to: number; text: string; clean: string }[] {
  const result: { from: number; to: number; text: string; clean: string }[] = [];
  let from = 0;
  for (;;) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline;
    const raw = text.slice(from, to);
    result.push({ from, to, text: raw, clean: raw.endsWith("\r") ? raw.slice(0, -1) : raw });
    if (newline < 0) break;
    from = newline + 1;
  }
  return result;
}

/** The frontmatter block: line 1 `---` to the closing `---` (or `...`), NOTE-01. */
export function frontmatterRange(text: string): FrontmatterRange | null {
  const all = lines(text);
  if (all.length < 2 || all[0]!.clean.trimEnd() !== "---") return null;
  for (let n = 1; n < all.length; n++) {
    const line = all[n]!;
    const clean = line.clean.trimEnd();
    if (clean === "---" || clean === "...") {
      const first = all[0]!;
      return { from: first.from, to: line.to, yamlFrom: first.to + 1, yamlTo: Math.max(first.to + 1, line.from - 1) };
    }
  }
  return null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const character of inner) {
    if (quote) {
      if (character === quote) quote = null;
      current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === ",") {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) items.push(current);
  return items.map(unquote).filter((item) => item.length);
}

/**
 * A forgiving reader for the frontmatter people actually write:
 * `key: value`, `key: [a, b]`, block lists (`- a`), true/false. Anything
 * nested is kept as raw text.
 */
export function parseProperties(yaml: string): ParsedProperty[] {
  const properties: ParsedProperty[] = [];
  const rows = yaml.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i]!;
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue;
    const match = /^([^:#][^:]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.trim();
    const raw = (match[2] ?? "").trim();
    let value: PropertyValue;
    if (raw === "") {
      const items: string[] = [];
      const nested: string[] = [];
      while (i + 1 < rows.length && (/^\s/.test(rows[i + 1]!) || rows[i + 1]!.trim() === "")) {
        const next = rows[++i]!;
        const item = /^\s*-\s+(.*)$/.exec(next);
        if (item) items.push(unquote(item[1]!));
        else if (next.trim()) nested.push(next.trim());
      }
      value = items.length ? items : nested.length ? nested.join(", ") : null;
      if (!items.length && nested.length) {
        properties.push({ key, value, nested: true });
        continue;
      }
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      value = splitInlineList(raw.slice(1, -1));
    } else if (/^(true|false)$/i.test(raw)) {
      value = raw.toLowerCase() === "true";
    } else {
      value = unquote(raw);
    }
    properties.push({ key, value });
  }
  return properties;
}

/** Where `key`'s lines sit in the text: [from, to) plus whether its list is written as a block. */
function propertyBlock(text: string, key: string): { from: number; to: number; blockList: boolean } | null {
  const range = frontmatterRange(text);
  if (!range) return null;
  const all = lines(text).filter((line) => line.from >= range.yamlFrom && line.to <= Math.max(range.yamlTo, range.yamlFrom));
  for (let n = 0; n < all.length; n++) {
    const line = all[n]!;
    const match = /^([^\s#:][^:]*):/.exec(line.clean);
    if (!match || match[1]!.trim() !== key) continue;
    let last = n;
    // Continuation: indented lines, or "- item" lines (YAML lets a block list start at column 0).
    while (last + 1 < all.length && /^(\s|-\s|-$)/.test(all[last + 1]!.clean)) last++;
    const blockList = last > n && /^\s*-/.test(all[n + 1]!.clean);
    // The replacement keeps the last line's "\r", so CRLF notes stay CRLF.
    const end = all[last]!;
    return { from: line.from, to: end.text.endsWith("\r") ? end.to - 1 : end.to, blockList };
  }
  return null;
}

// A leading "-" is only a list marker before a space (so -3 stays a plain number).
const NEEDS_QUOTES = /^[\s?:,[\]{}#&*!|>'"%@`]|^-(\s|$)|\s$|: | #|^(true|false|yes|no|null|~)$/i;

/** A scalar as YAML: plain when that reads back the same, otherwise double-quoted. */
export function yamlScalar(text: unknown): string {
  const value = String(text);
  if (value === "") return "";
  return NEEDS_QUOTES.test(value) || value.includes('"') ? JSON.stringify(value) : value;
}

/** The YAML for one property. Lists keep the block style (`- item`) when `blockList`; `eol` joins block lines. */
export function serializeProperty(key: string, value: unknown, { blockList = false, eol = "\n" }: { blockList?: boolean; eol?: string } = {}): string {
  if (typeof value === "boolean") return `${key}: ${value}`;
  if (Array.isArray(value)) {
    const items = value.map((item) => yamlScalar(String(item).trim())).filter((item) => item !== "");
    if (blockList && items.length) return `${key}:${eol}${items.map((item) => `  - ${item}`).join(eol)}`;
    return `${key}: [${items.join(", ")}]`;
  }
  if (value === null || value === undefined || value === "") return `${key}:`;
  return `${key}: ${yamlScalar(value)}`;
}

/** The line ending a text uses: CRLF when its first line break is one. */
export function lineEnding(text: string): "\n" | "\r\n" {
  const at = text.indexOf("\n");
  return at > 0 && text[at - 1] === "\r" ? "\r\n" : "\n";
}

/** The change that sets `key` to `value`: rewrites its lines, or adds it (creating the frontmatter if needed). */
export function setPropertyChange(text: string, key: string, value: unknown): TextChange {
  const eol = lineEnding(text);
  const block = propertyBlock(text, key);
  if (block) return { from: block.from, to: block.to, insert: serializeProperty(key, value, { blockList: block.blockList, eol }) };
  const range = frontmatterRange(text);
  const line = serializeProperty(key, value, { eol });
  if (!range) return { from: 0, to: 0, insert: `---${eol}${line}${eol}---${eol}` };
  const closing = lines(text).find((candidate) => candidate.from <= range.to && candidate.to >= range.to)!;
  return { from: closing.from, to: closing.from, insert: line + eol };
}

/** The change that deletes `key` and its lines, or null when the note doesn't have it. */
export function removePropertyChange(text: string, key: string): TextChange | null {
  const block = propertyBlock(text, key);
  if (!block) return null;
  const eol = lineEnding(text);
  const after = text.slice(block.to, block.to + eol.length);
  return { from: block.from, to: after === eol ? block.to + eol.length : block.to, insert: "" };
}

export function applyChange(text: string, change: TextChange | null): string {
  if (!change) return text;
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}

/** The note's text with `key` set to `value` (one property rewritten, everything else byte for byte as it was). */
export function setProperty(text: string, key: string, value: unknown): string {
  return applyChange(text, setPropertyChange(text, key, value));
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const TAG_KEYS = new Set(["tags", "tag"]);

/** The type a property's value shows as: list, checkbox, number, date, datetime or text. */
export function propertyType(property: ParsedProperty): PropertyKind {
  const { key, value, nested } = property;
  if (nested) return "text";
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value) || TAG_KEYS.has(key.toLowerCase())) return "list";
  const text = value === null ? "" : String(value);
  if (NUMBER.test(text)) return "number";
  if (DATE.test(text)) return /[ T]\d{2}:\d{2}$/.test(text) ? "datetime" : "date";
  return "text";
}

/** `YYYY-MM-DD[ HH:MM]` or `YYYY-MM-DDTHH:MM` as a Date (local time), or null. */
export function parseDateValue(text: string): Date | null {
  const match = DATE.exec(text);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const when = new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
  return Number.isNaN(when.getTime()) ? null : when;
}
