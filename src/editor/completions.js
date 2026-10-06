// Autocomplete for [[links]], [[Note#headings]], ![[embeds]], #tags, <html> tags and :emoji:.
// Holocron sends the vault's notes, attachments and tags via setVaultData.
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { EMOJI } from "./emojiData.js";

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

// The inline HTML live preview renders (ED-02). Our override replaces the
// markdown language's own HTML completion, so offer these instead.
const HTML_TAGS = [
  ["kbd", "keyboard key"], ["mark", "highlight"], ["sup", "superscript"], ["sub", "subscript"],
  ["u", "underline"], ["b", "bold"], ["i", "italic"], ["s", "strikethrough"], ["small", "small text"],
  ["ins", "inserted"], ["del", "deleted"], ["br", "line break"], ["details", "collapsible block"], ["summary", "details title"],
];

/** Inserts `before` + `after` over the typed "<tag", cursor between them. */
function applyHTML(before, after) {
  return (view, _completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: before + after },
      selection: { anchor: from + before.length },
      userEvent: "input.complete",
    });
  };
}

export function htmlTagCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /<([a-z]*)$/i.exec(before);
  if (!match || (!match[1] && !context.explicit) || inCode(context.state, context.pos)) return null;
  return {
    from: context.pos - match[0].length,
    options: HTML_TAGS.map(([tag, detail]) => ({
      label: `<${tag}>`,
      detail,
      apply: tag === "br" ? applyHTML("<br>", "")
        : tag === "details" ? applyHTML("<details>\n<summary>", "</summary>\n\n</details>")
        : applyHTML(`<${tag}>`, `</${tag}>`),
    })),
    validFor: /^<[a-z]*$/i,
  };
}

// Emoji shortcodes (":ro" → :rocket:): inserts the shortcode, which keeps the
// file plain text; live preview shows the emoji.
const POPULAR_EMOJI = [
  "+1", "-1", "100", "smile", "smiley", "grin", "joy", "laughing", "wink", "blush", "heart_eyes", "thinking",
  "sweat_smile", "sob", "cry", "rage", "sunglasses", "partying_face", "pray", "clap", "wave", "muscle", "ok_hand",
  "raised_hands", "eyes", "heart", "fire", "sparkles", "star", "tada", "rocket", "zap", "boom", "bulb", "bug",
  "memo", "warning", "x", "white_check_mark", "heavy_check_mark", "question", "exclamation", "construction",
  "lock", "key", "link", "pushpin", "calendar", "books", "bookmark", "coffee", "tea", "beer", "pizza", "gift",
  "trophy", "checkered_flag", "chart_with_upwards_trend", "hourglass", "alarm_clock", "mag", "gear", "wrench",
  "hammer", "package", "art", "speech_balloon", "robot", "ghost", "skull", "see_no_evil", "rainbow", "sunny",
  "snowflake", "earth_americas", "house", "computer", "email", "phone", "arrow_right", "point_right",
  "rotating_light", "recycle", "pencil2", "clipboard", "lipstick", "rose", "dog", "cat", "unicorn",
];

const EMOJI_OPTIONS = Object.entries(EMOJI).map(([name, emoji], index) => ({
  label: `:${name}:`,
  emoji,
  // Popular ones first (in POPULAR_EMOJI order), then gemoji order: faces before objects and flags.
  boost: POPULAR_EMOJI.includes(name) ? 1 - POPULAR_EMOJI.indexOf(name) / 1000 : -index / 10000,
}));

/** Draws the emoji before the shortcode in the list. */
function renderEmoji(completion) {
  if (!completion.emoji) return null;
  const span = document.createElement("span");
  span.className = "cm-completionEmoji";
  span.textContent = completion.emoji;
  return span;
}

export function emojiCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /(?:^|\s):([\w+-]{2,})$/.exec(before);
  if (!match || inCode(context.state, context.pos)) return null;
  return { from: context.pos - match[1].length - 1, options: EMOJI_OPTIONS, validFor: /^:[\w+-]*$/ };
}

const emojiOptionTheme = EditorView.baseTheme({
  ".cm-completionEmoji": { display: "inline-block", width: "1.6em", fontSize: "15px", lineHeight: "1" },
});

export const linkAutocomplete = [
  autocompletion({
    override: [linkCompletions, tagCompletions, htmlTagCompletions, emojiCompletions],
    icons: false,
    activateOnTyping: true,
    maxRenderedOptions: 60,
    addToOptions: [{ render: renderEmoji, position: 20 }],
  }),
  emojiOptionTheme,
];

