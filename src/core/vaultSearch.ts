// Full-text search across a vault's notes. Pure functions over a snapshot
// of the notes, so it can run in the index worker or the renderer.
//
// Query syntax (Obsidian-style, SRCH-01/SRCH-11):
// - `kyber crystal` — notes containing every word, anywhere
// - `"kyber crystal"` — the exact phrase
// - `-ilum` — leave out notes containing the word
// - `tag:lore`, `path:Lore/Crystals`, `file:log` — filters
// - `a OR b`, `(a b) OR c`, `-(a OR b)` — alternatives, groups, exclusion
// - `line:(a b)`, `block:(a b)`, `section:(a b)` — within one line,
//   paragraph or heading section
// - `task:x`, `task-todo:x`, `task-done:x` — checklist lines
// - `content:x` — in the text only, not the file name
// - `[key]`, `[key:value]` — frontmatter properties
// With "regular expression" on, the whole query is one pattern.
//
// Ranges are `{ location, length }` in UTF-16 code units (JavaScript string
// indices) within the line's original text — the same shape as NSRange.

import { parse, TASK_PATTERN, type Property } from "./noteParser";
import { basename, naturalCompare, title as noteTitle } from "./paths";
import { stripMarkdown } from "./plainMarkdown";

export interface SearchNote {
  /** Vault path, "/"-separated. */
  path: string;
  /** Raw note text, including frontmatter and code. */
  text: string;
  tags: string[];
  /** Frontmatter properties (NOTE-02), for `[key:value]`; parsed from the text when missing. */
  properties?: Property[];
}

/**
 * One node of a parsed query. Terms next to each other are ANDed; `OR`
 * binds looser; parentheses group; `-` negates. Scoped nodes hold only
 * when their child holds within one line, block or section; task nodes
 * when it holds within the text of a checklist line.
 */
export type QueryNode =
  | { kind: "and"; nodes: QueryNode[] }
  | { kind: "or"; nodes: QueryNode[] }
  | { kind: "not"; node: QueryNode }
  /** A word or phrase in the text or the file name. */
  | { kind: "term"; text: string }
  /** A word or phrase in the text only (`content:`). */
  | { kind: "content"; text: string }
  | { kind: "tag"; value: string }
  | { kind: "path"; value: string }
  | { kind: "file"; value: string }
  /** `[key]` (value null) or `[key:value]`. */
  | { kind: "property"; key: string; value: string | null }
  | { kind: "scope"; scope: "line" | "block" | "section"; node: QueryNode }
  /** `task:` (any), `task-todo:` (open or custom status) or `task-done:`; `node` null matches any such line. */
  | { kind: "task"; status: "any" | "todo" | "done"; node: QueryNode | null };

export interface SearchQuery {
  /** Every word or phrase searched for (not under a `-`), in order — the text that results highlight. */
  terms: string[];
  /** Top-level `-word`s. */
  excluded: string[];
  /** Top-level filters. */
  tags: string[];
  paths: string[];
  files: string[];
  matchCase: boolean;
  /** Set in regular-expression mode: the whole query as one pattern. */
  regex: string | null;
  /** The full query outside regex mode; null when empty. Built from the fields above when absent. */
  expr?: QueryNode | null;
}

/** A span of UTF-16 code units: `text.slice(location, location + length)`. */
export interface SearchRange {
  location: number;
  length: number;
}

export interface LineMatch {
  /** 1-based line number. */
  line: number;
  text: string;
  /** Matches within `text`, sorted and non-overlapping. */
  ranges: SearchRange[];
}

export interface SearchHit {
  path: string;
  title: string;
  /** Total matches in the note (lines may hold several). */
  matchCount: number;
  /** Up to `maxLinesPerNote` matching lines, in order. */
  lines: LineMatch[];
  /** The note's title contains every term (or matches the pattern). */
  titleMatches: boolean;
}

export interface SearchOutcome {
  hits: SearchHit[];
  totalMatches: number;
  /** More notes matched than are listed. */
  truncated: boolean;
  error?: string;
}

export const MAX_NOTES = 200;
export const MAX_LINES_PER_NOTE = 20;
export const INVALID_REGEX_MESSAGE = "That isn’t a valid regular expression.";

// MARK: - Parsing

export function emptyQuery(matchCase = false): SearchQuery {
  return { terms: [], excluded: [], tags: [], paths: [], files: [], matchCase, regex: null, expr: null };
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return !query.regex && queryExpr(query) === null;
}

/** The query's tree, built from the flat fields for a query made by hand. */
function queryExpr(query: SearchQuery): QueryNode | null {
  if (query.expr !== undefined) return query.expr;
  const nodes: QueryNode[] = [
    ...query.terms.map((text): QueryNode => ({ kind: "term", text })),
    ...query.excluded.map((text): QueryNode => ({ kind: "not", node: { kind: "term", text } })),
    ...query.tags.map((value): QueryNode => ({ kind: "tag", value })),
    ...query.paths.map((value): QueryNode => ({ kind: "path", value })),
    ...query.files.map((value): QueryNode => ({ kind: "file", value })),
  ];
  return andOf(nodes);
}

const EDGE_SPACES = /^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu;

export function parseQuery(
  input: string,
  options: { matchCase?: boolean; useRegex?: boolean } = {},
): SearchQuery {
  const query = emptyQuery(options.matchCase ?? false);
  if (options.useRegex) {
    query.regex = input.replace(EDGE_SPACES, "");
    return query;
  }
  const expr = new QueryParser(tokenize(input)).parse();
  query.expr = expr;
  if (!expr) return query;
  // The flat fields describe the query's top level, for replace and for callers that only need words.
  collectTerms(expr, query.terms);
  for (const node of expr.kind === "and" ? expr.nodes : [expr]) {
    if (node.kind === "not" && node.node.kind === "term") query.excluded.push(node.node.text);
    else if (node.kind === "tag") query.tags.push(node.value);
    else if (node.kind === "path") query.paths.push(node.value);
    else if (node.kind === "file") query.files.push(node.value);
  }
  return query;
}

