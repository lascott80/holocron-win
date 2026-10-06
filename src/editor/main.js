// Holocron's markdown editor. Runs inside a WKWebView; Swift drives it through
// `window.holocron` and listens on the `holocron` script message handler.
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { indentOnInput, syntaxHighlighting } from "@codemirror/language";
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

import { Frontmatter, Highlight, Tag, WikiLink } from "./syntax.js";
import { codeBlockTools, codeHighlight, codeLanguage } from "./codeblocks.js";
import { insertTable, tables } from "./tables.js";
import { firstLineHeading } from "./firstHeading.js";
import { setFocused } from "./focus.js";
import { hoverPreview } from "./hoverPreview.js";
import { focusMode } from "./focusMode.js";
import { insertSizedTable, tableCommands, tableEditing } from "./tableEditing.js";
import { folding } from "./folds.js";
import { foldAllHeadings, foldHeading, headingFoldKeymap, headingFolding, unfoldAll, unfoldHeading } from "./headingFolds.js";
import { comments } from "./comments.js";
import { mermaidDiagrams, setMermaidTheme } from "./mermaid.js";
import { math } from "./math.js";
import { emoji } from "./emoji.js";
import { livePreview } from "./livePreview.js";
import { currentNote, imagePaste, inlineImages, setImageContext } from "./images.js";
import { mediaEmbeds } from "./media.js";
import { htmlRendering } from "./html.js";
import { copyMarkdown, richCopy } from "./richCopy.js";
import { pasteMarkdown, pastePlainText } from "./pasteMarkdown.js";
import { configureEmbeds, embedDepth, invalidateEmbeds, noteEmbeds, refreshEmbeds, resolveEmbed } from "./embeds.js";
import { Prec } from "@codemirror/state";
import { mergeFrontmatterChanges, properties } from "./properties.js";
import { linkAutocomplete, setVaultData, vaultDataSummary } from "./completions.js";
import { holocronHighlight, holocronTheme } from "./theme.js";
import {
  insertLink,
  setHeading,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrikethrough,
  toggleTask,
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

let currentId = null;

// ---------- Editor setup ----------

const formatKeymap = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-e", run: toggleCode },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-l", run: toggleTask },
  { key: "Mod-Shift-h", run: toggleHighlight },
  { key: "Mod-Alt-0", run: setHeading(0) },
  { key: "Mod-Alt-1", run: setHeading(1) },
  { key: "Mod-Alt-2", run: setHeading(2) },
  { key: "Mod-Alt-3", run: setHeading(3) },
  { key: "Mod-Shift-v", run: pastePlainText }, // Paste as Plain Text (Windows convention)
];

const markdownSupport = markdown({
  base: markdownLanguage,
  extensions: [Frontmatter, WikiLink, Tag, Highlight],
  codeLanguages: codeLanguage,
});

const preview = livePreview({
  onOpenLink: (target, newTab) => post({ type: "openLink", target, newTab }),
  onOpenURL: (url) => post({ type: "openURL", url }),
  onOpenTag: (tag) => post({ type: "openTag", tag }),
});
const media = mediaEmbeds({ onOpenLink: (target, newTab) => post({ type: "openLink", target, newTab }) });

/** The read-only editor inside a note embed: same rendering, no editing. */
function embeddedEditorExtensions() {
  return [
    markdownSupport,
    syntaxHighlighting(holocronHighlight),
    syntaxHighlighting(codeHighlight),
    preview,
    inlineImages,
    media,
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

const notifyNative = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    post({ type: "change", id: currentId, text: update.state.doc.toString() });
  }
  if (update.docChanged || update.selectionSet) {
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    post({ type: "selection", id: currentId, line: line.number, column: head - line.from + 1, ...selectionStats(update.state) });
  }
});

// ---------- View modes ----------
// Live preview renders markdown except on the lines you're editing; source
// mode shows the raw text; reading view renders everything and is read-only
// (links, embeds and checkboxes still work).

