// Every command in one registry: the menu bar, the command palette and
// keyboard shortcuts all read it, so they never fall out of step
// (REQUIREMENTS §12, QO-05). Shortcuts use the Windows mapping in §17.2.

import { app } from "./app.svelte";
import { accents } from "./theme";
import { editor, run } from "./host";
import type { Accent, Appearance, EditorMode } from "@shared/settings";
import type { MenuEntry } from "./menu.svelte";

export interface Command {
  id: string;
  title: string;
  /** Display form, e.g. "Ctrl+Shift+D". */
  shortcut?: string;
  /** Extra key bindings that run the command but aren't shown. */
  alsoKeys?: string[];
  /** Handled by the editor's own keymap while it has focus (formatting, find…). */
  editorKey?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void;
  /** Hidden from the palette (e.g. "Tab 3"). */
  hidden?: boolean;
}

const hasVault = () => app.vault !== null;
const hasNote = () => app.doc !== null;
const canFormat = () => hasNote() && !app.readingView;

/** Runs an editor command (formatting, find…). */
function ed(name: string) {
  return () => {
    editor()?.run(name);
  };
}

function undoOrRedo(name: "undo" | "redo") {
  return () => {
    const active = document.activeElement;
    if (active?.closest(".cm-editor")) editor()?.run(name);
    else document.execCommand(name);
  };
}

const modes: { mode: EditorMode; title: string }[] = [
  { mode: "livePreview", title: "Live Preview" },
  { mode: "source", title: "Source Mode" },
  { mode: "reading", title: "Reading View" },
];