/** Every word or phrase that can produce a match (not under a `-`), in query order. */
function collectTerms(node: QueryNode, into: string[]): void {
  switch (node.kind) {
    case "term":
    case "content":
      into.push(node.text);
      break;
    case "and":
    case "or":
      for (const child of node.nodes) collectTerms(child, into);
      break;
    case "scope":
      collectTerms(node.node, into);
      break;
    case "task":
      if (node.node) collectTerms(node.node, into);
      break;
    default:
      break;
  }
}

function andOf(nodes: QueryNode[]): QueryNode | null {
  return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { kind: "and", nodes };
}

type Token = { kind: "word"; text: string; quoted: boolean } | { kind: "(" } | { kind: ")" };

const WHITESPACE = /\s/u;

/**
 * Splits on whitespace, keeping "quoted phrases" together. A quote right
 * after `-` or a `prefix:` belongs to that operator (`-"a b"`, `path:"a b"`,
 * `[status:"in progress"]`), so the token isn't a phrase. "(" opens a group
 * only at the start of a token (or after `-` / `prefix:`) and ")" closes
 * one only while a group is open, so `f(x)` is still one word.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let inQuotes = false;
  let sawQuote = false;
  /** The text before the first quote: "" for a phrase, "-" or "prefix:" for an operator. */
  let prefix = "";
  let depth = 0;
  const flush = () => {
    if (current !== "" || sawQuote) tokens.push({ kind: "word", text: current, quoted: sawQuote && prefix === "" });
    current = "";
    sawQuote = false;
    prefix = "";
  };
  for (const character of input) {
    if (character === '"') {
      if (!sawQuote) prefix = current === "-" || current.endsWith(":") ? current : "";
      inQuotes = !inQuotes;
      sawQuote = true;
    } else if (inQuotes) {
      current += character;
    } else if (WHITESPACE.test(character)) {
      flush();
    } else if (character === "(" && !sawQuote && (current === "" || current === "-" || current.endsWith(":"))) {
      flush();
      tokens.push({ kind: "(" });
      depth++;
    } else if (character === ")" && depth > 0) {
      flush();
      tokens.push({ kind: ")" });
      depth--;
    } else {
      current += character;
    }
  }
  flush();
  return tokens;
}

