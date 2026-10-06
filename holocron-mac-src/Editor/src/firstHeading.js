// Typing into an empty note starts it with a "# " heading, so the first line
// is a real H1 (and becomes the note's name). Starting with markdown of your
// own (a list, quote, heading, table…) is left alone, and Backspace on an
// empty heading removes the whole "# " marker. Removing the automatic marker
// that way means "no heading here", so it isn't added again for this note.
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const MARKDOWN_START = /^[\s#\-*+>`|!\[<$=~]/;

const decline = StateEffect.define();
const declined = StateField.define({
  create: () => false,
  update: (value, transaction) => value || transaction.effects.some((effect) => effect.is(decline)),
});

const typeFirstLine = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.doc.length !== 0 || from !== 0 || to !== 0 || view.state.field(declined)) return false;
  if (!text || MARKDOWN_START.test(text) || view.composing) return false;
  const insert = `# ${text}`;
  view.dispatch({
    changes: { from: 0, insert },
    selection: { anchor: insert.length },
    userEvent: "input.type",
  });
  return true;
});

/** Backspace at the end of a bare "# " (any level) clears the marker in one go. */
function deleteEmptyHeading(view) {
  const range = view.state.selection.main;
  if (!range.empty || view.state.selection.ranges.length > 1) return false;
  const line = view.state.doc.lineAt(range.head);
  if (range.head !== line.to || !/^#{1,6} $/.test(line.text)) return false;
  const emptiesNote = view.state.doc.length === line.text.length;
  view.dispatch({
    changes: { from: line.from, to: line.to },
    effects: emptiesNote ? decline.of(true) : [],
    userEvent: "delete.backward",
  });
  return true;
}

export const firstLineHeading = [declined, typeFirstLine, Prec.high(keymap.of([{ key: "Backspace", run: deleteEmptyHeading }]))];