export const commands: Command[] = [
  // File
  { id: "newNote", title: "New Note", shortcut: "Ctrl+N", enabled: hasVault, run: () => run("createNote") },
  { id: "newNoteFromTemplate", title: "New Note from Template…", shortcut: "Ctrl+Shift+N", enabled: hasVault, run: () => (app.templatePicker = "newNote") },
  { id: "newFolder", title: "New Folder", shortcut: "Ctrl+Alt+N", enabled: hasVault, run: () => run("createFolder") },
  { id: "newTab", title: "New Tab", shortcut: "Ctrl+T", enabled: hasVault, run: () => run("newTab") },
  { id: "quickOpen", title: "Quick Open…", shortcut: "Ctrl+O", enabled: hasVault, run: () => app.showQuickOpen() },
  { id: "commandPalette", title: "Command Palette…", shortcut: "Ctrl+Shift+P", hidden: true, run: () => app.showCommandPalette() },
  { id: "openVault", title: "Open Folder as Vault…", shortcut: "Ctrl+Shift+O", run: () => run("openVaultDialog") },
  { id: "createVault", title: "Create New Vault…", run: () => run("createVaultDialog") },
  { id: "save", title: "Save", shortcut: "Ctrl+S", enabled: hasVault, run: () => run("saveAll") },
  { id: "closeTab", title: "Close Tab", shortcut: "Ctrl+W", alsoKeys: ["Ctrl+F4"], enabled: () => (app.vault?.tabs.length ?? 0) > 0, run: () => run("closeActiveTab") },
  { id: "closeVault", title: "Close Vault", shortcut: "Ctrl+Shift+W", enabled: hasVault, run: () => run("closeVault") },
  { id: "showVaultInExplorer", title: "Show Vault in File Explorer", enabled: hasVault, run: () => run("showVaultInFolder") },
  { id: "showNoteInExplorer", title: "Show Note in File Explorer", enabled: hasNote, run: () => app.doc && run("showInFolder", app.doc.path) },
  { id: "settings", title: "Settings…", shortcut: "Ctrl+,", run: () => (app.settingsOpen = true) },

  // Edit
  { id: "undo", title: "Undo", shortcut: "Ctrl+Z", editorKey: true, hidden: true, run: undoOrRedo("undo") },
  { id: "redo", title: "Redo", shortcut: "Ctrl+Y", editorKey: true, hidden: true, run: undoOrRedo("redo") },
  { id: "find", title: "Find in Note…", shortcut: "Ctrl+F", editorKey: true, enabled: hasNote, run: ed("find") },
  { id: "findNext", title: "Find Next", shortcut: "F3", editorKey: true, enabled: hasNote, run: ed("findNext") },
  { id: "findPrevious", title: "Find Previous", shortcut: "Shift+F3", editorKey: true, enabled: hasNote, run: ed("findPrevious") },
  { id: "searchVault", title: "Search Vault…", shortcut: "Ctrl+Shift+F", enabled: hasVault, run: () => app.showSearch() },

  // View
  { id: "toggleSidebar", title: "Toggle Sidebar", shortcut: "Ctrl+\\", enabled: hasVault, checked: () => app.settings.showSidebar, run: () => app.setSetting("showSidebar", !app.settings.showSidebar) },
  { id: "toggleInspector", title: "Toggle Inspector", shortcut: "Ctrl+Alt+I", enabled: hasVault, checked: () => app.settings.showInspector, run: () => app.setSetting("showInspector", !app.settings.showInspector) },
  { id: "toggleFormattingBar", title: "Show Formatting Bar", checked: () => app.settings.showFormattingBar, run: () => app.setSetting("showFormattingBar", !app.settings.showFormattingBar) },
  ...modes.map(({ mode, title }): Command => ({
    id: `mode:${mode}`,
    title: `View Mode: ${title}`,
    checked: () => app.settings.editorMode === mode,
    run: () => app.setSetting("editorMode", mode),
  })),
  { id: "toggleReading", title: "Toggle Reading View", shortcut: "Ctrl+Shift+E", enabled: hasVault, run: () => app.toggleReadingView() },
  { id: "toggleSource", title: "Toggle Source Mode", shortcut: "Ctrl+Alt+E", enabled: hasVault, run: () => app.toggleSourceMode() },
  { id: "foldHeading", title: "Fold Heading", shortcut: "Ctrl+Shift+[", editorKey: true, enabled: hasNote, run: ed("foldHeading") },
  { id: "unfoldHeading", title: "Unfold Heading", shortcut: "Ctrl+Shift+]", editorKey: true, enabled: hasNote, run: ed("unfoldHeading") },
  { id: "foldAllHeadings", title: "Fold All Headings", enabled: hasNote, run: ed("foldAllHeadings") },
  { id: "unfoldAll", title: "Unfold All", enabled: hasNote, run: ed("unfoldAll") },
  { id: "focusMode", title: "Focus Mode", shortcut: "Ctrl+Alt+F", enabled: hasNote, checked: () => app.focusMode, run: () => (app.focusMode = !app.focusMode) },

  // Go
  { id: "today", title: "Open Today’s Note", shortcut: "Ctrl+Shift+D", enabled: hasVault, run: () => run("openDailyNote") },
  { id: "previousDaily", title: "Previous Daily Note", shortcut: "Alt+PageUp", enabled: hasVault, run: () => run("openAdjacentDailyNote", -1) },
  { id: "nextDaily", title: "Next Daily Note", shortcut: "Alt+PageDown", enabled: hasVault, run: () => run("openAdjacentDailyNote", 1) },
  { id: "back", title: "Back", shortcut: "Alt+Left", enabled: () => app.vault?.canGoBack ?? false, run: () => run("goBack") },
  { id: "forward", title: "Forward", shortcut: "Alt+Right", enabled: () => app.vault?.canGoForward ?? false, run: () => run("goForward") },
  { id: "nextTab", title: "Show Next Tab", shortcut: "Ctrl+Tab", alsoKeys: ["Ctrl+PageDown"], enabled: hasVault, run: () => run("nextTab") },
  { id: "previousTab", title: "Show Previous Tab", shortcut: "Ctrl+Shift+Tab", alsoKeys: ["Ctrl+PageUp"], enabled: hasVault, run: () => run("previousTab") },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): Command => ({
    id: `tab${n}`,
    title: `Tab ${n}`,
    shortcut: `Ctrl+${n}`,
    hidden: true,
    enabled: hasVault,
    run: () => run("selectTabNumber", n),
  })),
  { id: "lastTab", title: "Last Tab", shortcut: "Ctrl+9", hidden: true, enabled: hasVault, run: () => run("selectTabNumber", 9) },

  // Format
  { id: "insertTemplate", title: "Insert Template…", shortcut: "Ctrl+Alt+T", enabled: canFormat, run: () => (app.templatePicker = "insert") },
  { id: "bold", title: "Bold", shortcut: "Ctrl+B", editorKey: true, enabled: canFormat, run: ed("bold") },
  { id: "italic", title: "Italic", shortcut: "Ctrl+I", editorKey: true, enabled: canFormat, run: ed("italic") },
  { id: "strikethrough", title: "Strikethrough", shortcut: "Ctrl+Shift+X", editorKey: true, enabled: canFormat, run: ed("strikethrough") },
  { id: "highlight", title: "Highlight", shortcut: "Ctrl+Shift+H", editorKey: true, enabled: canFormat, run: ed("highlight") },
  { id: "code", title: "Inline Code", shortcut: "Ctrl+E", editorKey: true, enabled: canFormat, run: ed("code") },
  { id: "link", title: "Insert Link", shortcut: "Ctrl+K", editorKey: true, enabled: canFormat, run: ed("link") },
  { id: "task", title: "Toggle Checklist Item", shortcut: "Ctrl+L", editorKey: true, enabled: canFormat, run: ed("task") },
  { id: "bulletList", title: "Bulleted List", enabled: canFormat, run: ed("bulletList") },
  { id: "numberedList", title: "Numbered List", enabled: canFormat, run: ed("numberedList") },
  { id: "quote", title: "Quote", enabled: canFormat, run: ed("quote") },
  { id: "codeBlock", title: "Code Block", enabled: canFormat, run: ed("codeBlock") },
  { id: "callout", title: "Callout", enabled: canFormat, run: ed("callout") },
  { id: "divider", title: "Divider", enabled: canFormat, run: ed("divider") },
  { id: "heading1", title: "Heading 1", shortcut: "Ctrl+Alt+1", editorKey: true, enabled: canFormat, run: ed("heading1") },
  { id: "heading2", title: "Heading 2", shortcut: "Ctrl+Alt+2", editorKey: true, enabled: canFormat, run: ed("heading2") },
  { id: "heading3", title: "Heading 3", shortcut: "Ctrl+Alt+3", editorKey: true, enabled: canFormat, run: ed("heading3") },
  { id: "heading0", title: "Body Text", shortcut: "Ctrl+Alt+0", editorKey: true, enabled: canFormat, run: ed("heading0") },
  { id: "table", title: "Insert Table", enabled: canFormat, run: ed("table") },
  { id: "convertToTable", title: "Convert Selection to Table", enabled: canFormat, run: ed("convertToTable") },
  { id: "tableInsertRowAbove", title: "Table: Insert Row Above", shortcut: "Ctrl+Alt+Shift+Up", editorKey: true, enabled: canFormat, run: ed("tableInsertRowAbove") },
  { id: "tableInsertRowBelow", title: "Table: Insert Row Below", shortcut: "Ctrl+Alt+Shift+Down", editorKey: true, enabled: canFormat, run: ed("tableInsertRowBelow") },
  { id: "tableInsertColumnLeft", title: "Table: Insert Column Left", shortcut: "Ctrl+Alt+Shift+Left", editorKey: true, enabled: canFormat, run: ed("tableInsertColumnLeft") },
  { id: "tableInsertColumnRight", title: "Table: Insert Column Right", shortcut: "Ctrl+Alt+Shift+Right", editorKey: true, enabled: canFormat, run: ed("tableInsertColumnRight") },
  { id: "tableMoveRowUp", title: "Table: Move Row Up", shortcut: "Alt+Shift+Up", editorKey: true, enabled: canFormat, run: ed("tableMoveRowUp") },
  { id: "tableMoveRowDown", title: "Table: Move Row Down", shortcut: "Alt+Shift+Down", editorKey: true, enabled: canFormat, run: ed("tableMoveRowDown") },
  { id: "tableMoveColumnLeft", title: "Table: Move Column Left", shortcut: "Alt+Shift+Left", editorKey: true, enabled: canFormat, run: ed("tableMoveColumnLeft") },
  { id: "tableMoveColumnRight", title: "Table: Move Column Right", shortcut: "Alt+Shift+Right", editorKey: true, enabled: canFormat, run: ed("tableMoveColumnRight") },
  { id: "tableDeleteRow", title: "Table: Delete Row", shortcut: "Alt+Shift+Backspace", editorKey: true, enabled: canFormat, run: ed("tableDeleteRow") },
  { id: "tableDeleteColumn", title: "Table: Delete Column", shortcut: "Ctrl+Alt+Shift+Backspace", editorKey: true, enabled: canFormat, run: ed("tableDeleteColumn") },

  // Help
  { id: "starterGuide", title: "Add Start Here Guide to Vault", enabled: hasVault, run: () => run("addStarterGuide") },

  // Appearance (palette only)
  ...(["system", "dark", "light"] as Appearance[]).map((appearance): Command => ({
    id: `appearance:${appearance}`,
    title: `Appearance: ${appearance === "system" ? "Match System" : appearance === "dark" ? "Dark" : "Light"}`,
    enabled: () => app.settings.appearance !== appearance,
    run: () => app.setSetting("appearance", appearance),
  })),
  ...(Object.keys(accents) as Accent[]).map((accent): Command => ({
    id: `accent:${accent}`,
    title: `Crystal: ${accents[accent].title}`,
    enabled: () => app.settings.accent !== accent,
    run: () => app.setSetting("accent", accent),
  })),
];

