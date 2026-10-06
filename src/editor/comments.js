// Obsidian comments: %% hidden text %%, inline or across lines. Hidden
// unless you're editing inside one, when it shows dimmed.
import { StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { focusChanged, focusTracking, isEditing } from "./focus.js";

/** Comment ranges in the document, skipping fenced and inline code. */
export function findComments(text) {
  const comments = [];
  let fence = null;
  let offset = 0;
  let open = null; // start of an unfinished multi-line comment
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (open === null) {
      if (fence) {
        if (trimmed.startsWith(fence)) fence = null;
        offset += line.length + 1;
        continue;
      }
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        fence = trimmed.slice(0, 3);
        offset += line.length + 1;
        continue;
      }
    }
    // Blank out inline code so %% inside `code` doesn't count.
    const scan = line.replace(/`[^`]*`/g, (code) => " ".repeat(code.length));
    let index = 0;
    while (index < scan.length) {
      const next = scan.indexOf("%%", index);
      if (next < 0) break;
      if (open === null) {
        open = offset + next;
      } else {
        comments.push({ from: open, to: offset + next + 2 });
        open = null;
      }
      index = next + 2;
    }
    offset += line.length + 1;
  }
  return comments;
}

function buildComments(state) {
  const { doc } = state;
  const decorations = [];
  for (const comment of findComments(doc.toString())) {
    if (isEditing(state, comment.from, comment.to)) {
      decorations.push(Decoration.mark({ class: "cm-comment" }).range(comment.from, comment.to));
      continue;
    }
    const first = doc.lineAt(comment.from);
    const last = doc.lineAt(comment.to);
    const wholeLines = comment.from === first.from && comment.to === last.to;
    if (wholeLines && last.number < doc.lines) {
      // Collapse the lines entirely, newline included.
      decorations.push(Decoration.replace({ block: true }).range(first.from, last.to));
    } else {
      decorations.push(Decoration.replace({}).range(comment.from, comment.to));
    }
  }
  return Decoration.set(decorations, true);
}

const commentDecorations = StateField.define({
  create: buildComments,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || focusChanged(transaction) ? buildComments(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const comments = [focusTracking, commentDecorations];
