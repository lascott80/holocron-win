// Live preview: renders markdown in place and reveals the raw syntax only on
// the lines the cursor is on (Obsidian-style). Everything here is decoration;
// the document text is never changed except by explicit clicks (checkboxes).
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { embedDepth, parseEmbed } from "./embeds.js";
import { isImageEmbed } from "./images.js";
import { toggledTaskStatus } from "./commands.js";
import { foldStatus } from "./folds.js";
import { modKey } from "./platform.js";

// ---------- Widgets ----------

/** Checkbox states beyond [ ] and [x], as popular Obsidian themes draw them. */
const TASK_STATES = {
  " ": "open", x: "done", X: "done",
  "-": "cancelled", "/": "partial", ">": "forwarded", "<": "scheduled",
  "!": "important", "?": "question", "*": "star",
};

class CheckboxWidget extends WidgetType {
  constructor(state) {
    super();
    this.state = state;
  }
  eq(other) {
    return other.state === this.state;
  }
  toDOM() {
    const name = TASK_STATES[this.state] ?? "done";
    const box = document.createElement("span");
    box.className = `cm-task-checkbox cm-task-${name}` + (this.state === " " ? "" : " is-checked");
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", this.state === " " ? "false" : this.state === "/" ? "mixed" : "true");
    box.setAttribute("aria-label", name);
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class FootnoteRefWidget extends WidgetType {
  constructor(number, label) {
    super();
    this.number = number;
    this.label = label;
  }
  eq(other) {
    return other.number === this.number && other.label === this.label;
  }
  toDOM() {
    const ref = document.createElement("sup");
    ref.className = "cm-footnote-ref";
    ref.textContent = String(this.number);
    ref.dataset.footnote = this.label;
    ref.title = `Footnote ${this.label}`;
    return ref;
  }
  ignoreEvent() {
    return false;
  }
}

class FootnoteDefWidget extends WidgetType {
  constructor(number, label) {
    super();
    this.number = number;
    this.label = label;
  }
  eq(other) {
    return other.number === this.number && other.label === this.label;
  }
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-footnote-def-marker";
    marker.textContent = `${this.number}.`;
    marker.dataset.footnoteBack = this.label;
    marker.title = "Back to the reference";
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}

class BreakWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const node = document.createElement("span");
    node.className = "cm-html-br";
    return node;
  }
}

class FoldChevronWidget extends WidgetType {
  constructor(header, folded, label) {
    super();
    this.header = header;
    this.folded = folded;
    this.label = label;
  }
  eq(other) {
    return other.header === this.header && other.folded === this.folded && other.label === this.label;
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-summary";
    wrapper.dataset.foldHeader = String(this.header);
    const chevron = document.createElement("span");
    chevron.className = "cm-fold-chevron" + (this.folded ? " is-folded" : "");
    wrapper.appendChild(chevron);
    if (this.label) wrapper.appendChild(document.createTextNode(this.label));
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-hr";
    return rule;
  }
}

class CalloutTitleWidget extends WidgetType {
  constructor(type, showLabel, fold) {
    super();
    this.type = type;
    this.showLabel = showLabel;
    this.fold = fold; // { header, folded } for foldable callouts
  }
  eq(other) {
    return other.type === this.type && other.showLabel === this.showLabel
      && other.fold?.header === this.fold?.header && other.fold?.folded === this.fold?.folded;
  }
  toDOM() {
    const title = document.createElement("span");
    title.className = "cm-callout-title";
    if (this.fold) {
      title.dataset.foldHeader = String(this.fold.header);
      title.classList.add("is-foldable");
      const chevron = document.createElement("span");
      chevron.className = "cm-fold-chevron" + (this.fold.folded ? " is-folded" : "");
      title.appendChild(chevron);
    }
    const icon = document.createElement("span");
    icon.className = "cm-callout-icon";
    title.appendChild(icon);
    if (this.showLabel) {
      title.appendChild(document.createTextNode(this.type.charAt(0).toUpperCase() + this.type.slice(1)));
    }
    return title;
  }
  ignoreEvent() {
    return false; // clicks fold and unfold
  }
}

