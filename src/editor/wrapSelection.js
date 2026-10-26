// Typing an emphasis character over a selection wraps it instead of replacing
// it: select "word", type * → *word*, type * again → **word**. Brackets and
// quotes already wrap (closeBrackets); this covers the markdown-only marks.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export const WRAP_CHARACTERS = new Set(["*", "_", "~", "=", "`"]);

function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter|CommentBlock)$/.test(node.name)) return true;
  }
  return false;
}

/** The transaction spec that wraps every selected range in `mark`, or null when it doesn't apply. */
export function wrapSelection(state, mark) {
  if (!WRAP_CHARACTERS.has(mark)) return null;
  const { ranges } = state.selection;
  if (ranges.some((range) => range.empty || inCode(state, range.from))) return null;
  return state.changeByRange((range) => ({
    changes: [
      { from: range.from, insert: mark },
      { from: range.to, insert: mark },
    ],
    // Keep the original text selected, so a second keystroke doubles the mark.
    range: EditorSelection.range(range.anchor + mark.length, range.head + mark.length),
  }));
}

export const wrapSelectionOnInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.readOnly || view.composing) return false;
  const spec = wrapSelection(view.state, text);
  if (!spec) return false;
  view.dispatch(view.state.update(spec, { scrollIntoView: true, userEvent: "input.type" }));
  return true;
});
