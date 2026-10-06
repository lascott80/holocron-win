// The contract between the main process (which owns the vault and files)
// and the renderer (window chrome + editor). Main pushes `AppState`
// snapshots; the renderer calls named commands. Editor bridge messages
// (REQUIREMENTS §2.1) travel on their own channels.

import type { Settings } from "./settings";

export interface TreeNode {
  /** Vault path ("Lore/Kyber.md"; folders without a trailing slash). */
  path: string;
  /** Folders: their name. Notes: title without extension. */
  name: string;
  isDir: boolean;
  children?: TreeNode[];
  /** Notes in this subtree (1 for a note). */
  noteCount: number;
}

export interface TabView {
  id: string;
  path: string | null;
  /** Note title, or "New Tab". */
  title: string;
  isDirty: boolean;
  /** Conflict or missing file: shows a warning triangle. */
  hasWarning: boolean;
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
  recentNotes: string[];
  toast: ToastView | null;
  doc: DocView | null;
  conflict: ConflictView | null;
  /** Template note paths, sorted by name. */
  templates: string[];
  isIndexing: boolean;
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
}

export interface Mention {
  source: string;
  title: string;
  context: string;
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

/** Messages the editor posts (Editor → native), REQUIREMENTS §2.1. */
export type EditorMessage =
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
  | { type: "pasteImage"; name: string; mime: string; data: string };

/** A call from main into `window.holocron` in the editor. */
export interface EditorCall {
  method: string;
  args: unknown[];
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
