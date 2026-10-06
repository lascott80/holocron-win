// Focus mode: everything but the paragraph you're in is dimmed, and the line
// you're typing on stays in the middle of the window (typewriter scrolling).
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

const dimmed = Decoration.line({ class: "cm-dimmed" });

/** The lines of the paragraph (run of non-blank lines) around the cursor. */
function currentParagraph(state) {
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  if (!line.text.trim()) return { first: line.number, last: line.number };
  let first = line.number;
  let last = line.number;
  while (first > 1 && doc.line(first - 1).text.trim()) first--;
  while (last < doc.lines && doc.line(last + 1).text.trim()) last++;
  return { first, last };
}

function dimming(view) {
  // Reading view has no cursor, so there's no paragraph to focus on.
  if (!view.state.facet(EditorView.editable)) return Decoration.none;
  const { doc } = view.state;
  const { first, last } = currentParagraph(view.state);
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (line.number < first || line.number > last) builder.add(line.from, line.from, dimmed);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const dimOthers = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = dimming(view);
    }
    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = dimming(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Typewriter scrolling: every edit or cursor move recentres the cursor's line. */
const typewriter = EditorState.transactionExtender.of((transaction) =>
  transaction.selection || transaction.docChanged
    ? { effects: EditorView.scrollIntoView(transaction.newSelection.main.head, { y: "center" }) }
    : null,
);

export const focusMode = [dimOthers, typewriter, EditorView.editorAttributes.of({ class: "cm-focus-mode" })];
