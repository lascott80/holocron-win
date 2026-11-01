// The contract between the main process (which owns the vault and files)
// and the renderer (window chrome + editor). Main pushes `AppState`
// snapshots; the renderer calls named commands. Editor bridge messages
// (REQUIREMENTS §2.1) travel on their own channels.

import type { Layout } from "@core/layout";
import type { Settings } from "./settings";
import type { SnippetView } from "./snippets";
import type { BaseRow } from "../core/base";
import type { LineMatch } from "../core/vaultSearch";

export interface TreeNode {
  /** Vault path ("Lore/Kyber.md"; folders without a trailing slash). */
  path: string;
  /** Folders: their name. Notes: title without extension. */
  name: string;
  isDir: boolean;
  /** A JSON Canvas file (UI-45) or a base (UI-46): shown with its own icon and opened in its viewer. */
  kind?: "canvas" | "base";
  children?: TreeNode[];
  /** Notes in this subtree (1 for a note, 0 for a canvas or base). */
  noteCount: number;
  /** ms since epoch; only when the tree is sorted by time (folders: the newest note inside). */
  modified?: number;
  created?: number;
}

export interface TabView {
  id: string;
  path: string | null;
  /** Note title, or "New Tab". */
  title: string;
  isDirty: boolean;
  /** Conflict or missing file: shows a warning triangle. */
  hasWarning: boolean;
  /** Pinned: leftmost, can't be closed by accident, links open beside it (TAB-12). */
  pinned: boolean;
}

/** A sync tool's conflict copy of a note (UI-41). */
export interface SyncConflictView {
  copy: string;
  original: string;
  service: "Dropbox" | "OneDrive" | "Syncthing" | "Nextcloud";
  device: string | null;
}

/** The JSON Canvas file in the active tab (UI-45); the renderer reads its text with `readCanvas`. */
export interface CanvasTabView {
  path: string;
  /** File name without extension. */
  title: string;
  /** Bumped when the file changes on disk, so the viewer reloads it. */
  revision: number;
}

/** The `.base` file in the active tab (UI-46); the renderer reads its text with `readBase`. */
export interface BaseTabView {
  path: string;
  /** File name without extension. */
  title: string;
  /** Bumped when the file changes on disk, so the view reloads it. */
  revision: number;
}

/** One note as a base's table or cards show it (UI-46): see `BaseRow` in src/core/base.ts. */
export interface BaseRowsResult {
  rows: BaseRow[];
  /** The filter couldn't be read (an invalid regular expression, say). */
  error: string | null;
}

/** A ```query block's results (§9.5): a trimmed search outcome. */
export interface QueryBlockResult {
  hits: { path: string; title: string; folder: string; lines: LineMatch[] }[];
  /** Notes that matched, listed or not. */
  total: number;
  truncated: boolean;
  error: string | null;
}

/** What a pane other than the primary one shows (UI-40): the file, its state and how to draw it. */
export interface PaneInfo {
  path: string | null;
  title: string;
  isDirty: boolean;
  hasWarning: boolean;
  /** "note": an editor; "canvas": the canvas viewer; "base": the Base view; "empty": nothing yet. */
  kind: "note" | "canvas" | "base" | "empty";
  /** Bumped when a canvas or base on show changes on disk (UI-45, UI-46). */
  revision: number;
}

/** The sidebar and inspector state a workspace remembers (UI-49); the renderer owns it. */
export interface WorkspaceUi {
  showSidebar: boolean;
  showInspector: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarMode: "files" | "search" | "tasks";
  inspectorTab: "outline" | "links" | "info";
}

export interface DocView {
  path: string;
  title: string;
  isDirty: boolean;
  saveError: string | null;
  hasConflict: boolean;
  isMissing: boolean;
  /** ms since epoch */
  lastSaved: number | null;
  lastSyncEvent: { kind: "reloaded" | "merged"; date: number } | null;
  created: number | null;
  modified: number | null;
}

export interface ConflictView {
  path: string;
  /** File name with extension, for the title. */
  fileName: string;
  mine: string;
  theirs: string;
  /** A clean three-way merge exists ("Merge Both" is offered). */
  canMerge: boolean;
}

export interface ToastView {
  id: number;
  message: string;
  actionTitle: string | null;
  isWarning: boolean;
}