export const commandById = new Map(commands.map((command) => [command.id, command]));

export function runCommand(id: string) {
  const command = commandById.get(id);
  if (command && (command.enabled?.() ?? true)) command.run();
}

/** The menu bar (REQUIREMENTS §12). "-" separates groups. */
export const menus: { title: string; items: (string | { title: string; items: string[] })[] }[] = [
  {
    title: "File",
    items: ["newNote", "newNoteFromTemplate", "newFolder", "newTab", "-", "quickOpen", "commandPalette", "-", "openVault", "createVault", "-", "save", "closeTab", "closeVault", "-", "showNoteInExplorer", "showVaultInExplorer", "-", "settings"],
  },
  { title: "Edit", items: ["undo", "redo", "-", "find", "findNext", "findPrevious", "searchVault"] },
  {
    title: "View",
    items: ["toggleSidebar", "toggleInspector", "toggleFormattingBar", "-", "mode:livePreview", "mode:source", "mode:reading", "-", "toggleReading", "toggleSource", "focusMode", "-", "foldHeading", "unfoldHeading", "foldAllHeadings", "unfoldAll"],
  },
  { title: "Go", items: ["today", "previousDaily", "nextDaily", "-", "back", "forward", "-", "nextTab", "previousTab"] },
  {
    title: "Format",
    items: [
      "insertTemplate", "-", "bold", "italic", "strikethrough", "highlight", "code", "link", "-", "task", "bulletList", "numberedList", "quote", "-",
      "codeBlock", "callout", "divider",
      { title: "Table", items: ["table", "convertToTable", "-", "tableInsertRowAbove", "tableInsertRowBelow", "tableInsertColumnLeft", "tableInsertColumnRight", "-", "tableMoveRowUp", "tableMoveRowDown", "tableMoveColumnLeft", "tableMoveColumnRight", "-", "tableDeleteRow", "tableDeleteColumn"] },
      "-", "heading1", "heading2", "heading3", "heading0",
    ],
  },
  { title: "Help", items: ["starterGuide"] },
];