/** The text after a case-insensitive prefix (possibly ""), or null if the token doesn't start with it. */
function afterPrefix(prefix: string, token: string): string | null {
  if (token.length < prefix.length || token.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  return token.slice(prefix.length);
}

/** The value after a case-insensitive filter prefix, or null when absent or empty. */
function valueOf(prefix: string, token: string): string | null {
  const value = afterPrefix(prefix, token);
  return value === null || value === "" ? null : value;
}

const SCOPES = ["line", "block", "section"] as const;
const TASK_PREFIXES: [string, "any" | "todo" | "done"][] = [
  ["task-todo:", "todo"],
  ["task-done:", "done"],
  ["task:", "any"],
];

/**
 * expr := and ("OR" and)* · and := unary+ · unary := "-" unary | primary ·
 * primary := "(" expr ")" | prefix:( expr ) | word. A dangling `OR` and an
 * empty group are ignored; an unclosed group runs to the end.
 */
class QueryParser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): QueryNode | null {
    const expr = this.parseOr();
    // Stray ")" at the top level: skip it and carry on.
    while (this.position < this.tokens.length) {
      this.position++;
      const more = this.parseOr();
      if (more) return andOf([...(expr ? [expr] : []), more]);
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private parseOr(): QueryNode | null {
    const alternatives: QueryNode[] = [];
    let current: QueryNode[] = [];
    for (;;) {
      const token = this.peek();
      if (!token || token.kind === ")") break;
      if (token.kind === "word" && !token.quoted && token.text === "OR") {
        this.position++;
        if (current.length > 0) {
          alternatives.push(andOf(current)!);
          current = [];
        }
        continue;
      }
      const node = this.parseUnary();
      if (node) current.push(node);
    }
    if (current.length > 0) alternatives.push(andOf(current)!);
    return alternatives.length === 0 ? null : alternatives.length === 1 ? alternatives[0]! : { kind: "or", nodes: alternatives };
  }

  /** A parenthesised group, consuming its ")" if present; null when empty. */
  private parseGroup(): QueryNode | null {
    this.position++; // "("
    const inner = this.parseOr();
    if (this.peek()?.kind === ")") this.position++;
    return inner;
  }

  private parseUnary(): QueryNode | null {
    const token = this.peek()!;
    if (token.kind === "(") return this.parseGroup();
    this.position++;
    if (token.kind === ")") return null;
    if (token.quoted) return token.text === "" ? null : { kind: "term", text: token.text };
    let text = token.text;
    let negate = false;
    if (text === "-" && this.peek()?.kind === "(") {
      negate = true;
      text = "";
    } else if (text.startsWith("-") && text.length > 1) {
      negate = true;
      text = text.slice(1);
    }
    const node = text === "" ? this.parseGroup() : this.parseAtom(text);
    return node && negate ? { kind: "not", node } : node;
  }

  /** A word, filter or operator; a `prefix:` with no value takes the group that follows. */
  private parseAtom(text: string): QueryNode | null {
    let rest: string | null;
    const hasOperand = (value: string) => value !== "" || this.peek()?.kind === "(";
    for (const scope of SCOPES) {
      if ((rest = afterPrefix(scope + ":", text)) === null) continue;
      if (!hasOperand(rest)) break; // a bare `line:` is a word
      const node = this.operand(rest);
      return node ? { kind: "scope", scope, node } : null;
    }
    for (const [prefix, status] of TASK_PREFIXES) {
      if ((rest = afterPrefix(prefix, text)) === null) continue;
      if (!hasOperand(rest)) return { kind: "task", status, node: null };
      const node = this.operand(rest);
      return node ? { kind: "task", status, node } : null;
    }
    if ((rest = afterPrefix("content:", text)) !== null && hasOperand(rest)) {
      const node = this.operand(rest);
      return node ? contentOnly(node) : null;
    }
    if ((rest = valueOf("tag:", text)) !== null) return { kind: "tag", value: rest.startsWith("#") ? rest.slice(1) : rest };
    if ((rest = valueOf("path:", text)) !== null) return { kind: "path", value: rest };
    if ((rest = valueOf("file:", text)) !== null) return { kind: "file", value: rest };
    const property = parseProperty(text);
    return property ?? { kind: "term", text };
  }

  /** `prefix:word` → that word; `prefix:(…)` → the group (possibly empty → null). */
  private operand(rest: string): QueryNode | null {
    return rest !== "" ? { kind: "term", text: rest } : this.parseGroup();
  }
}

/** `[key]` or `[key:value]`; null for anything else (a `[[link]]` is a word). */
function parseProperty(text: string): QueryNode | null {
  if (text.length < 3 || !text.startsWith("[") || !text.endsWith("]")) return null;
  const inner = text.slice(1, -1);
  const colon = inner.indexOf(":");
  const key = (colon < 0 ? inner : inner.slice(0, colon)).replace(EDGE_SPACES, "");
  if (key === "" || /[[\]]/.test(key)) return null;
  const value = colon < 0 ? null : inner.slice(colon + 1).replace(EDGE_SPACES, "");
  return { kind: "property", key, value };
}

/** The same query with every word matched in the text only (`content:(…)`). */
function contentOnly(node: QueryNode): QueryNode {
  switch (node.kind) {
    case "term":
      return { kind: "content", text: node.text };
    case "and":
    case "or":
      return { ...node, nodes: node.nodes.map(contentOnly) };
    case "not":
      return { kind: "not", node: contentOnly(node.node) };
    case "scope":
      return { ...node, node: contentOnly(node.node) };
    case "task":
      return { ...node, node: node.node ? contentOnly(node.node) : null };
    default:
      return node;
  }
}

// MARK: - Folding
//
// Case- and accent-insensitive matching compares folded text: lowercased,
// decomposed (NFD) and stripped of combining marks, so "Café" → "cafe".
// Folding is per character, so a match in folded text maps back to the
// original by walking both in step (see `unfoldRanges`).

const ASCII_ONLY = /^[\x00-\x7f]*$/;
const MARKS = /\p{M}/gu;
const FINAL_SIGMA = /ς/g;

/**
 * Folds a whole string with native operations — fast enough to screen every
 * note. Final sigma becomes σ so the result doesn't depend on context and
 * equals the concatenation of each character folded on its own.
 */
function quickFold(text: string): string {
  const lower = text.toLowerCase();
  if (ASCII_ONLY.test(lower)) return lower;
  return lower.normalize("NFD").replace(MARKS, "").replace(FINAL_SIGMA, "σ");
}

const foldedLengths = new Map<number, number>();

/** UTF-16 length of the folded form of the character at `index` (0 for a dropped mark). */
function foldedLength(text: string, index: number): number {
  const code = text.codePointAt(index)!;
  if (code < 0x80) return 1;
  let length = foldedLengths.get(code);
  if (length === undefined) {
    length = quickFold(String.fromCodePoint(code)).length;
    if (foldedLengths.size > 8192) foldedLengths.clear();
    foldedLengths.set(code, length);
  }
  return length;
}

/**
 * Maps sorted, non-overlapping ranges in `quickFold(text)` back to `text`.
 * A range covers every character that produced part of it, plus any
 * dropped accents right after it.
 */
function unfoldRanges(text: string, ranges: SearchRange[]): SearchRange[] {
  if (ASCII_ONLY.test(text)) return ranges;
  const result: SearchRange[] = [];
  let original = 0; // index into `text`
  let folded = 0; // folded offset where the character at `original` begins
  const step = () => {
    folded += foldedLength(text, original);
    original += text.charCodeAt(original) >= 0xd800 && text.charCodeAt(original) <= 0xdbff ? 2 : 1;
  };
  for (const range of ranges) {
    const end = range.location + range.length;
    while (original < text.length && folded + foldedLength(text, original) <= range.location) step();
    const start = original;
    while (original < text.length && folded < end) step();
    while (original < text.length && foldedLength(text, original) === 0) step();
    result.push({ location: start, length: original - start });
  }
  return result;
}

/**
 * Quick folds of note texts from earlier searches, by path, so typing in the
 * search field doesn't refold the vault on every keystroke.
 */
const noteFoldCache = new Map<string, { source: string; folded: string }>();

function foldedNote(note: SearchNote): string {
  const cached = noteFoldCache.get(note.path);
  if (cached && cached.source === note.text) return cached.folded;
  const folded = quickFold(note.text);
  noteFoldCache.set(note.path, { source: note.text, folded });
  return folded;
}

/** Drops cached folds of notes that are gone. */
function pruneFoldCache(notes: readonly SearchNote[]): void {
  if (noteFoldCache.size <= notes.length + 1000) return;
  const present = new Set(notes.map((note) => note.path));
  for (const path of noteFoldCache.keys()) if (!present.has(path)) noteFoldCache.delete(path);
}

// MARK: - Running

export function runSearch(
  query: SearchQuery,
  notes: readonly SearchNote[],
  maxNotes = MAX_NOTES,
  maxLinesPerNote = MAX_LINES_PER_NOTE,
): SearchOutcome {
  const outcome: SearchOutcome = { hits: [], totalMatches: 0, truncated: false };
  if (isEmptyQuery(query)) return outcome;

  // `^`/`$` match at line breaks; lines are searched one at a time.
  let lineRegex: RegExp | null = null;
  let testRegex: RegExp | null = null;
  if (query.regex) {
    const flags = query.matchCase ? "m" : "im";
    try {
      testRegex = compile(query.regex, flags);
      lineRegex = compile(query.regex, flags + "g");
    } catch {
      return { ...outcome, error: INVALID_REGEX_MESSAGE };
    }
  }
  const expr = lineRegex ? null : prepareNode(queryExpr(query)!, query.matchCase);
  const folding = !query.matchCase;

  const candidates: { note: SearchNote; context: NoteContext | null; hits: Hit[]; hit: SearchHit }[] = [];
  for (const note of notes) {
    const title = noteTitle(note.path);
    let titleMatches: boolean;
    let matchCount: number;
    let context: NoteContext | null = null;
    const hits: Hit[] = [];
    // First pass: counts only. Lines are built afterwards for the notes kept.
    if (testRegex && lineRegex) {
      titleMatches = testRegex.test(title);
      if (!titleMatches && !testRegex.test(note.text)) continue;
      ({ matchCount } = regexLines(note.text, lineRegex, 0));
    } else {
      context = new NoteContext(note, title, query.matchCase, false);
      if (!evaluate(expr!, context, context.whole, hits)) continue;
      titleMatches = hasTerm(expr!) && matchesTitle(expr!, context.title);
      // Filter-only queries (e.g. "tag:lore") and title-only matches list notes without lines.
      matchCount = hits.length === 0 ? 0 : groupByLine(note.text, context.haystack, folding, hits, 0).matchCount;
    }

    outcome.totalMatches += matchCount;
    candidates.push({ note, context, hits, hit: { path: note.path, title, matchCount, lines: [], titleMatches } });
  }

  // Rank every match, then keep the best `maxNotes` (not merely the first found).
  candidates.sort((a, b) => {
    if (a.hit.titleMatches !== b.hit.titleMatches) return a.hit.titleMatches ? -1 : 1;
    if (a.hit.matchCount !== b.hit.matchCount) return b.hit.matchCount - a.hit.matchCount;
    return naturalCompare(a.hit.path, b.hit.path);
  });
  outcome.truncated = candidates.length > maxNotes;
  for (const { note, context, hits, hit } of candidates.slice(0, maxNotes)) {
    if (lineRegex) hit.lines = regexLines(note.text, lineRegex, maxLinesPerNote).lines;
    else if (hits.length > 0 && context) hit.lines = groupByLine(note.text, context.haystack, folding, hits, maxLinesPerNote).lines;
    outcome.hits.push(hit);
  }
  if (!query.matchCase) pruneFoldCache(notes);
  return outcome;
}

/** Parses and runs in one step. */
export function search(
  input: string,
  notes: readonly SearchNote[],
  options: { matchCase?: boolean; useRegex?: boolean } = {},
): SearchOutcome {
  return runSearch(parseQuery(input, options), notes);
}

/**
 * Compiles a query (text, or one from `parseQuery`) into a predicate that
 * says whether a note matches it — the same syntax and semantics as the
 * search results, without producing hits, so other features can filter
 * notes with it. An empty query matches every note (no filter), unlike a
 * search, which shows nothing. In regex mode the pattern is tested against
 * the title and the text; an invalid pattern throws an Error whose message
 * is `INVALID_REGEX_MESSAGE`.
 */
export function compileQuery(
  query: string | SearchQuery,
  options: { matchCase?: boolean; useRegex?: boolean } = {},
): (note: SearchNote) => boolean {
  const parsed = typeof query === "string" ? parseQuery(query, options) : query;
  if (parsed.regex !== null) {
    if (parsed.regex === "") return () => true;
    let regex: RegExp;
    try {
      regex = compile(parsed.regex, parsed.matchCase ? "m" : "im");
    } catch {
      throw new Error(INVALID_REGEX_MESSAGE);
    }
    return (note) => regex.test(noteTitle(note.path)) || regex.test(note.text);
  }
  const expr = queryExpr(parsed);
  if (!expr) return () => true;
  const prepared = prepareNode(expr, parsed.matchCase);
  return (note) => {
    const context = new NoteContext(note, noteTitle(note.path), parsed.matchCase, false);
    return evaluate(prepared, context, context.whole, null);
  };
}

// MARK: - Evaluating
//
// A query tree is evaluated against one note at a time. Each node says
// whether it holds within a region of the note (the whole note, or one
// line, block, section or task's text for scoped operators) and appends the
// spans of the words that made it hold, in the folded text, to `hits`; the
// hits are then grouped by line and mapped back to the original text, so
// what's highlighted is exactly what matched.

/** A span of the (folded) note text, [start, end). */
interface Hit {
  start: number;
  end: number;
}

/** A region of the (folded) note text, [from, to). */
interface Region {
  from: number;
  to: number;
}

interface LineUnit extends Region {
  /** 1-based. */
  number: number;
}

interface TaskUnit {
  /** The text after the box. */
  text: Region;
  done: boolean;
}

/** Everything the evaluator knows about one note, worked out lazily. */
class NoteContext {
  readonly whole: Region;
  private _haystack: string | null = null;
  private _title: string | null = null;
  private readonly occurrences = new Map<string, number[]>();
  private _lines: LineUnit[] | null = null;
  private _blocks: Region[] | null = null;
  private _sections: Region[] | null = null;
  private _tasks: TaskUnit[] | null = null;
  private _properties: Property[] | null = null;

