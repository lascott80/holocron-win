// A folder of markdown notes opened in Holocron. The folder on disk is the
// only source of truth; Holocron keeps no database alongside it.
// (Port of Vault.swift — tabs, documents, file operations, links, daily
// notes, templates, auto-titles. iCloud handling is left out: on Windows the
// vault is a plain local folder.)

import fs from "node:fs";
import nodePath from "node:path";
import os from "node:os";
import * as P from "@core/paths";
import { LinkResolver, parse as parseNote } from "@core/noteParser";
import { rewrite as rewriteLinks, relativePath as relativeLinkPath } from "@core/linkRewriter";
import * as Attachments from "@core/attachments";
import { VaultIndex } from "@core/vaultIndex";
import { dailyNoteDate, dailyNotePath, renderPlaceholders } from "@core/dailyNotes";
import { noteText, renderTemplate } from "@core/templates";
import { isPlaceholderName, titleFromContent } from "@core/autoTitle";
import type { Settings } from "@shared/settings";
import type { ConflictView, DocView, NoteDetails, TabView, ToastView, TreeNode, VaultView } from "@shared/ipc";
import * as fsx from "./fsx";
import { isServableAsset } from "./assets";
import { EditorTab } from "./editorTab";
import { NoteDocument } from "./noteDocument";
import type { StateStore } from "./store";

/** What the vault needs from the editor (the renderer's CodeMirror, via IPC). */
export interface EditorPort {
  /** Shows a note (or nothing). */
  show(path: string | null, text: string | null): void;
  /** The shown note's file moved. */
  documentDidMove(oldPath: string, newPath: string): void;
  /** Applies a reload/merge to the shown note as line edits. */
  externalChange(path: string, oldText: string, newText: string): void;
  forget(path: string): void;
  focus(): void;
  /** Selects columns [from, to) of a 1-based line once `path` is showing. */
  reveal(path: string, line: number, from: number, to: number): void;
  applyTemplate(frontmatter: string, body: string): void;
  insertAtCursor(text: string): void;
  /** Autocomplete data; coalesced by the port. */
  setVaultData(make: () => unknown): void;
}

export const nullEditor: EditorPort = {
  show() {},
  documentDidMove() {},
  externalChange() {},
  forget() {},
  focus() {},
  reveal() {},
  applyTemplate() {},
  insertAtCursor() {},
  setVaultData() {},
};

/** Restores a trashed item; null when it can't be restored. */
export type TrashItem = (file: string) => Promise<(() => void) | null>;

export interface VaultOptions {
  store: StateStore;
  settings: () => Settings;
  editor?: EditorPort;
  trash?: TrashItem;
  /** Opens a file in its default app. */
  openPath?: (file: string) => void;
  /** Asks the window chrome to do something (quick open, beep…). */
  ui?: (request: import("@shared/ipc").UiRequest) => void;
  /** Called whenever observable state changes. */
  onChange?: () => void;
  /** Called when the file tree changed. */
  onTreeChange?: () => void;
  /** Called when the index changed (notes re-parsed); `texts` lists updated notes. */
  onIndexChange?: (updated: { path: string; text: string }[], removed: string[]) => void;
  saveDelay?: number;
  autoTitleDelay?: number;
  liveIndexDelay?: number;
  missingFileGracePeriod?: number;
}

class FileError extends Error {}

const INVALID_NAME = "Names can’t be empty, start with a dot, or contain “/” or “:”.";

interface Toast extends ToastView {
  action: (() => void) | null;
}

export class Vault {
  readonly root: string;
  tree: TreeNode[] = [];
  noteCount = 0;
  /** Vault paths of every note, in tree order. */
  allNotes: string[] = [];
  /** Vault paths of every other file (images, PDFs…). */
  attachments: string[] = [];
  readonly index = new VaultIndex();
  private resolver = new LinkResolver([]);

  tabs: EditorTab[] = [];
  activeTabId: string | null = null;
  /** Loaded notes, one per file, shared by every tab showing it. */
  readonly documents = new Map<string, NoteDocument>();
  recentNotes: string[];
  selection: string | null = null;
  renaming: string | null = null;
  pendingDeletion: string[] | null = null;
  toast: Toast | null = null;
  errorMessage: string | null = null;
  treeRevision = 0;
  indexRevision = 0;
  isIndexing = false;

  /** Overrides for tests. */
  updatesLinksOverride: boolean | null = null;
  namesFromFirstLineOverride: boolean | null = null;
  dailyNoteSettingsOverride: { folder: string; format: string; template: string } | null = null;
  templatesFolderOverride: string | null = null;

  private readonly options: VaultOptions;
  private readonly editor: EditorPort;
  private toastTimer: NodeJS.Timeout | null = null;
  private nextToastId = 1;
  private liveIndexTimer: NodeJS.Timeout | null = null;
  /** Documents still being named from their first line. */
  private readonly autoTitled = new Set<NoteDocument>();
  private readonly autoTitleTimers = new Map<NoteDocument, NodeJS.Timeout>();
  private readonly missingTimers = new Set<NodeJS.Timeout>();
  private indexQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(root: string, options: VaultOptions) {
    this.root = nodePath.resolve(root);
    this.options = options;
    this.editor = options.editor ?? nullEditor;
    this.recentNotes = options.store.get<string[]>(this.recentNotesKey) ?? [];
    this.reload();
    this.restoreTabs();
  }

  get name() {
    return nodePath.basename(this.root);
  }

  /** The vault path with the home folder shortened to "~". */
  get displayPath() {
    const home = os.homedir();
    return this.root.toLowerCase().startsWith(home.toLowerCase()) ? "~" + this.root.slice(home.length) : this.root;
  }

  get activeTab(): EditorTab | null {
    return this.tabs.find((tab) => tab.id === this.activeTabId) ?? null;
  }

  /** The note in the active tab. */
  get document(): NoteDocument | null {
    const path = this.activeTab?.path;
    return path ? (this.documents.get(path) ?? null) : null;
  }

  get canGoBack() {
    return this.activeTab?.canGoBack ?? false;
  }

  get canGoForward() {
    return this.activeTab?.canGoForward ?? false;
  }

  private get settings(): Settings {
    return this.options.settings();
  }

  /** Absolute file system path for a vault path. */
  abs(path: string): string {
    return path === "" ? this.root : nodePath.join(this.root, ...path.split("/"));
  }

  /** Vault path for an absolute path inside the vault. */
  relative(file: string): string {
    return nodePath.relative(this.root, file).split(nodePath.sep).join("/");
  }

  /** Whether an absolute path is inside the vault (following links). */
  contains(file: string): boolean {
    return fsx.isInside(this.root, file);
  }

  private changed() {
    this.options.onChange?.();
  }

