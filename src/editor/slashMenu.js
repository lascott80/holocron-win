// The slash menu: "/" at the start of a line offers the blocks you can insert,
// filtered as you type ("/tab" → Table). Choosing one replaces the "/query".
import { snippet } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

let handlers = { insertTemplate: null };

/** Actions the menu hands to the app (Insert Template… opens its picker). */
export function setSlashHandlers(next) {
  handlers = { ...handlers, ...next };
}

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const callout = (type, title) => ({ label: `${title} callout`, detail: `> [!${type}]`, section: "Callouts", template: `> [!${type}] \${}\n> ` });

/** Every item: `template` is a snippet (${} marks fields, Tab moves between them), or `run` does something else. */
export const SLASH_ITEMS = [
  { label: "Heading 1", detail: "Ctrl+Alt+1", section: "Text", template: "# ${}" },
  { label: "Heading 2", detail: "Ctrl+Alt+2", section: "Text", template: "## ${}" },
  { label: "Heading 3", detail: "Ctrl+Alt+3", section: "Text", template: "### ${}" },
  { label: "Bullet list", detail: "- ", section: "Text", template: "- ${}" },
  { label: "Numbered list", detail: "1. ", section: "Text", template: "1. ${}" },
  { label: "Task list", detail: "Ctrl+L", section: "Text", template: "- [ ] ${}" },
  { label: "Quote", detail: "> ", section: "Text", template: "> ${}" },
  callout("note", "Note"),
  callout("tip", "Tip"),
  callout("warning", "Warning"),
  callout("danger", "Danger"),
  callout("question", "Question"),
  { label: "Table", detail: "3 × 2", section: "Blocks", template: "| ${Column} | ${Column} | ${Column} |\n| --- | --- | --- |\n| ${} |  |  |\n|  |  |  |" },
  { label: "Code block", detail: "```", section: "Blocks", template: "```${language}\n${}\n```" },
  { label: "Math block", detail: "$$", section: "Blocks", template: "$$\n${}\n$$" },
  { label: "Mermaid diagram", detail: "```mermaid", section: "Blocks", template: "```mermaid\nflowchart LR\n  ${A} --> ${B}\n```" },
  { label: "Collapsible section", detail: "<details>", section: "Blocks", template: "<details>\n<summary>${Summary}</summary>\n\n${}\n\n</details>" },
  { label: "Divider", detail: "---", section: "Blocks", template: "---\n${}" },
  { label: "Table of contents", detail: "[TOC]", section: "Blocks", template: "[TOC]\n${}" },
  { label: "Today's date", detail: "YYYY-MM-DD", section: "Insert", template: () => `${today()}\${}` },
  { label: "Template…", detail: "Ctrl+Alt+T", section: "Insert", run: () => handlers.insertTemplate?.() },
];

function inCodeOrTable(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter|Table|HTMLBlock|CommentBlock)$/.test(node.name)) return true;
  }
  return false;
}

function applyItem(item) {
  if (item.run) {
    return (view, _completion, from, to) => {
      view.dispatch({ changes: { from: from - 1, to }, userEvent: "input.complete" });
      item.run(view);
    };
  }
  return (view, completion, from, to) => {
    const template = typeof item.template === "function" ? item.template() : item.template;
    snippet(template)(view, completion, from - 1, to); // from - 1: the slash goes too
  };
}

const SECTIONS = Object.fromEntries(["Text", "Callouts", "Blocks", "Insert"].map((name, rank) => [name, { name, rank }]));

const OPTIONS = SLASH_ITEMS.map((item, index) => ({
  label: item.label,
  detail: item.detail,
  section: SECTIONS[item.section],
  boost: -index / 100, // keep the menu's own order when nothing is typed
  apply: applyItem(item),
}));

/** Completion source: "/" (plus a filter) alone on a line, outside code and tables. */
export function slashCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^\s*\/([\w' ]*)$/.exec(before);
  if (!match || line.text.slice(before.length).trim() !== "" || inCodeOrTable(context.state, context.pos)) return null;
  // Matching runs on the query after the slash; choosing an item removes the slash too.
  return { from: context.pos - match[1].length, options: OPTIONS, validFor: /^[\w' ]*$/ };
}
