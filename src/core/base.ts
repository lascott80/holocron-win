// Bases (UI-46, §9.5): a `.base` file (or a ```base block in a note) holds a
// Holocron search query as its filter and one or more views — tables or
// cards — over the notes that match. This module reads and writes the small
// YAML subset those files use (no YAML dependency), models columns, and
// sorts and filters rows; main gathers the rows, the renderer draws them.

import { naturalCompare } from "./paths";
import { parseDateValue, propertyType, type PropertyValue } from "./properties";
import { parseQuery, type QueryNode } from "./vaultSearch";

// MARK: - YAML subset

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export interface YamlError {
  /** 1-based line. */
  line: number;
  message: string;
}

export interface YamlResult {
  value: YamlValue;
  errors: YamlError[];
}

interface YamlLine {
  number: number;
  indent: number;
  /** The line without indentation or a trailing comment. */
  text: string;
}

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

/** A scalar as YAML reads it: quoted strings, numbers, booleans, null, or the plain text. */
function scalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^(null|~)$/i.test(text)) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** Splits an inline list or map body on top-level commas (quotes and nested brackets respected). */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      current += c;
      if (c === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === "[" || c === "{") {
      depth++;
      current += c;
    } else if (c === "]" || c === "}") {
      depth--;
      current += c;
    } else if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

/** The first top-level ": " (or trailing ":") that separates a key from its value, or -1. */
function keySeparator(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s,{[]/.test(text[i - 1]!)) quote = c;
    } else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]!))) return i;
  }
  return -1;
}

/** `[a, b]`, `{ k: v }` or a scalar, on one line. */
function inlineValue(text: string, line: number, errors: YamlError[]): YamlValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) {
      errors.push({ line, message: "Unclosed [ list" });
      return [];
    }
    return splitTopLevel(trimmed.slice(1, -1)).map((part) => inlineValue(part, line, errors));
  }
  if (trimmed.startsWith("{")) {
    if (!trimmed.endsWith("}")) {
      errors.push({ line, message: "Unclosed { map" });
      return {};
    }
    const map: { [key: string]: YamlValue } = {};
    for (const part of splitTopLevel(trimmed.slice(1, -1))) {
      const at = keySeparator(part.trim());
      if (at < 0) {
        errors.push({ line, message: `Expected "key: value" in { … }, got "${part.trim()}"` });
        continue;
      }
      const key = String(scalar(part.trim().slice(0, at)));
      map[key] = inlineValue(part.trim().slice(at + 1), line, errors);
    }
    return map;
  }
  return scalar(trimmed);
}

/**
 * Reads a small, forgiving subset of YAML: block mappings and lists at any
 * nesting, inline `[a, b]` lists and `{ k: v }` maps, double- and
 * single-quoted strings, numbers, booleans, null and `#` comments. Tabs
 * count as indentation like spaces. Anything it doesn't understand is
 * reported with its line and skipped, so one odd line never loses a file.
 */