  /** Saves open notes and stops all timers. */
  close() {
    this.saveAll();
    this.closed = true;
    for (const timer of [...this.autoTitleTimers.values(), ...this.missingTimers]) clearTimeout(timer);
    if (this.liveIndexTimer) clearTimeout(this.liveIndexTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    for (const document of this.documents.values()) document.dispose();
  }

  // MARK: Scanning

  /**
   * Rescans the folder. Only touches observed state when something changed,
   * so frequent rescans don't churn the sidebar. Re-reads `changedPaths`
   * into the index even if the tree's shape didn't change.
   */
  reload(changedPaths: Iterable<string> = []) {
    const scan = scanVault(this.root);
    this.attachments = scan.attachments;
    const changed = new Set(changedPaths);
    const treeChanged = JSON.stringify(scan.tree) !== JSON.stringify(this.tree);
    if (treeChanged) {
      this.tree = scan.tree;
      this.noteCount = scan.notes.length;
      this.allNotes = scan.notes;
      this.resolver = new LinkResolver(scan.notes);
      const before = this.recentNotes.length;
      this.recentNotes = this.recentNotes.filter((path) => fsx.exists(this.abs(path)));
      if (this.recentNotes.length !== before) this.options.store.set(this.recentNotesKey, this.recentNotes);
      this.treeRevision++;
      this.options.onTreeChange?.();
      this.changed();
    }
    if (treeChanged || changed.size) this.scheduleIndexSync(changed);
  }

  /** Brings the index in line with the notes: drops removed ones, reads new or changed ones. */
  private scheduleIndexSync(reread: Set<string>) {
    const paths = this.allNotes;
    this.indexQueue = this.indexQueue.then(() => this.syncIndex(paths, reread));
  }

  /** Waits until queued index updates have finished (for tests). */
  indexingFinished(): Promise<void> {
    return this.indexQueue;
  }

  private async syncIndex(paths: string[], reread: Set<string>) {
    if (this.closed) return;
    const present = new Set(paths);
    const removed = [...this.index.allNotes.keys()].filter((path) => !present.has(path));
    const unread = new Set(this.index.setPaths(paths));
    const toRead = paths.filter((path) => unread.has(path) || reread.has(path));
    const updated: { path: string; text: string }[] = [];
    if (toRead.length) {
      this.isIndexing = true;
      this.changed();
      // Read in batches, yielding between them so the app stays responsive.
      // Reads are synchronous so no file handle stays open across a yield:
      // on Windows an open handle makes renaming the file (or its folder)
      // fail, and the synchronous retry in fsx would block the very event
      // loop that has to close it.
      for (let start = 0; start < toRead.length; start += 64) {
        if (start > 0) await new Promise((resolve) => setImmediate(resolve));
        if (this.closed) return;
        const batch = toRead.slice(start, start + 64);
        const texts = batch.map((path) => {
          try {
            return fsx.readText(this.abs(path));
          } catch {
            return null;
          }
        });
        batch.forEach((path, i) => {
          const text = texts[i];
          if (text === null || !this.index.hasPath(path)) return;
          // An open note's unsaved text is fresher than the disk.
          const live = this.documents.get(path)?.text ?? text;
          this.index.update(path, live);
          updated.push({ path, text: live });
        });
      }
      this.isIndexing = false;
    }
    this.indexRevision++;
    this.options.onIndexChange?.(updated, removed);
    this.sendVaultData();
    this.changed();
  }

  // MARK: Outside changes

  /** Called by the watcher with vault paths that changed on disk. */
  handleDiskChanges(paths: string[]) {
    if (this.closed) return;
    const changedNotes = paths.filter((path) => P.isNote(path));
    this.reload(changedNotes);
    for (const [path, document] of [...this.documents]) {
      const affected = paths.some((changed) => changed === "" || changed === path || path.startsWith(changed + "/"));
      if (!affected) continue;
      document.reconcileWithDisk();
      if (document.canBeClosedSafely) {
        // Some sync tools delete a file and write its replacement a moment
        // later; only close if it's still gone after a short wait.
        const timer = setTimeout(() => {
          this.missingTimers.delete(timer);
          if (this.documents.get(path) !== document) return;
          document.reconcileWithDisk();
          if (document.canBeClosedSafely) this.closeTabsShowing(path);
        }, this.options.missingFileGracePeriod ?? 1500);
        this.missingTimers.add(timer);
      }
    }
  }

  /** The missing-file banner's "Discard Edits": drops the note without saving it. */
  discardMissing(path: string) {
    const document = this.documents.get(path);
    if (!document) return;
    this.dropDocument(path);
    this.closeTabsShowing(path);
  }

  /** The missing-file banner's "Restore": writes the note back to disk. */
  restoreMissing(path: string) {
    const document = this.documents.get(path);
    if (!document) return;
    document.save();
    this.reload([path]);
  }

  // MARK: Links

  /**
   * Finds the note a `[[target]]` link points to: a bare name, a vault path,
   * optional extension, optional "#Heading"/"^block". Empty path = the open note.
   */
  resolveLink(rawTarget: string): string | null {
    if (LinkResolver.linkPath(rawTarget) === "") return this.activeTab?.path ?? null;
    return this.resolver.resolveWiki(rawTarget);
  }

  /** Opens the note a link points to, creating it (at the written path) when it doesn't exist yet. */
  openLink(rawTarget: string, inNewTab = false) {
    if (Attachments.isAttachmentTarget(rawTarget)) {
      // [[report.pdf]] opens the file, never creates "report.pdf.md".
      const from = this.activeTab?.path ?? "";
      const path = Attachments.resolve(rawTarget, from, this.attachments);
      if (path !== null) this.options.openPath?.(this.abs(path));
      else this.showError(`“${LinkResolver.linkPath(rawTarget)}” isn’t in this vault.`);
      return;
    }
    const resolved = this.resolveLink(rawTarget);
    if (resolved !== null) {
      this.open(resolved, inNewTab);
      this.editor.focus();
      this.revealFragment(rawTarget);
      return;
    }
    const safe = LinkResolver.linkPath(rawTarget)
      .split("/")
      // ":" as on the Mac, plus the other characters Windows forbids in names.
      .map((part) => part.replace(/[:<>"|?*\\]/g, "-").trim())
      .filter((part) => part !== "" && part !== "." && part !== "..");
    if (!safe.length) return;
    const fileName = safe[safe.length - 1];
    const path = P.join(...safe.slice(0, -1), P.isNote(fileName) ? fileName : `${fileName}.md`);
    try {
      fsx.writeAtomic(this.abs(path), "", { withoutOverwriting: true });
    } catch (error) {
      this.showError(`Couldn’t create “${fileName}”: ${message(error)}`);
      return;
    }
    this.reload();
    this.open(path, inNewTab);
    this.editor.focus();
  }

  /** Scrolls the open note to a link's #Heading or #^block-id, if it has one. */
  private revealFragment(rawTarget: string) {
    const fragment = linkFragment(rawTarget);
    const document = this.document;
    const path = this.activeTab?.path;
    if (fragment === null || !document || !path) return;
    const line = lineOfFragment(fragment, document.text);
    if (line !== null) this.editor.reveal(path, line, 0, 0);
  }

  // MARK: Saving

  saveAll() {
    for (const document of this.documents.values()) document.save();
  }

  /** Re-indexes the open note shortly after typing pauses, so backlinks and the outline follow edits. */
  private scheduleLiveIndexUpdate(path: string, text: string) {
    if (this.liveIndexTimer) clearTimeout(this.liveIndexTimer);
    this.liveIndexTimer = setTimeout(() => {
      this.liveIndexTimer = null;
      if (!this.index.hasPath(path)) return;
      if (this.index.update(path, text)) {
        this.indexRevision++;
        this.options.onIndexChange?.([{ path, text }], []);
        this.sendVaultData();
        this.changed();
      }
    }, this.options.liveIndexDelay ?? 300);
  }

  // MARK: Tabs

  /**
   * Opens a note. Switches to its tab if one already shows it; otherwise shows
   * it in the active tab, or in a new tab when asked (an empty active tab is
   * reused either way).
   */
  open(path: string, inNewTab = false) {
    const existing = this.tabs.find((tab) => tab.path === path);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }
    if (!this.loadDocument(path)) return;
    const index = this.activeIndex;
    if (index !== null && (!inNewTab || this.tabs[index].path === null)) {
      this.document?.save();
      this.tabs[index].navigate(path);
    } else {
      const tab = new EditorTab(path);
      this.tabs.splice(index === null ? this.tabs.length : index + 1, 0, tab);
      this.activeTabId = tab.id;
    }
    this.didChangeTabs();
  }

  /** Opens an empty tab after the active one. */
  newTab() {
    const tab = new EditorTab();
    const index = this.activeIndex;
    this.tabs.splice(index === null ? this.tabs.length : index + 1, 0, tab);
    this.activeTabId = tab.id;
    this.didChangeTabs();
  }

  activateTab(id: string) {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    if (id !== this.activeTabId) this.document?.save();
    this.activeTabId = id;
    const path = this.activeTab?.path;
    if (path) this.loadDocument(path);
    this.didChangeTabs();
  }

  closeTab(id: string) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.activeTabId === id) {
      this.activeTabId = (this.tabs[index] ?? this.tabs[this.tabs.length - 1])?.id ?? null;
      const path = this.activeTab?.path;
      if (path) this.loadDocument(path);
    }
    this.didChangeTabs();
  }

  /** Closes the active tab. */
  closeActiveTab() {
    if (this.activeTabId) this.closeTab(this.activeTabId);
  }

  closeOtherTabs(id: string) {
    this.tabs = this.tabs.filter((tab) => tab.id === id);
    this.activateTab(id);
  }

  closeTabsToTheRight(id: string) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const closing = new Set(this.tabs.slice(index + 1).map((tab) => tab.id));
    this.tabs = this.tabs.filter((tab) => !closing.has(tab.id));
    if (this.activeTabId && closing.has(this.activeTabId)) this.activateTab(id);
    else this.didChangeTabs();
  }

