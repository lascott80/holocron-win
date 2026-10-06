import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Frontmatter, Highlight, Tag, WikiLink } from "../../src/editor/syntax.js";

/** A minimal stand-in for an EditorView: commands only need `state` and `dispatch`. */
export function makeView(doc: string, cursor = 0, extensions: Extension[] = [], anchor?: number) {
  const view = {
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor ?? cursor, cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter, WikiLink, Tag, Highlight] }), ...extensions],
    }),
    dispatch(...specs: any[]) {
      view.state = specs.length === 1 && specs[0]?.state ? specs[0].state : view.state.update(...specs).state;
    },
  };
  return view as any;
}

/** "a|b" → doc "ab", cursor 1. */
export function withCursor(text: string) {
  const at = text.indexOf("|^|");
  return { doc: text.replace("|^|", ""), cursor: at };
}
