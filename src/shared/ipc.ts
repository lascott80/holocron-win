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
  | { type: "beep" };