const rendering = [
  preview,
  noteEmbeds,
  tables,
  mermaidDiagrams,
  math,
  emoji,
  folding,
  headingFolding,
  keymap.of(headingFoldKeymap),
  comments,
  codeBlockTools((code) => post({ type: "copy", text: code })),
  inlineImages,
  media,
  htmlRendering,
  properties,
  hoverPreview,
  richCopy({ post }), // copies rendered HTML alongside the markdown
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

/** Brings the view in line with the current mode and focus mode (saved states may be behind). */
function syncMode() {
  const effects = [];
  if (modes.get(view.state) !== modeExtensions[currentMode]) {
    effects.push(modes.reconfigure(modeExtensions[currentMode]), setFocused.of(currentMode !== "reading" && view.hasFocus));
  }
  const wantFocus = focusModeOn ? focusMode : noFocusMode;
  if (focusing.get(view.state) !== wantFocus) effects.push(focusing.reconfigure(wantFocus));
  if (effects.length) view.dispatch({ effects });
}
const noFocusMode = [];

const extensions = (mode) => [
  history(),
  drawSelection(),
  dropCursor(),
  rectangularSelection(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  markdownSupport,
  syntaxHighlighting(holocronHighlight),
  syntaxHighlighting(codeHighlight),
  firstLineHeading,
  tableEditing,
  closeBrackets(),
  linkAutocomplete,
  search({ top: true }),
  EditorView.lineWrapping,
  modes.of(modeExtensions[mode]),
  focusing.of(focusModeOn ? focusMode : noFocusMode),
  keymap.of([
    ...formatKeymap,
    ...closeBracketsKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...defaultKeymap,
    indentWithTab,
  ]),
  imagePaste((image) => post({ type: "pasteImage", ...image })),
  // Formatted pastes as markdown; local pictures in them are saved as attachments first.
  pasteMarkdown({
    saveImage: (mime, data) => window.holocronHost?.call("saveAttachmentData", "", mime, data) ?? Promise.resolve(null),
    importFile: (path) => window.holocronHost?.call("importFiles", [path]).then((texts) => texts?.[0] ?? null) ?? Promise.resolve(null),
  }),
  EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off" }),
  placeholder("Start writing…"),
  holocronTheme,
  notifyNative,
];

function createState(text) {
  return EditorState.create({ doc: text, extensions: extensions(currentMode) });
}

const view = new EditorView({
  state: createState(""),
  parent: document.getElementById("editor"),
});

// Editor states per note, so switching back keeps undo history and cursor.
const savedStates = new Map();
const MAX_SAVED_STATES = 30;

// ---------- API called from Swift ----------

const commands = {
  undo,
  redo,
  bold: toggleBold,
  italic: toggleItalic,
  strikethrough: toggleStrikethrough,
  code: toggleCode,
  link: insertLink,
  task: toggleTask,
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
  copyMarkdown: copyMarkdown((text) => post({ type: "copy", text })),
  pastePlainText,
};

window.holocron = {
  /** Shows a note. `id` identifies it (Swift passes the file path). */
  setDocument(text, id) {
    if (currentId !== null && currentId !== id) {
      savedStates.delete(currentId);
      savedStates.set(currentId, view.state);
      if (savedStates.size > MAX_SAVED_STATES) savedStates.delete(savedStates.keys().next().value);
    }
    const saved = savedStates.get(id);
    currentId = id;
    setImageContext(id);
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
    post({ type: "selection", id, line: line.number, column: head - line.from + 1 });
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
      setImageContext(newId);
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
    view.dispatch({ effects: setMermaidTheme.of(`${mode === "light" ? "light" : "dark"}:${vars["--hc-accent"] ?? ""}`) });
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
};

post({ type: "ready" });

// Dev mode (opened in a normal browser): load ?sample=<url> for visual checks.
if (!nativeHandler) {
  const sample = new URLSearchParams(location.search).get("sample");
  if (sample) {
    fetch(sample)
      .then((response) => response.text())
      .then((text) => window.holocron.setDocument(text, sample));
  }
}