  /** Closes every tab showing `path` (e.g. after the file was deleted). */
  closeTabsShowing(path: string) {
    for (const tab of this.tabs.filter((tab) => tab.path === path)) this.closeTab(tab.id);
  }

  /**
   * Closes every tab showing `path` or a note under it, all at once: closing
   * them one by one could briefly activate (and try to load) a neighbour
   * that is gone too.
   */
  private closeTabsUnder(path: string) {
    const closes = (tab: EditorTab) => tab.path !== null && P.isUnder(tab.path, path);
    if (!this.tabs.some(closes)) return;
    const index = this.activeIndex;
    const activeCloses = index !== null && closes(this.tabs[index]);
    const nextSurvivor = index === null ? undefined : this.tabs.slice(index).find((tab) => !closes(tab));
    this.tabs = this.tabs.filter((tab) => !closes(tab));
    if (activeCloses) {
      this.activeTabId = (nextSurvivor ?? this.tabs[this.tabs.length - 1])?.id ?? null;
      const active = this.activeTab?.path;
      if (active) this.loadDocument(active);
    }
    this.didChangeTabs();
  }

  selectNextTab() {
    this.selectTabOffset(1);
  }

  selectPreviousTab() {
    this.selectTabOffset(-1);
  }

  /** Ctrl+1…Ctrl+8 pick that tab; Ctrl+9 always picks the last one. */
  selectTabNumber(number: number) {
    if (!this.tabs.length) return;
    const index = number >= 9 ? this.tabs.length - 1 : number - 1;
    if (index >= 0 && index < this.tabs.length) this.activateTab(this.tabs[index].id);
  }

  private selectTabOffset(offset: number) {
    const index = this.activeIndex;
    if (index === null || this.tabs.length < 2) return;
    this.activateTab(this.tabs[(index + offset + this.tabs.length) % this.tabs.length].id);
  }

  /** Moves a tab so it sits where `target` is now. */
  moveTab(id: string, target: string) {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    const to = this.tabs.findIndex((tab) => tab.id === target);
    if (id === target || from < 0 || to < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.saveTabs();
    this.changed();
  }

  goBack() {
    this.navigateHistory((tab, missing) => tab.goBack(missing));
  }

  goForward() {
    this.navigateHistory((tab, missing) => tab.goForward(missing));
  }

  private navigateHistory(move: (tab: EditorTab, missing: (path: string) => boolean) => string | null) {
    const index = this.activeIndex;
    if (index === null) return;
    this.document?.save();
    const path = move(this.tabs[index], (candidate) => !fsx.exists(this.abs(candidate)));
    if (path === null) return;
    this.loadDocument(path);
    this.didChangeTabs();
  }

  private get activeIndex(): number | null {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    return index < 0 ? null : index;
  }

  /** The shared document for `path`, loading it if needed. */
  private loadDocument(path: string): NoteDocument | null {
    const existing = this.documents.get(path);
    if (existing) return existing;
    try {
      const document = new NoteDocument(this.abs(path), {
        saveDelay: this.options.saveDelay,
        autoMerge: () => this.settings.autoMergeExternalChanges,
      });
      this.attach(document, path);
      if (isPlaceholderName(path)) this.autoTitled.add(document);
      this.documents.set(path, document);
      return document;
    } catch (error) {
      this.showError(`Couldn’t open “${P.basename(path)}”: ${message(error)}`);
      return null;
    }
  }

  /** Wires a document's callbacks for its current path. */
  private attach(document: NoteDocument, path: string) {
    document.onTextChange = (text) => {
      this.scheduleLiveIndexUpdate(path, text);
      this.scheduleAutoTitle(document);
    };
    document.onExternalTextChange = (oldText, newText) => this.editor.externalChange(path, oldText, newText);
    document.onStateChange = () => this.changed();
  }

  /** Forgets a document without saving it. */
  private dropDocument(path: string) {
    const document = this.documents.get(path);
    if (!document) return;
    document.dispose();
    this.autoTitled.delete(document);
    const timer = this.autoTitleTimers.get(document);
    if (timer) clearTimeout(timer);
    this.autoTitleTimers.delete(document);
    this.documents.delete(path);
    this.editor.forget(path);
  }

  /**
   * Runs after any change to tabs: keeps the sidebar selection and recent
   * notes in step, unloads notes no tab shows, remembers the tabs, and shows
   * the active note in the editor.
   */
  private didChangeTabs() {
    this.finishAutoTitles(this.document);
    const path = this.activeTab?.path ?? null;
    this.selection = path;
    if (path) this.rememberRecent(path);
    this.unloadUnusedDocuments();
    this.saveTabs();
    this.editor.show(path, this.document?.text ?? null);
    this.changed();
  }

  private unloadUnusedDocuments() {
    const inUse = new Set(this.tabs.map((tab) => tab.path).filter((path): path is string => path !== null));
    for (const [path, document] of [...this.documents]) {
      if (inUse.has(path)) continue;
      if (document.conflict) {
        // Never drop unresolved edits: keep them as a separate note.
        document.resolveKeepingBoth();
        this.reload();
      } else if (!document.isMissingOnDisk || document.isDirty) {
        document.save();
      }
      this.dropDocument(path);
    }
  }

  private get tabsKey() {
    return "openTabs:" + this.root;
  }

  private saveTabs() {
    this.options.store.set(this.tabsKey, this.tabs.map((tab) => tab.path).filter((path) => path !== null));
    this.options.store.set(this.tabsKey + ":active", this.activeIndex ?? 0);
  }

  /** Reopens the tabs that were open when this vault was last closed. */
  private restoreTabs() {
    const paths = (this.options.store.get<string[]>(this.tabsKey) ?? []).filter(
      (path) => typeof path === "string" && P.isNote(path) && fsx.exists(this.abs(path)),
    );
    if (!paths.length) return;
    this.tabs = paths.map((path) => new EditorTab(path));
    const active = Math.min(this.options.store.get<number>(this.tabsKey + ":active") ?? 0, this.tabs.length - 1);
    this.activateTab(this.tabs[Math.max(0, active)].id);
  }

  /** Sidebar selection: selecting a note opens it; a folder just becomes the target for new items. */
  select(path: string | null) {
    if (path === this.selection) return;
    this.selection = path;
    if (path && P.isNote(path)) this.open(path);
    else this.changed();
  }

  // MARK: Toasts

  /** Shows `message` for a few seconds, optionally with a button (Undo, Review…). */
  showToast(text: string, action: (() => void) | null = null, actionTitle = "Undo", isWarning = false) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const toast: Toast = { id: this.nextToastId++, message: text, actionTitle: action ? actionTitle : null, isWarning, action };
    this.toast = toast;
    this.toastTimer = setTimeout(() => {
      if (this.toast === toast) this.dismissToast();
    }, action === null ? 3000 : isWarning ? 12000 : 6000);
    this.changed();
  }

