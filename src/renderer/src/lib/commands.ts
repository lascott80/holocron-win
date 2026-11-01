// Every command in one registry: the menu bar, the command palette and
// keyboard shortcuts all read it, so they never fall out of step
// (REQUIREMENTS §12, QO-05). Shortcuts use the Windows mapping in §17.2.

import { app } from "./app.svelte";
import { SEARCH_SORTS, searchState } from "../components/sidebar/searchState.svelte";
import { accents, activeTheme, themes } from "./theme";
import { call, editor, run } from "./host";
import { defaultSettings, FONT_SIZE_RANGE, shortcutLabel, type Accent, type Appearance, type EditorMode, type FileSort } from "@shared/settings";
import { effectiveHotkeys, hotkeyLabel, normalizeHotkey, resolveBindings, resolveHotkey, toCodeMirrorKey, type HotkeyBinding, type HotkeyMap } from "@shared/hotkeys";
import type { MenuEntry } from "./menu.svelte";

export interface Command {
  id: string;
  title: string;
  /**
   * The shortcut in force, for display ("Ctrl+Shift+D"), or undefined when
   * unbound. Written as the default in the table below; after `installHotkeys`
   * it reads the effective map (defaults overlaid by Settings › Hotkeys, HK-01).
   */
  shortcut?: string;
  /** The built-in shortcut, canonical form (set by `installHotkeys`). */
  defaultShortcut?: string;
  /** Extra key bindings that run the command but aren't shown; they apply while the command keeps its default. */
  alsoKeys?: string[];
  /** Handled by the editor's own keymap while it has focus (formatting, find…). */
  editorKey?: boolean;
  /** The editor command's name when it differs from the id (`editor().run(name)`). */
  editorCommand?: string;
  /** A standard text-editing key (Undo/Redo) that can't be rebound. */
  fixedKey?: boolean;
  /** Settings › Hotkeys group for a command that isn't in a menu ("Go" for Tab 1–9). */
  group?: string;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void;
  /** Hidden from the palette (e.g. "Tab 3"). */
  hidden?: boolean;
  /** The shortcut is a system-wide one (registered by main): shown, never bound in the window. */
  globalShortcut?: boolean;
}

/** Text zoom: one point bigger (1) or smaller (-1), or back to the default size (0). Also Ctrl+scroll over a note. */
export function zoomText(step: -1 | 0 | 1) {
  const [min, max] = FONT_SIZE_RANGE;
  const size = step === 0 ? defaultSettings.editorFontSize : Math.min(max, Math.max(min, app.settings.editorFontSize + step));
  if (size !== app.settings.editorFontSize) app.setSetting("editorFontSize", size);
}

/** Export as PDF / HTML and Print: the editor builds the page, the app saves or prints it (FOP-12). */
async function exportNote(format: "pdf" | "html" | "print") {
  const title = app.doc?.title ?? "Note";
  const html = await editor()?.exportHtml(title);
  if (html) await call("exportNote", format, html);
}