const bullet = new BulletWidget();
const rule = new RuleWidget();

const CALLOUT_FAMILIES = {
  note: "blue", info: "blue", abstract: "blue", summary: "blue", todo: "blue",
  tip: "green", hint: "green", success: "green", check: "green", done: "green",
  question: "purple", help: "purple", faq: "purple", example: "purple",
  warning: "yellow", caution: "yellow", attention: "yellow",
  failure: "red", fail: "red", missing: "red", danger: "red", error: "red", bug: "red",
  quote: "gray", cite: "gray",
};

// ---------- Helpers ----------

/** Line numbers touched by the selection (only while the editor has focus). */
export function activeLines(view) {
  const lines = new Set();
  if (!view.hasFocus || !view.state.facet(EditorView.editable)) return lines;
  const { doc, selection } = view.state;
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Per view: numbers of the image/embed lines collapsed to zero height. */
const collapsedLines = new WeakMap();

/**
 * Up/Down would skip a collapsed (zero-height) image or embed line, leaving
 * its syntax unreachable from the keyboard. Stop on it instead; that makes
 * it active, so it expands to show the raw text.
 */
function stepOntoCollapsedLine(view, dir, extend) {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || (!extend && !range.empty)) return false;
  const target = state.doc.lineAt(range.head).number + dir;
  if (!collapsedLines.get(view)?.has(target)) return false;
  const head = state.doc.line(target).from;
  view.dispatch({ selection: { anchor: extend ? range.anchor : head, head }, scrollIntoView: true, userEvent: "select" });
  return true;
}

const collapsedLineKeys = Prec.highest(keymap.of([
  { key: "ArrowDown", run: (view) => stepOntoCollapsedLine(view, 1, false), shift: (view) => stepOntoCollapsedLine(view, 1, true) },
  { key: "ArrowUp", run: (view) => stepOntoCollapsedLine(view, -1, false), shift: (view) => stepOntoCollapsedLine(view, -1, true) },
]));