export interface VaultView {
  root: string;
  name: string;
  displayPath: string;
  noteCount: number;
  treeRevision: number;
  indexRevision: number;
  tabs: TabView[];
  activeTabId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Sidebar selection: a note or folder path. */
  selection: string | null;
  /** The sidebar row being renamed inline. */
  renaming: string | null;
  /** Items waiting for "Move to Recycle Bin?" confirmation. */
  pendingDeletion: string[] | null;
  /** Attachments only the pending items use, offered for deletion with them. */
  pendingDeletionAttachments: string[];
  /** Unused attachments offered by Clean Up Unused Attachments…, or null when it isn't showing. */
  attachmentCleanup: AttachmentCleanupItem[] | null;
  /** The moves Organise Attachments… would make, or null when it isn't showing. */
  attachmentOrganise: AttachmentOrganiseView | null;
  /** Empty Unused Attachments… / Undo Last Attachment Change… asking for confirmation. */
  attachmentConfirm: AttachmentConfirmView | null;
  recentNotes: string[];
  /** Bookmarked note and folder paths, in the user's order (UI-14a). */
  bookmarks: string[];
  /** The pane tree (UI-40, UI-47) and, per pane except the primary one, what it shows. */
  layout: Layout;
  panes: Record<string, PaneInfo>;
  /** View › Stack Tabs (UI-48), per vault. */
  stackTabs: boolean;
  /** Saved workspaces (UI-49), sorted by name, and the one saved or loaded last. */
  workspaces: string[];
  lastWorkspace: string | null;
  /** Sync tools' conflict copies beside their notes (UI-41). */
  syncConflicts: SyncConflictView[];
  toast: ToastView | null;
  doc: DocView | null;
  /** The canvas the active tab shows (then `doc` is null), UI-45. */
  canvas: CanvasTabView | null;
  /** The base the active tab shows (then `doc` is null), UI-46. */
  base: BaseTabView | null;
  conflict: ConflictView | null;
  /** Template note paths, sorted by name. */
  templates: string[];
  isIndexing: boolean;
  /** Every frontmatter key in the vault with its counts and values (IDX-07), by count then name. */
  properties: PropertySummary[];
}

/** A frontmatter key across the vault, compact for the state snapshot (IDX-07). */
export interface PropertySummary {
  key: string;
  /** Notes using the key. */
  count: number;
  type: "text" | "list" | "number" | "checkbox" | "date" | "datetime";
  /** [value, notes] for up to 50 distinct values, commonest first. */
  values: [string, number][];
}

export interface AttachmentCleanupItem {
  path: string;
  /** In bytes. */
  size: number;
  isImage: boolean;
  /** Notes that mention the file's name without a link Holocron understands: it may still be in use. */
  mentionedIn: string[];
}

export interface AttachmentOrganiseView {
  moves: { from: string; to: string }[];
  /** Used files left alone because a note mentions them in a way Holocron can't update. */
  skipped: { path: string; notes: string[] }[];
  /** How many notes' links will be updated. */
  notesChanged: number;
  /** The note whose attachments are being organised, or null for all of them. */
  scope: string | null;
}

export interface AttachmentConfirmView {
  title: string;
  message: string;
  confirmLabel: string;
  /** The confirm button is destructive (red). */
  danger: boolean;
}

export interface RecentVault {
  path: string;
  name: string;
  displayPath: string;
}

export interface AppState {
  vault: VaultView | null;
  recentVaults: RecentVault[];
  settings: Settings;
  /** An alert to show ("Something went wrong" / OK). */
  errorMessage: string | null;
  version: string;
  isDark: boolean;
  /** Auto-update (src/main/updater.ts). */
  update: UpdateView;
  /** Quick capture's system-wide shortcut (src/main/capture.ts). */
  quickCapture: QuickCaptureView;
  /** The spell checker: dictionaries Chromium offers, and the ones in use right now. */
  spelling: SpellingView;
  /** The open vault's CSS snippets (`.holocron/snippets/*.css`, §16.11), in file-name order. */
  snippets: SnippetView[];
}

export interface SpellingView {
  /** BCP 47 tags of every dictionary available, sorted. */
  available: string[];
  /** The dictionaries in use (what the setting resolves to; empty when spell check is off). */
  active: string[];
}

export interface QuickCaptureView {
  /** The shortcut is registered with Windows right now. */
  registered: boolean;
  /** Why it couldn't be registered ("That shortcut is in use by another app."), or null. */
  error: string | null;
}

/** What the capture window shows (sent with each `capture` UI request). */
export interface CaptureInfo {
  /** The open vault's name, or null (the window then asks to open one). */
  vaultName: string | null;
  /** The default target from Settings. */
  target: "daily" | "inbox";
  /** Vault paths the two targets write to. */
  dailyPath: string | null;
  inboxPath: string | null;
  isDark: boolean;
  settings: Settings;
}