  constructor(
    readonly note: SearchNote,
    private readonly rawTitle: string,
    private readonly matchCase: boolean,
    /** Treat tag/path/file/property filters as true (replacing within one note). */
    readonly filtersNeutral: boolean,
  ) {
    this.whole = { from: 0, to: note.text.length };
  }

  /** The note's text as searched: folded unless matching case. Line breaks are kept, so offsets map line for line. */
  get haystack(): string {
    return (this._haystack ??= this.matchCase ? this.note.text : foldedNote(this.note));
  }

  get title(): string {
    return (this._title ??= this.matchCase ? this.rawTitle : quickFold(this.rawTitle));
  }

  get properties(): Property[] {
    return (this._properties ??= this.note.properties ?? parse(this.note.text).properties);
  }

  /** A property value as compared with a `[key:value]`: folded unless matching case. */
  prepareValue(value: string): string {
    return this.matchCase ? value : quickFold(value);
  }

  /** Starts of every occurrence of a prepared term, ascending. */
  occurrencesOf(term: string): number[] {
    let starts = this.occurrences.get(term);
    if (!starts) {
      starts = [];
      // Lines never contain a break, so such a term can't match within one; "" never matches.
      if (term !== "" && !term.includes("\n") && !term.includes("\r")) {
        const haystack = this.haystack;
        let from = 0;
        for (;;) {
          const found = haystack.indexOf(term, from);
          if (found < 0) break;
          starts.push(found);
          from = found + term.length;
        }
      }
      this.occurrences.set(term, starts);
    }
    return starts;
  }