function buildDecorations(view) {
  const { state } = view;
  const { doc } = state;
  const active = activeLines(view);
  const decorations = [];

  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const anyLineActive = (from, to) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) if (active.has(n)) return true;
    return false;
  };
  const hide = (from, to) => {
    if (to > from) decorations.push(Decoration.replace({}).range(from, to));
  };
  const replaceWith = (from, to, widget) => {
    decorations.push(Decoration.replace({ widget }).range(from, to));
  };
  const mark = (from, to, spec) => {
    if (to > from) decorations.push(Decoration.mark(spec).range(from, to));
  };
  const formatting = (from, to) => mark(from, to, { class: "cm-formatting" });
  const lineClass = (pos, cls) => {
    decorations.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  };
  /** Adds `cls` to every line of [from, to], with -first/-last modifiers. */
  const blockLines = (from, to, cls) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(Math.max(from, to - (to > from && doc.sliceString(to - 1, to) === "\n" ? 1 : 0))).number;
    for (let n = first; n <= last; n++) {
      let classes = cls;
      if (n === first) classes += ` ${cls}-first`;
      if (n === last) classes += ` ${cls}-last`;
      decorations.push(Decoration.line({ class: classes }).range(doc.line(n).from));
    }
  };
  /** Hides a block marker (#, >, -) plus the single space after it. */
  const hideMarkerAndSpace = (from, to) => {
    hide(from, doc.sliceString(to, to + 1) === " " ? to + 1 : to);
  };
  // Lines whose only content is images/embeds: once their syntax is hidden
  // the empty source line is collapsed so no blank line sits above the widget.
  const mediaRanges = new Map();
  const hideMedia = (from, to) => {
    hide(from, to);
    const line = doc.lineAt(from);
    if (!mediaRanges.has(line.number)) mediaRanges.set(line.number, []);
    mediaRanges.get(line.number).push([from - line.from, to - line.from]);
  };
  const inCode = (pos) => {
    for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
      if (/^(FencedCode|CodeBlock|InlineCode|Frontmatter)$/.test(node.name)) return true;
    }
    return false;
  };

  // Reference link definitions ([ref]: url) and footnote numbers, found once.
  let definitions = null;
  const linkDefinitions = () => {
    if (definitions) return definitions;
    definitions = new Map();
    for (const match of doc.toString().matchAll(/^ {0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm)) {
      const key = match[1].trim().toLowerCase();
      if (!definitions.has(key)) definitions.set(key, match[2]);
    }
    return definitions;
  };
  let footnoteNumbers = null;
  const footnoteNumber = (label) => {
    if (!footnoteNumbers) {
      footnoteNumbers = new Map();
      for (const match of doc.toString().matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
        if (!footnoteNumbers.has(match[1])) footnoteNumbers.set(match[1], footnoteNumbers.size + 1);
      }
    }
    return footnoteNumbers.get(label) ?? "?";
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const parent = node.node.parent;

        if (/^ATXHeading[1-6]$/.test(name)) {
          lineClass(node.from, `cm-h cm-h${name.slice(-1)}`);
          return;
        }
        if (name === "SetextHeading1" || name === "SetextHeading2") {
          lineClass(node.from, `cm-h cm-h${name.slice(-1)}`);
          return;
        }

        switch (name) {
          case "HeaderMark": {
            if (!parent || !parent.name.startsWith("ATXHeading")) {
              formatting(node.from, node.to);
              break;
            }
            if (isActive(node.from)) {
              mark(node.from, node.to, { class: "cm-formatting cm-formatting-header" });
            } else if (node.from === doc.lineAt(node.from).from) {
              hideMarkerAndSpace(node.from, node.to);
            } else {
              const spaceBefore = doc.sliceString(node.from - 1, node.from) === " ";
              hide(spaceBefore ? node.from - 1 : node.from, node.to);
            }
            break;
          }

          case "Highlight":
            mark(node.from, node.to, { class: "cm-highlight" });
            break;

          case "Escape":
            // \* shows as *, except while editing the line.
            if (!isActive(node.from)) hide(node.from, node.from + 1);
            break;

          case "LinkReference":
            lineClass(node.from, "cm-link-definition");
            return false;

          case "EmphasisMark":
          case "HighlightMark":
          case "StrikethroughMark":
            if (isActive(node.from)) formatting(node.from, node.to);
            else hide(node.from, node.to);
            break;

          case "InlineCode":
            mark(node.from, node.to, { class: "cm-inline-code" });
            break;

          case "CodeMark":
            if (parent?.name === "InlineCode") {
              if (isActive(node.from)) formatting(node.from, node.to);
              else hide(node.from, node.to);
            }
            break;

          case "Link": {
            const marks = [];
            let url = null;
            let label = null;
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push(child);
              else if (child.name === "URL") url = child;
              else if (child.name === "LinkLabel") label = child;
            }
            if (marks.length >= 2) {
              const textFrom = marks[0].to;
              const textTo = marks[1].from;
              let href = url ? doc.sliceString(url.from, url.to) : "";
              if (!url) {
                // [text][ref], [text][] or [ref]: look up the definition.
                const labelText = label ? doc.sliceString(label.from + 1, label.to - 1) : "";
                const key = (labelText || doc.sliceString(textFrom, textTo)).trim().toLowerCase();
                href = linkDefinitions().get(key) ?? "";
                if (!href) break; // not a link after all, just brackets
              }
              mark(textFrom, textTo, { class: "cm-md-link", attributes: { "data-href": href } });
              if (!isActive(node.from)) {
                hide(node.from, textFrom);
                hide(textTo, node.to);
                return false;
              }
            }
            break;
          }

          case "URL":
            if (parent?.name !== "Link" && parent?.name !== "Image") {
              mark(node.from, node.to, {
                class: "cm-md-link",
                attributes: { "data-href": doc.sliceString(node.from, node.to) },
              });
            }
            break;

          case "Image":
            // Rendered below the line by images.js.
            if (!isActive(node.from)) hideMedia(node.from, node.to);
            return false;

          case "WikiLink": {
            const isEmbed = doc.sliceString(node.from - 1, node.from) === "!";
            const inner = doc.sliceString(node.from + 2, node.to - 2);
            // Only hide what images.js / embeds.js will actually render (same parsers).
            const isImage = isImageEmbed(inner);
            const isNoteEmbed = isEmbed && !isImage && state.facet(embedDepth) === 0 && parseEmbed(inner) !== null;
            if (isEmbed && (isImage || isNoteEmbed)) {
              // Rendered below the line by images.js / embeds.js.
              if (!isActive(node.from)) hideMedia(node.from - 1, node.to);
              else mark(node.from - 1, node.to, { class: "cm-formatting" });
              return false;
            }
            const pipe = inner.indexOf("|");
            const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
            const lineActive = isActive(node.from);
            let textFrom = pipe >= 0 && !lineActive ? node.from + 3 + pipe : node.from + 2;
            // [[#Heading]] in the same note reads as "Heading".
            if (pipe < 0 && !lineActive && inner.startsWith("#")) textFrom += inner.startsWith("#^") ? 2 : 1;
            mark(textFrom, node.to - 2, { class: "cm-wikilink", attributes: { "data-target": target } });
            if (lineActive) {
              formatting(node.from, node.from + 2);
              formatting(node.to - 2, node.to);
            } else {
              hide(node.from, textFrom);
              hide(node.to - 2, node.to);
            }
            return false;
          }

          case "Tag":
            mark(node.from, node.to, {
              class: "cm-tag",
              attributes: { "data-tag": doc.sliceString(node.from + 1, node.to) },
            });
            break;

          case "ListMark": {
            if (isActive(node.from)) break;
            // "- [-] text" and friends are drawn as checkboxes below, not bullets.
            if (/^\s*([-*+]|\d+[.)]) \[[^\]xX ]\](?= |$)/.test(doc.lineAt(node.from).text)) break;
            const isTask = node.node.nextSibling?.name === "Task";
            if (isTask) hideMarkerAndSpace(node.from, node.to);
            else if (parent?.parent?.name === "BulletList") replaceWith(node.from, node.to, bullet);
            break;
          }

          case "TaskMarker": {
            const marker = doc.sliceString(node.from + 1, node.from + 2);
            const isChecked = marker !== " ";
            lineClass(node.from, "cm-task-line");
            if (!isActive(node.from)) replaceWith(node.from, node.to, new CheckboxWidget(marker));
            if (isChecked) {
              const lineEnd = doc.lineAt(node.from).to;
              mark(node.to, lineEnd, { class: "cm-task-done" });
            }
            break;
          }

          case "Blockquote": {
            if (parent?.name === "Blockquote") break;
            const firstLine = doc.lineAt(node.from);
            const callout = /^\s*>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(firstLine.text);
            if (callout) {
              const type = callout[1].toLowerCase();
              const family = CALLOUT_FAMILIES[type] ?? "blue";
              blockLines(node.from, node.to, "cm-callout");
              // The colour family applies to every line of the callout.
              for (let n = firstLine.number; n <= doc.lineAt(node.to).number; n++) {
                decorations.push(Decoration.line({ class: `cm-callout-${family}` }).range(doc.line(n).from));
              }
              const fold = foldStatus(state, firstLine.from);
              if (fold?.folded) lineClass(firstLine.from, "cm-callout-last");
              if (!isActive(node.from)) {
                const start = firstLine.from + firstLine.text.indexOf("[!");
                const end = firstLine.from + firstLine.text.indexOf("]", start - firstLine.from) + 1;
                const afterType = firstLine.text.slice(end - firstLine.from);
                const markerEnd = end + (/^[+-]/.test(afterType) ? 1 : 0);
                const hasCustomTitle = afterType.replace(/^[+-]/, "").trim().length > 0;
                const titleFrom = Math.min(markerEnd + (hasCustomTitle ? 1 : 0), firstLine.to);
                const foldInfo = fold ? { header: firstLine.from, folded: fold.folded } : null;
                replaceWith(start, titleFrom, new CalloutTitleWidget(type, !hasCustomTitle, foldInfo));
                if (hasCustomTitle) mark(titleFrom, firstLine.to, { class: "cm-callout-title-text" });
              }
            } else {
              blockLines(node.from, node.to, "cm-blockquote");
            }
            break;
          }

          case "QuoteMark":
            if (isActive(node.from)) formatting(node.from, node.to);
            else hideMarkerAndSpace(node.from, node.to);
            break;

          case "FencedCode":
          case "CodeBlock": {
            blockLines(node.from, node.to, "cm-codeblock");
            if (name === "FencedCode") {
              const first = doc.lineAt(node.from);
              const last = doc.lineAt(node.to);
              const blockActive = anyLineActive(node.from, node.to);
              if (!blockActive) {
                // The label and Copy button replace the ```lang line's text.
                lineClass(first.from, "cm-codeblock-fence");
                hide(first.from, first.to);
                if (last.number !== first.number && /^\s*(```|~~~)/.test(last.text)) {
                  lineClass(last.from, "cm-codeblock-fence");
                  hide(last.from, last.to);
                }
              }
            }
            return false;
          }

          case "HorizontalRule":
            if (isActive(node.from)) formatting(node.from, node.to);
            else replaceWith(node.from, node.to, rule);
            break;

          case "Frontmatter":
            blockLines(node.from, node.to, "cm-frontmatter");
            return false;

          case "Table":
            blockLines(node.from, node.to, "cm-table");
            break;
        }
      },
    });

    // Line-based syntax the markdown parser doesn't know about.
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (!line.text || inCode(line.from)) continue;
      const lineActive = active.has(line.number);
      const text = line.text;

      // Footnote definition: [^1]: text
      const definition = /^\[\^([^\]]+)\]:\s?/.exec(text);
      if (definition) {
        lineClass(line.from, "cm-footnote-def");
        if (!lineActive) replaceWith(line.from, line.from + definition[0].length, new FootnoteDefWidget(footnoteNumber(definition[1]), definition[1]));
      }
      // Footnote references: text[^1]
      for (const match of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
        const start = line.from + match.index;
        if (inCode(start)) continue;
        if (lineActive) formatting(start, start + match[0].length);
        else replaceWith(start, start + match[0].length, new FootnoteRefWidget(footnoteNumber(match[1]), match[1]));
      }
      // Block id: text ^my-block
      const blockId = /\s\^([A-Za-z0-9-]+)\s*$/.exec(text);
      if (blockId && !definition) {
        const start = line.from + blockId.index;
        if (lineActive) mark(start + 1, line.to, { class: "cm-block-id" });
        else hide(start, line.to);
      }
      // Extra checkbox states: - [-] cancelled, - [/] partial, - [>] …
      const task = /^(\s*)([-*+]|\d+[.)]) \[([^\]xX ])\](?= |$)/.exec(text);
      if (task) {
        const markerFrom = line.from + task[1].length;
        const boxFrom = markerFrom + task[2].length + 1;
        lineClass(line.from, "cm-task-line");
        if (!lineActive) {
          hide(markerFrom, boxFrom);
          replaceWith(boxFrom, boxFrom + 3, new CheckboxWidget(task[3]));
        }
        if (task[3] === "-") mark(boxFrom + 3, line.to, { class: "cm-task-done" });
      }
      // Inline HTML: <kbd>⌘K</kbd>, <mark>, <sup>, <sub>, <u>, …, and <br>
      for (const match of text.matchAll(/<(kbd|mark|sup|sub|u|b|i|s|small|ins|del)>(.+?)<\/\1>/gi)) {
        const start = line.from + match.index;
        if (inCode(start)) continue;
        const tag = match[1].toLowerCase();
        const openEnd = start + tag.length + 2;
        const closeStart = start + match[0].length - tag.length - 3;
        mark(openEnd, closeStart, { class: `cm-html-${tag}` });
        if (lineActive) {
          formatting(start, openEnd);
          formatting(closeStart, start + match[0].length);
        } else {
          hide(start, openEnd);
          hide(closeStart, start + match[0].length);
        }
      }
      for (const match of text.matchAll(/<br\s*\/?>/gi)) {
        const start = line.from + match.index;
        if (lineActive) formatting(start, start + match[0].length);
        else replaceWith(start, start + match[0].length, new BreakWidget());
      }
      // <details> / <summary> / </details>: a foldable block with a title.
      if (/^\s*<\/?details(\s[^>]*)?>\s*$/i.test(text)) {
        if (lineActive) formatting(line.from, line.to);
        else {
          hide(line.from, line.to);
          lineClass(line.from, "cm-collapsed-line");
        }
      } else {
        const summary = /^(\s*(?:<details(?:\s[^>]*)?>\s*)?)<summary>(.*?)<\/summary>\s*$/i.exec(text);
        if (summary) {
          const fold = foldStatus(state, line.from);
          if (lineActive) formatting(line.from, line.to);
          else replaceWith(line.from, line.to, new FoldChevronWidget(line.from, fold?.folded ?? false, summary[2].replace(/<[^>]+>/g, "")));
        }
      }
    }
  }

  const collapsed = new Set();
  for (const [number, ranges] of mediaRanges) {
    const line = doc.line(number);
    let rest = line.text;
    for (const [from, to] of ranges.sort((a, b) => b[0] - a[0])) rest = rest.slice(0, from) + rest.slice(to);
    if (!rest.trim()) {
      lineClass(line.from, "cm-media-source");
      collapsed.add(number);
    }
  }
  collapsedLines.set(view, collapsed);

  return Decoration.set(decorations, true);
}

// ---------- Plugin ----------

export function toggleCheckboxAt(view, pos) {
  const marker = view.state.doc.sliceString(pos, pos + 3);
  if (!/^\[.\]$/.test(marker)) return false;
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: toggledTaskStatus(marker[1]) },
    userEvent: "input.toggle",
  });
  return true;
}

export function livePreview({ onOpenLink, onOpenURL, onOpenTag }) {
  return [collapsedLineKeys, ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }
      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown(event, view) {
          if (event.button !== 0 || !(event.target instanceof Element)) return false;

          // Task list checkboxes (property checkboxes are handled in properties.js).
          const box = event.target.closest(".cm-task-checkbox:not(.cm-property-checkbox)");
          if (box) {
            event.preventDefault();
            // Embeds are read-only views of another note: don't fake a change.
            // (Reading view is read-only too, but ticking tasks there is fine.)
            if (view.state.facet(embedDepth) > 0) return true;
            return toggleCheckboxAt(view, view.posAtDOM(box));
          }

          // Footnotes: jump between the reference and its text.
          const footnote = event.target.closest("[data-footnote], [data-footnote-back]");
          if (footnote) {
            event.preventDefault();
            const label = footnote.dataset.footnote ?? footnote.dataset.footnoteBack;
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = footnote.dataset.footnote
              ? new RegExp(`^\\[\\^${escaped}\\]:`, "m")
              : new RegExp(`\\[\\^${escaped}\\](?!:)`);
            const match = pattern.exec(view.state.doc.toString());
            if (match) {
              view.focus();
              view.dispatch({ selection: { anchor: match.index + match[0].length }, scrollIntoView: true });
            }
            return true;
          }

          const tag = event.target.closest(".cm-tag");
          if (tag) {
            const pos = view.posAtDOM(tag);
            const lineIsRaw = activeLines(view).has(view.state.doc.lineAt(pos).number);
            if (modKey(event) || !lineIsRaw) {
              event.preventDefault();
              onOpenTag(tag.dataset.tag);
              return true;
            }
          }

          const link = event.target.closest(".cm-wikilink, .cm-md-link");
          if (link) {
            const pos = view.posAtDOM(link);
            const lineIsRaw = activeLines(view).has(view.state.doc.lineAt(pos).number);
            if (modKey(event) || !lineIsRaw) {
              event.preventDefault();
              if (link.classList.contains("cm-wikilink")) onOpenLink(link.dataset.target, modKey(event));
              else if (link.dataset.href) onOpenURL(link.dataset.href);
              return true;
            }
          }
          return false;
        },
      },
    },
  )];
}
