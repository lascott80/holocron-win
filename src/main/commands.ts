// Every command the renderer may run in the main process. Arguments come
// from the renderer, so each command checks their types before use.

import { shell } from "electron";
import { quickOpenSearch } from "@core/quickOpen";
import { stem } from "@core/paths";
import { defaultSettings, type Settings } from "@shared/settings";
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
    saveAll: () => app.saveAll(),
    cursor: () => app.editor.cursor,

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
