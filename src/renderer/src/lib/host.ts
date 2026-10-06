// Typed access to the preload's host API (src/preload/index.ts).

import type { HolocronHost } from "../../../preload/index";

declare global {
  interface Window {
    holocronHost: HolocronHost;
    /** Set by the renderer so it sees editor messages before they go to main. */
    holocronEditorPost?: (message: import("@shared/ipc").EditorMessage) => void;
    /** The editor's API (src/editor/main.js). */
    holocron?: EditorApi;
  }
}

/** `window.holocron`, defined by the editor (REQUIREMENTS §2.1). */
export interface EditorApi {
  run(name: string): boolean;
  focus(): void;
  setMode(mode: "live" | "source" | "reading"): void;
  setFocusMode(on: boolean): void;
  setAppearance(vars: Record<string, string>, mode: "dark" | "light"): void;
  insertTable(rows: number, columns: number): void;
  insertAtPoint(x: number, y: number, text: string): void;
  insertAtCursor(text: string): void;
  scrollToLine(line: number): void;
  getText(): string;
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

/** Runs an editor command if the editor is loaded. */
export function editor(): EditorApi | null {
  return window.holocron ?? null;
}