  get lines(): LineUnit[] {
    if (!this._lines) {
      const lines: LineUnit[] = [];
      const cursor = new LineCursor(this.haystack);
      for (;;) {
        lines.push({ from: cursor.start, to: cursor.end, number: cursor.number });
        if (cursor.atEnd) break;
        cursor.advance();
      }
      this._lines = lines;
    }
    return this._lines;
  }

  get blocks(): Region[] {
    return (this._blocks ??= blocksOf(this.haystack, this.lines));
  }

  get sections(): Region[] {
    return (this._sections ??= sectionsOf(this.haystack, this.lines));
  }

  get tasks(): TaskUnit[] {
    return (this._tasks ??= tasksOf(this.haystack, this.lines));
  }
}

/** The query with its words folded like the notes and its filter values lowercased. */
function prepareNode(node: QueryNode, matchCase: boolean): QueryNode {
  const prepare = matchCase ? (text: string) => text : quickFold;
  switch (node.kind) {
    case "term":
    case "content":
      return { kind: node.kind, text: prepare(node.text) };
    case "tag":
    case "path":
    case "file":
      return { kind: node.kind, value: node.value.toLowerCase() };
    case "property":
      return { kind: "property", key: node.key.toLowerCase(), value: node.value === null ? null : prepare(node.value) };
    case "and":
    case "or":
      return { kind: node.kind, nodes: node.nodes.map((child) => prepareNode(child, matchCase)) };
    case "not":
      return { kind: "not", node: prepareNode(node.node, matchCase) };
    case "scope":
      return { kind: "scope", scope: node.scope, node: prepareNode(node.node, matchCase) };
    case "task":
      return { kind: "task", status: node.status, node: node.node ? prepareNode(node.node, matchCase) : null };
  }
}

/**
 * Whether `node` holds within `region` of the note. The words that made it
 * hold are appended to `hits` (when given); a node that doesn't hold leaves
 * `hits` as it found it.
 */
function evaluate(node: QueryNode, context: NoteContext, region: Region, hits: Hit[] | null): boolean {
  switch (node.kind) {
    case "term":
    case "content": {
      const starts = occurrencesWithin(context, node.text, region);
      if (starts.length > 0) {
        if (hits) for (const start of starts) hits.push({ start, end: start + node.text.length });
        return true;
      }
      // The file name counts as text for the note as a whole, not within a line or section.
      return node.kind === "term" && region === context.whole && node.text !== "" && context.title.includes(node.text);
    }
    case "and": {
      const mark = hits?.length ?? 0;
      for (const child of node.nodes) {
        if (!evaluate(child, context, region, hits)) {
          if (hits) hits.length = mark;
          return false;
        }
      }
      return true;
    }
    case "or": {
      // Every alternative that holds contributes its matches.
      let any = false;
      for (const child of node.nodes) if (evaluate(child, context, region, hits)) any = true;
      return any;
    }
    case "not":
      return !evaluate(node.node, context, region, null);
    case "tag":
      return context.filtersNeutral || context.note.tags.some((tag) => {
        const lower = tag.toLowerCase();
        return lower === node.value || lower.startsWith(node.value + "/");
      });
    case "path":
      return context.filtersNeutral || context.note.path.toLowerCase().includes(node.value);
    case "file":
      return context.filtersNeutral || basename(context.note.path).toLowerCase().includes(node.value);
    case "property":
      return context.filtersNeutral || matchesProperty(node, context);
    case "scope": {
      // Nothing can hold in a part of the region if it doesn't hold in the whole (unless a `-` is involved).
      if (!containsNot(node.node) && !evaluate(node.node, context, region, null)) return false;
      const units = node.scope === "line" ? context.lines : node.scope === "block" ? context.blocks : context.sections;
      let any = false;
      for (const unit of units) {
        if (unit.from < region.from || unit.to > region.to) continue;
        if (evaluate(node.node, context, unit, hits)) any = true;
      }
      return any;
    }
    case "task": {
      if (node.node && !containsNot(node.node) && !evaluate(node.node, context, region, null)) return false;
      let any = false;
      for (const task of context.tasks) {
        if (task.text.from < region.from || task.text.to > region.to) continue;
        if (node.status === "done" ? !task.done : node.status === "todo" ? task.done : false) continue;
        if (node.node) {
          if (evaluate(node.node, context, task.text, hits)) any = true;
        } else {
          if (hits && task.text.to > task.text.from) hits.push({ start: task.text.from, end: task.text.to });
          any = true;
        }
      }
      return any;
    }
  }
}

/** Occurrences of `term` that lie entirely within `region`. */
function occurrencesWithin(context: NoteContext, term: string, region: Region): number[] {
  const all = context.occurrencesOf(term);
  if (region === context.whole || all.length === 0) return all;
  // Binary search for the first start at or after the region.
  let low = 0;
  let high = all.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (all[mid]! < region.from) low = mid + 1;
    else high = mid;
  }
  const result: number[] = [];
  for (let i = low; i < all.length && all[i]! + term.length <= region.to; i++) result.push(all[i]!);
  return result;
}

