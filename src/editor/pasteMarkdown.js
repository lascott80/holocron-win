// Paste as Markdown: formatted content copied from a web page, Outlook, Word
// or Teams pastes as clean markdown (htmlToMarkdown.js) instead of plain
// text. Ctrl+Shift+V pastes plain text with no conversion at all.
//
// What a paste does (`pastePlan`, in order):
//   read-only editor                         → nothing
//   inside fenced/inline code or frontmatter → the plain text (CodeMirror's own paste)
//   a spreadsheet grid (tab-separated text)  → tableEditing.js makes a table (ED-33)
//   a URL over selected text                 → [selection](url) (ED-48)
//   no HTML                                  → plain text (and images.js saves a pasted picture)
//   HTML that's just pictures + image data   → images.js saves the picture
//   inside a table                           → plain text (a converted block would break the table)
//   Holocron's own rich copy                 → its text/plain, which is the original markdown
//   HTML with nothing to convert             → plain text (Notepad-like sources, code editors)
//   anything else                            → the HTML converted to markdown
//
// Local pictures in the HTML (data: URIs, and the file:/// temp files Outlook
// and Word put on the clipboard) are saved as attachments first, so the paste
// is inserted when they're done — at the paste position mapped through any
// edits made in the meantime.
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { analyzeHtml, markdownFromAnalysis } from "./htmlToMarkdown.js";
import { parseDelimited } from "./tableEditing.js";
import { findTables } from "./tables.js";

// ---------- Deciding ----------

/** Text Excel/Sheets put on the clipboard: tab-separated, 2+ rows of the same 2+ columns (as tableEditing.js). */
export function isSpreadsheet(text) {
  if (!text || !text.includes("\t")) return false;
  const rows = parseDelimited(text.replace(/\n$/, ""), "\t");
  return rows.length >= 2 && rows[0].length >= 2 && rows.every((cells) => cells.length === rows[0].length);
}

