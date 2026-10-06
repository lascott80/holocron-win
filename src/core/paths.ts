// Helpers for vault paths: "/"-separated, relative to the vault root
// ("Lore/Crystals/Kyber.md"). Pure string functions, no file system access,
// so they work in the main process, the index worker and the renderer.

export const NOTE_EXTENSIONS = new Set(["md", "markdown"]);

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "avif",
]);

/** The last path component: "Lore/Kyber.md" → "Kyber.md". */
export function basename(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** Everything before the last component: "Lore/Kyber.md" → "Lore"; "Kyber.md" → "". */
export function dirname(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? "" : trimmed.slice(0, slash);
}

/** Joins vault path parts, skipping empty ones: join("", "Kyber.md") → "Kyber.md". */
export function join(...parts: string[]): string {
  return parts.filter((part) => part !== "").join("/");
}

/** The extension without the dot, as written ("MD" stays "MD"); "" if none. */
export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

/** The name without its extension: "Lore/Kyber.md" → "Kyber". */
export function stem(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Removes the extension, keeping the folder: "Lore/Kyber.md" → "Lore/Kyber". */
export function withoutExtension(path: string): string {
  const ext = extname(path);
  return ext ? path.slice(0, -(ext.length + 1)) : path;
}

/** A note is a file with extension md or markdown, in any case. */
export function isNote(path: string): boolean {
  return NOTE_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** A note's title: its file name without extension. */
export function title(path: string): string {
  return stem(path);
}

/** Whether any component starts with "." (".git", ".obsidian", ".trash"…). */
export function isHidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

/** Whether `path` is `folder` itself or inside it. "" is the vault root and contains everything. */
export function isUnder(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(folder + "/");
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Finder-style ordering: case-insensitive, numbers compared by value
 * ("Note 1, note 2, Note 10"). Falls back to plain order so it's total.
 */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The first free name in "Base.ext", "Base 2.ext", "Base 3.ext"…,
 * where `exists` checks a candidate file name. `ext` may be "" (folders).
 */
export function uniqueName(base: string, ext: string, exists: (name: string) => boolean): string {
  const make = (name: string) => (ext ? `${name}.${ext}` : name);
  let candidate = make(base);
  for (let counter = 2; exists(candidate); counter++) candidate = make(`${base} ${counter}`);
  return candidate;
}
