// Version history (HIS-01…HIS-04): snapshots of each note's text, taken as
// Holocron writes it, kept outside the vault in
// userData/history/<hash of the vault>/<hash of the note path>/<ms>.md, so a
// bad paste, an accepted merge or a mistaken Replace All can be undone days
// later. Snapshots are coalesced (writes within INTERVAL of the newest one
// made this session replace it), capped per note and pruned by age. The
// store is a safety net, never a source of truth: a missing or broken
// snapshot is simply skipped.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeAtomic } from "./fsx";

/** Writes closer together than this (within one session) share a snapshot. */
export const HISTORY_INTERVAL = 5 * 60 * 1000;
export const HISTORY_MAX_PER_NOTE = 100;
export const HISTORY_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export interface VersionInfo {
  /** The snapshot's id: its time in ms since the epoch, as a string. */
  id: string;
  /** ms since epoch. */
  date: number;
  /** UTF-8 size of the text. */
  size: number;
}

const hash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 20);

/** Where a vault's history lives inside `folder`. */
export function historyFolder(folder: string, root: string): string {
  return path.join(folder, hash(path.resolve(root).toLowerCase()));
}

export class NoteHistory {
  /** Newest snapshot made this session per note, so rapid saves coalesce. */
  private latest = new Map<string, { id: string; date: number }>();

  constructor(
    private readonly folder: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private noteFolder(notePath: string): string {
    return path.join(this.folder, hash(notePath.toLowerCase()));
  }

  /**
   * Records a write of `next` to a note. The first write of a session also
   * keeps `previous` (the text before this session touched the note) when
   * no snapshot holds it yet, so the starting point can always be restored.
   */
  record(notePath: string, previous: string | null, next: string): void {
    try {
      const folder = this.noteFolder(notePath);
      const now = this.now().getTime();
      const existing = this.list(notePath);
      const latest = this.latest.get(notePath);
      if (!latest && previous !== null && previous !== next) {
        const newest = existing[0];
        const newestText = newest ? this.readFile(folder, newest.id) : null;
        if (newestText !== previous) this.write(folder, notePath, String(Math.max(now - 1, (newest ? newest.date : 0) + 1)), previous);
      }
      let id = String(now);
      if (latest && now - latest.date < HISTORY_INTERVAL) {
        id = latest.id; // coalesce into this session's newest snapshot
      } else if (existing.some((version) => version.id === id)) {
        id = String(now + 1);
      }
      this.write(folder, notePath, id, next);
      this.latest.set(notePath, { id, date: latest && id === latest.id ? latest.date : now });
      this.prune(folder, now);
    } catch (error) {
      console.warn("Couldn’t record a note version:", error);
    }
  }

  private write(folder: string, notePath: string, id: string, text: string) {
    writeAtomic(path.join(folder, `${id}.md`), text);
    const marker = path.join(folder, "path.txt");
    if (!fs.existsSync(marker)) writeAtomic(marker, notePath);
  }

  /** The note's snapshots, newest first. */
  list(notePath: string): VersionInfo[] {
    const folder = this.noteFolder(notePath);
    let names: string[];
    try {
      names = fs.readdirSync(folder);
    } catch {
      return [];
    }
    const versions: VersionInfo[] = [];
    for (const name of names) {
      const match = /^(\d+)\.md$/.exec(name);
      if (!match) continue;
      try {
        const stat = fs.statSync(path.join(folder, name));
        versions.push({ id: match[1], date: Number(match[1]), size: stat.size });
      } catch {
        // Vanished meanwhile.
      }
    }
    return versions.sort((a, b) => b.date - a.date);
  }

  /** A snapshot's text, or null if it's gone. */
  read(notePath: string, id: string): string | null {
    if (!/^\d+$/.test(id)) return null;
    return this.readFile(this.noteFolder(notePath), id);
  }

  private readFile(folder: string, id: string): string | null {
    try {
      return fs.readFileSync(path.join(folder, `${id}.md`), "utf8");
    } catch {
      return null;
    }
  }

  /** Follows a renamed or moved note. */
  rename(oldPath: string, newPath: string): void {
    const from = this.noteFolder(oldPath);
    const to = this.noteFolder(newPath);
    if (from === to || !fs.existsSync(from)) return;
    try {
      if (fs.existsSync(to)) {
        // Both have history (a note moved onto an old name): merge the files.
        for (const name of fs.readdirSync(from)) {
          if (name !== "path.txt") fs.renameSync(path.join(from, name), path.join(to, name));
        }
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        fs.renameSync(from, to);
      }
      writeAtomic(path.join(to, "path.txt"), newPath);
      const latest = this.latest.get(oldPath);
      this.latest.delete(oldPath);
      if (latest) this.latest.set(newPath, latest);
    } catch (error) {
      console.warn("Couldn’t move a note’s history:", error);
    }
  }

  /** Drops old snapshots and keeps the newest HISTORY_MAX_PER_NOTE. */
  private prune(folder: string, now: number) {
    const versions = this.list(path.basename(folder) === "" ? "" : this.pathOf(folder));
    versions.forEach((version, index) => {
      if (index >= HISTORY_MAX_PER_NOTE || now - version.date > HISTORY_MAX_AGE) {
        try {
          fs.rmSync(path.join(folder, `${version.id}.md`), { force: true });
        } catch {
          // Next time.
        }
      }
    });
  }

  private pathOf(folder: string): string {
    try {
      return fs.readFileSync(path.join(folder, "path.txt"), "utf8");
    } catch {
      return "";
    }
  }

  /** Removes every snapshot of this vault (Settings › Clear history). */
  clear(): void {
    fs.rmSync(this.folder, { recursive: true, force: true });
    this.latest.clear();
  }

  /** Total size of this vault's history in bytes. */
  size(): number {
    let total = 0;
    const walk = (folder: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          try {
            total += fs.statSync(full).size;
          } catch {
            // Skip.
          }
        }
      }
    };
    walk(this.folder);
    return total;
  }
}
