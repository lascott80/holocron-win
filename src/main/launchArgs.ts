// Command-line arguments Holocron understands — from the taskbar jump list,
// the sign-in login item, a file association, or a second launch while
// it's running (REQUIREMENTS §22). Arguments are untrusted: anything
// unknown is ignored, and paths are only accepted when absolute and
// ending in .md/.markdown (the caller still checks they exist and are in a
// vault). Pure, so it can be tested without Electron.

import path from "node:path";

export interface LaunchArgs {
  /** --new-note: a new note in the open vault. */
  newNote: boolean;
  /** --today: today's daily note. */
  today: boolean;
  /** --capture: the quick capture window. */
  capture: boolean;
  /** --hidden: start in the notification area without showing the window (sign-in launch). */
  hidden: boolean;
  /** --open <file>, --open=<file>, or a bare .md path (file association): an absolute note path. */
  open: string | null;
}

export const noLaunchArgs: LaunchArgs = { newNote: false, today: false, capture: false, hidden: false, open: null };

/**
 * Reads `argv` (process.argv, or the argv of a second instance). The first
 * entry is the program and is skipped; so is anything that isn't one of
 * Holocron's flags or a note path — Chromium's own switches, and in
 * development the app folder Electron was started with. Chromium may
 * reorder or append switches in a second instance's argv, so flags are
 * matched anywhere and `--open=<path>` is preferred by the jump list.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
  const result: LaunchArgs = { ...noLaunchArgs };
  const args = argv.slice(1).filter((arg): arg is string => typeof arg === "string");
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const lower = arg.toLowerCase();
    if (lower === "--new-note") result.newNote = true;
    else if (lower === "--today") result.today = true;
    else if (lower === "--capture") result.capture = true;
    else if (lower === "--hidden") result.hidden = true;
    else if (lower === "--open") {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        index++;
        result.open = notePath(next) ?? result.open;
      }
    } else if (lower.startsWith("--open=")) {
      result.open = notePath(arg.slice("--open=".length)) ?? result.open;
    } else if (!arg.startsWith("-")) {
      // A bare path: double-clicking an associated .md file.
      result.open = notePath(arg) ?? result.open;
    }
  }
  return result;
}

/** An absolute, normalised Windows path to a note, or null. */
export function notePath(raw: string): string | null {
  const value = raw.trim().replace(/^"(.*)"$/, "$1");
  if (!value || value.length > 32_000 || /[\0\r\n]/.test(value)) return null;
  // Device and extended-length paths (\\?\, \\.\) bypass normal path rules.
  if (/^[\\/]{2}[?.][\\/]/.test(value)) return null;
  if (!path.win32.isAbsolute(value) || !/^([a-zA-Z]:[\\/]|[\\/]{2}[^\\/])/.test(value)) return null;
  const normal = path.win32.normalize(value);
  if (!/\.(md|markdown)$/i.test(normal)) return null;
  return normal;
}

/** Whether there's anything to act on besides `hidden`. */
export function hasActions(args: LaunchArgs): boolean {
  return args.newNote || args.today || args.capture || args.open !== null;
}