/** The URL if the text is a single http(s) or www. URL, else null (`www.` gets https://). */
export function singleUrl(text) {
  const value = String(text ?? "").trim();
  if (!/^(https?:\/\/|www\.)[^\s<>"]+$/i.test(value)) return null;
  return /^www\./i.test(value) ? `https://${value}` : value;
}

/**
 * What a paste should do. `context`: { readOnly, code, table, selection }
 * (selection = the selected text when there's one range). Returns
 * { action: "default" | "link" | "markdown", reason, url?, analysis? };
 * "default" leaves the paste to the other handlers and CodeMirror.
 */
export function pastePlan({ text = "", html = "", imageFiles = 0, context = {} }, options = {}) {
  const pass = (reason) => ({ action: "default", reason });
  if (context.readOnly) return pass("readOnly");
  if (context.code) return pass("code");
  if (!context.table && isSpreadsheet(text)) return pass("spreadsheet");
  const url = context.selection && !context.selection.includes("\n") ? singleUrl(text) : null;
  if (url) return { action: "link", reason: "url", url };
  if (!html || !html.trim()) return pass(imageFiles ? "image" : "noHtml");
  const analysis = analyzeHtml(html, options);
  if (imageFiles && analysis.onlyImages) return pass("image");
  if (context.table) return pass("table");
  if (analysis.holocron && text) return pass("holocron");
  if (analysis.plain && text) return pass("plain");
  return { action: "markdown", reason: "html", analysis };
}

/** Whether `pos` is in fenced, indented or inline code, or the frontmatter. */
function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

function inTable(state, pos) {
  if (!state.doc.lineAt(pos).text.includes("|")) return false;
  return findTables(state.doc).some((table) => pos >= table.from && pos <= table.to);
}

/** The editor facts pastePlan needs. */
export function pasteContext(state) {
  const { main } = state.selection;
  return {
    readOnly: state.readOnly,
    code: inCode(state, main.from) || (!main.empty && inCode(state, main.to)),
    table: inTable(state, main.from),
    selection: state.selection.ranges.length === 1 && !main.empty ? state.sliceDoc(main.from, main.to) : "",
  };
}

// ---------- Inserting ----------

const BLOCK_START = /^(#{1,6} |\||```|~~~|> |[-*] |\d{1,9}[.)] |---$)/;

/**
 * The change that inserts converted markdown over [from, to): blocks that
 * must start a line (headings, tables, lists, fences…) go on lines of their
 * own when pasted mid-line.
 */
export function insertion(doc, from, to, markdown) {
  const before = doc.sliceString(doc.lineAt(from).from, from);
  const after = doc.sliceString(to, doc.lineAt(to).to);
  const multiline = markdown.includes("\n");
  const prefix = before.trim() && (BLOCK_START.test(markdown) || (multiline && /^(```|~~~|\|)/m.test(markdown))) ? "\n\n" : "";
  const lastLine = markdown.slice(markdown.lastIndexOf("\n") + 1);
  const suffix = after.trim() && multiline && /^(```|~~~|\||#{1,6} )/.test(lastLine) ? "\n\n" : "";
  const insert = prefix + markdown + suffix;
  return { changes: { from, to, insert }, cursor: from + prefix.length + markdown.length };
}

function insert(view, from, to, markdown, effects = []) {
  const { changes, cursor } = insertion(view.state.doc, from, to, markdown);
  view.dispatch({
    changes,
    selection: { anchor: cursor },
    effects,
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

// Pastes waiting for their pictures to be saved: id → range, mapped through edits.
const trackPaste = StateEffect.define();
const finishPaste = StateEffect.define();
const pendingPastes = StateField.define({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged && value.size) {
      next = new Map();
      for (const [id, range] of value) {
        next.set(id, { from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) });
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(trackPaste)) next = new Map(next).set(effect.value.id, { from: effect.value.from, to: effect.value.to });
      else if (effect.is(finishPaste)) {
        next = new Map(next);
        next.delete(effect.value);
      }
    }
    return next;
  },
});

/** Saves the HTML's local pictures; src → embed text for those that worked. */
async function saveImages(images, { saveImage, importFile }) {
  const resolved = new Map();
  await Promise.all(images.map(async (image) => {
    try {
      const text = image.kind === "data" ? await saveImage?.(image.mime, image.data) : await importFile?.(image.path);
      if (typeof text === "string" && text) resolved.set(image.src, text.trim());
    } catch (error) {
      console.error("Couldn’t save a pasted picture:", error);
    }
  }));
  return resolved;
}

let pasteCount = 0;

/**
 * Handles a paste event; true if it took the paste (its default is then
 * prevented). `saveImage(mime, base64)` and `importFile(path)` save a picture
 * as an attachment and resolve to its embed text (or null). `options.parse`
 * is for tests (see htmlToMarkdown.js). Returns the pending picture save as
 * `handlePaste.pending` (for tests).
 */
export function handlePaste(event, view, { saveImage, importFile } = {}, options = {}) {
  const data = event.clipboardData;
  if (!data) return false;
  let plan;
  try {
    plan = pastePlan({
      text: data.getData("text/plain"),
      html: data.getData("text/html"),
      imageFiles: Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/")).length,
      context: pasteContext(view.state),
    }, options);
  } catch (error) {
    console.error("Paste as Markdown failed:", error);
    return false;
  }
  if (plan.action === "default") return false;
  const { from, to } = view.state.selection.main;
  if (plan.action === "link") {
    event.preventDefault();
    const text = `[${view.state.sliceDoc(from, to)}](${plan.url})`;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.paste" });
    return true;
  }
  const { analysis } = plan;
  if (!analysis.images.length) {
    let markdown;
    try {
      markdown = markdownFromAnalysis(analysis);
    } catch (error) {
      console.error("Paste as Markdown failed:", error);
      return false; // CodeMirror pastes the plain text instead
    }
    event.preventDefault();
    if (markdown) insert(view, from, to, markdown);
    return true;
  }
  // Pictures to save first: remember where the paste goes, insert when they're done.
  event.preventDefault();
  const id = ++pasteCount;
  const fallback = data.getData("text/plain");
  view.dispatch({ effects: trackPaste.of({ id, from, to }) });
  handlePaste.pending = saveImages(analysis.images, { saveImage, importFile }).then((images) => {
    const range = view.state.field(pendingPastes, false)?.get(id);
    if (!range) return; // another note is showing now
    let markdown;
    try {
      markdown = markdownFromAnalysis(analysis, { images });
    } catch (error) {
      console.error("Paste as Markdown failed:", error);
      markdown = fallback;
    }
    insert(view, range.from, range.to, markdown, [finishPaste.of(id)]);
  });
  return true;
}
handlePaste.pending = null;

/** The state field that remembers pastes waiting for their pictures. */
export const pasteTracking = pendingPastes;

/**
 * The paste extension. High precedence so it sees pastes before images.js
 * and tableEditing.js; pastePlan hands spreadsheets and plain pictures back
 * to them.
 */
export function pasteMarkdown(deps = {}) {
  return [pendingPastes, Prec.high(EditorView.domEventHandlers({ paste: (event, view) => handlePaste(event, view, deps) }))];
}

/** Ctrl+Shift+V: the clipboard's plain text, exactly as it is (no conversion, no table or link magic). */
export function pastePlainText(view) {
  if (view.state.readOnly) return false;
  const read = globalThis.navigator?.clipboard?.readText?.();
  if (!read) return false;
  read
    .then((text) => {
      if (!text) return;
      view.dispatch({ ...view.state.replaceSelection(text.replace(/\r\n?/g, "\n")), scrollIntoView: true, userEvent: "input.paste" });
    })
    .catch((error) => console.error("Paste as plain text failed:", error));
  return true;
}
