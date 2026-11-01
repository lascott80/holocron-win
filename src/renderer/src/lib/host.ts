// Typed access to the preload's host API (src/preload/index.ts).

import type { EditorPane } from "@shared/ipc";
import type { HolocronHost } from "../../../preload/index";

declare global {
  interface Window {
    holocronHost: HolocronHost;
    /** Set by the renderer so it sees editor messages before they go to main. */
    holocronEditorPost?: (message: import("@shared/ipc").EditorMessage) => void;
    /** The editor's API (src/editor/main.js). */
    holocron?: EditorApi;
    /** Creates another editor, for a pane of the layout (UI-40) or a stacked tab (UI-48), named by its id. */
    holocronCreateEditor?: (parent: HTMLElement, pane: EditorPane) => EditorApi;
  }
}

/** `window.holocron`, defined by the editor (REQUIREMENTS §2.1). */
export interface EditorApi {
  run(name: string): boolean;
  focus(): void;
  setMode(mode: "live" | "source" | "reading"): void;
  setFocusMode(on: boolean): void;
  setRevealMode(mode: "line" | "span"): void;
  /** The editor's shortcuts in CodeMirror spelling, from the effective hotkey map (HK-01). */
  setHotkeys(entries: { key: string; command: string }[]): void;
  setAppearance(vars: Record<string, string>, mode: "dark" | "light"): void;
  insertTable(rows: number, columns: number): void;
  insertAtPoint(x: number, y: number, text: string): void;
  insertAtCursor(text: string): void;
  scrollToLine(line: number): void;
  moveSection(fromLine: number, beforeLine: number | null): boolean;
  getText(): string;
  /** The #tag at the cursor without the "#", or null (FOP-13). */
  tagAtCursor(): string | null;
  exportHtml(title: string): Promise<string>;
  /** Linked scrolling (UI-47): the fractional 1-based line at the top of the view, and the note's line count. */
  getScrollLine(): { line: number; lines: number };
  setScrollLine(line: number): void;
  onScroll(listener: () => void): () => void;
  /** Tears the editor down (a pane closed). */
  destroy(): void;
  [method: string]: unknown;
}

export const host = window.holocronHost;

/** Runs a main-process command (see src/main/commands.ts). */
export function call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  return host.call(name, ...args) as Promise<T>;
}

/** Fire-and-forget command; errors are logged. */
export function run(name: string, ...args: unknown[]): void {
  host.call(name, ...args).catch((error: unknown) => console.error(`[${name}]`, error));
}

/** The editors of the other panes (UI-40) and stacked tabs (UI-48), by id; "main" is `window.holocron`. */
const paneEditors = new Map<string, EditorApi>();

/** The editor that formatting commands, Find and the status bar follow: the one last focused (UI-40). */
export function editor(): EditorApi | null {
  return editorFor(activeEditorPane);
}

let activeEditorPane: EditorPane = "main";

export function activePane(): EditorPane {
  return activeEditorPane;
}

export function setActivePane(pane: EditorPane) {
  activeEditorPane = pane;
}

/** The editor for `pane` (the main one when unnamed), or null while it doesn't exist. */
export function editorFor(pane: EditorPane | undefined): EditorApi | null {
  return (pane && pane !== "main" ? paneEditors.get(pane) : window.holocron) ?? null;
}

/** Makes the editor for a pane in `parent` (the pane's component owns it) and registers it under its id. */
export function createPaneEditor(parent: HTMLElement, pane: EditorPane): EditorApi | null {
  const api = window.holocronCreateEditor?.(parent, pane) ?? null;
  if (api) paneEditors.set(pane, api);
  return api;
}

/** Forgets a pane's editor and tears it down (the pane closed). */
export function destroyPaneEditor(pane: EditorPane) {
  const api = paneEditors.get(pane);
  paneEditors.delete(pane);
  api?.destroy();
  if (activeEditorPane === pane) activeEditorPane = "main";
}
