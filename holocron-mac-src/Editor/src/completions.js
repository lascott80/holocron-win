// Autocomplete for [[links]], [[Note#headings]], ![[embeds]] and #tags.
// Holocron sends the vault's notes, attachments and tags via setVaultData.
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

let vault = { notes: [], attachments: [], tags: [] };

/**
 * notes: [{ path, title, aliases, headings: [{ text, level }], recent }]
 * attachments: [paths]; tags: [{ tag, count }]
 */
export function setVaultData(data) {
  vault = {
    notes: data.notes ?? [],
    attachments: data.attachments ?? [],
    tags: data.tags ?? [],
  };
  // Note names that appear more than once need their path to be unambiguous.
  const counts = new Map();
  for (const note of vault.notes) counts.set(note.title.toLowerCase(), (counts.get(note.title.toLowerCase()) ?? 0) + 1);
  for (const note of vault.notes) note.ambiguous = counts.get(note.title.toLowerCase()) > 1;
}

/** Counts of what autocomplete knows about (for debugging). */
export function vaultDataSummary() {
  return { notes: vault.notes.length, attachments: vault.attachments.length, tags: vault.tags.length };
}

function folderOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function withoutExtension(path) {
  return path.replace(/\.(md|markdown)$/i, "");
}

function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
  }
  return false;
}

/** Inserts `text` and the closing ]] (unless already there), cursor after it. */
function applyLink(text) {
  return (view, _completion, from, to) => {
    const hasClose = view.state.sliceDoc(to, to + 2) === "]]";
    view.dispatch({
      changes: { from, to, insert: hasClose ? text : text + "]]" },
      selection: { anchor: from + text.length + 2 },
      userEvent: "input.complete",
    });
  };
}

function noteTarget(note) {
  return note.ambiguous ? withoutExtension(note.path) : note.title;
}

function linkCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /(!?)\[\[([^[\]|\n]*)$/.exec(before);
  if (!match || inCode(context.state, context.pos)) return null;
  const isEmbed = match[1] === "!";
  const query = match[2];
  const from = context.pos - query.length;

  // [[Note#… → that note's headings
  const hash = query.indexOf("#");
  if (hash >= 0) {
    const name = query.slice(0, hash).trim().toLowerCase();
    const note = vault.notes.find(
      (n) => n.title.toLowerCase() === name || withoutExtension(n.path).toLowerCase() === name,
    );
    if (!note || !note.headings?.length) return null;
    const headingFrom = from + hash + 1;
    return {
      from: headingFrom,
      options: note.headings.map((heading, index) => ({
        label: heading.text,
        detail: "H" + heading.level,
        boost: -index / 1000,
        apply: (view, completion, f, t) => applyLink(heading.text)(view, completion, f, t),
      })),
      validFor: /^[^[\]|#\n]*$/,
    };
  }

  const options = [];
  for (const note of vault.notes) {
    const target = noteTarget(note);
    options.push({
      label: note.title,
      detail: folderOf(note.path),
      boost: note.recent ?? 0,
      apply: applyLink(target),
    });
    for (const alias of note.aliases ?? []) {
      options.push({
        label: alias,
        detail: `→ ${note.title}`,
        boost: (note.recent ?? 0) - 10, // the note's own name ranks first
        apply: applyLink(`${target}|${alias}`),
      });
    }
  }
  if (isEmbed) {
    for (const path of vault.attachments) {
      const name = path.split("/").pop();
      const unique = vault.attachments.filter((p) => p.split("/").pop().toLowerCase() === name.toLowerCase()).length === 1;
      options.push({ label: name, detail: folderOf(path), apply: applyLink(unique ? name : path) });
    }
  }
  return { from, options, validFor: /^[^[\]|#\n]*$/ };
}

function tagCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /(?:^|\s)#([\p{L}\p{N}_\-/]+)$/u.exec(before);
  if (!match || inCode(context.state, context.pos) || !vault.tags.length) return null;
  return {
    from: context.pos - match[1].length,
    options: vault.tags.map((tag) => ({ label: tag.tag, detail: String(tag.count), boost: Math.min(tag.count, 50) / 50 })),
    validFor: /^[\p{L}\p{N}_\-/]*$/u,
  };
}

export const linkAutocomplete = autocompletion({
  override: [linkCompletions, tagCompletions],
  icons: false,
  activateOnTyping: true,
  maxRenderedOptions: 60,
});

