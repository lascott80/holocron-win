// Every command the renderer may run in the main process. Arguments come
// from the renderer, so each command checks their types before use.

import { clipboard, ClipboardItem, shell } from "electron";
import { quickOpenSearch } from "@core/quickOpen";
import { stem } from "@core/paths";
import { defaultSettings, type Settings } from "@shared/settings";
import { EDIT_ACTIONS, type EditAction } from "@shared/ipc";
import { openExternalSafely } from "./editorBridge";
import type { HolocronApp } from "./index";
import type { Vault } from "./vault";

type Command = (...args: unknown[]) => unknown;

const str = (value: unknown): string => {
  if (typeof value !== "string") throw new TypeError("Expected a string");
  return value;
};
const optStr = (value: unknown): string | null => (typeof value === "string" ? value : null);
const bool = (value: unknown): boolean => value === true;
const num = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Expected a number");
  return value;
};
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new TypeError("Expected strings");
  return value;
};

/** Most a rich copy may put on the clipboard (text + HTML, UTF-16 units). */
export const MAX_CLIPBOARD_LENGTH = 50 * 1024 * 1024;

/** Most a quick capture may hold (UTF-16 units). */
export const MAX_CAPTURE_LENGTH = 1024 * 1024;

/**
 * Whether the clipboard still holds `expected` (the markdown of the copy a
 * late HTML rewrite belongs to), so a newer copy is never clobbered. Line
 * endings may have become CRLF on the way through the Windows clipboard.
 */
export function clipboardStillHolds(current: string, expected: string): boolean {
  const normal = (text: string) => text.replace(/\r\n?/g, "\n");
  return expected !== "" && normal(current) === normal(expected);
}

export function isEditAction(name: unknown): name is EditAction {
  return typeof name === "string" && (EDIT_ACTIONS as readonly string[]).includes(name);
}

/** A word for the spell checker: one line, not absurdly long. */
export function spellingWord(value: unknown): string {
  const word = str(value);
  if (word === "" || word.length > 200 || /[\r\n]/.test(word)) throw new TypeError("Expected a word");
  return word;
}

/** holocron-asset://<kind>/<target>?from=<note> → its parts (REQUIREMENTS ARC-07); null for anything else. */
export function parseAssetUrl(value: string): { kind: string; target: string; from: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "holocron-asset:") return null;
    const kind = url.hostname;
    if (kind !== "embed" && kind !== "relative") return null;
    const target = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return target ? { kind, target, from: url.searchParams.get("from") ?? "" } : null;
  } catch {
    return null;
  }
}

