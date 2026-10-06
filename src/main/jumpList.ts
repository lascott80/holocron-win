// The taskbar jump list (right-click Holocron's taskbar button): Tasks —
// New Note, Today's Note, Quick Capture — and the open vault's recent notes.
// Each item starts Holocron with an argument (launchArgs.ts); when Holocron
// is already running, the single-instance lock hands it to the running app.

import type { JumpListCategory, JumpListItem, JumpListSettings } from "electron";

export const MAX_JUMP_LIST_NOTES = 8;

export interface JumpListNote {
  /** Note title (file name without extension). */
  title: string;
  /** Absolute file path. */
  file: string;
  /** Vault path, shown as the tooltip. */
  vaultPath: string;
}

/**
 * The jump list's categories. `program` is the Holocron executable (its icon
 * is used for every item); `notes` are the open vault's recent notes, most
 * recent first (empty when no vault is open: the category is left out).
 * Items Windows says the user removed are left out too — adding one back
 * would make Windows drop the whole category.
 */
export function buildJumpList(program: string, notes: readonly JumpListNote[], removed: readonly JumpListItem[] = []): JumpListCategory[] {
  const task = (title: string, args: string, description: string): JumpListItem => ({
    type: "task",
    title,
    description,
    program,
    args,
    iconPath: program,
    iconIndex: 0,
  });
  const removedArgs = new Set(removed.map((item) => item.args).filter(Boolean));
  const recent = notes
    .map((note) => task(note.title, `--open="${note.file}"`, note.vaultPath))
    .filter((item) => !removedArgs.has(item.args))
    .slice(0, MAX_JUMP_LIST_NOTES);
  const categories: JumpListCategory[] = [];
  if (recent.length) categories.push({ type: "custom", name: "Recent Notes", items: recent });
  categories.push({
    type: "tasks",
    items: [
      task("New Note", "--new-note", "Create a note in the open vault"),
      task("Today’s Note", "--today", "Open today’s daily note"),
      task("Quick Capture", "--capture", "Jot something down without leaving what you’re doing"),
    ],
  });
  return categories;
}

export interface JumpListHost {
  setJumpList(categories: JumpListCategory[] | null): string;
  getJumpListSettings(): JumpListSettings;
}

/**
 * Sets the jump list, quietly. If Windows refuses custom categories
 * (privacy settings or group policy) it's set again with the tasks only.
 * Returns Electron's result ("ok", or the error it reported).
 */
export function applyJumpList(host: JumpListHost, program: string, notes: readonly JumpListNote[]): string {
  try {
    let removed: JumpListItem[] = [];
    try {
      removed = host.getJumpListSettings().removedItems ?? [];
    } catch {
      // Not available; nothing to filter.
    }
    const categories = buildJumpList(program, notes, removed);
    let result = host.setJumpList(categories);
    if (result === "customCategoryAccessDeniedError") {
      result = host.setJumpList(categories.filter((category) => category.type !== "custom"));
    }
    if (result !== "ok") console.warn("Couldn’t set the jump list:", result);
    return result;
  } catch (error) {
    console.warn("Couldn’t set the jump list:", error);
    return "error";
  }
}
