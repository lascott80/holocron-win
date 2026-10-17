// A copy of every note's text from the last session, so opening a vault
// doesn't read thousands of files again (NFR-03). Each entry remembers the
// file's size and modification time; a note is only taken from the cache
// when both still match, otherwise it's read from disk as before. The cache
// is a convenience, never a source of truth: a missing or broken cache just
// means a slower first index.
//
// One JSON file per vault in userData/index-cache/<hash of root>.json,
// written atomically a little after the index changes and when the vault
// closes.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeAtomic } from "./fsx";

const FORMAT = 1;
/** How long after the last index change the cache is written. */
export const WRITE_DELAY = 5_000;

export interface CachedNote {
  size: number;
  mtime: number;
  text: string;
}

interface CacheFile {
  format: number;
  root: string;
  notes: Record<string, CachedNote>;
}

/** Where a vault's cache lives inside `folder`. */
export function cacheFile(folder: string, root: string): string {
  const hash = createHash("sha1").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16);
  return path.join(folder, `${hash}.json`);
}

export class IndexCache {
  private notes = new Map<string, CachedNote>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string;

  constructor(
    folder: string,
    private readonly root: string,
  ) {
    this.file = cacheFile(folder, root);
    this.load();
  }

  /** How many notes the cache holds (for tests). */
  get size(): number {
    return this.notes.size;
  }

  private load() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return; // No cache yet, or unreadable: start empty.
    }
    const cache = parsed as Partial<CacheFile> | null;
    if (!cache || cache.format !== FORMAT || cache.root !== this.root || !cache.notes || typeof cache.notes !== "object") return;
    for (const [notePath, entry] of Object.entries(cache.notes)) {
      if (entry && typeof entry.size === "number" && typeof entry.mtime === "number" && typeof entry.text === "string") {
        this.notes.set(notePath, entry);
      }
    }
  }

  /**
   * The cached text of `path` if the file at `file` still has the same size
   * and modification time, else null (the caller reads the file).
   */
  textIfCurrent(notePath: string, file: string): string | null {
    const entry = this.notes.get(notePath);
    if (!entry) return null;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    return stat.size === entry.size && stat.mtimeMs === entry.mtime ? entry.text : null;
  }

  /** Remembers the text just read from `file`. */
  remember(notePath: string, file: string, text: string) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    const entry = this.notes.get(notePath);
    if (entry && entry.size === stat.size && entry.mtime === stat.mtimeMs && entry.text === text) return;
    this.notes.set(notePath, { size: stat.size, mtime: stat.mtimeMs, text });
    this.markDirty();
  }

  forget(notePath: string) {
    if (this.notes.delete(notePath)) this.markDirty();
  }

  /** Drops entries for notes that no longer exist. */
  keepOnly(paths: Iterable<string>) {
    const keep = new Set(paths);
    for (const notePath of [...this.notes.keys()]) {
      if (!keep.has(notePath)) this.forget(notePath);
    }
  }

  private markDirty() {
    this.dirty = true;
    this.timer ??= setTimeout(() => this.flush(), WRITE_DELAY);
  }

  /** Writes the cache now if it changed. Errors are swallowed: the cache is optional. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const data: CacheFile = { format: FORMAT, root: this.root, notes: Object.fromEntries(this.notes) };
    try {
      writeAtomic(this.file, JSON.stringify(data));
    } catch (error) {
      console.warn("Couldn’t write the index cache:", error);
    }
  }

  /** Stops the pending write (the vault is closing; `flush` first if it should be kept). */
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