function matchesProperty(node: Extract<QueryNode, { kind: "property" }>, context: NoteContext): boolean {
  for (const property of context.properties) {
    if (property.key.toLowerCase() !== node.key) continue;
    if (node.value === null) return true;
    if (node.value === "") continue;
    for (const value of property.values) if (context.prepareValue(value).includes(node.value)) return true;
  }
  return false;
}

function containsNot(node: QueryNode): boolean {
  switch (node.kind) {
    case "not":
      return true;
    case "and":
    case "or":
      return node.nodes.some(containsNot);
    case "scope":
      return containsNot(node.node);
    case "task":
      return node.node ? containsNot(node.node) : false;
    default:
      return false;
  }
}

/** The query asks for some word (so a note can match on its title alone). */
function hasTerm(node: QueryNode): boolean {
  switch (node.kind) {
    case "term":
    case "content":
      return true;
    case "and":
    case "or":
      return node.nodes.some(hasTerm);
    case "scope":
      return hasTerm(node.node);
    case "task":
      return node.node ? hasTerm(node.node) : false;
    default:
      return false;
  }
}

/** Whether the title alone satisfies the query's words (filters are taken as holding). */
function matchesTitle(node: QueryNode, title: string): boolean {
  switch (node.kind) {
    case "term":
      return node.text !== "" && title.includes(node.text);
    case "content":
      return false;
    case "and":
      return node.nodes.every((child) => matchesTitle(child, title));
    case "or":
      return node.nodes.some((child) => matchesTitle(child, title));
    case "not":
      return !matchesTitle(node.node, title);
    case "scope":
      return matchesTitle(node.node, title);
    case "task":
      return node.node ? matchesTitle(node.node, title) : false;
    default:
      return true;
  }
}

const BLANK = /^[\t\p{Zs}]*$/u;
const LIST_ITEM = /^[\t\p{Zs}]*(?:[-*+]|\d+[.)])(?:[\t\p{Zs}]|$)/u;
const HEADING = /^(#{1,6})(?:[\t\p{Zs}]|$)/u;
const INDENTED = /^[\t\p{Zs}]/u;

/** The opening fence of a code block, or null. */
function fenceOf(line: string): string | null {
  const trimmed = line.replace(/^[ \t]+/, "");
  return trimmed.startsWith("```") || trimmed.startsWith("~~~") ? trimmed.slice(0, 3) : null;
}

/**
 * Blank-line-separated paragraphs, where a heading, each list item (with
 * its indented continuation lines), a table and a code block are blocks
 * of their own.
 */
function blocksOf(text: string, lines: LineUnit[]): Region[] {
  const blocks: Region[] = [];
  let current: (Region & { kind: "paragraph" | "list" | "table" | "code" }) | null = null;
  let fence: string | null = null;
  const close = () => {
    if (current) blocks.push({ from: current.from, to: current.to });
    current = null;
  };
  for (const line of lines) {
    const content = text.slice(line.from, line.to);
    const trimmed = content.replace(/^[ \t]+/, "");
    if (fence && current) {
      current.to = line.to;
      if (trimmed.startsWith(fence)) {
        fence = null;
        close();
      }
      continue;
    }
    if (BLANK.test(content)) {
      close();
      continue;
    }
    const opening = fenceOf(content);
    if (opening) {
      close();
      fence = opening;
      current = { from: line.from, to: line.to, kind: "code" };
    } else if (HEADING.test(content)) {
      close();
      blocks.push({ from: line.from, to: line.to });
    } else if (LIST_ITEM.test(content)) {
      close();
      current = { from: line.from, to: line.to, kind: "list" };
    } else if (trimmed.startsWith("|")) {
      if (current?.kind === "table") current.to = line.to;
      else {
        close();
        current = { from: line.from, to: line.to, kind: "table" };
      }
    } else if (current && (current.kind === "paragraph" || (current.kind === "list" && INDENTED.test(content)))) {
      current.to = line.to;
    } else {
      close();
      current = { from: line.from, to: line.to, kind: "paragraph" };
    }
  }
  close();
  return blocks;
}

/**
 * From each heading to the next heading of the same or a higher level (so
 * a section holds its subsections), plus the text before the first heading.
 */
function sectionsOf(text: string, lines: LineUnit[]): Region[] {
  const headings: { index: number; level: number }[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const content = text.slice(line.from, line.to);
    if (fence) {
      if (content.replace(/^[ \t]+/, "").startsWith(fence)) fence = null;
      return;
    }
    const opening = fenceOf(content);
    if (opening) {
      fence = opening;
      return;
    }
    const heading = HEADING.exec(content);
    if (heading) headings.push({ index, level: heading[1]!.length });
  });
  const sections: Region[] = [];
  const first = headings[0]?.index ?? lines.length;
  if (first > 0) sections.push({ from: lines[0]!.from, to: lines[first - 1]!.to });
  headings.forEach((heading, position) => {
    const next = headings.slice(position + 1).find((other) => other.level <= heading.level);
    const last = next ? lines[next.index - 1]! : lines[lines.length - 1]!;
    sections.push({ from: lines[heading.index]!.from, to: last.to });
  });
  return sections;
}

/** Checklist lines (TSK-01) outside code blocks, with the region of their text. */
function tasksOf(text: string, lines: LineUnit[]): TaskUnit[] {
  const tasks: TaskUnit[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const content = text.slice(line.from, line.to);
    if (fence) {
      if (content.replace(/^[ \t]+/, "").startsWith(fence)) fence = null;
      continue;
    }
    const opening = fenceOf(content);
    if (opening) {
      fence = opening;
      continue;
    }
    const task = TASK_PATTERN.exec(content);
    if (!task) continue;
    const status = task[2]!;
    tasks.push({ text: { from: line.to - task[3]!.length, to: line.to }, done: status === "x" || status === "X" });
  }
  return tasks;
}

