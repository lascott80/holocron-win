// A folder of markdown notes opened in Holocron. The folder on disk is the
// only source of truth; Holocron keeps no database alongside it.
// (Port of Vault.swift — tabs, documents, file operations, links, daily
// notes, templates, auto-titles. iCloud handling is left out: on Windows the
// vault is a plain local folder.)

import fs from "node:fs";
import nodePath from "node:path";
import os from "node:os";
import * as P from "@core/paths";
import { LinkResolver, parse as parseNote, toggleTaskLine } from "@core/noteParser";
import { rewrite as rewriteLinks, relativePath as relativeLinkPath } from "@core/linkRewriter";
import * as Attachments from "@core/attachments";
import {
  attachmentUsage,
  attachmentsOnlyUsedBy,
  brokenLinks,
  noteAttachmentFolder,
  planHolding,
  planOrganise,
  rewriteAttachmentLinks,
  unusedAttachments,
  UNUSED_FOLDER,
  type AttachmentMove,
  type AttachmentUsage,
  type NoteChange,
} from "@core/attachmentUsage";
import { VaultIndex } from "@core/vaultIndex";
import { dailyNoteDate, dailyNotePath, renderPlaceholders } from "@core/dailyNotes";
import { INVALID_REGEX_MESSAGE, parseQuery, replaceMatches, runSearch, type Replacement } from "@core/vaultSearch";
import { noteText, renderTemplate } from "@core/templates";
import { isPlaceholderName, titleFromContent } from "@core/autoTitle";
import type { Settings } from "@shared/settings";
import type {
  AttachmentCleanupItem,
  AttachmentConfirmView,
  AttachmentOrganiseView,
  ConflictView,
  DocView,
  NoteDetails,
  TabView,
  ToastView,
  TreeNode,
  VaultView,
} from "@shared/ipc";
import * as fsx from "./fsx";
import { isServableAsset } from "./assets";
import { EditorTab } from "./editorTab";
import { IndexCache } from "./indexCache";
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
  /** Folder for the on-disk index cache (none: every note is read on open). */
  indexCacheFolder?: string;
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

/** One change in `.holocron/attachment-log.json` (REQUIREMENTS VLT-23). */
export interface AttachmentLogEntry {
  id: string;
  /** ISO time it was made. */
  date: string;
  kind: "organise" | "cleanup" | "delete";
  /** What the toast said, e.g. "Organised 12 attachments". */
  summary: string;
  moves: AttachmentMove[];
  undone?: boolean;
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
  /** Bookmarked note and folder paths, in the user's order (UI-14a). */
  bookmarks: string[];
  selection: string | null = null;
  renaming: string | null = null;
  pendingDeletion: string[] | null = null;
  /** Attachments only the pending items use; worked out after `requestDeletion`. */
  pendingDeletionAttachments: string[] = [];
  attachmentCleanup: AttachmentCleanupItem[] | null = null;
  attachmentOrganise: AttachmentOrganiseView | null = null;
  /** Empty Unused Attachments… or Undo Last Attachment Change…, waiting for confirmation. */
  pendingAttachmentAction: { view: AttachmentConfirmView; run: () => Promise<void> } | null = null;
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
  /** Last session's note texts, so opening doesn't read every file again. */
  readonly indexCache: IndexCache | null;

  constructor(root: string, options: VaultOptions) {
    this.root = nodePath.resolve(root);
    this.options = options;
    this.editor = options.editor ?? nullEditor;
    this.recentNotes = options.store.get<string[]>(this.recentNotesKey) ?? [];
    this.bookmarks = (options.store.get<string[]>(this.bookmarksKey) ?? []).filter((path) => typeof path === "string" && path !== "");
    this.indexCache = options.indexCacheFolder ? new IndexCache(options.indexCacheFolder, this.root) : null;
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
    this.indexCache?.flush();
    this.indexCache?.dispose();
  }

  // MARK: Scanning