  dismissToast() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toast = null;
    this.changed();
  }

  /** Runs the current toast's button. */
  runToastAction() {
    const action = this.toast?.action;
    this.dismissToast();
    action?.();
  }

  showError(text: string) {
    this.errorMessage = text;
    this.changed();
  }

  /** "“Kyber”" or "3 items". */
  private describe(paths: string[]): string {
    if (paths.length !== 1) return `${paths.length} items`;
    const path = paths[0];
    return `“${P.isNote(path) ? P.stem(path) : P.basename(path)}”`;
  }

  private folderName(folder: string) {
    return folder === "" ? "the top of the vault" : P.basename(folder);
  }

  // MARK: File management

  /**
   * Renames a note or folder in place. Notes keep their extension even if
   * the new name leaves it off. Links to renamed notes are updated.
   * Throws with a user-facing message.
   */
  rename(path: string, rawName: string): string {
    const document = this.documents.get(path);
    if (document) this.stopAutoTitle(document);
    const name = rawName.trim();
    if (!name || name.startsWith(".") || name.includes("/") || name.includes(":") || name.includes("\\")) {
      throw new FileError(INVALID_NAME);
    }
    if (/[<>"|?*]/.test(name) || /[. ]$/.test(name) || isReservedWindowsName(name)) {
      throw new FileError(`“${name}” can’t be used as a name on Windows.`);
    }
    const isDir = fsx.isDirectory(this.abs(path));
    let fileName = name;
    if (!isDir && P.isNote(path) && !P.isNote(name)) fileName += "." + P.extname(path);
    const renamed = this.performMove(path, P.join(P.dirname(path), fileName));
    if (renamed !== path) {
      this.showToast(`Renamed ${this.describe([path])} to ${this.describe([renamed])}`, () =>
        this.undoMoves([{ from: path, to: renamed }]),
      );
    }
    return renamed;
  }

  /** Renames from the sidebar's inline field; reports errors as an alert. */
  commitRename(path: string, rawName: string) {
    this.renaming = null;
    try {
      this.rename(path, rawName);
    } catch (error) {
      this.showError(`Couldn’t rename “${P.basename(path)}”: ${message(error)}`);
    }
    this.changed();
  }

  startRenaming(path: string | null) {
    this.renaming = path;
    this.changed();
  }

  /** Puts moved items back where they were (most recent first). */
  private undoMoves(moves: { from: string; to: string }[]) {
    for (const move of [...moves].reverse()) {
      try {
        this.performMove(move.to, move.from);
      } catch (error) {
        this.showError(`Couldn’t put “${P.basename(move.to)}” back: ${message(error)}`);
      }
    }
    this.reload();
  }

  /**
   * Moves vault items into `folder` ("" = the vault root). Absolute paths
   * from outside the vault are copied in instead.
   */
  move(items: string[], folder: string) {
    const moves: { from: string; to: string }[] = [];
    const copies: string[] = [];
    const queue = [...items];
    for (const item of queue) {
      const outside = nodePath.isAbsolute(item);
      const label = outside ? nodePath.basename(item) : P.basename(item);
      try {
        if (outside) {
          if (this.contains(item)) {
            // An absolute path that's really in the vault: treat as a move.
            queue.push(this.relative(item));
            continue;
          }
          const ext = nodePath.extname(item).slice(1);
          const base = ext ? nodePath.basename(item, "." + ext) : nodePath.basename(item);
          const target = this.uniquePath(base, ext, folder);
          fsx.copy(item, this.abs(target));
          copies.push(target);
          continue;
        }
        if (P.dirname(item) === folder) continue;
        if (fsx.isDirectory(this.abs(item)) && P.isUnder(folder, item)) {
          throw new FileError("A folder can’t be moved into itself.");
        }
        const moved = this.performMove(item, P.join(folder, P.basename(item)));
        moves.push({ from: item, to: moved });
      } catch (error) {
        this.showError(`Couldn’t move “${label}”: ${message(error)}`);
      }
    }
    this.reload();
    if (moves.length) {
      this.showToast(`Moved ${this.describe(moves.map((m) => m.to))} to ${this.folderName(folder)}`, () => this.undoMoves(moves));
    } else if (copies.length) {
      this.showToast(`Copied ${this.describe(copies)} into ${this.folderName(folder)}`, () => {
        void this.delete(copies, false);
      });
    }
  }

  /** Creates "Untitled Folder" (numbered if taken) and starts renaming it. */
  createFolder(parent: string | null = null): string | null {
    const folder = parent ?? this.targetFolderForNewItems();
    const path = this.uniquePath("Untitled Folder", "", folder);
    try {
      fsx.mkdirp(this.abs(path));
    } catch (error) {
      this.showError(`Couldn’t create a folder: ${message(error)}`);
      return null;
    }
    this.reload();
    this.renaming = path;
    this.changed();
    return path;
  }

  /** Copies a note beside itself as "Name copy" and opens the copy. */
  duplicate(path: string): string | null {
    this.documents.get(path)?.save();
    const copy = this.uniquePath(P.stem(path) + " copy", P.extname(path), P.dirname(path));
    try {
      fsx.copy(this.abs(path), this.abs(copy));
    } catch (error) {
      this.showError(`Couldn’t duplicate “${P.basename(path)}”: ${message(error)}`);
      return null;
    }
    this.reload();
    this.open(copy, true);
    this.showToast(`Duplicated ${this.describe([path])}`, () => {
      void this.delete([copy], false);
    });
    return copy;
  }

  /** Asks before moving items to the Recycle Bin (see `pendingDeletion`). */
  requestDeletion(paths: string[]) {
    const items = paths.filter((path) => path !== "" && fsx.exists(this.abs(path)));
    if (items.length) {
      this.pendingDeletion = items;
      this.changed();
    }
  }

  cancelDeletion() {
    this.pendingDeletion = null;
    this.changed();
  }

  async confirmDeletion() {
    const paths = this.pendingDeletion;
    if (!paths) return;
    this.pendingDeletion = null;
    await this.delete(paths);
  }

  /**
   * Moves items to the Recycle Bin and closes their tabs. Unsaved edits in
   * those notes are discarded with them (the documents are dropped first,
   * so closing their tabs can't save them back).
   */
  async delete(paths: string[], announce = true) {
    const trashed: { path: string; restore: (() => void) | null }[] = [];
    for (const path of paths) {
      for (const documentPath of [...this.documents.keys()]) {
        if (P.isUnder(documentPath, path)) this.dropDocument(documentPath);
      }
      try {
        const restore = await (this.options.trash ?? defaultTrash)(this.abs(path));
        trashed.push({ path, restore });
      } catch (error) {
        this.showError(`Couldn’t move “${P.basename(path)}” to the Recycle Bin: ${message(error)}`);
        continue;
      }
      this.closeTabsUnder(path);
      if (this.selection && P.isUnder(this.selection, path)) this.selection = null;
    }
    this.reload();
    this.changed();
    if (!announce || !trashed.length) return;
    const restorable = trashed.every((item) => item.restore !== null);
    this.showToast(
      `Moved ${this.describe(trashed.map((item) => item.path))} to the Recycle Bin`,
      restorable ? () => this.restoreFromTrash(trashed) : null,
    );
  }

  private restoreFromTrash(items: { path: string; restore: (() => void) | null }[]) {
    for (const item of items) {
      try {
        item.restore?.();
      } catch (error) {
        this.showError(`Couldn’t restore “${P.basename(item.path)}”: ${message(error)}`);
      }
    }
    this.reload();
  }

  /**
   * Moves a file or folder within the vault, keeping open notes, tabs and
   * (if enabled) links in other notes pointing at the right place.
   */
  private performMove(source: string, destination: string): string {
    if (source === destination) return destination;
    const caseOnly = source.toLowerCase() === destination.toLowerCase();
    if (!caseOnly && fsx.exists(this.abs(destination))) {
      throw new FileError(`There’s already an item named “${P.basename(destination)}” there.`);
    }

    // Which notes move, by vault path.
    const movesTo = (path: string): string | null => {
      if (path === source) return destination;
      if (path.startsWith(source + "/")) return destination + path.slice(source.length);
      return null;
    };
    const mapping = new Map<string, string>();
    for (const note of this.allNotes) {
      const moved = movesTo(note);
      if (moved !== null) mapping.set(note, moved);
    }

    // Work out link changes before anything moves.
    const updatesLinks = this.updatesLinksOverride ?? this.settings.updateLinksOnMove;
    const rewrites = updatesLinks && mapping.size ? this.planLinkRewrites(mapping) : new Map<string, string>();

    // Flush open notes being moved, then move on disk.
    for (const [path, document] of this.documents) if (movesTo(path) !== null) document.save();
    if (caseOnly) {
      // NTFS is case-insensitive: "kyber.md" and "Kyber.md" are the same file.
      const temporary = P.join(P.dirname(source), `.holocron-rename-${Date.now()}`);
      fsx.move(this.abs(source), this.abs(temporary));
      fsx.move(this.abs(temporary), this.abs(destination));
    } else {
      fsx.mkdirp(nodePath.dirname(this.abs(destination)));
      fsx.move(this.abs(source), this.abs(destination));
    }

    // Point documents, tabs, selection and recents at the new location.
    const remap = (path: string) => movesTo(path) ?? path;
    for (const [oldPath, document] of [...this.documents]) {
      const newPath = remap(oldPath);
      if (newPath === oldPath) continue;
      this.documents.delete(oldPath);
      document.didMove(this.abs(newPath));
      this.attach(document, newPath);
      this.documents.set(newPath, document);
      this.editor.documentDidMove(oldPath, newPath);
    }
    for (const tab of this.tabs) tab.remap(remap);
    if (this.selection) this.selection = remap(this.selection);
    if (this.renaming) this.renaming = remap(this.renaming);
    this.recentNotes = this.recentNotes.map(remap);
    this.options.store.set(this.recentNotesKey, this.recentNotes);

    // Rewrite links in other notes.
    for (const [path, text] of rewrites) {
      const document = this.documents.get(path);
      if (document) document.replaceContents(text);
      else {
        try {
          fsx.writeAtomic(this.abs(path), text);
        } catch (error) {
          this.showError(`Couldn’t update links in “${P.stem(path)}”: ${message(error)}`);
          continue;
        }
      }
      // Keep the index's links current right away: the next move (an Undo
      // straight after this one) filters notes by them before the
      // background re-read has caught up.
      if (this.index.hasPath(path)) this.index.update(path, text);
    }

    this.reload([...rewrites.keys(), ...mapping.values()]);
    this.saveTabs();
    this.changed();
    return destination;
  }

  /**
   * For each note whose links point at a moving note (or that moves and has
   * relative markdown links), its new text — keyed by its path after the move.
   */
  private planLinkRewrites(mapping: Map<string, string>): Map<string, string> {
    const oldResolver = this.resolver;
    const newResolver = new LinkResolver(this.allNotes.map((path) => mapping.get(path) ?? path));
    const result = new Map<string, string>();

    for (const sourceOld of this.allNotes) {
      const sourceNew = mapping.get(sourceOld) ?? sourceOld;
      const sourceMoves = mapping.has(sourceOld);
      let text: string;
      const document = this.documents.get(sourceOld);
      if (document) text = document.text;
      else {
        try {
          text = fsx.readText(this.abs(sourceOld));
        } catch {
          continue;
        }
      }
      // Cheap filter using the index (or a fresh parse if not indexed yet).
      const links = (this.index.info(sourceOld) ?? parseNote(text)).links;
      const relevant = links.some((link) => {
        const target = oldResolver.resolve(link, sourceOld);
        return (target !== null && mapping.has(target)) || (sourceMoves && link.kind === "markdown");
      });
      if (!relevant) continue;

      const newFolder = P.dirname(sourceNew);
      const rewritten = rewriteLinks(text, (target) => {
        if (target.kind === "wiki") {
          const oldTarget = oldResolver.resolveWiki(target.path);
          const newTarget = oldTarget === null ? undefined : mapping.get(oldTarget);
          if (newTarget === undefined) return null;
          return wikiTarget(newTarget, target.path, newResolver);
        }
        const oldTarget = oldResolver.resolveMarkdown(target.path, sourceOld);
        if (oldTarget === null) return null;
        const newTarget = mapping.get(oldTarget) ?? oldTarget;
        if (newTarget === oldTarget && !sourceMoves) return null;
        return target.path.startsWith("/") ? "/" + newTarget : relativeLinkPath(newFolder, newTarget);
      });
      if (rewritten !== text) result.set(sourceNew, rewritten);
    }
    return result;
  }

  /** "Name.ext", "Name 2.ext"… free in `folder`; remembered as named by Holocron. */
  uniquePath(base: string, ext: string, folder: string): string {
    const name = P.uniqueName(base, ext, (candidate) => fsx.exists(this.abs(P.join(folder, candidate))));
    return P.join(folder, name);
  }

  // MARK: Attachments

  /**
   * The file an image or media embed points to, for the editor's asset
   * protocol. `kind` is "embed" (![[name]]) or "relative" (![](path), <img
   * src>); the result is always an image, audio, video or PDF file inside the
   * vault (never a note, script or any other file).
   */
  resolveAsset(kind: string, target: string, fromNote: string): string | null {
    if (kind === "relative" && target.includes(":")) return null; // not a local path
    const path = Attachments.resolve(target, fromNote, this.attachments);
    if (path === null || !isServableAsset(path)) return null;
    const file = this.abs(path);
    return this.contains(file) ? file : null;
  }

  private get attachmentFolder(): string {
    return Attachments.normalize(this.settings.attachmentFolder);
  }

  /** Saves pasted data as a new file in the attachment folder and returns the text that embeds it. */
  saveAttachment(data: Uint8Array, fileName: string): string {
    const ext = P.extname(fileName) || "png";
    const base = P.stem(fileName) || "Attachment";
    const path = this.uniquePath(base, ext, this.attachmentFolder);
    fsx.writeAtomic(this.abs(path), data, { withoutOverwriting: true });
    this.reload();
    return Attachments.linkText(path, this.attachments);
  }

  /**
   * Adds dropped files: files already in the vault are linked where they are;
   * others are copied into the attachment folder. Returns the text to insert
   * for each (notes get a [[link]], images an embed).
   */
  importFiles(files: string[]): string[] {
    const texts: string[] = [];
    for (const file of files) {
      let path: string;
      if (this.contains(file)) {
        path = this.relative(file);
      } else {
        try {
          const ext = nodePath.extname(file).slice(1);
          const base = ext ? nodePath.basename(file, "." + ext) : nodePath.basename(file);
          path = this.uniquePath(base, ext, this.attachmentFolder);
          fsx.copy(file, this.abs(path));
        } catch (error) {
          this.showError(`Couldn’t add “${nodePath.basename(file)}”: ${message(error)}`);
          continue;
        }
      }
      this.reload();
      texts.push(P.isNote(path) ? `[[${P.withoutExtension(path)}]]` : Attachments.linkText(path, this.attachments));
    }
    return texts;
  }

  // MARK: Daily notes

  get dailyNoteSettings() {
    return (
      this.dailyNoteSettingsOverride ?? {
        folder: this.settings.dailyNoteFolder,
        format: this.settings.dailyNoteFormat,
        template: this.settings.dailyNoteTemplate,
      }
    );
  }

  /** The vault path of the daily note for `date` (whether or not it exists). */
  dailyNotePathFor(date = new Date()): string {
    const settings = this.dailyNoteSettings;
    return dailyNotePath(date, settings.folder, settings.format);
  }

  /**
   * Makes sure the daily note for `date` exists — creating it from the
   * template, if one is set — without opening it. `warning` says the
   * template wasn't found (the note is then created empty). Throws if the
   * note can't be created.
   */
  ensureDailyNote(date = new Date()): { path: string; created: boolean; warning: string | null } {
    const settings = this.dailyNoteSettings;
    const path = dailyNotePath(date, settings.folder, settings.format);
    if (fsx.exists(this.abs(path))) return { path, created: false, warning: null };
    let warning: string | null = null;
    let text = "";
    const template = settings.template.trim();
    if (template) {
      const templatePath = this.templatePath(template);
      let source: string | null = null;
      try {
        source = templatePath === null ? null : fsx.readText(this.abs(templatePath));
      } catch {
        source = null;
      }
      if (source !== null) text = renderPlaceholders(source, date, P.stem(path), settings.format);
      else warning = `The daily note template “${template}” wasn’t found, so the note was created empty.`;
    }
    try {
      fsx.writeAtomic(this.abs(path), text, { withoutOverwriting: true });
    } catch (error) {
      // Someone (a sync client, another capture) made it in the meantime: fine.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return { path, created: false, warning: null };
    }
    this.reload();
    return { path, created: true, warning };
  }

  /** Opens the daily note for `date` (today by default), creating it — from the template, if set — when needed. */
  openDailyNote(date = new Date(), inNewTab = false): string | null {
    let result: { path: string; warning: string | null };
    try {
      result = this.ensureDailyNote(date);
    } catch (error) {
      this.showError(`Couldn’t create today’s note: ${message(error)}`);
      return null;
    }
    this.open(result.path, inNewTab);
    this.editor.focus();
    if (result.warning) this.showError(result.warning);
    return result.path;
  }

  // MARK: Quick capture

  /** The inbox note's vault path from Settings, cleaned up; null if it can't be used (hidden, empty). */
  get inboxPath(): string | null {
    return inboxNotePath(this.inboxOverride ?? this.settings.quickCaptureInbox);
  }

  /** Overrides the inbox setting (tests). */
  inboxOverride: string | null = null;

  /**
   * Appends a quick capture to today's daily note (created from the template
   * if needed) or the inbox note (created if missing), as a bullet with the
   * time — see `formatCapture`. If the note is open, the capture goes through
   * its document so the editor shows it at once and unsaved edits are kept;
   * otherwise the file is read, extended and written back atomically. Line
   * endings follow the note (CRLF stays CRLF). Returns the note's vault path;
   * throws with a user-facing message.
   */
  appendCapture(text: string, target: "daily" | "inbox", date = new Date()): string {
    const entry = formatCapture(text, date);
    if (entry === null) throw new FileError("There’s nothing to save.");
    let path: string;
    if (target === "daily") {
      path = this.dailyNotePathFor(date);
      // An open note is used as it is (even if its file just vanished: its text is the truth).
      if (!this.documents.has(path)) {
        let result: { path: string; warning: string | null };
        try {
          result = this.ensureDailyNote(date);
        } catch (error) {
          throw new FileError(`Couldn’t create today’s note: ${message(error)}`);
        }
        path = result.path;
        if (result.warning) this.showError(result.warning);
      }
    } else {
      const inbox = this.inboxPath;
      if (inbox === null) throw new FileError(`The inbox note “${this.settings.quickCaptureInbox}” can’t be used. Choose another in Settings › General.`);
      path = inbox;
    }
    const file = this.abs(path);
    if (!this.contains(file)) throw new FileError(`“${path}” isn’t in this vault.`);

    const document = this.documents.get(path);
    if (document) {
      // The editor gets it as an outside edit (cursor and undo history kept);
      // the save that follows checks the disk first (§14), as every save does.
      document.replaceContents(appendEntry(document.text, entry));
    } else {
      try {
        if (fsx.isDirectory(file)) throw new Error("It’s a folder.");
        const existing = fsx.exists(file) ? fsx.readText(file) : "";
        fsx.writeAtomic(file, appendEntry(existing, entry));
      } catch (error) {
        throw new FileError(`Couldn’t add to “${P.stem(path)}”: ${message(error)}`);
      }
    }
    this.reload([path]);
    return path;
  }

  /** Opens the nearest existing daily note before (-1) or after (+1) the open one — or today. */
  openAdjacentDailyNote(direction: -1 | 1) {
    const settings = this.dailyNoteSettings;
    const dated = this.allNotes
      .map((path) => ({ path, date: dailyNoteDate(path, settings.folder, settings.format) }))
      .filter((entry): entry is { path: string; date: Date } => entry.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const current = this.activeTab?.path;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reference = (current ? dailyNoteDate(current, settings.folder, settings.format) : null) ?? today;
    const target =
      direction < 0
        ? [...dated].reverse().find((entry) => entry.date < reference)
        : dated.find((entry) => entry.date > reference);
    if (target) this.open(target.path);
    else this.options.ui?.({ type: "beep" });
  }

  /** A template given as a vault path ("Templates/Daily.md", extension optional) or a note name. */
  private templatePath(template: string): string | null {
    for (const candidate of [template, template + ".md"]) {
      const path = Attachments.normalize(candidate);
      if (path && fsx.exists(this.abs(path)) && !fsx.isDirectory(this.abs(path)) && this.contains(this.abs(path))) return path;
    }
    return this.resolveLink(template);
  }

  // MARK: Naming notes from their first line

  private get namesFromFirstLine() {
    return this.namesFromFirstLineOverride ?? this.settings.nameNotesFromFirstLine;
  }

  private scheduleAutoTitle(document: NoteDocument) {
    if (!this.autoTitled.has(document)) return;
    const existing = this.autoTitleTimers.get(document);
    if (existing) clearTimeout(existing);
    this.autoTitleTimers.set(
      document,
      setTimeout(() => {
        this.autoTitleTimers.delete(document);
        this.applyAutoTitle(document);
      }, this.options.autoTitleDelay ?? 1000),
    );
  }

  private stopAutoTitle(document: NoteDocument) {
    this.autoTitled.delete(document);
    const timer = this.autoTitleTimers.get(document);
    if (timer) clearTimeout(timer);
    this.autoTitleTimers.delete(document);
  }

  /** Renames a note to match its first line, if it's still being named. */
  applyAutoTitle(document: NoteDocument) {
    const timer = this.autoTitleTimers.get(document);
    if (timer) clearTimeout(timer);
    this.autoTitleTimers.delete(document);
    if (!this.namesFromFirstLine || !this.autoTitled.has(document)) return;
    const title = titleFromContent(document.text);
    if (title === null) return;
    const path = this.pathOf(document);
    if (path === null) return;
    const current = P.stem(path);
    if (title === current) return;
    const folder = P.dirname(path);
    const ext = P.extname(path);
    let target = P.join(folder, `${title}.${ext}`);
    // Only number the name if it belongs to a different file.
    if (fsx.exists(this.abs(target)) && target.toLowerCase() !== path.toLowerCase()) {
      target = this.uniquePath(title, ext, folder);
      if (P.stem(target) === current) return;
    }
    try {
      this.performMove(path, target);
    } catch {
      // Leave the name as it is; the user can rename by hand.
    }
  }

  /** Finishes naming any note that's no longer in the active tab. */
  private finishAutoTitles(active: NoteDocument | null) {
    for (const document of [...this.autoTitled]) {
      if (document === active) continue;
      this.applyAutoTitle(document);
      this.autoTitled.delete(document);
    }
  }

  private pathOf(document: NoteDocument): string | null {
    for (const [path, candidate] of this.documents) if (candidate === document) return path;
    return null;
  }

  // MARK: Templates

  get templatesFolder(): string {
    return Attachments.normalize(this.templatesFolderOverride ?? this.settings.templatesFolder);
  }

  /** Notes in the templates folder (and its subfolders), by name. */
  get templates(): string[] {
    const folder = this.templatesFolder;
    if (!folder) return [];
    return this.allNotes
      .filter((path) => path.startsWith(folder + "/"))
      .sort((a, b) => P.naturalCompare(P.basename(a), P.basename(b)));
  }

  private readTemplate(path: string, title: string) {
    try {
      return renderTemplate(fsx.readText(this.abs(path)), title, this.dailyNoteSettings.format);
    } catch {
      this.showError(`Couldn’t read the template “${P.stem(path)}”.`);
      return null;
    }
  }

  /** Inserts a template into the open note at the cursor, merging its properties. */
  insertTemplate(path: string) {
    const document = this.document;
    if (!document) return;
    const rendered = this.readTemplate(path, document.title);
    if (rendered) this.editor.applyTemplate(rendered.frontmatter ?? "", rendered.body);
  }

  /** Creates a note from a template beside the selection (never in the templates folder), opens it, cursor at {{cursor}}. */
  createNoteFromTemplate(template: string, rawName: string): string | null {
    const name = rawName.replaceAll(":", "-").replaceAll("/", "-").replaceAll("\\", "-").trim();
    const title = name || "Untitled";
    let folder = this.targetFolderForNewItems();
    const templatesRoot = this.templatesFolder;
    if (templatesRoot && (folder + "/").startsWith(templatesRoot + "/")) folder = "";
    const path = this.uniquePath(title, "md", folder);
    const finalTitle = P.stem(path);
    const rendered = this.readTemplate(template, finalTitle);
    if (!rendered) return null;
    const { text, cursor } = noteText(rendered);
    try {
      fsx.writeAtomic(this.abs(path), text, { withoutOverwriting: true });
    } catch (error) {
      this.showError(`Couldn’t create “${finalTitle}”: ${message(error)}`);
      return null;
    }
    this.reload();
    this.open(path, true);
    const before = text.slice(0, cursor).split("\n");
    this.editor.reveal(path, before.length, before[before.length - 1].length, before[before.length - 1].length);
    this.editor.focus();
    return path;
  }

  // MARK: Embeds and autocomplete

  /** The note an `![[embed]]` shows: title, vault path and current text (unsaved edits included). */
  embedContent(rawTarget: string): { title: string; path: string; text: string } | null {
    const path = this.resolver.resolveWiki(rawTarget);
    if (path === null) return null;
    let text = this.documents.get(path)?.text;
    if (text === undefined) {
      try {
        text = fsx.readText(this.abs(path));
      } catch {
        return null;
      }
    }
    return { title: P.stem(path), path, text };
  }

  /** What the editor needs to suggest [[links]], #headings, embeds and #tags. */
  completionData() {
    const recentRank = new Map<string, number>();
    this.recentNotes.slice(0, 10).forEach((path, index) => {
      if (!recentRank.has(path)) recentRank.set(path, 10 - index);
    });
    const notes = this.allNotes.map((path) => {
      const info = this.index.info(path);
      return {
        path,
        title: P.stem(path),
        aliases: info?.aliases ?? [],
        headings: (info?.headings ?? []).map((heading) => ({ text: heading.text, level: heading.level })),
        recent: recentRank.get(path) ?? 0,
      };
    });
    return { notes, attachments: this.attachments, tags: this.index.allTags() };
  }

  sendVaultData() {
    this.editor.setVaultData(() => this.completionData());
  }

  /** Everything the inspector shows about a note. */
  details(path: string): NoteDetails {
    const info = this.index.info(path);
    return {
      headings: info?.headings ?? [],
      backlinks: this.index.backlinks(path),
      mentions: this.index.unlinkedMentions(path),
      outgoing: this.index.outgoingLinks(path),
      tags: info?.tags ?? [],
      aliases: info?.aliases ?? [],
      properties: info?.properties ?? [],
    };
  }

  // MARK: Recent notes and new notes

  private get recentNotesKey() {
    return "recentNotes:" + this.root;
  }

  private rememberRecent(path: string) {
    this.recentNotes = [path, ...this.recentNotes.filter((recent) => recent !== path)].slice(0, 30);
    this.options.store.set(this.recentNotesKey, this.recentNotes);
  }

  /** Creates a note named `name` (as a link target, so "/" makes folders) and opens it. Quick open's "Create note". */
  createNoteNamed(name: string, inNewTab = false) {
    const cleaned = name.replaceAll(":", "-").trim();
    if (!cleaned) return;
    // Like ⌘N, create in the selected folder unless the name says otherwise.
    const folder = this.targetFolderForNewItems();
    this.openLink(cleaned.includes("/") || !folder ? cleaned : `${folder}/${cleaned}`, inNewTab);
  }

  /** Creates an empty "Untitled" note (numbered if taken) in the selected folder, beside the selected note, or at the root. */
  createNote(folder: string | null = null): string | null {
    const path = this.uniquePath("Untitled", "md", folder ?? this.targetFolderForNewItems());
    try {
      fsx.writeAtomic(this.abs(path), "", { withoutOverwriting: true });
    } catch (error) {
      this.showError(`Couldn’t create a note: ${message(error)}`);
      return null;
    }
    this.reload();
    this.open(path, true);
    this.editor.focus();
    return path;
  }

  private targetFolderForNewItems(): string {
    const selection = this.selection;
    if (selection === null) return "";
    return fsx.isDirectory(this.abs(selection)) ? selection : P.dirname(selection);
  }

  // MARK: Editor bridge

  /** The editor's text for the shown note changed. */
  editorChanged(path: string, text: string) {
    if (path !== this.activeTab?.path) return;
    this.documents.get(path)?.setText(text);
  }

  /** Pasted image → attachment; returns the text to insert, or null. */
  pasteImage(name: string, mime: string, data: Uint8Array): string | null {
    try {
      return this.saveAttachment(data, name || Attachments.pastedImageName(mime));
    } catch (error) {
      this.showError(`Couldn’t save the pasted image: ${message(error)}`);
      return null;
    }
  }

  // MARK: Conflicts

  resolveConflict(choice: "mine" | "disk" | "merge" | "both") {
    const document = this.document;
    if (!document?.conflict) return;
    switch (choice) {
      case "mine":
        document.resolveKeepingMine();
        break;
      case "disk":
        document.resolveUsingDisk();
        break;
      case "merge":
        document.resolveMerging();
        break;
      case "both":
        if (document.resolveKeepingBoth() !== null) this.reload();
        break;
    }
    this.changed();
  }

  // MARK: View state

  view(): VaultView {
    const document = this.document;
    const path = this.activeTab?.path ?? null;
    return {
      root: this.root,
      name: this.name,
      displayPath: this.displayPath,
      noteCount: this.noteCount,
      treeRevision: this.treeRevision,
      indexRevision: this.indexRevision,
      tabs: this.tabs.map((tab): TabView => {
        const doc = tab.path ? this.documents.get(tab.path) : undefined;
        return {
          id: tab.id,
          path: tab.path,
          title: tab.path ? P.stem(tab.path) : "New Tab",
          isDirty: doc?.isDirty ?? false,
          hasWarning: Boolean(doc && (doc.conflict || doc.isMissingOnDisk)),
        };
      }),
      activeTabId: this.activeTabId,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      selection: this.selection,
      renaming: this.renaming,
      pendingDeletion: this.pendingDeletion,
      recentNotes: this.recentNotes,
      toast: this.toast ? { id: this.toast.id, message: this.toast.message, actionTitle: this.toast.actionTitle, isWarning: this.toast.isWarning } : null,
      doc: document && path ? this.docView(path, document) : null,
      conflict: document?.conflict && path ? this.conflictView(path, document) : null,
      templates: this.templates,
      isIndexing: this.isIndexing,
    };
  }

  private docView(path: string, document: NoteDocument): DocView {
    let created: number | null = null;
    let modified: number | null = null;
    try {
      const stat = fs.statSync(document.file);
      created = stat.birthtimeMs;
      modified = stat.mtimeMs;
    } catch {
      // Missing on disk.
    }
    return {
      path,
      title: P.stem(path),
      isDirty: document.isDirty,
      saveError: document.saveError,
      hasConflict: document.conflict !== null,
      isMissing: document.isMissingOnDisk,
      lastSaved: document.lastSaved?.getTime() ?? null,
      lastSyncEvent: document.lastSyncEvent ? { kind: document.lastSyncEvent.kind, date: document.lastSyncEvent.date.getTime() } : null,
      created,
      modified,
    };
  }

  private conflictView(path: string, document: NoteDocument): ConflictView {
    const conflict = document.conflict!;
    return {
      path,
      fileName: P.basename(path),
      mine: document.text,
      theirs: conflict.diskText,
      canMerge: conflict.merge.mergedText !== null,
    };
  }
}

// MARK: - Helpers

async function defaultTrash(): Promise<null> {
  throw new Error("No trash is configured.");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A quick capture as a markdown bullet with the local time: "- 14:32 first
 * line", later lines indented two spaces so they stay part of the item
 * (blank lines inside are kept, empty). Leading/trailing blank lines and
 * trailing spaces are dropped; null if nothing is left. Lines are joined
 * with "\n" (`appendEntry` converts to the note's line endings).
 */
export function formatCapture(text: string, date: Date): string | null {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return [`- ${time} ${lines[0].trimStart()}`, ...lines.slice(1).map((line) => (line === "" ? "" : `  ${line}`))].join("\n");
}

/**
 * `existing` with `entry` added as a new block at the end: after a line
 * break and one blank line (an empty note gets just the entry), ending in a
 * line break. Nothing already in the note changes. The note's line endings
 * are kept: if its first line break is CRLF, the entry uses CRLF too.
 */
export function appendEntry(existing: string, entry: string): string {
  const firstBreak = existing.indexOf("\n");
  const eol = firstBreak > 0 && existing[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  const block = entry.split("\n").join(eol) + eol;
  const body = existing.replace(/^﻿/, ""); // a byte-order mark alone counts as empty
  if (body === "") return existing + block;
  let text = existing;
  if (!text.endsWith("\n")) text += eol;
  if (body.trim() !== "") {
    // Separate it from the text above with one blank line, unless there already is one.
    const lines = text.split("\n");
    if (lines[lines.length - 2].trim() !== "") text += eol;
  }
  return text + block;
}

/**
 * The inbox setting as a vault path: "/" or "\" separated, ".md" added when
 * there's no note extension, characters Windows forbids replaced by "-".
 * Null when empty or when it would climb out of the vault or into a hidden
 * folder.
 */
export function inboxNotePath(setting: string): string | null {
  const parts = setting.trim().split(/[\\/]+/).map((part) => part.trim()).filter((part) => part !== "" && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part.startsWith("."))) return null;
  const cleaned = parts.map((part) => part.replace(/[:<>"|?*]/g, "-"));
  const name = cleaned[cleaned.length - 1];
  cleaned[cleaned.length - 1] = P.isNote(name) ? name : `${name}.md`;
  return cleaned.join("/");
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Windows reserves these device names, with or without an extension. */
export function isReservedWindowsName(name: string): boolean {
  return RESERVED.test(name.trim());
}

/** The part of a link after the note: "Heading", "Parent#Child" or "^id". */
export function linkFragment(target: string): string | null {
  const index = target.search(/[#^]/);
  if (index < 0) return null;
  let fragment = target.slice(index).trim();
  if (fragment.startsWith("#")) fragment = fragment.slice(1);
  return fragment || null;
}

/**
 * The 1-based line of a heading (matched like Obsidian: case-insensitive,
 * formatting ignored; "A#B" means heading B) or a block id ("^id").
 */
export function lineOfFragment(fragment: string, text: string): number | null {
  if (fragment.startsWith("^")) {
    const id = fragment.slice(1);
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const trimmed = lines[index].replace(/\r$/, "").trim();
      if (trimmed === "^" + id) {
        // An id on its own line names the block above it.
        let above = index - 1;
        while (above > 0 && lines[above].trim() === "") above--;
        return Math.max(above, 0) + 1;
      }
      if (trimmed.endsWith(" ^" + id)) return index + 1;
    }
    return null;
  }
  const parts = fragment.split("#");
  const wanted = parts[parts.length - 1].trim().toLowerCase();
  return parseNote(text).headings.find((heading) => heading.text.toLowerCase() === wanted)?.line ?? null;
}

/**
 * How to write a wikilink to `newTarget`, keeping the original's style: a
 * bare name when that's unambiguous, otherwise the vault path; with the
 * extension only if the original had one.
 */
function wikiTarget(newTarget: string, original: string, resolver: LinkResolver): string {
  const keepsExtension = P.isNote(original.trim().toLowerCase());
  const path = keepsExtension ? newTarget : P.withoutExtension(newTarget);
  const name = P.basename(path);
  if (original.includes("/")) return path;
  return resolver.resolveWiki(name) === newTarget ? name : path;
}

/** Folders and notes (folders first, Finder order), plus every attachment's path. Hidden entries skipped. */
export function scanVault(root: string): { tree: TreeNode[]; notes: string[]; attachments: string[] } {
  const notes: string[] = [];
  const attachments: string[] = [];

  function walk(folder: string, prefix: string): TreeNode[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = nodePath.join(folder, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(full);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue; // broken link
        }
      }
      if (isDir) {
        const children = walk(full, path);
        nodes.push({ path, name: entry.name, isDir: true, children, noteCount: children.reduce((sum, child) => sum + child.noteCount, 0) });
      } else if (isFile && P.isNote(entry.name)) {
        nodes.push({ path, name: P.stem(entry.name), isDir: false, noteCount: 1 });
      } else if (isFile) {
        attachments.push(path);
      }
    }
    nodes.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : P.naturalCompare(P.basename(a.path), P.basename(b.path))));
    return nodes;
  }

  const tree = walk(root, "");
  const flatten = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.isDir) flatten(node.children ?? []);
      else notes.push(node.path);
    }
  };
  flatten(tree);
  attachments.sort(P.naturalCompare);
  return { tree, notes, attachments };
}
