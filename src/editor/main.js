// Holocron's markdown editor. Runs inside a WKWebView; Swift drives it through
// `window.holocron` and listens on the `holocron` script message handler.
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  search,
  searchKeymap,
  selectSelectionMatches,
} from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { wrapSelectionOnInput } from "./wrapSelection.js";

import { Frontmatter, Highlight, Tag, WikiLink } from "./syntax.js";
import { codeBlockTools, codeHighlight, codeLanguage } from "./codeblocks.js";
import { insertTable, tables } from "./tables.js";
import { firstLineHeading } from "./firstHeading.js";
import { setFocused } from "./focus.js";
import { hoverPreview } from "./hoverPreview.js";
import { focusMode } from "./focusMode.js";
import { insertSizedTable, tableCommands, tableEditing } from "./tableEditing.js";
import { folding } from "./folds.js";
import { foldAllHeadings, foldHeading, headingFolding, unfoldAll, unfoldHeading } from "./headingFolds.js";
import { comments } from "./comments.js";
import { mermaidDiagrams, setMermaidTheme } from "./mermaid.js";
import { math } from "./math.js";
import { emoji } from "./emoji.js";
import { livePreview, setRevealMode } from "./livePreview.js";
import { currentNote, imagePaste, imageViewer, inlineImages, setImageContext } from "./images.js";
import { mediaEmbeds } from "./media.js";
import { youtubeCards } from "./youtube.js";
import { htmlRendering } from "./html.js";
import { copyMarkdown, richCopy } from "./richCopy.js";
import { pasteMarkdown, pastePlainText } from "./pasteMarkdown.js";
import { configureEmbeds, embedDepth, invalidateEmbeds, noteEmbeds, refreshEmbeds, resolveEmbed } from "./embeds.js";
import { Prec } from "@codemirror/state";
import { mergeFrontmatterChanges, properties } from "./properties.js";
import { linkAutocomplete, setCurrentNote, setVaultData, vaultDataSummary } from "./completions.js";
import { setSlashHandlers } from "./slashMenu.js";
import { holocronHighlight, holocronTheme } from "./theme.js";
import { paragraphSpacing } from "./typography.js";
import { footnotes } from "./footnotes.js";
import { headingNavigation } from "./headings.js";
import { tidyNote } from "./tidy.js";
import { exportHtml } from "./exporter.js";
import {
  insertLink,
  setHeading,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrikethrough,
  toggleTask,
  markdownKeys,
  moveDoneTasksDown,
  moveSection,
  toggleHighlight,
  toggleBulletList,
  toggleNumberedList,
  toggleQuote,
  insertCodeBlock,
  insertCallout,
  insertDivider,
} from "./commands.js";

// ---------- Bridge to the native side ----------
// Mac: WKWebView script message handler. Electron: the preload's host API
// (window.holocronHost), whose postEditor routes messages to the app.

const nativeHandler = window.webkit?.messageHandlers?.holocron
  ?? (window.holocronHost ? { postMessage: (message) => (window.holocronEditorPost ?? window.holocronHost.postEditor)(message) } : null);
function post(message) {
  if (nativeHandler) nativeHandler.postMessage(message);
  else if (message.type !== "change" && message.type !== "selection") console.log("[holocron]", message);
}

// ---------- Editor setup ----------