// MARK: - Replacing

export interface Replacement {
  text: string;
  /** Matches replaced (merged overlapping term matches count once). */
  count: number;
}

/**
 * Replaces every match of `query` in one note's text (search & replace,
 * SRCH-10). Only the text query is replaced: `tag:`/`path:`/`file:` and
 * `-word` pick notes, so a query with no terms or pattern changes nothing.
 * In regex mode `replacement` may use `$1`, `$&` and friends, as in
 * String.replace; otherwise it's inserted literally. Ranges come from the
 * same matcher as the results list, so what's highlighted is what changes.
 * Throws on an invalid pattern.
 */
export function replaceMatches(text: string, query: SearchQuery, replacement: string): Replacement {
  if (query.regex !== null) {
    if (query.regex === "") return { text, count: 0 };
    const regex = compile(query.regex, query.matchCase ? "mg" : "img");
    let count = 0;
    // Zero-length matches are never results, so they're never replaced; a
    // match that spans a line break can't happen (search is per line, and
    // without the `s` flag "." doesn't cross one).
    const replaced = text.replace(regex, (...args: unknown[]) => {
      const match = args[0] as string;
      if (match.length === 0 || /[\r\n]/.test(match)) return match;
      count++;
      const offset = args.at(-2) as number;
      return expandReplacement(replacement, match, args.slice(1, -2) as (string | undefined)[], text, offset, args.at(-1));
    });
    return { text: replaced, count };
  }
  const expr = queryExpr(query);
  if (!expr) return { text, count: 0 };
  // Filters are taken as holding: the note was already picked by the search.
  const context = new NoteContext({ path: "", text, tags: [] }, "", query.matchCase, true);
  const hits: Hit[] = [];
  if (!evaluate(prepareNode(expr, query.matchCase), context, context.whole, hits) || hits.length === 0) return { text, count: 0 };
  const { lines } = groupByLine(text, context.haystack, !query.matchCase, hits, Infinity);
  // Lines hold ranges relative to their own text; walk the original to make them absolute.
  const cursor = new LineCursor(text);
  const pieces: string[] = [];
  let from = 0;
  let count = 0;
  for (const line of lines) {
    while (cursor.number < line.line) cursor.advance();
    for (const range of line.ranges) {
      const start = cursor.start + range.location;
      pieces.push(text.slice(from, start), replacement);
      from = start + range.length;
      count++;
    }
  }
  pieces.push(text.slice(from));
  return { text: pieces.join(""), count };
}

/** `$1`, `$<name>`, `$&`, `` $` ``, `$'` and `$$` as String.replace expands them. */
function expandReplacement(
  pattern: string,
  match: string,
  groups: (string | undefined)[],
  text: string,
  offset: number,
  named: unknown,
): string {
  // Reuse the engine's own expansion by replacing the match within itself.
  const namedGroups = typeof named === "object" && named !== null ? (named as Record<string, string | undefined>) : undefined;
  return pattern.replace(/\$(\$|&|`|'|<([^>]*)>|(\d{1,2}))/g, (whole, kind: string, name: string | undefined, digits: string | undefined) => {
    if (kind === "$") return "$";
    if (kind === "&") return match;
    if (kind === "`") return text.slice(0, offset);
    if (kind === "'") return text.slice(offset + match.length);
    if (name !== undefined) return namedGroups && name in namedGroups ? (namedGroups[name] ?? "") : whole;
    if (digits !== undefined) {
      // Two digits are one group if that group exists, else one digit plus a literal.
      const two = Number(digits);
      if (digits.length === 2 && two >= 1 && two <= groups.length) return groups[two - 1] ?? "";
      const one = Number(digits[0]);
      if (one >= 1 && one <= groups.length) return (groups[one - 1] ?? "") + digits.slice(1);
      return whole;
    }
    return whole;
  });
}

/** Unicode mode when the pattern allows it (\p{L} etc.), else legacy syntax. */
function compile(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags + "u");
  } catch {
    return new RegExp(pattern, flags);
  }
}

/**
 * Hits (spans of the folded `haystack`, in any order) grouped by line with
 * overlaps merged (e.g. "kyber" and "kyber crystal"). Folding keeps line
 * breaks, so lines correspond one to one; only lines that are listed are
 * refolded to map ranges back to `original`.
 */
function groupByLine(
  original: string,
  haystack: string,
  folding: boolean,
  hits: readonly Hit[],
  maxLines: number,
): { lines: LineMatch[]; matchCount: number } {
  if (hits.length === 0) return { lines: [], matchCount: 0 };
  const order = hits.map((_, index) => index);
  if (hits.length > 1) order.sort((a, b) => hits[a]!.start - hits[b]!.start || hits[a]!.end - hits[b]!.end);
  const lines: LineMatch[] = [];
  let matchCount = 0;
  const foldedLine = new LineCursor(haystack);
  const originalLine = folding ? new LineCursor(original) : foldedLine;
  let current: SearchRange[] = [];
  const finishLine = () => {
    if (current.length === 0) return;
    matchCount += current.length;
    if (lines.length < maxLines) {
      const text = original.slice(originalLine.start, originalLine.end);
      lines.push({ line: foldedLine.number, text, ranges: folding ? unfoldRanges(text, current) : current });
    }
    current = [];
  };
  for (const index of order) {
    const { start, end } = hits[index]!;
    if (start >= foldedLine.end && !foldedLine.atEnd) {
      finishLine();
      while (start >= foldedLine.end && !foldedLine.atEnd) {
        foldedLine.advance();
        if (originalLine !== foldedLine && lines.length < maxLines) originalLine.advance();
      }
    }
    const location = start - foldedLine.start;
    const last = current[current.length - 1];
    if (last && location <= last.location + last.length) {
      last.length = Math.max(last.length, end - foldedLine.start - last.location);
    } else {
      current.push({ location, length: end - start });
    }
  }
  finishLine();
  return { lines, matchCount };
}

