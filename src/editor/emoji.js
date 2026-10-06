// Emoji shortcodes like GitHub: `:rocket:` shows 🚀 except on active lines.
// The file keeps the shortcode; only known names render, and not in code,
// frontmatter, URLs, wikilinks or raw HTML.
import { Decoration, ViewPlugin, WidgetType, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { activeLines } from "./livePreview.js";
import { EMOJI } from "./emojiData.js";

const SHORTCODE = /:([a-z0-9_+-]+):/g;

/** Known `:name:` shortcodes in a line of text, with word boundaries so times and URLs don't match. */
export function findShortcodes(text) {
  const found = [];
  let lastEnd = -1;
  SHORTCODE.lastIndex = 0;
  for (let match; (match = SHORTCODE.exec(text)); ) {
    const from = match.index;
    const to = from + match[0].length;
    const before = text[from - 1] ?? "";
    const okBefore = from === lastEnd || !/[\w/:]/.test(before);
    const emoji = Object.hasOwn(EMOJI, match[1]) ? EMOJI[match[1]] : null;
    if (!okBefore || !emoji || /\w/.test(text[to] ?? "")) {
      SHORTCODE.lastIndex = from + 1;
      continue;
    }
    found.push({ from, to, name: match[1], emoji });
    lastEnd = to;
  }
  return found;
}

const NOT_EMOJI = /^(InlineCode|FencedCode|CodeBlock|Frontmatter|URL|Autolink|HTMLTag|HTMLBlock|CommentBlock|WikiLink|Table)$/;

/** Shortcodes in the lines of [from, to] outside code etc. Positions are document offsets. */
export function shortcodesIn(state, from, to) {
  const { doc } = state;
  const tree = syntaxTree(state);
  const found = [];
  for (let pos = doc.lineAt(from).from; pos <= to; ) {
    const line = doc.lineAt(pos);
    pos = line.to + 1;
    if (!line.text.includes(":")) continue;
    for (const code of findShortcodes(line.text)) {
      let excluded = false;
      tree.iterate({
        from: line.from + code.from,
        to: line.from + code.to,
        enter(node) {
          if (NOT_EMOJI.test(node.name)) excluded = true;
          return !excluded;
        },
      });
      if (!excluded) found.push({ ...code, from: line.from + code.from, to: line.from + code.to });
    }
  }
  return found;
}

class EmojiWidget extends WidgetType {
  constructor(emoji, name) {
    super();
    this.emoji = emoji;
    this.name = name;
  }
  eq(other) {
    return other.emoji === this.emoji && other.name === this.name;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-emoji";
    span.textContent = this.emoji;
    span.title = `:${this.name}:`;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view) {
  const active = activeLines(view);
  const { state } = view;
  const decorations = [];
  for (const { from, to } of view.visibleRanges) {
    for (const code of shortcodesIn(state, from, to)) {
      if (active.has(state.doc.lineAt(code.from).number)) continue;
      decorations.push(Decoration.replace({ widget: new EmojiWidget(code.emoji, code.name) }).range(code.from, code.to));
    }
  }
  return Decoration.set(decorations, true);
}

const emojiPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = build(view);
    }
    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const emojiTheme = EditorView.baseTheme({
  ".cm-emoji": { fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif" },
});

export const emoji = [emojiPlugin, emojiTheme];