// The editor's own shortcuts, as command names (the `commands` table below).
// These are the defaults; the app replaces them through `setHotkeys` when the
// user customises shortcuts (Settings › Hotkeys, HK-01), so the editor's
// keymap and the app's menus never disagree.
const defaultEditorHotkeys = [
  { key: "Mod-b", command: "bold" },
  { key: "Mod-i", command: "italic" },
  { key: "Mod-Shift-x", command: "strikethrough" },
  { key: "Mod-e", command: "code" },
  { key: "Mod-k", command: "link" },
  { key: "Mod-l", command: "task" },
  { key: "Mod-Shift-h", command: "highlight" },
  { key: "Mod-Alt-0", command: "heading0" },
  { key: "Mod-Alt-1", command: "heading1" },
  { key: "Mod-Alt-2", command: "heading2" },
  { key: "Mod-Alt-3", command: "heading3" },
  { key: "Mod-Shift-v", command: "pastePlainText" }, // Paste as Plain Text (Windows convention)
  { key: "Mod-f", command: "find" },
  { key: "F3", command: "findNext" },
  { key: "Shift-F3", command: "findPrevious" },
  { key: "Mod-Shift-[", command: "foldHeading" },
  { key: "Mod-Shift-]", command: "unfoldHeading" },
  { key: "Alt-Shift-ArrowUp", command: "tableMoveRowUp" },
  { key: "Alt-Shift-ArrowDown", command: "tableMoveRowDown" },
  { key: "Alt-Shift-ArrowLeft", command: "tableMoveColumnLeft" },
  { key: "Alt-Shift-ArrowRight", command: "tableMoveColumnRight" },
  { key: "Ctrl-Alt-Shift-ArrowUp", command: "tableInsertRowAbove" },
  { key: "Ctrl-Alt-Shift-ArrowDown", command: "tableInsertRowBelow" },
  { key: "Ctrl-Alt-Shift-ArrowLeft", command: "tableInsertColumnLeft" },
  { key: "Ctrl-Alt-Shift-ArrowRight", command: "tableInsertColumnRight" },
  { key: "Alt-Shift-Backspace", command: "tableDeleteRow" },
  { key: "Ctrl-Alt-Shift-Backspace", command: "tableDeleteColumn" },
];

// The keys above are the app's to assign, so CodeMirror's own bindings for them step aside.
const REBINDABLE_SEARCH_KEYS = new Set(["Mod-f", "F3", "Mod-d"]);
const fixedSearchKeymap = searchKeymap.filter((binding) => !REBINDABLE_SEARCH_KEYS.has(binding.key));

const markdownSupport = markdown({
  base: markdownLanguage,
  extensions: [Frontmatter, WikiLink, Tag, Highlight],
  codeLanguages: codeLanguage,
  addKeymap: false, // markdownKeys (commands.js) instead
});

// Note embeds, hover previews and the slash menu's Template… are shared by
// every editor; their messages go out unlabelled (the main pane's).
const embedPreview = livePreview({
  onOpenLink: (target, newTab) => post({ type: "openLink", target, newTab }),
  onOpenURL: (url) => post({ type: "openURL", url }),
  onOpenTag: (tag) => post({ type: "openTag", tag }),
});
const embedMedia = mediaEmbeds({ onOpenLink: (target, newTab) => post({ type: "openLink", target, newTab }) });
setSlashHandlers({ insertTemplate: () => post({ type: "insertTemplate" }) });

/** The read-only editor inside a note embed: same rendering, no editing. */
function embeddedEditorExtensions() {
  return [
    markdownSupport,
    syntaxHighlighting(holocronHighlight),
    syntaxHighlighting(codeHighlight),
    embedPreview,
    inlineImages,
    imageViewer,
    embedMedia,
    htmlRendering,
    tables,
    mermaidDiagrams,
    math,
    emoji,
    folding,
    comments,
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    embedDepth.of(1),
    holocronTheme,
    Prec.highest(EditorView.theme({
      ".cm-scroller": { padding: "0", fontSize: "0.95em" },
      ".cm-content": { maxWidth: "none", padding: "0" },
    })),
  ];
}

configureEmbeds({
  request: ({ id, target, from }) => {
    if (nativeHandler) return post({ type: "embed", id, target, from });
    // Browser dev mode: embedded notes come from Editor/dev/.
    fetch(`/Editor/dev/${encodeURIComponent(target)}.md`)
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((text) => resolveEmbed(id, { title: target, path: `${target}.md`, text }))
      .catch(() => resolveEmbed(id, null));
  },
  nestedExtensions: embeddedEditorExtensions,
  openLink: (target, newTab) => post({ type: "openLink", target, newTab }),
  currentNote,
});

/** Words and characters selected (words counted like Holocron's word count). */
function selectionStats(state) {
  let words = 0;
  let characters = 0;
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    const text = state.sliceDoc(range.from, range.to);
    words += text.split(/\s+/).filter(Boolean).length;
    characters += text.length;
  }
  return { selectedWords: words, selectedCharacters: characters };
}