/** The file tree's orders (UI-10a), as shown in the sort menu. */
export const FILE_SORTS: { value: FileSort; label: string }[] = [
  { value: "name", label: "Name (A to Z)" },
  { value: "nameDesc", label: "Name (Z to A)" },
  { value: "modified", label: "Last Modified" },
  { value: "created", label: "Created" },
];

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
  {
    id: "quickCapture",
    title: "Quick Capture",
    // The system-wide shortcut from Settings, while Windows has it registered.
    get shortcut() {
      return app.state.quickCapture.registered ? shortcutLabel(app.settings.quickCaptureShortcut) : undefined;
    },
    globalShortcut: true,
    run: () => run("quickCapture"),
  },
  { id: "quickOpen", title: "Quick Open…", shortcut: "Ctrl+O", enabled: hasVault, run: () => app.showQuickOpen() },
  { id: "commandPalette", title: "Command Palette…", shortcut: "Ctrl+Shift+P", hidden: true, run: () => app.showCommandPalette() },
  { id: "openVault", title: "Open Folder as Vault…", shortcut: "Ctrl+Shift+O", run: () => run("openVaultDialog") },
  { id: "createVault", title: "Create New Vault…", run: () => run("createVaultDialog") },
  { id: "save", title: "Save", shortcut: "Ctrl+S", enabled: hasVault, run: () => run("saveAll") },
  { id: "closeTab", title: "Close Tab", shortcut: "Ctrl+W", alsoKeys: ["Ctrl+F4"], enabled: () => (app.vault?.tabs.length ?? 0) > 0, run: () => run("closeActiveTab") },
  {
    id: "pinTab",
    title: "Pin Tab",
    enabled: hasNote,
    checked: () => app.vault?.tabs.find((tab) => tab.id === app.vault?.activeTabId)?.pinned ?? false,
    run: () => app.vault?.activeTabId && run("togglePinTab", app.vault.activeTabId),
  },
  {
    id: "bookmark",
    title: "Bookmark This Note",
    shortcut: "Ctrl+D",
    enabled: hasNote,
    checked: () => (app.doc ? app.vault?.bookmarks.includes(app.doc.path) ?? false : false),
    run: () => app.doc && run("toggleBookmark", app.doc.path),
  },
  { id: "closeVault", title: "Close Vault", shortcut: "Ctrl+Shift+W", enabled: hasVault, run: () => run("closeVault") },
  { id: "showVaultInExplorer", title: "Show Vault in File Explorer", enabled: hasVault, run: () => run("showVaultInFolder") },
  { id: "exportPdf", title: "Export as PDF…", enabled: hasNote, run: () => void exportNote("pdf") },
  { id: "exportHtml", title: "Export as HTML…", enabled: hasNote, run: () => void exportNote("html") },
  { id: "print", title: "Print…", shortcut: "Ctrl+P", enabled: hasNote, run: () => void exportNote("print") },
  { id: "organiseAttachments", title: "Organise Attachments…", enabled: hasVault, run: () => run("requestAttachmentOrganise") },
  { id: "organiseNoteAttachments", title: "Organise This Note’s Attachments…", enabled: hasNote, run: () => run("requestAttachmentOrganise", app.doc?.path) },
  { id: "cleanUpAttachments", title: "Clean Up Unused Attachments…", enabled: hasVault, run: () => run("requestAttachmentCleanup") },
  { id: "emptyUnusedAttachments", title: "Empty Unused Attachments…", enabled: hasVault, run: () => run("requestEmptyUnused") },
  { id: "undoAttachmentChange", title: "Undo Last Attachment Change…", enabled: hasVault, run: () => run("requestAttachmentUndo") },
  { id: "showNoteInExplorer", title: "Show Note in File Explorer", enabled: hasNote, run: () => app.doc && run("showInFolder", app.doc.path) },
  { id: "versionHistory", title: "Version History…", enabled: hasNote, run: () => (app.historyOpen = true) },
  { id: "settings", title: "Settings…", shortcut: "Ctrl+,", run: () => (app.settingsOpen = true) },
  // Quits even when Holocron keeps running in the background (closing the window only hides it).
  { id: "quitApp", title: "Exit Holocron", run: () => run("quitApp") },

  // Edit
  { id: "undo", title: "Undo", shortcut: "Ctrl+Z", editorKey: true, fixedKey: true, hidden: true, run: undoOrRedo("undo") },
  { id: "redo", title: "Redo", shortcut: "Ctrl+Y", editorKey: true, fixedKey: true, hidden: true, run: undoOrRedo("redo") },
  // Not an editorKey: reading view can't take focus, so its keys never reach the editor's keymap.
  { id: "copyMarkdown", title: "Copy as Markdown", shortcut: "Ctrl+Shift+C", enabled: hasNote, run: ed("copyMarkdown") },
  { id: "pastePlainText", title: "Paste as Plain Text", shortcut: "Ctrl+Shift+V", editorKey: true, enabled: canFormat, run: ed("pastePlainText") },
  { id: "find", title: "Find in Note…", shortcut: "Ctrl+F", editorKey: true, enabled: hasNote, run: ed("find") },
  { id: "findNext", title: "Find Next", shortcut: "F3", editorKey: true, enabled: hasNote, run: ed("findNext") },
  { id: "findPrevious", title: "Find Previous", shortcut: "Shift+F3", editorKey: true, enabled: hasNote, run: ed("findPrevious") },
  // Unbound by default (Ctrl+D is Bookmark); Settings › Hotkeys can give it a key.
  { id: "selectNextOccurrence", title: "Select Next Occurrence", editorKey: true, editorCommand: "selectMatches", enabled: canFormat, run: ed("selectMatches") },
  { id: "searchVault", title: "Search Vault…", shortcut: "Ctrl+Shift+F", enabled: hasVault, run: () => app.showSearch() },
  // Search results (SRCH-12, SRCH-13)
  { id: "copySearchResults", title: "Copy Search Results", enabled: () => hasVault() && searchState.outcome.hits.length > 0, run: () => searchState.copyResults() },
  ...SEARCH_SORTS.map(
    ({ value, label }): Command => ({
      id: `sortSearch:${value}`,
      title: `Sort Search Results by ${label}`,
      enabled: hasVault,
      checked: () => searchState.sort === value,
      run: () => (searchState.sort = value),
    }),
  ),
  { id: "showTasks", title: "Show Tasks", shortcut: "Ctrl+Shift+T", enabled: hasVault, run: () => app.showTasks() },

  // View
  { id: "toggleSidebar", title: "Toggle Sidebar", shortcut: "Ctrl+\\", enabled: hasVault, checked: () => app.settings.showSidebar, run: () => app.setSetting("showSidebar", !app.settings.showSidebar) },
  { id: "toggleInspector", title: "Toggle Inspector", shortcut: "Ctrl+Alt+I", enabled: hasVault, checked: () => app.settings.showInspector, run: () => app.setSetting("showInspector", !app.settings.showInspector) },
  // Split view (UI-40)
  { id: "splitRight", title: "Split Right", shortcut: "Ctrl+Alt+\\", enabled: hasNote, run: () => run("splitActiveNote") },
  { id: "closeSplit", title: "Close Split View", enabled: () => Boolean(app.vault?.split), run: () => run("closeSplit") },
  // Graph view (UI-42)
  { id: "graphView", title: "Graph View", shortcut: "Ctrl+G", enabled: hasVault, run: () => ((app.graphScope = "vault"), (app.graphOpen = true)) },
  { id: "localGraph", title: "Local Graph (This Note)", shortcut: "Ctrl+Shift+G", enabled: hasNote, run: () => ((app.graphScope = "local"), (app.graphOpen = true)) },
  { id: "readableLineLength", title: "Readable Line Length", checked: () => app.settings.readableLineLength, run: () => app.setSetting("readableLineLength", !app.settings.readableLineLength) },
  // Backlinks under the note (UI-44)
  { id: "backlinksInNote", title: "Show Backlinks in Note", checked: () => app.settings.backlinksInNote, run: () => app.setSetting("backlinksInNote", !app.settings.backlinksInNote) },
  { id: "toggleFormattingBar", title: "Show Formatting Bar", checked: () => app.settings.showFormattingBar, run: () => app.setSetting("showFormattingBar", !app.settings.showFormattingBar) },
  ...FILE_SORTS.map(
    ({ value, label }): Command => ({
      id: `sortFiles:${value}`,
      title: `Sort Files by ${label}`,
      enabled: hasVault,
      checked: () => app.settings.fileSort === value,
      run: () => app.setSetting("fileSort", value),
    }),
  ),
  { id: "zoomIn", title: "Zoom In", shortcut: "Ctrl+=", alsoKeys: ["Ctrl+Shift++", "Ctrl++"], run: () => zoomText(1) },
  { id: "zoomOut", title: "Zoom Out", shortcut: "Ctrl+-", run: () => zoomText(-1) },
  { id: "zoomReset", title: "Actual Size", shortcut: "Ctrl+0", run: () => zoomText(0) },
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
  { id: "calendar", title: "Daily Notes Calendar", enabled: hasVault, run: () => (app.calendarRequest++) },
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
    group: "Go",
    enabled: hasVault,
    run: () => run("selectTabNumber", n),
  })),
  { id: "lastTab", title: "Last Tab", shortcut: "Ctrl+9", hidden: true, group: "Go", enabled: hasVault, run: () => run("selectTabNumber", 9) },

  // Format
  { id: "insertTemplate", title: "Insert Template…", shortcut: "Ctrl+Alt+T", enabled: canFormat, run: () => (app.templatePicker = "insert") },
  { id: "bold", title: "Bold", shortcut: "Ctrl+B", editorKey: true, enabled: canFormat, run: ed("bold") },
  { id: "italic", title: "Italic", shortcut: "Ctrl+I", editorKey: true, enabled: canFormat, run: ed("italic") },
  { id: "strikethrough", title: "Strikethrough", shortcut: "Ctrl+Shift+X", editorKey: true, enabled: canFormat, run: ed("strikethrough") },
  { id: "highlight", title: "Highlight", shortcut: "Ctrl+Shift+H", editorKey: true, enabled: canFormat, run: ed("highlight") },
  { id: "code", title: "Inline Code", shortcut: "Ctrl+E", editorKey: true, enabled: canFormat, run: ed("code") },
  { id: "link", title: "Insert Link", shortcut: "Ctrl+K", editorKey: true, enabled: canFormat, run: ed("link") },
  { id: "task", title: "Toggle Checklist Item", shortcut: "Ctrl+L", editorKey: true, enabled: canFormat, run: ed("task") },
  { id: "moveDoneTasksDown", title: "Move Done Tasks to Bottom", enabled: canFormat, run: ed("moveDoneTasksDown") },
  { id: "bulletList", title: "Bulleted List", enabled: canFormat, run: ed("bulletList") },
  { id: "numberedList", title: "Numbered List", enabled: canFormat, run: ed("numberedList") },
  { id: "quote", title: "Quote", enabled: canFormat, run: ed("quote") },
  { id: "codeBlock", title: "Code Block", enabled: canFormat, run: ed("codeBlock") },
  { id: "callout", title: "Callout", enabled: canFormat, run: ed("callout") },
  { id: "divider", title: "Divider", enabled: canFormat, run: ed("divider") },
  { id: "tidyNote", title: "Tidy Note", shortcut: "Ctrl+Alt+L", enabled: canFormat, run: ed("tidyNote") },
  // Rename Tag… (FOP-13): the tag under the cursor, vault-wide.
  {
    id: "renameTag",
    title: "Rename Tag…",
    enabled: () => canFormat() && Boolean(editor()?.tagAtCursor()),
    run: () => {
      const tag = editor()?.tagAtCursor();
      if (tag) app.renamingTag = tag;
    },
  },
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
  { id: "about", title: "About Holocron", run: () => (app.aboutOpen = true) },
  { id: "checkForUpdates", title: "Check for Updates…", run: () => run("checkForUpdates") },
  { id: "showLogs", title: "Show Logs Folder", run: () => run("showLogsFolder") },

  // Appearance (palette only)
  ...(["system", "dark", "light"] as Appearance[]).map((appearance): Command => ({
    id: `appearance:${appearance}`,
    title: `Appearance: ${appearance === "system" ? "Match System" : appearance === "dark" ? "Dark" : "Light"}`,
    group: "Appearance",
    enabled: () => app.settings.appearance !== appearance,
    run: () => app.setSetting("appearance", appearance),
  })),
  ...(["theme", ...Object.keys(accents)] as Accent[]).map((accent): Command => ({
    id: `accent:${accent}`,
    title: `Crystal: ${accent === "theme" ? "Theme default" : accents[accent].title}`,
    group: "Appearance",
    enabled: () => app.settings.accent !== accent,
    run: () => app.setSetting("accent", accent),
  })),
  // Colour themes: a dark theme becomes the dark theme, and if the window is
  // light the appearance switches to Dark so it shows (and vice versa).
  ...themes.map((theme): Command => ({
    id: `theme:${theme.id}`,
    title: `Theme: ${theme.name}`,
    group: "Appearance",
    enabled: () => activeTheme(app.state.isDark, app.settings).id !== theme.id,
    run: () => {
      const dark = theme.kind === "dark";
      app.setSetting(dark ? "darkTheme" : "lightTheme", theme.id);
      if (app.state.isDark !== dark) app.setSetting("appearance", theme.kind);
    },
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
    items: ["newNote", "newNoteFromTemplate", "newFolder", "newTab", "pinTab", "bookmark", "-", "quickCapture", "quickOpen", "commandPalette", "-", "openVault", "createVault", "-", "save", "closeTab", "closeVault", "-", "versionHistory", "showNoteInExplorer", "showVaultInExplorer", "-", "exportPdf", "exportHtml", "print", "-", { title: "Attachments", items: ["organiseAttachments", "organiseNoteAttachments", "-", "cleanUpAttachments", "emptyUnusedAttachments", "-", "undoAttachmentChange"] }, "-", "settings", "-", "quitApp"],
  },
  { title: "Edit", items: ["undo", "redo", "-", "copyMarkdown", "pastePlainText", "-", "find", "findNext", "findPrevious", "selectNextOccurrence", "searchVault", "copySearchResults"] },
  {
    title: "View",
    items: ["toggleSidebar", "toggleInspector", "splitRight", "closeSplit", "graphView", "localGraph", "toggleFormattingBar", "readableLineLength", "backlinksInNote", "showTasks", { title: "Sort Files", items: FILE_SORTS.map(({ value }) => `sortFiles:${value}`) }, { title: "Sort Search Results", items: SEARCH_SORTS.map(({ value }) => `sortSearch:${value}`) }, "-", "zoomIn", "zoomOut", "zoomReset", "-", "mode:livePreview", "mode:source", "mode:reading", "-", "toggleReading", "toggleSource", "focusMode", "-", "foldHeading", "unfoldHeading", "foldAllHeadings", "unfoldAll"],
  },
  { title: "Go", items: ["today", "calendar", "previousDaily", "nextDaily", "-", "back", "forward", "-", "nextTab", "previousTab"] },
  {
    title: "Format",
    items: [
      "insertTemplate", "-", "bold", "italic", "strikethrough", "highlight", "code", "link", "-", "task", "moveDoneTasksDown", "bulletList", "numberedList", "quote", "-",
      "codeBlock", "callout", "divider", "-", "tidyNote", "renameTag",
      { title: "Table", items: ["table", "convertToTable", "-", "tableInsertRowAbove", "tableInsertRowBelow", "tableInsertColumnLeft", "tableInsertColumnRight", "-", "tableMoveRowUp", "tableMoveRowDown", "tableMoveColumnLeft", "tableMoveColumnRight", "-", "tableDeleteRow", "tableDeleteColumn"] },
      "-", "heading1", "heading2", "heading3", "heading0",
    ],
  },
  { title: "Help", items: ["starterGuide", "-", "checkForUpdates", "showLogs", "-", "about"] },
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

// MARK: Hotkeys (HK-01)

/** Whether a command's shortcut can be changed in Settings › Hotkeys. */
export const rebindable = (command: Command) => !command.globalShortcut && !command.fixedKey;

/** Every rebindable command's built-in shortcut (canonical form) or null. */
export const defaultHotkeys: HotkeyMap = {};
const extraKeys: Record<string, string[]> = {};

// The `shortcut` written in the table above is the default; from here on the
// property reads the effective map, so the menu bar, palette, tooltips and
// cheat sheet all show what Settings › Hotkeys says.
for (const command of commands) {
  if (!rebindable(command)) continue;
  const literal = command.shortcut;
  const canonical = literal ? normalizeHotkey(literal) : null;
  if (literal && !canonical) throw new Error(`Command ${command.id} has an unusable shortcut ${literal}`);
  command.defaultShortcut = canonical ?? undefined;
  defaultHotkeys[command.id] = canonical;
  if (command.alsoKeys?.length) extraKeys[command.id] = command.alsoKeys;
  Object.defineProperty(command, "shortcut", {
    enumerable: true,
    get: () => {
      const key = hotkeyMap()[command.id];
      return key ? hotkeyLabel(key) : undefined;
    },
  });
}

interface HotkeyState {
  overrides: HotkeyMap;
  map: HotkeyMap;
  bindings: HotkeyBinding[];
}
let hotkeyState: HotkeyState | null = null;

/** The effective map and winners for the current overrides (recomputed when the setting changes). */
function hotkeys(): HotkeyState {
  const overrides = app.settings.hotkeys;
  if (hotkeyState?.overrides !== overrides) {
    hotkeyState = { overrides, map: effectiveHotkeys(defaultHotkeys, overrides), bindings: resolveBindings(defaultHotkeys, overrides, extraKeys) };
  }
  return hotkeyState;
}

/** Command id → shortcut in force (canonical) or null, for every rebindable command. */
export function hotkeyMap(): HotkeyMap {
  return hotkeys().map;
}

/** The keys that run something right now, conflicts settled (last-bound wins). */
export function boundHotkeys(): HotkeyBinding[] {
  return hotkeys().bindings;
}

/** The bindings the editor's own keymap should hold, in CodeMirror spelling. */
export function editorHotkeys(): { key: string; command: string }[] {
  return boundHotkeys().flatMap(({ id, key }) => {
    const command = commandById.get(id);
    return command?.editorKey ? [{ key: toCodeMirrorKey(key), command: command.editorCommand ?? id }] : [];
  });
}

/** Settings › Hotkeys: every rebindable command, grouped by menu (then by `group`, then "Other"). */
export function hotkeyGroups(): { title: string; commands: Command[] }[] {
  const placed = new Set<string>();
  const groups = new Map<string, Command[]>();
  const add = (title: string, command: Command) => {
    if (placed.has(command.id) || !rebindable(command)) return;
    placed.add(command.id);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(command);
  };
  const walk = (title: string, items: (string | { title: string; items: string[] })[]) => {
    for (const item of items) {
      if (item === "-") continue;
      if (typeof item !== "string") walk(title, item.items);
      else {
        const command = commandById.get(item);
        if (command) add(title, command);
      }
    }
  };
  for (const menuDef of menus) walk(menuDef.title, menuDef.items);
  for (const command of commands) add(command.group ?? "Other", command);
  return [...groups].map(([title, list]) => ({ title, commands: list }));
}

// MARK: Keyboard

/**
 * Global shortcuts. Runs in the capture phase so app shortcuts win over the
 * editor's defaults (e.g. Alt+Left); editor-owned keys are left to the
 * editor while it has focus. Keys are matched on the character typed
 * (hotkeys.ts), so AltGr combinations never trigger a Ctrl+Alt shortcut.
 */
export function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.repeat && !event.ctrlKey) return;
  // Settings' shortcut recorders take every key combination as it is.
  if ((event.target as Element | null)?.closest?.("[data-shortcut-recorder]")) return;
  const inEditor = (event.target as Element | null)?.closest?.(".cm-editor") != null;
  const id = resolveHotkey(boundHotkeys(), event);
  const command = id ? commandById.get(id) : undefined;
  if (!command) return;
  if (command.editorKey && (inEditor || command.id === "undo" || command.id === "redo")) return;
  // Text fields paste plain text natively.
  if (command.id === "pastePlainText" && (event.target as Element | null)?.closest?.("input, textarea, [contenteditable]")) return;
  // Plain text fields keep their own Ctrl+A/C/V/X/Z and Backspace handling.
  event.preventDefault();
  event.stopPropagation();
  if (command.enabled?.() ?? true) command.run();
}
