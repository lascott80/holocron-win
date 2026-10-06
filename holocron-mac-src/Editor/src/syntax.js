// Markdown syntax extensions for the Lezer markdown parser:
// Obsidian-style [[wikilinks]], #tags, and YAML frontmatter.
import { tags as t } from "@lezer/highlight";

const OPEN_BRACKET = 91; // [
const HASH = 35; // #

/** [[Target]], [[Target|Alias]], [[Target#Heading]] */
export const WikiLink = {
  defineNodes: [
    { name: "WikiLink", style: t.link },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1;
        const match = /^([^\[\]\n|]+)(\|[^\[\]\n]*)?\]\]/.exec(cx.slice(pos + 2, cx.end));
        if (!match) return -1;
        const end = pos + 2 + match[0].length;
        return cx.addElement(
          cx.elt("WikiLink", pos, end, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkMark", end - 2, end),
          ]),
        );
      },
    },
  ],
};

/** #tag, #nested/tag — must start after whitespace and contain a non-digit. */
export const Tag = {
  defineNodes: [{ name: "Tag", style: t.labelName }],
  parseInline: [
    {
      name: "Tag",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        const prev = pos > cx.offset ? cx.char(pos - 1) : -1;
        if (prev !== -1 && !/\s/.test(String.fromCharCode(prev))) return -1;
        const match = /^#[\p{L}\p{N}_\-\/]+/u.exec(cx.slice(pos, cx.end));
        if (!match || /^#[\d\/]+$/.test(match[0])) return -1;
        return cx.addElement(cx.elt("Tag", pos, pos + match[0].length));
      },
    },
  ],
};

/** A YAML block delimited by --- lines at the very start of the document. */
export const Frontmatter = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "FrontmatterMark", style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== "---") return false;
        const start = cx.lineStart;
        const marks = [cx.elt("FrontmatterMark", start, start + 3)];
        let end = start + line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          const trimmed = line.text.trimEnd();
          if (trimmed === "---" || trimmed === "...") {
            marks.push(cx.elt("FrontmatterMark", cx.lineStart, cx.lineStart + 3));
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("Frontmatter", start, end, marks));
        return true;
      },
    },
  ],
};

const HighlightDelimiter = { resolve: "Highlight", mark: "HighlightMark" };
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const EQUALS = 61; // =

/** ==highlighted text== (Obsidian), parsed like ~~strikethrough~~. */
export const Highlight = {
  defineNodes: [
    { name: "Highlight", style: t.special(t.content) },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION.test(before);
        const punctAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          HighlightDelimiter,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
    },
  ],
};