// Editor states per note, so switching back keeps undo history and cursor.
const MAX_SAVED_STATES = 30;
const noFocusMode = [];

/**
 * Creates an editor in `parent` and returns its API (what Swift / the app
 * calls). "main" is `window.holocron`; any other `pane` is another pane of the
 * layout (UI-40) or a stacked tab's column (UI-48), whose messages carry that
 * `pane` id. Each has its own note, undo history, mode and saved states.
 */
function createEditor(parent, pane = "main") {
  const send = pane === "main" ? post : (message) => post({ ...message, pane });
  let currentId = null;

  /** Relative image paths and [[ suggestions follow the note of the editor last used. */
  const claimNoteContext = () => {
    if (currentId === null) return;
    setImageContext(currentId);
    setCurrentNote(currentId);
  };

  const notifyNative = EditorView.updateListener.of((update) => {
    // Edits applied from outside (a reload, or the other pane of split view) are
    // already in the document; echoing them back would bounce stale text between panes.
    const fromOutside = update.transactions.every((tr) => !tr.docChanged || tr.isUserEvent("input.external"));
    if (update.docChanged && !fromOutside) {
      send({ type: "change", id: currentId, text: update.state.doc.toString() });
    }
    if (update.docChanged || update.selectionSet) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      send({ type: "selection", id: currentId, line: line.number, column: head - line.from + 1, ...selectionStats(update.state) });
    }
  });

  // ---------- View modes ----------
  // Live preview renders markdown except on the lines you're editing; source
  // mode shows the raw text; reading view renders everything and is read-only
  // (links, embeds and checkboxes still work).

  const preview = livePreview({
    onOpenLink: (target, newTab) => send({ type: "openLink", target, newTab }),
    onOpenURL: (url) => send({ type: "openURL", url }),
    onOpenTag: (tag) => send({ type: "openTag", tag }),
  });
  const media = mediaEmbeds({ onOpenLink: (target, newTab) => send({ type: "openLink", target, newTab }) });

  const rendering = [
    preview,
    noteEmbeds,
    tables,
    mermaidDiagrams,
    math,
    emoji,
    folding,
    headingFolding,
    comments,
    codeBlockTools((code) => send({ type: "copy", text: code })),
    inlineImages,
    imageViewer,
    media,
    htmlRendering,
    properties,
    hoverPreview,
    footnotes,
    headingNavigation,
    richCopy({ post: send }), // copies rendered HTML alongside the markdown
    youtubeCards((url) => send({ type: "openURL", url })),
  ];

  const modeExtensions = {
    live: rendering,
    source: [EditorView.editorAttributes.of({ class: "cm-mode-source" })],
    reading: [
      rendering,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.editorAttributes.of({ class: "cm-mode-reading" }),
    ],
  };

  const modes = new Compartment();
  let currentMode = "live";
  const focusing = new Compartment();
  let focusModeOn = false;

  // ---------- Commands (what Swift / the app runs by name) ----------

  const commands = {
    undo,
    redo,
    bold: toggleBold,
    italic: toggleItalic,
    strikethrough: toggleStrikethrough,
    code: toggleCode,
    link: insertLink,
    task: toggleTask,
    moveDoneTasksDown,
    heading0: setHeading(0),
    heading1: setHeading(1),
    heading2: setHeading(2),
    heading3: setHeading(3),
    table: insertTable,
    highlight: toggleHighlight,
    bulletList: toggleBulletList,
    numberedList: toggleNumberedList,
    quote: toggleQuote,
    codeBlock: insertCodeBlock,
    callout: insertCallout,
    divider: insertDivider,
    find: openSearchPanel,
    findNext,
    findPrevious,
    replaceAll,
    selectMatches: selectSelectionMatches,
    ...tableCommands,
    foldHeading,
    unfoldHeading,
    foldAllHeadings,
    unfoldAll,
    copyMarkdown: copyMarkdown((text) => send({ type: "copy", text })),
    pastePlainText,
    tidyNote,
  };

  // The editor's shortcuts live in a compartment so `setHotkeys` can swap
  // them without rebuilding the editor (HK-01). High precedence: the table
  // keys must beat CodeMirror's defaults (Alt+Shift+↑ copies a line otherwise).
  const hotkeys = new Compartment();
  const hotkeyKeymap = (entries) => Prec.high(keymap.of(entries.filter(({ command }) => commands[command]).map(({ key, command }) => ({ key, run: commands[command] }))));
  let currentHotkeys = hotkeyKeymap(defaultEditorHotkeys);

  /** Brings the view in line with the current mode, focus mode and hotkeys (saved states may be behind). */
  function syncMode() {
    const effects = [];
    if (modes.get(view.state) !== modeExtensions[currentMode]) {
      effects.push(modes.reconfigure(modeExtensions[currentMode]), setFocused.of(currentMode !== "reading" && view.hasFocus));
    }
    const wantFocus = focusModeOn ? focusMode : noFocusMode;
    if (focusing.get(view.state) !== wantFocus) effects.push(focusing.reconfigure(wantFocus));
    if (hotkeys.get(view.state) !== currentHotkeys) effects.push(hotkeys.reconfigure(currentHotkeys));
    if (effects.length) view.dispatch({ effects });
  }

  const extensions = (mode) => [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    markdownSupport,
    markdownKeys,
    syntaxHighlighting(holocronHighlight),
    syntaxHighlighting(codeHighlight),
    firstLineHeading,
    paragraphSpacing,
    tableEditing,
    closeBrackets(),
    wrapSelectionOnInput,
    linkAutocomplete,
    search({ top: true }),
    EditorView.lineWrapping,
    modes.of(modeExtensions[mode]),
    focusing.of(focusModeOn ? focusMode : noFocusMode),
    hotkeys.of(currentHotkeys),
    keymap.of([
      ...closeBracketsKeymap,
      ...fixedSearchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    imagePaste((image) => send({ type: "pasteImage", ...image })),
    // Formatted pastes as markdown; local pictures in them are saved as attachments first.
    pasteMarkdown({
      saveImage: (mime, data) => window.holocronHost?.call("saveAttachmentData", "", mime, data) ?? Promise.resolve(null),
      importFile: (path) => window.holocronHost?.call("importFiles", [path]).then((texts) => texts?.[0] ?? null) ?? Promise.resolve(null),
      // A lone pasted link becomes [Page title](url) (ED-76; main returns null when the setting is off).
      fetchTitle: window.holocronHost ? (url) => window.holocronHost.call("fetchPageTitle", url) : undefined,
    }),
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off" }),
    EditorView.domEventHandlers({ focus: () => void claimNoteContext() }),
    placeholder("Start writing…"),
    holocronTheme,
    notifyNative,
  ];

  function createState(text) {
    return EditorState.create({ doc: text, extensions: extensions(currentMode) });
  }

  const view = new EditorView({ state: createState(""), parent });
  const savedStates = new Map();

  // ---------- API called from Swift ----------

  const api = {
    /**
     * Replaces the editor's shortcuts with the app's effective ones (HK-01):
     * `[{ key: "Ctrl-b", command: "bold" }, …]` in CodeMirror's key spelling.
     * Takes effect at once, in saved states too.
     */
    setHotkeys(entries) {
      currentHotkeys = hotkeyKeymap(Array.isArray(entries) ? entries : defaultEditorHotkeys);
      syncMode();
    },

    /** Shows a note. `id` identifies it (Swift passes the file path). */
    setDocument(text, id) {
      if (currentId !== null && currentId !== id) {
        savedStates.delete(currentId);
        savedStates.set(currentId, view.state);
        if (savedStates.size > MAX_SAVED_STATES) savedStates.delete(savedStates.keys().next().value);
      }
      const saved = savedStates.get(id);
      currentId = id;
      claimNoteContext();
      queueMicrotask(refreshEmbeds);
      if (saved && saved.doc.toString() === text) {
        view.setState(saved);
        syncMode();
      } else {
        view.setState(createState(text));
        view.scrollDOM.scrollTop = 0;
      }
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      send({ type: "selection", id, line: line.number, column: head - line.from + 1 });
    },

    /**
     * Applies a change that came from disk (a reload or merge) as targeted
     * edits, keeping the cursor and undo history. `text` is the expected result;
     * if the editor's content had drifted, the whole document is replaced.
     */
    applyExternalEdits(edits, text, id) {
      if (id !== currentId) {
        savedStates.delete(id);
        return;
      }
      const length = view.state.doc.length;
      const valid = edits.every((e, i) => e.from <= e.to && e.to <= length && (i === 0 || edits[i - 1].to <= e.from));
      if (valid) {
        view.dispatch({ changes: edits, userEvent: "input.external" });
      }
      if (view.state.doc.toString() !== text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.external" });
      }
    },

    /** The vault's notes, attachments and tags, for autocomplete. */
    setVaultData(data) {
      setVaultData(data);
      invalidateEmbeds(); // notes may have changed; embeds refresh if their text did
    },

    /** Holocron's reply to an embed request. */
    resolveEmbed(id, result) {
      resolveEmbed(id, result);
    },

    vaultDataSummary,

    /** A note's file was renamed or moved: keep its state under the new id. */
    renameDocument(oldId, newId) {
      if (savedStates.has(oldId)) {
        savedStates.set(newId, savedStates.get(oldId));
        savedStates.delete(oldId);
      }
      if (currentId === oldId) {
        currentId = newId;
        claimNoteContext();
      }
    },

    /** Forgets a note's saved state (e.g. after it was deleted or renamed). */
    forget(id) {
      savedStates.delete(id);
    },

    run(name) {
      const command = commands[name];
      if (!command) return false;
      // Reading view is read-only: only searching and folding make sense there.
      const readOnlyCommands = ["find", "findNext", "findPrevious", "selectMatches", "foldHeading", "unfoldHeading", "foldAllHeadings", "unfoldAll", "copyMarkdown"];
      if (currentMode === "reading" && !readOnlyCommands.includes(name)) return false;
      view.focus();
      return command(view);
    },

    focus() {
      view.focus();
    },

    /** Inserts a table of `rows` body rows × `columns` at the cursor. */
    insertTable(rows, columns) {
      if (currentMode === "reading") return;
      view.focus();
      insertSizedTable(view, Math.max(1, rows), Math.max(1, columns));
    },

    /** Dims all but the current paragraph and keeps the cursor centred. */
    setFocusMode(on) {
      focusModeOn = Boolean(on);
      syncMode();
      if (focusModeOn) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) });
    },

    /** "line": an active line shows all its markdown; "span": only the element under the cursor. */
    setRevealMode(mode) {
      setRevealMode(view, mode);
    },

    /** Switches between "live" (preview), "source" and "reading". */
    setMode(mode) {
      if (!modeExtensions[mode] || mode === currentMode) return;
      currentMode = mode;
      syncMode();
    },

    /** Applies colours and typography: `vars` are --hc-* CSS properties. */
    setAppearance(vars, mode) {
      const root = document.documentElement;
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.classList.toggle("hc-light", mode === "light");
      root.classList.toggle("hc-dark", mode !== "light");
      root.style.colorScheme = mode === "light" ? "light" : "dark";
      // The key changes with the mode, theme or accent, so diagrams redraw in the new colours.
      view.dispatch({ effects: setMermaidTheme.of(`${mode === "light" ? "light" : "dark"}:${vars["--hc-theme"] ?? ""}:${vars["--hc-accent"] ?? ""}`) });
      view.requestMeasure();
    },

    /**
     * Inserts a template: the body at the cursor (which moves to {{cursor}},
     * or the end), and its properties merged into the note's frontmatter.
     */
    applyTemplate(frontmatter, body) {
      const state = view.state;
      const marker = body.indexOf("{{cursor}}");
      const cleanBody = body.split("{{cursor}}").join("");
      const { from, to } = state.selection.main;
      // Frontmatter first, so at position 0 it lands above the body.
      const changes = state.changes([
        ...mergeFrontmatterChanges(state.doc, frontmatter),
        { from, to, insert: cleanBody },
      ]);
      const start = changes.mapPos(to, 1) - cleanBody.length;
      view.dispatch({
        changes,
        selection: { anchor: start + (marker >= 0 ? marker : cleanBody.length) },
        scrollIntoView: true,
        userEvent: "input.template",
      });
      view.focus();
    },

    /** Inserts text at the cursor (e.g. the embed for a pasted image). */
    insertAtCursor(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      view.focus();
    },

    /** Inserts text where something was dropped (viewport coordinates). */
    insertAtPoint(x, y, text) {
      const pos = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      // Embeds read best on their own line.
      const before = pos > line.from && /\S/.test(view.state.doc.sliceString(pos - 1, pos)) ? "\n" : "";
      const insert = before + text;
      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + insert.length },
        scrollIntoView: true,
        userEvent: "input.drop",
      });
      view.focus();
    },

    /** Selects columns [from, to) (UTF-16) of a 1-based line and centres it. */
    selectInLine(lineNumber, from, to) {
      const doc = view.state.doc;
      const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
      const anchor = Math.min(line.from + from, line.to);
      const head = Math.min(line.from + to, line.to);
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      });
    },

    /** Outline drag (UI-43): the section under the heading on `fromLine` goes before `beforeLine` (null: the end). */
    moveSection(fromLine, beforeLine) {
      if (currentMode === "reading") return false;
      return moveSection(view, fromLine, beforeLine);
    },

    /** Moves the cursor to the start of a 1-based line and scrolls it near the top. */
    scrollToLine(lineNumber) {
      const doc = view.state.doc;
      const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 48 }),
      });
      view.focus();
    },

    getText() {
      return view.state.doc.toString();
    },

    /** The #tag the cursor is on or right after (without the "#"), or null: Format › Rename Tag… (FOP-13). */
    tagAtCursor() {
      const pos = view.state.selection.main.head;
      const tree = syntaxTree(view.state);
      for (const side of [-1, 1]) {
        let node = tree.resolveInner(pos, side);
        while (node && node.name !== "Tag") node = node.parent;
        if (node) return view.state.doc.sliceString(node.from + 1, node.to);
      }
      return null;
    },

    /** The note as a standalone HTML page for Export as PDF / HTML and Print (exporter.js). */
    exportHtml(title) {
      return exportHtml(view.state.doc.toString(), title);
    },

    // ---------- Linked scrolling (UI-47) ----------

    /** The 1-based line at the top of the view (fractional: how far into it the view is scrolled) and the note's line count. */
    getScrollLine() {
      const doc = view.state.doc;
      const height = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
      const block = view.lineBlockAtHeight(height);
      const line = doc.lineAt(block.from).number;
      const within = block.height > 0 ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
      return { line: line + within, lines: doc.lines };
    },

    /** Scrolls so that (fractional, 1-based) `line` is at the top, without moving the cursor. */
    setScrollLine(line) {
      const doc = view.state.doc;
      const number = Math.max(1, Math.min(doc.lines, Math.floor(line)));
      const block = view.lineBlockAt(doc.line(number).from);
      const top = block.top + Math.min(1, Math.max(0, line - number)) * block.height + view.documentPadding.top;
      view.scrollDOM.scrollTop = top;
    },

    /** Calls `listener` whenever the view scrolls; returns a function that stops that. */
    onScroll(listener) {
      view.scrollDOM.addEventListener("scroll", listener);
      return () => view.scrollDOM.removeEventListener("scroll", listener);
    },

    /** Tears the editor down (a pane closed). */
    destroy() {
      view.destroy();
    },
  };

  send({ type: "ready" });
  return api;
}

window.holocron = createEditor(document.getElementById("editor"), "main");
/** Another pane's editor (UI-40) or a stacked tab's (UI-48): the app creates one per pane, named by its id. */
window.holocronCreateEditor = (parent, pane) => createEditor(parent, pane);

// Dev mode (opened in a normal browser): load ?sample=<url> for visual checks.
if (!nativeHandler) {
  const sample = new URLSearchParams(location.search).get("sample");
  if (sample) {
    fetch(sample)
      .then((response) => response.text())
      .then((text) => window.holocron.setDocument(text, sample));
  }
}