  /**
   * Rescans the folder. Only touches observed state when something changed,
   * so frequent rescans don't churn the sidebar. Re-reads `changedPaths`
   * into the index even if the tree's shape didn't change.
   */
  reload(changedPaths: Iterable<string> = []) {
    const sort = this.settings.fileSort;
    const scan = scanVault(this.root, sort === "modified" || sort === "created");
    this.attachments = scan.attachments;
    const changed = new Set(changedPaths);
    const treeChanged = !sameTree(scan.tree, this.tree);
    if (treeChanged) {
      this.tree = scan.tree;
      this.noteCount = scan.notes.length;
      this.allNotes = scan.notes;
      this.resolver = new LinkResolver(scan.notes);
      const before = this.recentNotes.length;
      this.recentNotes = this.recentNotes.filter((path) => fsx.exists(this.abs(path)));
      if (this.recentNotes.length !== before) this.options.store.set(this.recentNotesKey, this.recentNotes);
      const bookmarksBefore = this.bookmarks.length;
      this.bookmarks = this.bookmarks.filter((path) => fsx.exists(this.abs(path)));
      if (this.bookmarks.length !== bookmarksBefore) this.options.store.set(this.bookmarksKey, this.bookmarks.length ? this.bookmarks : undefined);
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
    this.indexCache?.keepOnly(present);
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
          const file = this.abs(path);
          // Notes the watcher reported changed are always re-read; the
          // cache only stands in for a note not indexed yet whose file is
          // unchanged since it was cached.
          if (!reread.has(path)) {
            const cached = this.indexCache?.textIfCurrent(path, file);
            if (cached !== null && cached !== undefined) return cached;
          }
          try {
            const text = fsx.readText(file);
            this.indexCache?.remember(path, file, text);
            return text;
          } catch {
            this.indexCache?.forget(path);
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

  // MARK: Tasks (TSK-03)

  /**
   * Toggles the checklist item on a line of a note from the Tasks view: an
   * open note changes through its document (the editor follows), others are
   * rewritten atomically. The index is updated at once so the view follows.
   */
  toggleTask(path: string, line: number) {
    if (!this.index.hasPath(path)) return;
    const text = this.textFor(path);
    if (text === null) return;
    const toggled = toggleTaskLine(text, line);
    if (toggled === null || toggled === text) return;
    this.writeUpdatedLinks(path, toggled);
    this.indexRevision++;
    this.changed();
  }

  // MARK: Bookmarks (UI-14a)

  private get bookmarksKey() {
    return "bookmarks:" + this.root;
  }

  isBookmarked(path: string): boolean {
    return this.bookmarks.includes(path);
  }

  /** Adds a note or folder to the vault's bookmarks, or removes it. */
  toggleBookmark(path: string) {
    if (path === "" || (!this.isBookmarked(path) && !fsx.exists(this.abs(path)))) return;
    this.bookmarks = this.isBookmarked(path) ? this.bookmarks.filter((item) => item !== path) : [...this.bookmarks, path];
    this.options.store.set(this.bookmarksKey, this.bookmarks.length ? this.bookmarks : undefined);
    this.changed();
  }

  /** Puts a bookmark where `target` is now (drag to reorder). */
  moveBookmark(path: string, target: string) {
    const from = this.bookmarks.indexOf(path);
    const to = this.bookmarks.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...this.bookmarks];
    next.splice(from, 1);
    next.splice(to, 0, path);
    this.bookmarks = next;
    this.options.store.set(this.bookmarksKey, next);
    this.changed();
  }

  // MARK: Search and replace

  /**
   * Replaces every match of a search query across the vault (or in one note
   * when `onlyPath` is given), SRCH-10. Open notes change through their
   * document (unsaved edits kept, the editor updated in place); others are
   * read fresh from disk and rewritten atomically. Shows a toast with Undo,
   * which puts the previous text back in notes that haven't changed since.
   */
  replaceInNotes(input: string, replacement: string, matchCase: boolean, useRegex: boolean, onlyPath: string | null = null): { notes: number; matches: number } {
    const query = parseQuery(input, { matchCase, useRegex });
    let candidates: string[];
    if (onlyPath) {
      candidates = [onlyPath];
    } else {
      const outcome = runSearch(query, this.index.searchSnapshot(), Infinity, 0);
      if (outcome.error) {
        this.showError(outcome.error);
        return { notes: 0, matches: 0 };
      }
      candidates = outcome.hits.map((hit) => hit.path);
    }
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    let matches = 0;
    for (const path of candidates) {
      if (!this.index.hasPath(path)) continue;
      const text = this.textFor(path);
      if (text === null) continue;
      let result: Replacement;
      try {
        result = replaceMatches(text, query, replacement);
      } catch {
        this.showError(INVALID_REGEX_MESSAGE);
        return { notes: 0, matches: 0 };
      }
      if (result.count === 0 || result.text === text) continue;
      before.set(path, text);
      after.set(path, result.text);
      matches += result.count;
    }
    if (after.size === 0) {
      this.showToast("Nothing to replace");
      return { notes: 0, matches: 0 };
    }
    for (const [path, text] of after) this.writeUpdatedLinks(path, text);
    this.reload([...after.keys()]);
    const notes = after.size;
    this.showToast(`Replaced ${(matches === 1 ? "1 match" : `${matches} matches`)} in ${plural(notes, "note")}`, () => {
      let restored = 0;
      for (const [path, text] of before) {
        // Only undo notes still showing the replacement; later edits win.
        if (this.index.hasPath(path) && this.textFor(path) === after.get(path)) {
          if (this.writeUpdatedLinks(path, text)) restored++;
        }
      }
      this.reload([...before.keys()]);
      if (restored < notes) this.showToast(`Restored ${plural(restored, "note")}; ${notes - restored === 1 ? "1 note has" : `${notes - restored} notes have`} changed since`, null, "Undo", true);
    });
    return { notes, matches };
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
    // A pinned tab keeps its note: anything else opens beside it (TAB-12).
    const reuse = index !== null && (!inNewTab || this.tabs[index].path === null) && !this.tabs[index].pinned;
    if (reuse) {
      this.document?.save();
      this.tabs[index].navigate(path);
    } else {
      const tab = new EditorTab(path);
      this.tabs.splice(this.insertionIndex(index), 0, tab);
      this.activeTabId = tab.id;
    }
    this.didChangeTabs();
  }

  /** Where a new tab goes: after the active one, but never among the pinned tabs. */
  private insertionIndex(active: number | null): number {
    const firstUnpinned = this.tabs.findIndex((tab) => !tab.pinned);
    const afterPinned = firstUnpinned < 0 ? this.tabs.length : firstUnpinned;
    if (active === null) return this.tabs.length;
    return Math.max(active + 1, afterPinned);
  }

  /** Opens an empty tab after the active one. */
  newTab() {
    const tab = new EditorTab();
    const index = this.activeIndex;
    this.tabs.splice(this.insertionIndex(index), 0, tab);
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

  /**
   * Closes a tab. A pinned tab stays unless `force` (its note was deleted,
   * the vault is closing): Ctrl+W and the close button just beep (TAB-12).
   */
  closeTab(id: string, force = false) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (this.tabs[index].pinned && !force) {
      this.options.ui?.({ type: "beep" });
      return;
    }
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

  /** Closes every other tab except pinned ones. */
  closeOtherTabs(id: string) {
    this.tabs = this.tabs.filter((tab) => tab.id === id || tab.pinned);
    this.activateTab(id);
  }

  /** Closes the tabs after this one, except pinned ones. */
  closeTabsToTheRight(id: string) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const closing = new Set(
      this.tabs
        .slice(index + 1)
        .filter((tab) => !tab.pinned)
        .map((tab) => tab.id),
    );
    this.tabs = this.tabs.filter((tab) => !closing.has(tab.id));
    if (this.activeTabId && closing.has(this.activeTabId)) this.activateTab(id);
    else this.didChangeTabs();
  }

  /** Pins or unpins a tab: pinned tabs gather at the left, in the order they were pinned (TAB-12). */
  togglePinTab(id: string) {
    const tab = this.tabs.find((tab) => tab.id === id);
    if (!tab || tab.path === null) return;
    tab.pinned = !tab.pinned;
    this.tabs = [...this.tabs.filter((tab) => tab.pinned), ...this.tabs.filter((tab) => !tab.pinned)];
    this.didChangeTabs();
  }

  /** Closes every tab showing `path` (e.g. after the file was deleted). */
  closeTabsShowing(path: string) {
    for (const tab of this.tabs.filter((tab) => tab.path === path)) this.closeTab(tab.id, true);
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
    // Pinned tabs stay together at the left whatever was dragged where.
    this.tabs = [...this.tabs.filter((tab) => tab.pinned), ...this.tabs.filter((tab) => !tab.pinned)];
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
    const withPaths = this.tabs.filter((tab) => tab.path !== null);
    this.options.store.set(this.tabsKey, withPaths.map((tab) => tab.path));
    this.options.store.set(this.tabsKey + ":active", this.activeIndex ?? 0);
    // Pinned tabs are always the leftmost ones, so their number is enough.
    this.options.store.set(this.tabsKey + ":pinned", withPaths.filter((tab) => tab.pinned).length || undefined);
  }

  /** Reopens the tabs that were open when this vault was last closed. */
  private restoreTabs() {
    const stored = (this.options.store.get<string[]>(this.tabsKey) ?? []).filter((path) => typeof path === "string" && P.isNote(path));
    let pinnedCount = Math.max(0, Math.min(this.options.store.get<number>(this.tabsKey + ":pinned") ?? 0, stored.length));
    const paths: { path: string; pinned: boolean }[] = [];
    stored.forEach((path, index) => {
      if (fsx.exists(this.abs(path))) paths.push({ path, pinned: index < pinnedCount });
    });
    if (!paths.length) return;
    this.tabs = paths.map(({ path, pinned }) => new EditorTab(path, pinned));
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
      this.pendingDeletionAttachments = [];
      this.changed();
      void this.findAttachmentsGoingWith(items);
    }
  }

  /**
   * Fills in `pendingDeletionAttachments`: files that only the notes in
   * `items` use and no other note mentions. None if any note can't be read.
   */
  private async findAttachmentsGoingWith(items: string[]) {
    await this.indexingFinished();
    if (this.pendingDeletion !== items) return;
    const { texts, unreadable } = this.readAllNotes();
    if (unreadable.length) return;
    const usage = attachmentUsage(texts, this.attachments);
    const going = (path: string) => items.some((item) => P.isUnder(path, item));
    const attachments = attachmentsOnlyUsedBy(usage, going).filter((path) => !going(path) && !P.isUnder(path, this.holdingFolder));
    if (!attachments.length) return;
    this.pendingDeletionAttachments = attachments;
    this.changed();
  }

  cancelDeletion() {
    this.pendingDeletion = null;
    this.pendingDeletionAttachments = [];
    this.changed();
  }

  /**
   * Deletes the pending items and, when `withAttachments`, moves the
   * attachments only they use to the unused folder (FOP-10a). One Undo
   * restores both.
   */
  async confirmDeletion(withAttachments = false) {
    const paths = this.pendingDeletion;
    if (!paths) return;
    const attachments = withAttachments ? this.pendingDeletionAttachments.filter((path) => fsx.exists(this.abs(path))) : [];
    this.pendingDeletion = null;
    this.pendingDeletionAttachments = [];
    if (!attachments.length) {
      await this.delete(paths);
      return;
    }
    const trashed = await this.delete(paths, false);
    const restorable = trashed.length > 0 && trashed.every((item) => item.restore !== null);
    const restoreNotes = () => this.restoreFromTrash(trashed);
    if (trashed.length < paths.length) {
      // Some items stayed; so do their attachments.
      if (trashed.length) this.showToast(`Moved ${this.describe(trashed.map((item) => item.path))} to the Recycle Bin`, restorable ? restoreNotes : null);
      return;
    }
    const moves = this.planHolding(attachments);
    if (this.moveAttachments(moves) === null) {
      this.showToast(`Moved ${this.describe(paths)} to the Recycle Bin; its attachments stayed`, restorable ? restoreNotes : null);
      return;
    }
    const summary = `Moved ${this.describe(paths)} to the Recycle Bin and ${plural(attachments.length, "attachment")} to ${this.holdingFolder}`;
    const id = this.logAttachmentChange("delete", summary, moves);
    this.showToast(summary, () => {
      this.undoAttachmentChange(id);
      if (restorable) restoreNotes();
      else this.reload();
    });
  }

  /**
   * Moves items to the Recycle Bin and closes their tabs. Unsaved edits in
   * those notes are discarded with them (the documents are dropped first,
   * so closing their tabs can't save them back).
   */
  async delete(paths: string[], announce = true, description?: string): Promise<{ path: string; restore: (() => void) | null }[]> {
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
    if (!announce || !trashed.length) return trashed;
    const restorable = trashed.every((item) => item.restore !== null);
    this.showToast(
      `Moved ${trashed.length === paths.length && description ? description : this.describe(trashed.map((item) => item.path))} to the Recycle Bin`,
      restorable ? () => this.restoreFromTrash(trashed) : null,
    );
    return trashed;
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
    const noteRewrites = updatesLinks && mapping.size ? this.planLinkRewrites(mapping) : new Map<string, string>();
    // The note's (or folder's) attachment folder moves with it, links and all.
    const plan = updatesLinks && mapping.size ? this.planMoveAttachments(source, destination, mapping, movesTo, noteRewrites) : null;
    const folderMove = plan?.folderMove ?? null;
    let rewrites = plan?.rewrites ?? noteRewrites;

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
    if (folderMove) {
      try {
        this.moveFolderOnDisk(folderMove.from, folderMove.to);
        this.removeEmptyAttachmentFolders([folderMove.from], false);
      } catch (error) {
        // The note moved; its attachments didn't, so only note links change.
        rewrites = noteRewrites;
        this.showError(`Couldn’t move the attachments in “${folderMove.from}”: ${message(error)}`);
      }
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
    this.bookmarks = this.bookmarks.map(remap);
    this.options.store.set(this.bookmarksKey, this.bookmarks.length ? this.bookmarks : undefined);
    this.options.store.set(this.recentNotesKey, this.recentNotes);

    // Rewrite links in other notes.
    for (const [path, text] of rewrites) this.writeUpdatedLinks(path, text);

    this.reload([...rewrites.keys(), ...mapping.values()]);
    this.saveTabs();
    this.changed();
    return destination;
  }

  /** Writes a note whose links were updated, to its open document or to disk. */
  private writeUpdatedLinks(path: string, text: string): boolean {
    const document = this.documents.get(path);
    if (document) document.replaceContents(text);
    else {
      try {
        fsx.writeAtomic(this.abs(path), text);
      } catch (error) {
        this.showError(`Couldn’t update links in “${P.stem(path)}”: ${message(error)}`);
        return false;
      }
    }
    // Keep the index's links current right away: the next move (an Undo
    // straight after this one) filters notes by them before the
    // background re-read has caught up.
    if (this.index.hasPath(path)) this.index.update(path, text);
    return true;
  }

  /** Moves a folder, creating the destination's parents. */
  private moveFolderOnDisk(from: string, to: string) {
    fsx.mkdirp(nodePath.dirname(this.abs(to)));
    fsx.move(this.abs(from), this.abs(to));
  }

  /**
   * With one folder per note, the attachment folder that moves along with
   * moving `source` to `destination`: "Attachments/Lore/Kyber" for the note
   * "Lore/Kyber.md", "Attachments/Lore" for the folder "Lore". Null when
   * there's nothing to move, or its new place is taken (with a warning).
   */
  private attachmentFolderMove(source: string, destination: string): AttachmentMove | null {
    if (this.settings.attachmentLayout !== "perNote") return null;
    const root = this.attachmentFolder;
    if (root !== "" && P.isUnder(source, root)) return null; // moving within the attachment folder itself
    const isFolder = !P.isNote(source);
    if (isFolder && (root === "" || P.isUnder(root, source))) return null; // it moves along anyway
    const counterpart = (path: string) => (isFolder ? P.join(root, path) : noteAttachmentFolder(root, path));
    const from = counterpart(source);
    const to = counterpart(destination);
    if (from === to || !fsx.isDirectory(this.abs(from))) return null;
    if (from.toLowerCase() !== to.toLowerCase() && fsx.exists(this.abs(to))) {
      this.showError(`The attachments stayed in “${from}” because “${to}” already exists.`);
      return null;
    }
    return { from, to };
  }

  /**
   * Plans the attachment side of moving `source`: whether its attachment
   * folder moves too, and every note's new text (`noteRewrites` plus updated
   * attachment links). The folder stays put (with an alert saying why) if a
   * note can't be read, a note mentions one of its files in a way Holocron
   * can't update, or a dry run shows a link would stop reaching its file.
   */
  private planMoveAttachments(
    source: string,
    destination: string,
    mapping: Map<string, string>,
    movesTo: (path: string) => string | null,
    noteRewrites: Map<string, string>,
  ): { folderMove: AttachmentMove | null; rewrites: Map<string, string> } {
    let folderMove = this.attachmentFolderMove(source, destination);
    // Unless attachments move too, only links in the moving notes can change.
    const filesMove = folderMove !== null || this.attachments.some((path) => movesTo(path) !== null);
    const { texts, unreadable } = filesMove ? this.readAllNotes() : this.readNotes(mapping.keys());
    if (folderMove && unreadable.length) {
      this.showError(`The attachments stayed in “${folderMove.from}”: ${this.unreadableMessage(unreadable)}`);
      folderMove = null;
    }
    if (folderMove) {
      const inFolder = this.attachments.filter((path) => P.isUnder(path, folderMove!.from));
      const usage = attachmentUsage(texts, inFolder);
      const mentioned = inFolder.find((path) => usage.mentions.get(path)!.size > 0);
      if (mentioned) {
        const note = [...usage.mentions.get(mentioned)!][0]!;
        this.showError(
          `The attachments stayed in “${folderMove.from}” because “${P.stem(note)}” mentions “${P.basename(mentioned)}” in a way Holocron can’t update.`,
        );
        folderMove = null;
      }
    }
    const attempt = (folder: AttachmentMove | null) => {
      // Attachments inside a moving folder move too.
      const moves = new Map<string, string>();
      for (const path of this.attachments) {
        const moved = movesTo(path) ?? (folder && P.isUnder(path, folder.from) ? folder.to + path.slice(folder.from.length) : null);
        if (moved !== null) moves.set(path, moved);
      }
      const before = new Attachments.AttachmentLookup(this.attachments);
      const after = moves.size ? new Attachments.AttachmentLookup(this.attachments.map((path) => moves.get(path) ?? path)) : before;
      const rewrites = new Map(noteRewrites);
      const changes: NoteChange[] = [];
      for (const [oldNote, original] of texts) {
        const newNote = mapping.get(oldNote) ?? oldNote;
        const text = noteRewrites.get(newNote) ?? original;
        const rewritten = moves.size || newNote !== oldNote ? rewriteAttachmentLinks(text, { oldNote, newNote, before, after, moves }) : text;
        if (rewritten !== text) rewrites.set(newNote, rewritten);
        changes.push({ oldNote, newNote, before: original, after: rewritten });
      }
      return { rewrites, broken: brokenLinks(changes, before, after, moves) };
    };
    let result = attempt(folderMove);
    if (folderMove && result.broken.length) {
      this.showError(`The attachments stayed in “${folderMove.from}”: moving them would break links in ${this.describeNotes(result.broken)}.`);
      folderMove = null;
      result = attempt(null);
    }
    // Only relative links in moved notes change now; never write a rewrite that fails the check.
    return { folderMove, rewrites: result.broken.length ? noteRewrites : result.rewrites };
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

  /** Where new attachments for a note go: its own subfolder, or the attachment folder itself. */
  attachmentFolderFor(notePath: string | null | undefined): string {
    const root = this.attachmentFolder;
    if (this.settings.attachmentLayout !== "perNote" || !notePath) return root;
    return noteAttachmentFolder(root, notePath);
  }

  /**
   * Saves pasted data as a new file in the shown note's attachment folder
   * and returns the text that embeds it.
   */
  saveAttachment(data: Uint8Array, fileName: string): string {
    const ext = P.extname(fileName) || "png";
    const base = P.stem(fileName) || "Attachment";
    const path = this.uniquePath(base, ext, this.attachmentFolderFor(this.activeTab?.path));
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
          path = this.uniquePath(base, ext, this.attachmentFolderFor(this.activeTab?.path));
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

  // MARK: Attachment housekeeping

  /**
   * A note's current text: unsaved edits first, then the disk (not the
   * index, which can lag a change made in another app). Null if unreadable.
   */
  private textFor(path: string): string | null {
    const live = this.documents.get(path)?.text;
    if (live !== undefined) return live;
    try {
      return fsx.readText(this.abs(path));
    } catch {
      return null;
    }
  }

  /** Every note's current text, and the notes that couldn't be read. */
  private readAllNotes(): { texts: Map<string, string>; unreadable: string[] } {
    return this.readNotes(this.allNotes);
  }

  private readNotes(paths: Iterable<string>): { texts: Map<string, string>; unreadable: string[] } {
    const texts = new Map<string, string>();
    const unreadable: string[] = [];
    for (const path of paths) {
      const text = this.textFor(path);
      if (text === null) unreadable.push(path);
      else texts.set(path, text);
    }
    return { texts, unreadable };
  }

  /**
   * Which notes use each attachment, once the index has caught up. Null
   * (after an alert) when a note can't be read: its links are unknown, so
   * nothing can safely be called unused or moved (VLT-17).
   */
  private async attachmentUsageNow(): Promise<{ usage: AttachmentUsage; texts: Map<string, string> } | null> {
    await this.indexingFinished();
    const { texts, unreadable } = this.readAllNotes();
    if (unreadable.length) {
      this.showError(this.unreadableMessage(unreadable));
      return null;
    }
    return { usage: attachmentUsage(texts, this.attachments), texts };
  }

  private unreadableMessage(unreadable: string[]): string {
    const them = unreadable.length === 1 ? "it’s" : "they’re";
    return `Holocron couldn’t read ${this.describeNotes(unreadable)}, so it can’t tell which attachments are in use. Check ${them} available offline and not locked by another app, then try again.`;
  }

  /** "“Kyber”", "“Kyber” and “Ilum”", "“Kyber”, “Ilum”, “Dagobah” and 4 more". */
  private describeNotes(paths: string[]): string {
    const names = paths.slice(0, 3).map((path) => `“${P.stem(path)}”`);
    if (paths.length > 3) return `${names.join(", ")} and ${paths.length - 3} more`;
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
  }

  /** Where unused attachments wait before they're deleted: "Attachments/_Unused". */
  private get holdingFolder(): string {
    return P.join(this.attachmentFolder, UNUSED_FOLDER);
  }

  private planHolding(paths: string[]): AttachmentMove[] {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return planHolding(paths, this.attachmentFolder, date, [...this.allNotes, ...this.attachments]);
  }

  /**
   * Removes folders inside the attachment folder left empty after `paths`
   * moved out, walking up but never removing the attachment folder itself.
   */
  private removeEmptyAttachmentFolders(paths: string[], reload = true) {
    const root = this.attachmentFolder;
    if (root === "") return; // the folders are the user's own
    const folders = new Set(paths.map((path) => P.dirname(path)));
    for (const path of paths) if (fsx.isDirectory(this.abs(path))) folders.add(path);
    for (let folder of [...folders].sort((a, b) => b.length - a.length)) {
      while (folder !== root && P.isUnder(folder, root) && fsx.removeIfEmpty(this.abs(folder))) folder = P.dirname(folder);
    }
    if (reload) this.reload();
  }

  /**
   * Moves attachment files and updates every note's links to them, as one
   * checked change (VLT-22): nothing happens unless every note can be read,
   * every source exists, every destination is free and a dry run shows every
   * link still reaching its file. If moving or writing fails part-way, or the
   * links don't check out on disk afterwards, everything is put back.
   * Returns the notes whose links changed, or null (after an alert) if
   * nothing was changed.
   */
  private moveAttachments(moves: AttachmentMove[]): string[] | null {
    if (!moves.length) return [];
    const { texts, unreadable } = this.readAllNotes();
    if (unreadable.length) {
      this.showError(`Nothing was moved. ${this.unreadableMessage(unreadable)}`);
      return null;
    }
    const destinations = new Set<string>();
    for (const move of moves) {
      const problem = !fsx.exists(this.abs(move.from))
        ? `“${move.from}” is no longer there.`
        : fsx.exists(this.abs(move.to)) || destinations.has(move.to.toLowerCase())
          ? `“${move.to}” already exists.`
          : null;
      if (problem) {
        this.showError(`Nothing was moved: ${problem}`);
        return null;
      }
      destinations.add(move.to.toLowerCase());
    }

    // Dry run: the new texts, and proof that every link still reaches its file.
    const mapping = new Map(moves.map((move) => [move.from, move.to]));
    const before = new Attachments.AttachmentLookup(this.attachments);
    const after = new Attachments.AttachmentLookup(this.attachments.map((path) => mapping.get(path) ?? path));
    const rewrites = new Map<string, string>();
    const planned: NoteChange[] = [];
    for (const [note, text] of texts) {
      const rewritten = rewriteAttachmentLinks(text, { oldNote: note, newNote: note, before, after, moves: mapping });
      if (rewritten !== text) rewrites.set(note, rewritten);
      planned.push({ oldNote: note, newNote: note, before: text, after: rewritten });
    }
    const broken = brokenLinks(planned, before, after, mapping);
    if (broken.length) {
      this.showError(`Nothing was moved: it would break links in ${this.describeNotes(broken)}.`);
      return null;
    }

    const moved: AttachmentMove[] = [];
    const written: string[] = [];
    const rollBack = () => {
      for (const path of written.reverse()) this.writeUpdatedLinks(path, texts.get(path)!);
      const stuck: string[] = [];
      for (const move of moved.reverse()) {
        try {
          this.moveFolderOnDisk(move.to, move.from);
        } catch {
          stuck.push(move.to);
        }
      }
      this.removeEmptyAttachmentFolders(moves.map((move) => move.to), false);
      this.reload(texts.keys());
      return stuck.length ? ` These couldn’t be put back: ${stuck.map((path) => `“${path}”`).join(", ")}.` : "";
    };

    for (const move of moves) {
      try {
        this.moveFolderOnDisk(move.from, move.to);
        moved.push(move);
      } catch (error) {
        const stuck = rollBack();
        this.showError(`Nothing was moved: couldn’t move “${move.from}”: ${message(error)}.${stuck}`);
        return null;
      }
    }
    for (const [path, text] of rewrites) {
      if (!this.writeUpdatedLinks(path, text)) {
        const stuck = rollBack();
        this.showError(`Nothing was moved: couldn’t update the links in “${P.stem(path)}”.${stuck}`);
        return null;
      }
      written.push(path);
    }

    // Check the result as it now is on disk.
    this.reload(rewrites.keys());
    const onDisk = new Attachments.AttachmentLookup(this.attachments);
    const now = this.readAllNotes().texts;
    const actual = brokenLinks(
      [...texts].map(([note, text]) => ({ oldNote: note, newNote: note, before: text, after: now.get(note) ?? "" })),
      before,
      onDisk,
      mapping,
    );
    if (actual.length) {
      const stuck = rollBack();
      this.showError(`The change was undone: afterwards, links in ${this.describeNotes(actual)} didn’t reach their files.${stuck}`);
      return null;
    }
    this.removeEmptyAttachmentFolders(moves.map((move) => move.from), false);
    this.reload();
    this.changed();
    return [...rewrites.keys()];
  }

  // MARK: Attachment log

  private get logFile(): string {
    return nodePath.join(this.root, ".holocron", "attachment-log.json");
  }

  /** Attachment changes made by Organise, Clean Up and delete-with-note, oldest first (VLT-23). */
  attachmentLog(): AttachmentLogEntry[] {
    try {
      const data = JSON.parse(fsx.readText(this.logFile)) as { entries?: unknown };
      return Array.isArray(data.entries) ? (data.entries as AttachmentLogEntry[]).filter((entry) => Array.isArray(entry?.moves)) : [];
    } catch {
      return [];
    }
  }

  private writeAttachmentLog(entries: AttachmentLogEntry[]) {
    try {
      fsx.writeAtomic(this.logFile, JSON.stringify({ version: 1, entries: entries.slice(-50) }, null, 2) + "\n");
    } catch (error) {
      this.showError(`The change was made, but Holocron couldn’t record it for Undo Last Attachment Change: ${message(error)}`);
    }
  }

  /** Records a change for File › Undo Last Attachment Change…; returns its id. */
  private logAttachmentChange(kind: AttachmentLogEntry["kind"], summary: string, moves: AttachmentMove[]): string {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.writeAttachmentLog([...this.attachmentLog(), { id, date: new Date().toISOString(), kind, summary, moves }]);
    return id;
  }

  /** Moves a logged change's files back (updating links again, so later edits survive). */
  private undoAttachmentChange(id: string): boolean {
    const entries = this.attachmentLog();
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || entry.undone) return false;
    const changed = this.moveAttachments([...entry.moves].reverse().map((move) => ({ from: move.to, to: move.from })));
    if (changed === null) return false;
    entry.undone = true;
    this.writeAttachmentLog(entries);
    return true;
  }

  // MARK: Clean up, organise, empty, undo

  /** Lists unused files in the attachment folder for review (see `attachmentCleanup`). */
  async requestAttachmentCleanup() {
    const result = await this.attachmentUsageNow();
    if (!result) return;
    const { usage } = result;
    const root = this.attachmentFolder;
    const unused = unusedAttachments(usage).filter((path) => P.isUnder(path, root) && !P.isUnder(path, this.holdingFolder));
    if (!unused.length) {
      this.showToast("No unused attachments");
      return;
    }
    this.attachmentCleanup = unused.map((path) => {
      let size = 0;
      try {
        size = fs.statSync(this.abs(path)).size;
      } catch {
        // Gone already; it's skipped when moving.
      }
      return { path, size, isImage: P.isImage(path), mentionedIn: [...usage.mentions.get(path)!].sort() };
    });
    this.changed();
  }

  cancelAttachmentCleanup() {
    this.attachmentCleanup = null;
    this.changed();
  }

  /** Moves the chosen files (only ones that were offered) to the unused folder, with Undo. */
  async confirmAttachmentCleanup(paths: string[]) {
    const offered = new Set(this.attachmentCleanup?.map((item) => item.path) ?? []);
    this.attachmentCleanup = null;
    const chosen = paths.filter((path) => offered.has(path) && fsx.exists(this.abs(path)));
    if (!chosen.length) {
      this.changed();
      return;
    }
    const moves = this.planHolding(chosen);
    if (this.moveAttachments(moves) === null) return;
    const summary = `Moved ${plural(chosen.length, "unused attachment")} to ${this.holdingFolder}`;
    const id = this.logAttachmentChange("cleanup", summary, moves);
    this.showToast(summary, () => this.undoFromToast(id));
  }

  /** Works out how Organise Attachments… would sort the files (see `attachmentOrganise`); `onlyNote` limits it to one note's files. */
  async requestAttachmentOrganise(onlyNote: string | null = null) {
    const result = await this.attachmentUsageNow();
    if (!result) return;
    const { usage, texts } = result;
    const plan = planOrganise(usage, this.attachmentFolder, [...this.allNotes, ...this.attachments], onlyNote);
    if (!plan.moves.length && !plan.skipped.length) {
      this.showToast(onlyNote ? `“${P.stem(onlyNote)}”’s attachments are already organised` : "Attachments are already organised");
      return;
    }
    const mapping = new Map(plan.moves.map((move) => [move.from, move.to]));
    const before = new Attachments.AttachmentLookup(this.attachments);
    const after = new Attachments.AttachmentLookup(this.attachments.map((path) => mapping.get(path) ?? path));
    let notesChanged = 0;
    for (const [note, text] of texts) {
      if (rewriteAttachmentLinks(text, { oldNote: note, newNote: note, before, after, moves: mapping }) !== text) notesChanged++;
    }
    this.attachmentOrganise = { moves: plan.moves, skipped: plan.skipped, notesChanged, scope: onlyNote };
    this.changed();
  }

  cancelAttachmentOrganise() {
    this.attachmentOrganise = null;
    this.changed();
  }

  /** Makes the chosen moves (by source path; all when omitted) from the pending plan, with Undo. */
  async confirmAttachmentOrganise(sources?: string[]) {
    const plan = this.attachmentOrganise;
    if (!plan) return;
    this.attachmentOrganise = null;
    const wanted = sources ? new Set(sources) : null;
    const moves = plan.moves.filter((move) => !wanted || wanted.has(move.from));
    if (!moves.length) {
      this.changed();
      return;
    }
    if (this.moveAttachments(moves) === null) return;
    const summary = `Organised ${plural(moves.length, "attachment")}`;
    const id = this.logAttachmentChange("organise", summary, moves);
    this.showToast(summary, () => this.undoFromToast(id));
  }

  private undoFromToast(id: string) {
    if (this.undoAttachmentChange(id)) this.reload();
  }

  /** Asks before sending the unused folder's files to the Recycle Bin (see `attachmentConfirm`). */
  async requestEmptyUnused() {
    const holding = this.holdingFolder;
    const files = this.attachments.filter((path) => P.isUnder(path, holding));
    if (!files.length) {
      this.showToast(`“${holding}” is empty`);
      return;
    }
    const result = await this.attachmentUsageNow();
    if (!result) return;
    // A file a note links to again stays (Organise moves it back out).
    const reused = files.filter((path) => result.usage.users.get(path)!.size > 0);
    const going = files.filter((path) => !reused.includes(path));
    if (!going.length) {
      this.showToast(`Notes use every file in “${holding}” again; Organise Attachments… moves them back`);
      return;
    }
    let size = 0;
    for (const path of going) {
      try {
        size += fs.statSync(this.abs(path)).size;
      } catch {
        // Gone already.
      }
    }
    const kept = reused.length ? ` ${plural(reused.length, "file")} that notes use again will stay.` : "";
    this.pendingAttachmentAction = {
      view: {
        title: `Empty “${holding}”?`,
        message: `Moves ${plural(going.length, "file")} (${formatBytes(size)}) to the Recycle Bin.${kept} On a drive without a Recycle Bin, Windows may delete them permanently.`,
        confirmLabel: "Move to Recycle Bin",
        danger: true,
      },
      run: async () => {
        const all = going.length === files.length;
        await this.delete(all ? [holding] : going, true, all ? `the contents of “${holding}”` : plural(going.length, "unused attachment"));
        if (!all) this.removeEmptyAttachmentFolders(going);
      },
    };
    this.changed();
  }

  /** Asks before undoing the most recent logged attachment change (see `attachmentConfirm`). */
  requestAttachmentUndo() {
    const entry = [...this.attachmentLog()].reverse().find((candidate) => !candidate.undone);
    if (!entry) {
      this.showToast("No attachment changes to undo");
      return;
    }
    const when = new Date(entry.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const notes = entry.kind === "delete" ? " The deleted notes stay in the Recycle Bin." : "";
    this.pendingAttachmentAction = {
      view: {
        title: "Undo Last Attachment Change?",
        message: `${entry.summary} (${when}). Holocron will move ${plural(entry.moves.length, "file")} back and update links to them.${notes}`,
        confirmLabel: "Undo",
        danger: false,
      },
      run: async () => {
        if (this.undoAttachmentChange(entry.id)) this.showToast(`Undid: ${entry.summary}`);
      },
    };
    this.changed();
  }

  cancelAttachmentAction() {
    this.pendingAttachmentAction = null;
    this.changed();
  }

  async confirmAttachmentAction() {
    const action = this.pendingAttachmentAction;
    this.pendingAttachmentAction = null;
    this.changed();
    await action?.run();
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

  /** The days of a month (1-based) that have a daily note, with their paths, for the calendar (DAY-07). `month` is 0-based. */
  dailyNotesInMonth(year: number, month: number): { day: number; path: string }[] {
    const settings = this.dailyNoteSettings;
    const result: { day: number; path: string }[] = [];
    for (const path of this.allNotes) {
      const date = dailyNoteDate(path, settings.folder, settings.format);
      if (date && date.getFullYear() === year && date.getMonth() === month) result.push({ day: date.getDate(), path });
    }
    return result.sort((a, b) => a.day - b.day);
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
          pinned: tab.pinned,
        };
      }),
      bookmarks: this.bookmarks,
      activeTabId: this.activeTabId,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      selection: this.selection,
      renaming: this.renaming,
      pendingDeletion: this.pendingDeletion,
      pendingDeletionAttachments: this.pendingDeletionAttachments,
      attachmentCleanup: this.attachmentCleanup,
      attachmentOrganise: this.attachmentOrganise,
      attachmentConfirm: this.pendingAttachmentAction?.view ?? null,
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

/** "1 attachment", "3 attachments". */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "512 B", "3.4 KB", "12 MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/**
 * Whether two scans describe the same tree. Compared node by node, so a
 * rescan after every watcher batch doesn't serialise the whole tree twice
 * (noticeable with thousands of notes).
 */
export function sameTree(a: TreeNode[], b: TreeNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.path !== y.path || x.name !== y.name || x.isDir !== y.isDir || x.noteCount !== y.noteCount) return false;
    if (x.modified !== y.modified || x.created !== y.created) return false;
    if (x.isDir && !sameTree(x.children ?? [], y.children ?? [])) return false;
  }
  return true;
}

/**
 * Folders and notes (folders first, Finder order), plus every attachment's
 * path. Hidden entries skipped. With `withTimes`, each note carries its
 * modification and creation time and each folder its newest note's, for a
 * tree sorted by time (UI-10a); that costs a stat per note, so it's only
 * asked for when the tree is sorted that way.
 */
export function scanVault(root: string, withTimes = false): { tree: TreeNode[]; notes: string[]; attachments: string[] } {
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
        const node: TreeNode = { path, name: entry.name, isDir: true, children, noteCount: children.reduce((sum, child) => sum + child.noteCount, 0) };
        if (withTimes) {
          for (const child of children) {
            if (child.modified !== undefined && (node.modified === undefined || child.modified > node.modified)) node.modified = child.modified;
            if (child.created !== undefined && (node.created === undefined || child.created > node.created)) node.created = child.created;
          }
        }
        nodes.push(node);
      } else if (isFile && P.isNote(entry.name)) {
        const node: TreeNode = { path, name: P.stem(entry.name), isDir: false, noteCount: 1 };
        if (withTimes) {
          try {
            const stat = fs.statSync(full);
            node.modified = stat.mtimeMs;
            // NTFS keeps a real creation time; where there is none, fall back to the change time.
            node.created = stat.birthtimeMs || stat.ctimeMs;
          } catch {
            // Vanished between readdir and stat: sorted as if undated.
          }
        }
        nodes.push(node);
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
