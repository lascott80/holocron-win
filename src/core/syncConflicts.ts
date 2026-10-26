// Sync conflict copies (UI-41): when two devices change a note before a sync
// tool catches up, the tool keeps both by writing a second file beside the
// original. Holocron recognises those copies so they can be reviewed instead
// of quietly piling up as extra notes.

import { diff, lines } from "./merge";
import { basename, dirname, extname, join } from "./paths";

export interface SyncConflict {
  /** The conflict copy the sync tool made. */
  copy: string;
  /** The note it's a copy of. */
  original: string;
  service: "Dropbox" | "OneDrive" | "Syncthing" | "Nextcloud";
  /** The device or person named in the copy's file name, when there is one. */
  device: string | null;
}

interface Pattern {
  service: SyncConflict["service"];
  /** Matches a file name without its extension; group 1 is the original's name. */
  match: (stem: string, hostname: string | null) => { original: string; device: string | null } | null;
}

const PATTERNS: Pattern[] = [
  {
    // "Plan (Lawrence's conflicted copy 2026-10-26).md", also "… (1))"
    service: "Dropbox",
    match: (stem) => {
      const m = /^(.+?) \((.+?)['’]s conflicted copy(?: \d{4}-\d{2}-\d{2})?(?: \(\d+\))?\)$/.exec(stem);
      return m ? { original: m[1], device: m[2] } : null;
    },
  },
  {
    // "Plan (conflicted copy 2026-10-26 101530).md"
    service: "Nextcloud",
    match: (stem) => {
      const m = /^(.+?) \(conflicted copy(?: [^)]*)?\)$/i.exec(stem);
      return m ? { original: m[1], device: null } : null;
    },
  },
  {
    // "Plan.sync-conflict-20261026-101530-ABCDEFG.md"
    service: "Syncthing",
    match: (stem) => {
      const m = /^(.+)\.sync-conflict-\d{8}-\d{6}-([A-Z0-9]{7})$/.exec(stem);
      return m ? { original: m[1], device: m[2] } : null;
    },
  },
  {
    // "Plan-DESKTOP-4F2A.md": OneDrive appends this PC's name. Only this PC's
    // name counts, so "Meeting-Q4.md" beside "Meeting.md" isn't mistaken for one.
    service: "OneDrive",
    match: (stem, hostname) => {
      if (!hostname) return null;
      const suffix = `-${hostname}`.toLowerCase();
      // A second conflict on the same PC adds "-1", "-2"…
      for (const name of [stem, stem.replace(/-\d+$/, "")]) {
        if (name.length > suffix.length && name.toLowerCase().endsWith(suffix)) return { original: name.slice(0, -suffix.length), device: hostname };
      }
      return null;
    },
  },
];

/**
 * The conflict copies among `paths` whose original note is also there.
 * `hostname` is this PC's name (OneDrive copies carry it).
 */
export function findSyncConflicts(paths: readonly string[], hostname: string | null = null): SyncConflict[] {
  const present = new Map(paths.map((path) => [path.toLowerCase(), path]));
  const conflicts: SyncConflict[] = [];
  for (const path of paths) {
    const extension = extname(path);
    const name = basename(path);
    const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
    for (const pattern of PATTERNS) {
      const found = pattern.match(stem, hostname);
      if (!found) continue;
      const original = present.get(join(dirname(path), `${found.original}${extension ? "." + extension : ""}`).toLowerCase());
      if (original && original !== path) {
        conflicts.push({ copy: path, original, service: pattern.service, device: found.device });
        break;
      }
    }
  }
  return conflicts.sort((a, b) => a.original.localeCompare(b.original) || a.copy.localeCompare(b.copy));
}

/**
 * Both versions in one, nothing lost: where they differ, the original's
 * lines come first and the copy's follow. (There's no common ancestor to
 * merge against, so this never guesses which side is right.)
 */
export function combineVersions(original: string, copy: string): string {
  const mine = lines(original);
  const theirs = lines(copy);
  const out: string[] = [];
  let at = 0;
  for (const hunk of diff(mine, theirs)) {
    out.push(...mine.slice(at, hunk.baseStart));
    const ours = mine.slice(hunk.baseStart, hunk.baseEnd);
    const other = theirs.slice(hunk.otherStart, hunk.otherEnd);
    // A last line without a newline would run into what follows it.
    if (ours.length && other.length && !/\n$/.test(ours[ours.length - 1])) ours[ours.length - 1] += "\n";
    out.push(...ours, ...other);
    at = hunk.baseEnd;
  }
  out.push(...mine.slice(at));
  return out.join("");
}