/** The answer to `captureSave`. */
export type CaptureResult = { ok: true; path: string } | { ok: false; error: string };

export type UpdateStatus = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

export interface UpdateView {
  status: UpdateStatus;
  /** The newer version found (available / downloading / downloaded). */
  version?: string;
  /** Plain text, trimmed. */
  releaseNotes?: string;
  /** Download progress, 0–100. */
  percent?: number;
  /** A friendly message for the last failure. */
  error?: string;
  /** ms since epoch */
  lastChecked?: number;
  currentVersion: string;
  /** The update card is showing (bottom-right of the window). */
  showPrompt: boolean;
  /** A transient note in the card ("You’re up to date…"). */
  message?: string;
}

// ---- Index queries (inspector, quick open, autocomplete) ----

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
}

export interface Backlink {
  source: string;
  title: string;
  contexts: string[];
  /** 1-based line of each context, for revealing it. */
  lines: number[];
}

export interface Mention {
  source: string;
  title: string;
  context: string;
  /** 1-based line of the mention. */
  line: number;
}

export interface OutgoingLink {
  target: string;
  resolved: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface NoteDetails {
  headings: HeadingInfo[];
  backlinks: Backlink[];
  mentions: Mention[];
  outgoing: OutgoingLink[];
  tags: string[];
  aliases: string[];
  properties: { key: string; values: string[] }[];
}

/** One note for quick open's fuzzy search. */
export interface QuickOpenNote {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
}

// ---- Editor bridge ----

/**
 * Which editor: "main" is the primary pane's; every other pane of the layout
 * has one named by its pane id (UI-40), and stacked tabs (UI-48) one per tab
 * named "tab:<tab id>".
 */
export type EditorPane = string;

/** Messages the editor posts (Editor → native), REQUIREMENTS §2.1. `pane` is absent for the main editor. */
export type EditorMessage = { pane?: EditorPane } & (
  | { type: "ready" }
  | { type: "change"; id: string; text: string }
  | { type: "selection"; id: string; line: number; column: number; selectedWords?: number; selectedCharacters?: number }
  | { type: "openLink"; target: string; newTab: boolean }
  | { type: "openURL"; url: string }
  | { type: "openTag"; tag: string }
  | { type: "embed"; id: number; target: string; from: string }
  | { type: "copy"; text: string }
  /** Rich copy's second pass: markdown plus HTML with images and diagrams loaded. */
  | { type: "copyRich"; text: string; html: string }
  | { type: "pasteImage"; name: string; mime: string; data: string }
  /** The slash menu's Template… item: open the template picker. */
  | { type: "insertTemplate" }
);

/** A call from main into an editor: `window.holocron`, or another pane's editor when `pane` names it. */
export interface EditorCall {
  method: string;
  args: unknown[];
  pane?: EditorPane;
}

export const Channels = {
  state: "holocron:state",
  tree: "holocron:tree",
  command: "holocron:command",
  editorMessage: "holocron:editor-message",
  editorCall: "holocron:editor-call",
  ui: "holocron:ui",
} as const;

/** Requests from main for the renderer's own UI (things only the window chrome does). */
export type UiRequest =
  | { type: "quickOpen"; query: string }
  | { type: "showSearch"; query?: string }
  | { type: "templatePicker"; mode: "insert" | "newNote" }
  | ({ type: "contextMenu" } & ContextMenuParams)
  | { type: "beep" }
  /** To the capture window: it's being shown (or the theme changed); `reset` clears the draft. */
  | { type: "capture"; info: CaptureInfo; reset?: boolean };

/** What Chromium reports for a right-click (the JSON-safe part of Electron's context-menu params). */
export interface ContextMenuParams {
  /** Where the menu was asked for, in window coordinates. */
  x: number;
  y: number;
  /** The misspelled word under the pointer, or "". */
  misspelledWord: string;
  /** Spell-checker suggestions for `misspelledWord`. */
  suggestions: string[];
  isEditable: boolean;
  selectionText: string;
  editFlags: {
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
    canRedo: boolean;
  };
  linkURL: string;
  /** "none", "image", "video", "audio", "canvas", "file" or "plugin". */
  mediaType: string;
}

/** Edit actions the renderer may ask main to run on its page (`editAction`). */
export const EDIT_ACTIONS = ["cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "undo", "redo"] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];
