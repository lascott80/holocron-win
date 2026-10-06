// File system helpers for the vault. Synchronous on purpose: vaults are local
// folders, and keeping the model synchronous keeps the save/reconcile logic
// identical to the Mac app's. Writes are atomic (temp file + rename), and
// renames retry briefly because Windows antivirus, the search indexer and
// sync clients often hold files open for a moment.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number) {
  Atomics.wait(sleeper, 0, 0, ms);
}

/** Runs `operation`, retrying for up to ~1 s on errors Windows raises while another process holds the file. */
export function withRetry<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 10 || !RETRYABLE.has(code)) throw error;
      sleepSync(15 * (attempt + 1));
    }
  }
}

/** Reads a file as UTF-8. Invalid bytes become U+FFFD instead of failing. */
export function readText(file: string): string {
  return fs.readFileSync(file).toString("utf8");
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

export function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

export interface WriteOptions {
  /** Fail with EEXIST instead of replacing an existing file. */
  withoutOverwriting?: boolean;
}

/**
 * Writes `data` atomically: to a hidden temp file beside the target, then
 * renamed over it, so other apps and sync tools never see half a file.
 * Parent folders are created as needed.
 */
export function writeAtomic(file: string, data: string | Uint8Array, options: WriteOptions = {}): void {
  const folder = path.dirname(file);
  fs.mkdirSync(folder, { recursive: true });
  if (options.withoutOverwriting) {
    // Exclusive create: either we make the file or it already existed.
    fs.writeFileSync(file, data, { flag: "wx" });
    return;
  }
  const temp = path.join(folder, `.${path.basename(file)}.${randomUUID().slice(0, 8)}.holocron-tmp`);
  fs.writeFileSync(temp, data);
  try {
    withRetry(() => fs.renameSync(temp, file));
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Leave it; it's hidden and harmless.
    }
    throw error;
  }
}

/** Moves a file or folder. The destination's parent must exist. */
export function move(from: string, to: string): void {
  withRetry(() => fs.renameSync(from, to));
}

/** Copies a file or folder, never replacing an existing destination. */
export function copy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}

export function mkdirp(folder: string): void {
  fs.mkdirSync(folder, { recursive: true });
}

/**
 * Whether `file` is inside `root` (not `root` itself), following symlinks
 * and junctions on both sides. Compared case-insensitively on Windows.
 */
export function isInside(root: string, file: string): boolean {
  const realRoot = realpathOrSelf(root);
  let real = realpathOrSelf(file);
  if (real === file) {
    // The file may not exist yet: resolve its nearest existing parent.
    const parent = realpathOrSelf(path.dirname(file));
    real = path.join(parent, path.basename(file));
  }
  const rel = path.relative(realRoot, real);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function realpathOrSelf(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * Moves items to the Recycle Bin. Electron's `shell.trashItem` doesn't say
 * where an item went, so for Undo a copy is kept in a staging folder and
 * restored from there; the copy is removed when the Undo offer expires.
 */
export interface Trash {
  /** Trashes `file`; returns a function that restores it, or null if it can't be restored. */
  trash(file: string): Promise<(() => void) | null>;
}

export function createTrash(stagingRoot: string, trashItem: (file: string) => Promise<void>): Trash {
  // Staged copies from earlier sessions are stale.
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  return {
    async trash(file) {
      let staged: string | null = path.join(stagingRoot, randomUUID(), path.basename(file));
      try {
        copy(file, staged);
      } catch {
        staged = null; // still trash it, just without Undo
      }
      try {
        await trashItem(file);
      } catch (error) {
        if (staged) fs.rmSync(path.dirname(staged), { recursive: true, force: true });
        throw error;
      }
      if (!staged) return null;
      const stagedCopy = staged;
      // Undo is offered for a few seconds; keep the copy a little longer.
      const cleanup = setTimeout(() => fs.rmSync(path.dirname(stagedCopy), { recursive: true, force: true }), 60_000);
      cleanup.unref?.();
      return () => {
        clearTimeout(cleanup);
        mkdirp(path.dirname(file));
        if (fs.existsSync(file)) throw Object.assign(new Error(`“${path.basename(file)}” already exists.`), { code: "EEXIST" });
        move(stagedCopy, file);
        fs.rmSync(path.dirname(stagedCopy), { recursive: true, force: true });
      };
    },
  };
}