export function parseYaml(text: string): YamlResult {
  const errors: YamlError[] = [];
  const lines: YamlLine[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (index === 0) raw = raw.replace(/^﻿/, "");
    const content = stripComment(raw);
    if (content.trim() === "") return;
    const leading = /^[ \t]*/.exec(content)![0];
    // A tab indents as far as two spaces, so a file mixing both still reads.
    lines.push({ number: index + 1, indent: leading.replace(/\t/g, "  ").length, text: content.slice(leading.length) });
  });
  if (lines.length === 0) return { value: null, errors };
  let position = 0;

  const parseNode = (indent: number): YamlValue => {
    const line = lines[position]!;
    if (line.text === "-" || line.text.startsWith("- ")) return parseList(indent);
    return parseMap(indent);
  };

  const parseList = (indent: number): YamlValue[] => {
    const items: YamlValue[] = [];
    while (position < lines.length) {
      const line = lines[position]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        errors.push({ line: line.number, message: "Unexpected indentation" });
        position++;
        continue;
      }
      if (!(line.text === "-" || line.text.startsWith("- "))) break;
      const rest = line.text.slice(1).trim();
      position++;
      if (rest === "") {
        // "- " alone: the item is the nested block under it.
        items.push(position < lines.length && lines[position]!.indent > indent ? parseNode(lines[position]!.indent) : null);
      } else if (keySeparator(rest) >= 0 && !/^[[{"']/.test(rest)) {
        // "- key: value": a mapping whose first entry shares the item's line.
        const nested = indent + 2;
        lines.splice(position, 0, { number: line.number, indent: nested, text: rest });
        // Lines that follow at the same (or any deeper) indent belong to the same mapping.
        const map = parseMap(nested, true);
        items.push(map);
      } else {
        items.push(inlineValue(rest, line.number, errors));
      }
    }
    return items;
  };

  const parseMap = (indent: number, lenient = false): { [key: string]: YamlValue } => {
    const map: { [key: string]: YamlValue } = {};
    let mapIndent = indent;
    let first = true;
    while (position < lines.length) {
      const line = lines[position]!;
      if (line.indent < mapIndent) break;
      // Entries of a "- key: value" mapping may be indented a little differently from the first.
      if (line.indent > mapIndent) {
        if (lenient && !first && line.indent > indent && !/^-( |$)/.test(line.text)) mapIndent = line.indent;
        else {
          errors.push({ line: line.number, message: "Unexpected indentation" });
          position++;
          continue;
        }
      }
      if (/^-( |$)/.test(line.text)) break;
      const at = keySeparator(line.text);
      if (at < 0) {
        errors.push({ line: line.number, message: `Expected "key: value", got "${line.text}"` });
        position++;
        continue;
      }
      const key = String(scalar(line.text.slice(0, at)));
      const rest = line.text.slice(at + 1).trim();
      position++;
      first = false;
      if (rest !== "") {
        map[key] = inlineValue(rest, line.number, errors);
      } else if (position < lines.length && lines[position]!.indent > mapIndent) {
        map[key] = parseNode(lines[position]!.indent);
      } else if (position < lines.length && lines[position]!.indent === mapIndent && /^-( |$)/.test(lines[position]!.text)) {
        // YAML lets a block list start at the key's own column.
        map[key] = parseList(mapIndent);
      } else {
        map[key] = null;
      }
    }
    return map;
  };

  const value = parseNode(lines[0]!.indent);
  while (position < lines.length) {
    errors.push({ line: lines[position]!.number, message: "Unexpected content after the document" });
    position++;
  }
  return { value, errors };
}

const NEEDS_QUOTES = /^[\s?:,[\]{}#&*!|>'"%@`-]|[\s]$|: | #|^(true|false|yes|no|null|~)$|^-?\d+(\.\d+)?$/i;

/** A string as a YAML scalar: plain when it reads back as the same string, otherwise double-quoted. */
export function yamlString(text: string): string {
  if (text === "") return '""';
  return NEEDS_QUOTES.test(text) || /["\\\r\n]/.test(text) ? JSON.stringify(text) : text;
}

// MARK: - Base files

export type BaseViewType = "table" | "cards";

export interface BaseSort {
  column: string;
  direction: "asc" | "desc";
}

export interface BaseViewSpec {
  type: BaseViewType;
  name: string;
  columns: string[];
  sort: BaseSort[];
  /** Most rows shown; unset means every matching note. */
  limit?: number;
}

export interface BaseFile {
  /** A Holocron search query (SRCH-01/SRCH-11); empty = every note. */
  filters: string;
  views: BaseViewSpec[];
}

export type BaseParseResult =
  | { ok: true; base: BaseFile; warnings: YamlError[] }
  /** `obsidian`: the file uses Obsidian's own filter expressions, which Holocron doesn't read. */
  | { ok: false; reason: string; line?: number; obsidian?: boolean };

export const OBSIDIAN_BASE_MESSAGE = "This base uses Obsidian’s filter syntax, which Holocron doesn’t read yet";

/** Obsidian's expression language: comparisons, functions, `file.hasTag(…)`, and/or/not mappings. */
const OBSIDIAN_EXPRESSION = /(==|!=|>=|<=|[^-:]\s[<>]\s|\bcontains\(|\bhasTag\(|\binFolder\(|\bhasLink\(|\bdate\(|\bnow\(|\btoday\(|\bfile\.(name|ext|folder|path|tags|links|backlinks|mtime|ctime|size)\b)/;

/** Whether a base file is written for Obsidian rather than Holocron (filters as expressions or and/or/not mappings). */
export function usesObsidianSyntax(value: YamlValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const filters = value.filters;
  if (filters && typeof filters === "object" && !Array.isArray(filters)) return true; // { and: […] } / { or: […] } / { not: … }
  if (typeof filters === "string" && OBSIDIAN_EXPRESSION.test(filters)) return true;
  const views = value.views;
  if (Array.isArray(views)) {
    for (const view of views) {
      if (!view || typeof view !== "object" || Array.isArray(view)) continue;
      if (view.filters && typeof view.filters === "object" && !Array.isArray(view.filters)) return true;
      if (typeof view.filters === "string" && OBSIDIAN_EXPRESSION.test(view.filters)) return true;
      if ("order" in view && !("columns" in view)) return true;
    }
  }
  if (value.formulas && typeof value.formulas === "object") return true;
  return false;
}

export const DEFAULT_COLUMNS = ["file.name", "file.mtime", "file.tags"];

/** What File › New Base… writes: every note, one table with the name, modified time and tags. */
export function defaultBase(): BaseFile {
  return { filters: "", views: [{ type: "table", name: "Table", columns: [...DEFAULT_COLUMNS], sort: [] }] };
}

function stringList(value: YamlValue | undefined): string[] {
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (item === null || typeof item === "object" ? "" : String(item)).trim()).filter(Boolean);
}

function sortList(value: YamlValue | undefined, warnings: YamlError[]): BaseSort[] {
  const sorts: BaseSort[] = [];
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  for (const item of items) {
    if (typeof item === "string") {
      const [column, direction] = item.trim().split(/\s+/);
      if (column) sorts.push({ column, direction: direction?.toLowerCase() === "desc" ? "desc" : "asc" });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const column = item.column ?? item.property;
      if (typeof column === "string" && column.trim()) {
        sorts.push({ column: column.trim(), direction: String(item.direction ?? "asc").toLowerCase() === "desc" ? "desc" : "asc" });
      } else warnings.push({ line: 0, message: "A sort entry has no column" });
    }
  }
  return sorts;
}

/** Reads a `.base` file (or a ```base block). Unknown keys are ignored; a missing `views` gets the default table. */
export function parseBase(text: string): BaseParseResult {
  const { value, errors } = parseYaml(text);
  if (value === null) return { ok: true, base: defaultBase(), warnings: errors };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "The file isn’t a YAML mapping", line: 1 };
  if (usesObsidianSyntax(value)) return { ok: false, reason: OBSIDIAN_BASE_MESSAGE, obsidian: true };
  const warnings = [...errors];
  // An unquoted `filters: [status:active]` reads as a YAML list: put the brackets back.
  const filters = value.filters === undefined || value.filters === null ? "" : typeof value.filters === "string" ? value.filters.trim() : Array.isArray(value.filters) ? value.filters.map((item) => `[${String(item)}]`).join(" ") : String(value.filters);
  const views: BaseViewSpec[] = [];
  const rawViews = Array.isArray(value.views) ? value.views : [];
  rawViews.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      warnings.push({ line: 0, message: `View ${index + 1} isn’t a mapping` });
      return;
    }
    const type = String(raw.type ?? "table").toLowerCase() === "cards" ? "cards" : "table";
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : type === "cards" ? "Cards" : "Table";
    const columns = stringList(raw.columns);
    const view: BaseViewSpec = { type, name, columns: columns.length ? columns : [...DEFAULT_COLUMNS], sort: sortList(raw.sort, warnings) };
    if (typeof raw.limit === "number" && raw.limit > 0) view.limit = Math.floor(raw.limit);
    views.push(view);
  });
  if (!views.length) views.push(...defaultBase().views);
  return { ok: true, base: { filters, views }, warnings };
}

/** Writes a base as YAML, in the shape `parseBase` reads; `eol` keeps a file's CRLF line endings. */
export function serializeBase(base: BaseFile, eol = "\n"): string {
  const out: string[] = [`filters: ${yamlString(base.filters)}`, "views:"];
  for (const view of base.views) {
    out.push(`  - type: ${view.type}`);
    out.push(`    name: ${yamlString(view.name)}`);
    out.push(`    columns: [${view.columns.map(yamlString).join(", ")}]`);
    if (view.sort.length) out.push(`    sort: [${view.sort.map((sort) => `{ column: ${yamlString(sort.column)}, direction: ${sort.direction} }`).join(", ")}]`);
    if (view.limit !== undefined) out.push(`    limit: ${view.limit}`);
  }
  return out.join(eol) + eol;
}

// MARK: - Columns and rows

/** Columns every base has, beside the notes' own frontmatter keys. */
export const BUILTIN_COLUMNS: { id: string; label: string; kind: "link" | "text" | "datetime" | "list" | "number" }[] = [
  { id: "file.name", label: "Name", kind: "link" },
  { id: "file.path", label: "Path", kind: "text" },
  { id: "file.folder", label: "Folder", kind: "text" },
  { id: "file.mtime", label: "Modified", kind: "datetime" },
  { id: "file.ctime", label: "Created", kind: "datetime" },
  { id: "file.tags", label: "Tags", kind: "list" },
  { id: "file.links", label: "Links", kind: "number" },
  { id: "file.backlinks", label: "Backlinks", kind: "number" },
];

export function isBuiltinColumn(id: string): boolean {
  return BUILTIN_COLUMNS.some((column) => column.id === id);
}

/** How a column is headed: built-ins by name, properties by their key. */
export function columnLabel(id: string): string {
  return BUILTIN_COLUMNS.find((column) => column.id === id)?.label ?? id;
}

/** One note as a base row; main builds these (`baseRows`), with only the costly fields that were asked for. */
export interface BaseRow {
  path: string;
  title: string;
  /** The note's folder, "" at the root. */
  folder: string;
  /** ms since epoch, or null when not gathered. */
  mtime: number | null;
  ctime: number | null;
  tags: string[];
  /** Outgoing links and backlinks; null when not gathered. */
  links: number | null;
  backlinks: number | null;
  /** Frontmatter, keyed as written (lookups are case-insensitive). */
  properties: Record<string, PropertyValue>;
  /** The first lines of the body as plain text, for cards; "" when not gathered. */
  preview: string;
}

/** What a cell holds, by column: built-ins from the row's fields, anything else from its properties. */
export function cellValue(row: BaseRow, column: string): PropertyValue | number {
  switch (column) {
    case "file.name":
      return row.title;
    case "file.path":
      return row.path;
    case "file.folder":
      return row.folder;
    case "file.mtime":
      return row.mtime;
    case "file.ctime":
      return row.ctime;
    case "file.tags":
      return row.tags;
    case "file.links":
      return row.links;
    case "file.backlinks":
      return row.backlinks;
    default: {
      if (column in row.properties) return row.properties[column]!;
      const wanted = column.toLowerCase();
      const key = Object.keys(row.properties).find((candidate) => candidate.toLowerCase() === wanted);
      return key === undefined ? null : row.properties[key]!;
    }
  }
}

export type ColumnKind = "link" | "text" | "list" | "number" | "checkbox" | "date" | "datetime";

/**
 * The kind a column's cells render as: built-ins have theirs; a property
 * column takes the vault's inferred type (IDX-07) when known, otherwise the
 * type its values show in the rows.
 */
export function columnKind(column: string, rows: readonly BaseRow[], known?: (key: string) => ColumnKind | undefined): ColumnKind {
  const builtin = BUILTIN_COLUMNS.find((candidate) => candidate.id === column);
  if (builtin) return builtin.kind;
  const summary = known?.(column);
  if (summary) return summary;
  const counts = new Map<ColumnKind, number>();
  for (const row of rows) {
    const value = cellValue(row, column);
    if (value === null || value === undefined) continue;
    const kind = propertyType({ key: column, value: value as PropertyValue });
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: ColumnKind = "text";
  let most = 0;
  for (const [kind, count] of counts) {
    if (count > most) {
      best = kind;
      most = count;
    }
  }
  return best;
}

/** No value to show: null, "" or an empty list. */
export function isEmptyCell(value: PropertyValue | number | undefined): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Orders two cell values of a kind: numbers and times numerically, dates as written, lists by their text, text naturally; empties last. */
export function compareCells(a: PropertyValue | number, b: PropertyValue | number, kind: ColumnKind): number {
  const emptyA = isEmptyCell(a);
  const emptyB = isEmptyCell(b);
  if (emptyA || emptyB) return emptyA && emptyB ? 0 : emptyA ? 1 : -1;
  switch (kind) {
    case "number": {
      const x = typeof a === "number" ? a : Number(Array.isArray(a) ? a[0] : a);
      const y = typeof b === "number" ? b : Number(Array.isArray(b) ? b[0] : b);
      if (Number.isNaN(x) || Number.isNaN(y)) return naturalCompare(String(a), String(b));
      return x - y;
    }
    case "checkbox":
      return Number(a === true) - Number(b === true);
    case "date":
    case "datetime": {
      const x = typeof a === "number" ? a : (parseDateValue(String(a))?.getTime() ?? NaN);
      const y = typeof b === "number" ? b : (parseDateValue(String(b))?.getTime() ?? NaN);
      if (Number.isNaN(x) || Number.isNaN(y)) return naturalCompare(String(a), String(b));
      return x - y;
    }
    default:
      return naturalCompare(Array.isArray(a) ? a.join(", ") : String(a), Array.isArray(b) ? b.join(", ") : String(b));
  }
}

/** Rows in the view's order: each sort in turn (empty cells last either way), then by title and path so the order is stable. */
export function sortRows(rows: readonly BaseRow[], sort: readonly BaseSort[], kindOf: (column: string) => ColumnKind): BaseRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const { column, direction } of sort) {
      const x = cellValue(a, column);
      const y = cellValue(b, column);
      const emptyX = isEmptyCell(x);
      const emptyY = isEmptyCell(y);
      if (emptyX !== emptyY) return emptyX ? 1 : -1;
      const result = compareCells(x, y, kindOf(column));
      if (result !== 0) return direction === "desc" ? -result : result;
    }
    return naturalCompare(a.title, b.title) || naturalCompare(a.path, b.path);
  });
  return sorted;
}

/** A cell as plain text (lists joined, times as ISO dates), for searching within a view and for cards. */
export function cellText(value: PropertyValue | number, kind: ColumnKind): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return kind === "datetime" || kind === "date" ? new Date(value).toISOString().slice(0, 16).replace("T", " ") : String(value);
  return String(value);
}

/** Rows whose shown columns (or title, path and tags) contain every word of `text`, case-insensitively. */
export function searchRows(rows: readonly BaseRow[], columns: readonly string[], text: string, kindOf: (column: string) => ColumnKind): BaseRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  const shown = [...new Set(["file.name", "file.path", "file.tags", ...columns])];
  return rows.filter((row) => {
    const haystack = shown.map((column) => cellText(cellValue(row, column), kindOf(column))).join("\n").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

// MARK: - New notes

/**
 * The frontmatter a note needs to satisfy a filter's simple parts: every
 * top-level `[key:value]` sets that property and every `tag:x` adds a tag
 * (OR, NOT, scopes and words are left alone). Empty when there's nothing
 * to prefill.
 */
export function prefilledProperties(filters: string): { key: string; value: string | string[] }[] {
  const expr = parseQuery(filters).expr;
  if (!expr) return [];
  const nodes: QueryNode[] = expr.kind === "and" ? expr.nodes : [expr];
  const result: { key: string; value: string | string[] }[] = [];
  const tags: string[] = [];
  for (const node of nodes) {
    if (node.kind === "property" && node.value !== null && node.value !== "") {
      const existing = result.find((entry) => entry.key.toLowerCase() === node.key.toLowerCase());
      if (existing) existing.value = node.value;
      else result.push({ key: node.key, value: node.value });
    } else if (node.kind === "tag" && node.value) {
      const tag = node.value.replace(/^#/, "");
      if (!tags.some((known) => known.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }
  }
  if (tags.length) {
    const existing = result.find((entry) => entry.key.toLowerCase() === "tags");
    if (existing) existing.value = [...(Array.isArray(existing.value) ? existing.value : [existing.value]), ...tags];
    else result.push({ key: "tags", value: tags });
  }
  return result;
}