/** Menu entries for command ids ("-" = separator, nested groups = submenus). */
export function menuEntries(items: (string | { title: string; items: string[] })[]): MenuEntry[] {
  return items.map((item): MenuEntry => {
    if (item === "-") return "-";
    if (typeof item !== "string") return { label: item.title, items: menuEntries(item.items) };
    const command = commandById.get(item);
    if (!command) throw new Error(`Unknown command ${item}`);
    return {
      label: command.title.replace(/^View Mode: /, "").replace(/^Table: /, ""),
      shortcut: command.shortcut,
      checked: command.checked?.(),
      disabled: !(command.enabled?.() ?? true),
      run: command.run,
    };
  });
}

// MARK: Keyboard

interface KeySpec {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const KEY_NAMES: Record<string, string> = { Left: "arrowleft", Right: "arrowright", Up: "arrowup", Down: "arrowdown" };

function parseShortcut(shortcut: string): KeySpec {
  const parts = shortcut.split("+");
  // "Ctrl++" style isn't used; a trailing "" means the key was "+".
  const key = parts.pop() || "+";
  return {
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    key: (KEY_NAMES[key] ?? key).toLowerCase(),
  };
}

function matches(spec: KeySpec, event: KeyboardEvent): boolean {
  if (spec.ctrl !== event.ctrlKey || spec.alt !== event.altKey || spec.shift !== event.shiftKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === spec.key) return true;
  // Digits with Shift report "!" etc.; compare the physical key for digits only.
  return /^[0-9]$/.test(spec.key) && event.code === `Digit${spec.key}`;
}

const bindings = commands.flatMap((command) =>
  [command.shortcut, ...(command.alsoKeys ?? [])].filter((s): s is string => Boolean(s)).map((shortcut) => ({ spec: parseShortcut(shortcut), command })),
);

/**
 * Global shortcuts. Runs in the capture phase so app shortcuts win over the
 * editor's defaults (e.g. Alt+Left); editor-owned keys are left to the
 * editor while it has focus.
 */
export function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.repeat && !event.ctrlKey) return;
  const inEditor = (event.target as Element | null)?.closest?.(".cm-editor") != null;
  for (const { spec, command } of bindings) {
    if (!matches(spec, event)) continue;
    if (command.editorKey && (inEditor || command.id === "undo" || command.id === "redo")) return;
    // Plain text fields keep their own Ctrl+A/C/V/X/Z and Backspace handling.
    event.preventDefault();
    event.stopPropagation();
    if (command.enabled?.() ?? true) command.run();
    return;
  }
}
