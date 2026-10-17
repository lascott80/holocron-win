// Reading typography: blank lines between paragraphs get a class so
// Settings › Paragraph spacing can make them shorter or taller (theme.js),
// without touching the text. Blank lines inside code, frontmatter and math
// blocks keep their full height.
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const blank = Decoration.line({ class: "cm-blank-line" });
const KEEP = /^(FencedCode|CodeBlock|Frontmatter|HTMLBlock|CommentBlock)$/;

/** Line numbers (1-based) of blank lines that separate paragraphs, among lines [first, last]. */
export function spacingLines(doc, tree, first, last) {
  const lines = [];
  let inMath = false;
  // $$ blocks aren't in the syntax tree; track them from the top of the range.
  for (let n = 1; n < first; n++) if (/^\s{0,3}\$\$/.test(doc.line(n).text) && !/\$\$.*\$\$/.test(doc.line(n).text)) inMath = !inMath;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    if (/^\s{0,3}\$\$/.test(line.text) && !/\$\$.*\$\$/.test(line.text)) inMath = !inMath;
    if (line.text.trim() !== "" || inMath) continue;
    let kept = false;
    for (let node = tree.resolveInner(line.from, 1); node; node = node.parent) {
      if (KEEP.test(node.name)) {
        kept = true;
        break;
      }
    }
    if (!kept) lines.push(n);
  }
  return lines;
}

export const paragraphSpacing = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build(update.view);
      }
    }
    build(view) {
      const builder = new RangeSetBuilder();
      const { doc } = view.state;
      const tree = syntaxTree(view.state);
      for (const { from, to } of view.visibleRanges) {
        for (const n of spacingLines(doc, tree, doc.lineAt(from).number, doc.lineAt(to).number)) {
          builder.add(doc.line(n).from, doc.line(n).from, blank);
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