export function createCommands(app: HolocronApp): Record<string, Command> {
  /** Runs `body` with the open vault; does nothing without one. */
  const withVault =
    <A extends unknown[]>(body: (vault: Vault, ...args: A) => unknown): Command =>
    (...args) => (app.vault ? body(app.vault, ...(args as A)) : undefined);

  return {
    // App
    getState: () => app.state(),
    getTree: () => app.vault?.tree ?? [],
    dismissError: () => app.dismissError(),
    setSetting: (key, value) => {
      if (typeof key !== "string" || !(key in defaultSettings)) throw new TypeError("Unknown setting");
      app.setSetting(key as keyof Settings, value as never);
    },
    openVaultDialog: () => app.presentOpenDialog(),
    createVaultDialog: () => app.presentCreateDialog(),
    openVault: (root) => app.openVault(str(root)),
    closeVault: () => app.closeVault(),
    forgetVault: (root) => app.forgetVault(str(root)),
    showInFolder: (target) => {
      const vault = app.vault;
      const value = str(target);
      // Vault paths are relative; recent vaults are absolute.
      if (vault && !/^[a-zA-Z]:[\\/]|^\\\\/.test(value)) shell.showItemInFolder(vault.abs(value));
      else if (app.recentVaults.includes(value)) void shell.openPath(value);
    },
    showVaultInFolder: () => app.vault && void shell.openPath(app.vault.root),
    addStarterGuide: () => app.addStarterGuide(),
    /** File › Exit Holocron: quits even when running in the background. */
    quitApp: () => app.quit(),
    showMainWindow: () => app.showMainWindow(),

    // Quick capture (src/main/capture.ts). The capture page may only run these four.
    quickCapture: () => app.showCapture(),
    captureInfo: () => app.captureInfo(),
    captureSave: (text, target) => {
      const value = str(text);
      if (value.length > MAX_CAPTURE_LENGTH) return { ok: false, error: "That’s too long for a quick capture." };
      return app.saveCapture(value, target === "inbox" ? "inbox" : "daily");
    },
    /** Hides the capture window; `discard` clears its draft (Esc). */
    captureHide: (discard) => app.capture.hide(bool(discard)),
    suspendCaptureShortcut: (suspended) => app.suspendCaptureShortcut(bool(suspended)),

    // Updates (src/main/updater.ts)
    checkForUpdates: () => app.updater.check(true),
    downloadUpdate: () => app.updater.download(),
    installUpdate: () => app.updater.install(),
    skipUpdate: (version) => app.updater.skip(str(version)),
    dismissUpdate: () => app.updater.dismiss(),
    /** The release page for a version; the URL is built from the fixed repo. */
    openReleasePage: (version) => app.updater.openReleasePage(optStr(version)),
    saveAll: () => app.saveAll(),
    cursor: () => app.editor.cursor,
    /** Rich copy: markdown + HTML, only if the clipboard still holds that markdown. */
    writeClipboard: async (text, html) => {
      const plain = str(text);
      const rich = str(html);
      if (plain.length + rich.length > MAX_CLIPBOARD_LENGTH) throw new RangeError("Clipboard content too large");
      if (!clipboardStillHolds(await clipboard.readText(), plain)) return false;
      await clipboard.write([new ClipboardItem({ "text/plain": plain, "text/html": rich })]);
      return true;
    },

    // Right-click menu (spelling and editing in the window's own page)
    replaceMisspelling: (word) => app.window?.webContents.replaceMisspelling(spellingWord(word)),
    addToDictionary: (word) => app.window?.webContents.session.addWordToSpellCheckerDictionary(spellingWord(word)) ?? false,
    removeFromDictionary: (word) => app.window?.webContents.session.removeWordFromSpellCheckerDictionary(spellingWord(word)) ?? false,
    editAction: (name) => {
      if (!isEditAction(name)) throw new TypeError("Unknown edit action");
      app.window?.webContents[name]();
    },
    copyImageAt: (x, y) => app.window?.webContents.copyImageAt(Math.round(num(x)), Math.round(num(y))),
    /** Opens an image shown in the editor: a vault file in its default app, a web image in the browser. */
    openImage: (src) => {
      const url = str(src);
      if (/^https?:/i.test(url)) return openExternalSafely(url);
      const asset = parseAssetUrl(url);
      const file = asset && app.vault?.resolveAsset(asset.kind, asset.target, asset.from);
      if (file) void shell.openPath(file);
    },

    // Tabs and navigation
    open: withVault((vault, path, newTab) => vault.open(str(path), bool(newTab))),
    openLink: withVault((vault, target, newTab) => vault.openLink(str(target), bool(newTab))),
    select: withVault((vault, path) => vault.select(optStr(path))),
    newTab: withVault((vault) => vault.newTab()),
    activateTab: withVault((vault, id) => vault.activateTab(str(id))),
    closeTab: withVault((vault, id) => vault.closeTab(str(id))),
    closeActiveTab: withVault((vault) => vault.closeActiveTab()),
    closeOtherTabs: withVault((vault, id) => vault.closeOtherTabs(str(id))),
    closeTabsToTheRight: withVault((vault, id) => vault.closeTabsToTheRight(str(id))),
    moveTab: withVault((vault, id, target) => vault.moveTab(str(id), str(target))),
    selectTabNumber: withVault((vault, number) => vault.selectTabNumber(num(number))),
    nextTab: withVault((vault) => vault.selectNextTab()),
    previousTab: withVault((vault) => vault.selectPreviousTab()),
    goBack: withVault((vault) => vault.goBack()),
    goForward: withVault((vault) => vault.goForward()),
    reveal: withVault((vault, path, line, from, to) => {
      vault.open(str(path));
      app.editor.reveal(str(path), num(line), num(from), num(to));
    }),
    scrollToLine: withVault((vault, line) => {
      const path = vault.activeTab?.path;
      if (path) app.editor.reveal(path, num(line), 0, 0);
    }),

    // Files
    createNote: withVault((vault, folder) => vault.createNote(optStr(folder))),
    createNoteNamed: withVault((vault, name, newTab) => vault.createNoteNamed(str(name), bool(newTab))),
    createFolder: withVault((vault, parent) => vault.createFolder(optStr(parent))),
    startRenaming: withVault((vault, path) => vault.startRenaming(optStr(path))),
    commitRename: withVault((vault, path, name) => vault.commitRename(str(path), str(name))),
    move: withVault((vault, items, folder) => vault.move(strings(items), str(folder))),
    duplicate: withVault((vault, path) => vault.duplicate(str(path))),
    requestDeletion: withVault((vault, paths) => vault.requestDeletion(strings(paths))),
    confirmDeletion: withVault((vault) => vault.confirmDeletion()),
    cancelDeletion: withVault((vault) => vault.cancelDeletion()),
    importFiles: withVault((vault, files) => vault.importFiles(strings(files))),
    /** Saves a picture from pasted HTML (base64) as an attachment; returns its embed text, or null. */
    saveAttachmentData: withVault((vault, name, mime, data) => {
      const type = str(mime).toLowerCase();
      if (!/^image\/[\w.+-]+$/.test(type)) throw new TypeError("Expected an image type");
      // Only a bare file name (no folders); empty → "Pasted image <timestamp>.<ext>".
      const fileName = (optStr(name) ?? "").split(/[\\/]/).pop() ?? "";
      return vault.pasteImage(fileName, type, Buffer.from(str(data), "base64"));
    }),
    runToastAction: withVault((vault) => vault.runToastAction()),
    dismissToast: withVault((vault) => vault.dismissToast()),
    resolveConflict: withVault((vault, choice) => {
      if (choice === "mine" || choice === "disk" || choice === "merge" || choice === "both") vault.resolveConflict(choice);
    }),
    discardMissing: withVault((vault, path) => vault.discardMissing(str(path))),
    restoreMissing: withVault((vault, path) => vault.restoreMissing(str(path))),

    // Daily notes and templates
    openDailyNote: withVault((vault) => vault.openDailyNote()),
    openAdjacentDailyNote: withVault((vault, direction) => vault.openAdjacentDailyNote(num(direction) < 0 ? -1 : 1)),
    insertTemplate: withVault((vault, path) => vault.insertTemplate(str(path))),
    createNoteFromTemplate: withVault((vault, template, name) => vault.createNoteFromTemplate(str(template), str(name))),

    // Index queries
    details: withVault((vault, path) => vault.details(str(path))),
    allTags: withVault((vault) => vault.index.allTags()),
    notesTagged: withVault((vault, tag) => vault.index.notesTaggedWith(str(tag))),
    search: (query, matchCase, useRegex) => app.search.search(str(query), bool(matchCase), bool(useRegex)),
    quickOpen: withVault((vault, query, limit) => {
      const notes = vault.allNotes.map((path) => ({ path, title: stem(path), aliases: vault.index.info(path)?.aliases ?? [], tags: vault.index.info(path)?.tags ?? [] }));
      return quickOpenSearch(notes, vault.recentNotes, str(query), typeof limit === "number" ? limit : 30);
    }),
  };
}