/** Lines split on \n, \r\n or \r; a trailing break adds no empty line. */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function regexLines(text: string, regex: RegExp, maxLines: number): { lines: LineMatch[]; matchCount: number } {
  const lines: LineMatch[] = [];
  let matchCount = 0;
  const all = splitLines(text);
  for (let index = 0; index < all.length; index++) {
    const line = all[index]!;
    const ranges: SearchRange[] = [];
    for (const match of line.matchAll(regex)) {
      if (match[0].length > 0) ranges.push({ location: match.index, length: match[0].length });
    }
    if (ranges.length === 0) continue;
    matchCount += ranges.length;
    if (lines.length < maxLines) lines.push({ line: index + 1, text: line, ranges });
  }
  return { lines, matchCount };
}

/** Walks the lines of a text (breaks: \n, \r\n, \r) without splitting it. */
class LineCursor {
  number = 1;
  start = 0;
  end: number;
  private nextNewline: number;
  private nextReturn: number;

  constructor(private readonly text: string) {
    this.nextNewline = text.indexOf("\n");
    this.nextReturn = text.indexOf("\r");
    this.end = this.findEnd();
  }

  get atEnd(): boolean {
    return this.end >= this.text.length;
  }

  advance(): void {
    const text = this.text;
    this.start = this.end + (text.charCodeAt(this.end) === 13 && text.charCodeAt(this.end + 1) === 10 ? 2 : 1);
    this.number++;
    this.end = this.findEnd();
  }

  private findEnd(): number {
    if (this.nextNewline >= 0 && this.nextNewline < this.start) this.nextNewline = this.text.indexOf("\n", this.start);
    if (this.nextReturn >= 0 && this.nextReturn < this.start) this.nextReturn = this.text.indexOf("\r", this.start);
    const newline = this.nextNewline < 0 ? this.text.length : this.nextNewline;
    return this.nextReturn >= 0 && this.nextReturn < newline ? this.nextReturn : newline;
  }
}

// MARK: - Snippets

export interface Snippet {
  /** The trimmed line, with "…" where text was cut. */
  text: string;
  /** Matches within `text`. */
  ranges: SearchRange[];
}

export const SNIPPET_LEAD = 24;
export const SNIPPET_LENGTH = 240;

const SPACE = /[\t\p{Zs}]/u;
const MARK = /\p{M}/u;

/**
 * The matching line, trimmed to start shortly before the first match (at a
 * word boundary) and to at most 240 characters, with ranges adjusted to it.
 */
export function snippet(lineText: string, ranges: readonly SearchRange[]): Snippet {
  const firstMatch = ranges[0]?.location ?? 0;
  let start = Math.max(0, firstMatch - SNIPPET_LEAD);
  if (start > 0) {
    // Begin at the next word boundary so the snippet doesn't start mid-word.
    let space = -1;
    for (let i = start; i < firstMatch; i++) {
      if (SPACE.test(lineText[i]!)) {
        space = i;
        break;
      }
    }
    start = space >= 0 ? space + 1 : characterStart(lineText, start);
  }
  let end = Math.min(lineText.length, start + SNIPPET_LENGTH);
  if (end < lineText.length && isLowSurrogate(lineText.charCodeAt(end))) end--;

  const prefix = start > 0 ? "…" : "";
  const adjusted: SearchRange[] = [];
  for (const range of ranges) {
    if (range.location < start || range.location >= end) continue;
    const length = Math.min(range.length, end - range.location);
    adjusted.push({ location: range.location - start + prefix.length, length });
  }
  const text = prefix + lineText.slice(start, end) + (end < lineText.length ? "…" : "");
  return { text, ranges: adjusted };
}

/**
 * The snippet as the reader sees the line: markdown syntax stripped, matches
 * moved onto the plain text. Falls back to the raw line when a match was in
 * the syntax itself (a search for "**", say).
 */
export function plainSnippet(lineText: string, ranges: readonly SearchRange[]): Snippet {
  const plain = stripMarkdown(lineText, { block: true });
  const moved: SearchRange[] = [];
  for (const range of ranges) {
    const end = range.location + range.length;
    let first = -1;
    let last = -1;
    for (let i = 0; i < plain.map.length; i++) {
      const source = plain.map[i]!;
      if (source >= range.location && source < end) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return snippet(lineText, ranges);
    moved.push({ location: first, length: last - first + 1 });
  }
  return snippet(plain.text, moved);
}

/**
 * Search results as markdown for the clipboard (SRCH-13): a `- [[title]]`
 * bullet per note, with its matching lines (as the panel shows them: plain
 * text snippets, at most `maxLines`) indented beneath it.
 */
export function resultsAsMarkdown(hits: readonly SearchHit[], maxLines = MAX_LINES_PER_NOTE): string {
  const out: string[] = [];
  for (const hit of hits) {
    out.push(`- [[${hit.title}]]`);
    for (const line of hit.lines.slice(0, maxLines)) {
      const text = plainSnippet(line.text, line.ranges).text.replace(/^[\t\p{Zs}]+/u, "");
      if (text !== "") out.push(`    ${text}`);
    }
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Steps back to the start of the user-perceived character containing `index`. */
function characterStart(text: string, index: number): number {
  let i = index;
  for (;;) {
    if (i > 0 && isLowSurrogate(text.charCodeAt(i))) {
      i--;
    } else if (i > 0 && MARK.test(String.fromCodePoint(text.codePointAt(i)!))) {
      i--;
    } else {
      return i;
    }
  }
}
