// CSS snippets (REQUIREMENTS §16.11) and custom font names: pure helpers
// shared by the main process (which reads the files) and the renderer
// (which injects them). No Node or DOM imports.

/** Where a vault keeps its snippets, relative to the vault root (a hidden folder, VLT-03). */
export const SNIPPETS_FOLDER = ".holocron/snippets";

/** Most a single snippet may hold (UTF-16 units); bigger files are skipped. */
export const MAX_SNIPPET_LENGTH = 512 * 1024;

/** The state-store key holding the enabled snippet names of a vault. */
export function snippetsKey(root: string): string {
  return `snippets:${root}`;
}

/** A snippet file as the renderer sees it. */
export interface SnippetView {
  /** The file name without ".css". */
  name: string;
  enabled: boolean;
  /** The sanitised stylesheet. */
  css: string;
}

/**
 * Keeps a snippet from reaching the network (NFR-04): every `@import` rule
 * goes, and any `url()` that names a remote or non-data scheme (http, https,
 * protocol-relative `//`, file, ftp…) becomes `url()`, which browsers ignore.
 * `url(data:…)`, local() fonts and plain relative references are kept.
 */
export function sanitizeSnippet(css: string): string {
  // @import "x"; / @import url(x) layer supports(...) media; — up to the next ";" or line end.
  let out = css.replace(/@import\b[^;{}\n]*(;|(?=\n)|$)/gi, "");
  // url("https://…"), url('//…'), url(file:…): anything with a scheme except data:.
  out = out.replace(/url\(\s*(['"]?)\s*([^'")]*?)\s*\1\s*\)/gi, (match, _quote: string, target: string) => {
    const value = target.trim();
    if (/^\/\//.test(value)) return "url()";
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
    if (scheme && scheme[1]!.toLowerCase() !== "data") return "url()";
    return match;
  });
  return out;
}

/** Whether `name` is a snippet file name Holocron lists: "*.css", no path parts. */
export function isSnippetFile(name: string): boolean {
  return /^[^\\/]+\.css$/i.test(name) && !name.startsWith(".");
}

/** The snippet's name: its file name without the extension. */
export function snippetName(file: string): string {
  return file.replace(/\.css$/i, "");
}

/** Snippet order: by file name, case-insensitively with numbers compared numerically. */
export function compareSnippetNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b);
}

/** Most characters a font-family setting may hold. */
export const MAX_FONT_FAMILY_LENGTH = 200;

/**
 * A font-family setting as stored: trimmed, one line, without the quotes,
 * braces or semicolons that could break out of a CSS value. A list
 * ("Inter, Segoe UI") is kept as typed.
 */
export function sanitizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/["'`;{}()\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FONT_FAMILY_LENGTH);
}

/**
 * The CSS `font-family` value for a custom font: each name quoted, followed
 * by `fallback` (a built-in stack) so missing fonts degrade gracefully.
 * An empty custom name yields the fallback alone.
 */
export function fontStack(custom: string, fallback: string): string {
  const names = sanitizeFontFamily(custom)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.length === 0) return fallback;
  return [...names.map((name) => `'${name}'`), fallback].join(", ");
}
