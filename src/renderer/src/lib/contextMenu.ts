// The right-click menu for the editor and text fields. Main forwards
// Chromium's context-menu params (spelling, edit flags); the renderer adds
// what's under the pointer (a link, tag, diagram or image) and builds the
// entries here. Pure (no DOM), so it's unit-tested; app.svelte.ts reads
// the DOM and opens the result in the shared popup menu.

import type { ContextMenuParams, EditAction } from "@shared/ipc";

/** The shape of menu.svelte.ts's MenuItem / MenuEntry (redeclared so this file stays DOM-free). */
export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  items?: MenuEntry[];
  run?: () => void;
}
export type MenuEntry = MenuItem | "-";

/** What the right-click landed on. */
export interface ContextTarget {
  /** In the note editor's text (not its find panel or another field). */
  inEditor: boolean;
  /** A [[wikilink]]'s target. */
  wikilink?: string;
  /** A markdown link's or bare URL's address. */
  url?: string;
  /** A #tag, without the "#". */
  tag?: string;
  /** A rendered Mermaid diagram; `canCopy` when its source can be found for a PNG. */
  diagram?: { canCopy: boolean };
  /** An image's src. */
  image?: string;
}

export interface ContextActions {
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  openLink(target: string, newTab: boolean): void;
  openUrl(url: string): void;
  copyText(text: string): void;
  searchTag(tag: string): void;
  expandDiagram(): void;
  copyDiagram(): void;
  copyImage(): void;
  openImage(src: string): void;
  edit(action: EditAction): void;
  copyMarkdown(): void;
  pastePlainText(): void;
  selectAll(): void;
}

/** A formatting command for the Format submenu (from the command registry). */
export interface FormatCommand {
  label: string;
  shortcut?: string;
  run(): void;
}

export const MAX_SUGGESTIONS = 5;

/** The registry commands offered under Format, with their menu labels. */
export const FORMAT_COMMANDS: { id: string; label: string }[] = [
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "strikethrough", label: "Strikethrough" },
  { id: "highlight", label: "Highlight" },
  { id: "code", label: "Inline Code" },
  { id: "link", label: "Link" },
];

/**
 * The menu for a right-click, or [] for none (somewhere that's neither text
 * nor the editor, with nothing selected).
 */
export function buildContextMenu(params: ContextMenuParams, target: ContextTarget, actions: ContextActions, format: FormatCommand[] = []): MenuEntry[] {
  const editable = params.isEditable;
  const flags = params.editFlags;
  const hasSelection = params.selectionText.trim() !== "";

  if (!target.inEditor && !editable) {
    // Plain UI text (backlinks, the inspector…): just Copy, and only for a selection.
    return hasSelection ? [{ label: "Copy", shortcut: "Ctrl+C", run: () => actions.edit("copy") }] : [];
  }

  const entries: MenuEntry[] = [];

  // Spelling
  const word = params.misspelledWord;
  if (editable && word) {
    const suggestions = params.suggestions.slice(0, MAX_SUGGESTIONS);
    if (suggestions.length) {
      for (const suggestion of suggestions) entries.push({ label: suggestion, run: () => actions.replaceMisspelling(suggestion) });
    } else {
      entries.push({ label: "No Suggestions", disabled: true });
    }
    entries.push({ label: `Add “${word}” to Dictionary`, run: () => actions.addToDictionary(word) }, "-");
  }

  // What's under the pointer
  if (target.inEditor) {
    const url = target.url ?? (/^(https?|mailto):/i.test(params.linkURL) ? params.linkURL : undefined);
    if (target.wikilink) {
      const link = target.wikilink;
      entries.push({ label: "Open Link", run: () => actions.openLink(link, false) }, { label: "Open in New Tab", run: () => actions.openLink(link, true) });
    } else if (url) {
      entries.push({ label: "Open Link", run: () => actions.openUrl(url) }, { label: "Copy Link Address", run: () => actions.copyText(url) });
    }
    if (target.tag) {
      const tag = target.tag;
      entries.push({ label: `Search for #${tag}`, run: () => actions.searchTag(tag) });
    }
    if (target.diagram) {
      entries.push({ label: "Expand Diagram", run: () => actions.expandDiagram() });
      if (target.diagram.canCopy) entries.push({ label: "Copy Image", run: () => actions.copyDiagram() });
    } else if (target.image) {
      const src = target.image;
      entries.push({ label: "Copy Image", run: () => actions.copyImage() }, { label: "Open Image", run: () => actions.openImage(src) });
    }
    entries.push("-");
  }

  // Editing (reading view and other read-only text: no Cut or Paste)
  if (editable) entries.push({ label: "Cut", shortcut: "Ctrl+X", disabled: !flags.canCut, run: () => actions.edit("cut") });
  entries.push({ label: "Copy", shortcut: "Ctrl+C", disabled: !flags.canCopy, run: () => actions.edit("copy") });
  if (target.inEditor) entries.push({ label: "Copy as Markdown", shortcut: "Ctrl+Shift+C", run: () => actions.copyMarkdown() });
  if (editable) {
    entries.push({ label: "Paste", shortcut: "Ctrl+V", disabled: !flags.canPaste, run: () => actions.edit("paste") });
    if (target.inEditor) entries.push({ label: "Paste as Plain Text", shortcut: "Ctrl+Shift+V", disabled: !flags.canPaste, run: () => actions.pastePlainText() });
  }
  entries.push({ label: "Select All", shortcut: "Ctrl+A", disabled: !flags.canSelectAll, run: () => actions.selectAll() });

  // Formatting a selection in the editor
  if (target.inEditor && editable && hasSelection && format.length) {
    const items: MenuItem[] = format.map((command) => ({ label: command.label, shortcut: command.shortcut, run: command.run }));
    entries.push("-", { label: "Format", items });
  }

  return tidySeparators(entries);
}

/** Drops leading, trailing and doubled separators. */
export function tidySeparators(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry === "-" && (out.length === 0 || out[out.length - 1] === "-")) continue;
    out.push(entry);
  }
  while (out[out.length - 1] === "-") out.pop();
  return out;
}

const CLOSE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*$/;

/**
 * The source of the Mermaid block whose code starts at `pos` in `text`
 * (the diagram's `data-pos`), up to its closing fence; null if `pos` isn't
 * a line start or the block is unclosed.
 */
export function mermaidCodeAt(text: string, pos: number): string | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > text.length || (pos > 0 && text[pos - 1] !== "\n")) return null;
  const lines = text.slice(pos).split("\n");
  const code: string[] = [];
  for (const line of lines) {
    if (CLOSE_FENCE.test(line.replace(/\r$/, ""))) return code.join("\n");
    code.push(line.replace(/\r$/, ""));
  }
  return null;
}
