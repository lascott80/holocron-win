// The main side of the editor bridge (port of EditorController.swift). Sends
// `window.holocron.*` calls to the renderer's CodeMirror and handles the
// messages it posts back (REQUIREMENTS §2.1).

import { clipboard, shell, type WebContents } from "electron";
import { edits } from "@core/merge";
import { Channels, type EditorMessage } from "@shared/ipc";
import type { EditorPort, Vault } from "./vault";

export class EditorBridge implements EditorPort {
  private isReady = false;
  private shown: { path: string | null; text: string | null } = { path: null, text: null };
  /** A selection to make once a note has been sent to the editor. */
  private pendingReveal: { path: string; line: number; from: number; to: number } | null = null;
  private focusWhenReady = false;
  private vaultDataTimer: NodeJS.Timeout | null = null;
  private vaultData: unknown = null;
  vault: Vault | null = null;
  /** Cursor position and selection, for the status bar. */
  cursor = { line: 1, column: 1, selectedWords: 0, selectedCharacters: 0 };
  onCursorChange: (() => void) | null = null;

  constructor(private readonly contents: () => WebContents | null) {}

  private call(method: string, ...args: unknown[]) {
    this.contents()?.send(Channels.editorCall, { method, args });
  }

  /** The renderer reloaded: the editor must say "ready" again. */
  reset() {
    this.isReady = false;
  }

  show(path: string | null, text: string | null) {
    if (path === this.shown.path && text === this.shown.text) return;
    this.shown = { path, text };
    if (this.isReady) this.send();
  }

  private send() {
    this.call("setDocument", this.shown.text ?? "", this.shown.path ?? "");
    this.flushReveal();
  }

  documentDidMove(oldPath: string, newPath: string) {
    if (this.shown.path === oldPath) this.shown.path = newPath;
    if (this.isReady) this.call("renameDocument", oldPath, newPath);
  }

  externalChange(path: string, oldText: string, newText: string) {
    if (path === this.shown.path) this.shown.text = newText;
    if (!this.isReady) return;
    this.call("applyExternalEdits", edits(oldText, newText), newText, path);
  }

  forget(path: string) {
    if (this.isReady) this.call("forget", path);
  }

  focus() {
    if (!this.isReady) {
      this.focusWhenReady = true;
      return;
    }
    this.contents()?.focus();
    this.call("focus");
  }

  reveal(path: string, line: number, from: number, to: number) {
    this.pendingReveal = { path, line, from, to };
    if (this.isReady && path === this.shown.path) this.flushReveal();
  }

  private flushReveal() {
    const reveal = this.pendingReveal;
    if (!reveal || reveal.path !== this.shown.path || !this.isReady) return;
    this.pendingReveal = null;
    this.call("selectInLine", reveal.line, reveal.from, reveal.to);
  }

  applyTemplate(frontmatter: string, body: string) {
    if (this.isReady) this.call("applyTemplate", frontmatter, body);
  }

  insertAtCursor(text: string) {
    if (this.isReady) this.call("insertAtCursor", text);
  }

  /** Coalesced: the index changes often while typing (REQUIREMENTS IDX-06). */
  setVaultData(make: () => unknown) {
    if (this.vaultDataTimer) clearTimeout(this.vaultDataTimer);
    this.vaultDataTimer = setTimeout(() => {
      this.vaultDataTimer = null;
      this.vaultData = make();
      if (this.isReady) this.call("setVaultData", this.vaultData);
    }, 1000);
  }

  /** Handles a message the editor posted. */
  handle(message: EditorMessage) {
    const vault = this.vault;
    switch (message.type) {
      case "ready":
        this.isReady = true;
        if (this.vaultData) this.call("setVaultData", this.vaultData);
        else if (vault) this.call("setVaultData", vault.completionData());
        this.send();
        if (this.focusWhenReady) {
          this.focusWhenReady = false;
          this.focus();
        }
        break;
      case "change":
        if (message.id !== this.shown.path || typeof message.text !== "string") return;
        this.shown.text = message.text;
        vault?.editorChanged(message.id, message.text);
        break;
      case "selection":
        if (message.id !== this.shown.path) return;
        this.cursor = {
          line: message.line ?? 1,
          column: message.column ?? 1,
          selectedWords: message.selectedWords ?? 0,
          selectedCharacters: message.selectedCharacters ?? 0,
        };
        this.onCursorChange?.();
        break;
      case "openLink":
        if (typeof message.target === "string") vault?.openLink(message.target, Boolean(message.newTab));
        break;
      case "openTag":
        if (typeof message.tag === "string") this.contents()?.send(Channels.ui, { type: "quickOpen", query: "#" + message.tag });
        break;
      case "openURL":
        openExternalSafely(message.url);
        break;
      case "copy":
        if (typeof message.text === "string") clipboard.writeText(message.text);
        break;
      case "embed": {
        const result = vault && typeof message.target === "string" ? vault.embedContent(message.target) : null;
        this.call("resolveEmbed", message.id, result);
        break;
      }
      case "pasteImage": {
        if (!vault || typeof message.data !== "string") return;
        const text = vault.pasteImage(message.name, message.mime ?? "image/png", Buffer.from(message.data, "base64"));
        if (text) this.insertAtCursor(text);
        break;
      }
    }
  }
}

/** Opens only http, https and mailto links in the system browser (REQUIREMENTS ARC-06, LNK-10). */
export function openExternalSafely(url: unknown) {
  if (typeof url !== "string") return;
  try {
    const scheme = new URL(url).protocol.toLowerCase();
    if (scheme === "http:" || scheme === "https:" || scheme === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL.
  }
}
