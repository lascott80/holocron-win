// Fenced code blocks: syntax colouring for common languages, plus a
// language label and a Copy button in the block's corner.
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { go } from "@codemirror/lang-go";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { c, cpp, java, kotlin, csharp, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { diff } from "@codemirror/legacy-modes/mode/diff";

const legacy = (mode) => () => StreamLanguage.define(mode);

/** Language name or alias (as written after ```) → language support. */
const LANGUAGES = {
  javascript: () => javascript(), js: () => javascript(), jsx: () => javascript({ jsx: true }), mjs: () => javascript(),
  typescript: () => javascript({ typescript: true }), ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  python: () => python(), py: () => python(),
  json: () => json(), jsonc: () => json(),
  html: () => html(), htm: () => html(), svelte: () => html(), vue: () => html(),
  css: () => css(), scss: () => css(), less: () => css(),
  sql: () => sql(), postgres: () => sql(), mysql: () => sql(), sqlite: () => sql(),
  rust: legacy(rust), rs: legacy(rust),
  c: legacy(c), h: legacy(c), cpp: legacy(cpp), "c++": legacy(cpp), hpp: legacy(cpp),
  java: legacy(java),
  go: () => go(), golang: () => go(),
  xml: () => xml(), plist: () => xml(), svg: () => xml(),
  yaml: () => yaml(), yml: () => yaml(),
  swift: legacy(swift),
  shell: legacy(shell), sh: legacy(shell), bash: legacy(shell), zsh: legacy(shell), console: legacy(shell),
  ruby: legacy(ruby), rb: legacy(ruby),
  toml: legacy(toml),
  dockerfile: legacy(dockerFile), docker: legacy(dockerFile),
  lua: legacy(lua),
  kotlin: legacy(kotlin), kt: legacy(kotlin),
  csharp: legacy(csharp), cs: legacy(csharp), "c#": legacy(csharp),
  objc: legacy(objectiveC), "objective-c": legacy(objectiveC),
  diff: legacy(diff), patch: legacy(diff),
};

const loaded = new Map();

/** For markdown({ codeLanguages }): resolves the info string to a language. */
export function codeLanguage(info) {
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  const make = LANGUAGES[name];
  if (!make) return null;
  if (!loaded.has(name)) {
    const support = make();
    loaded.set(name, support.language ?? support);
  }
  return loaded.get(name);
}

/** Token colours; values come from --hc-syn-* variables (see editor.css). */
const syn = (name, fallback) => `var(--hc-syn-${name}, ${fallback})`;
export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: syn("keyword", "#C792EA") },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: syn("string", "#A5D6A7") },
  { tag: [t.number, t.bool, t.null, t.atom], color: syn("number", "#F78C6C") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syn("comment", "#6B7280"), fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: syn("function", "#82AAFF") },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: syn("type", "#FFCB6B") },
  { tag: [t.propertyName, t.attributeName], color: syn("property", "#89DDFF") },
  { tag: [t.tagName, t.angleBracket], color: syn("tag", "#F07178") },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: syn("punctuation", "#9AA1AD") },
  { tag: [t.inserted], color: syn("string", "#A5D6A7") },
  { tag: [t.deleted], color: syn("tag", "#F07178") },
  { tag: [t.meta, t.annotation, t.self], color: syn("meta", "#C3A6FF") },
]);

// ---------- Label & copy button ----------

class CodeToolsWidget extends WidgetType {
  constructor(language, code, onCopy) {
    super();
    this.language = language;
    this.code = code;
    this.onCopy = onCopy;
  }
  eq(other) {
    return other.language === this.language && other.code === this.code;
  }
  toDOM() {
    const tools = document.createElement("span");
    tools.className = "cm-code-tools";
    if (this.language) {
      const label = document.createElement("span");
      label.className = "cm-code-language";
      label.textContent = this.language;
      tools.appendChild(label);
    }
    const button = document.createElement("button");
    button.className = "cm-code-copy";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onCopy(this.code);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1200);
    });
    tools.appendChild(button);
    return tools;
  }
  ignoreEvent() {
    return true;
  }
}

/** Adds the label and Copy button to the first line of each code block. */
export function codeBlockTools(onCopy) {
  return ViewPlugin.fromClass(
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
        const widgets = [];
        const { doc } = view.state;
        for (const { from, to } of view.visibleRanges) {
          syntaxTree(view.state).iterate({
            from,
            to,
            enter(node) {
              if (node.name !== "FencedCode") return;
              let info = "";
              let codeFrom = null;
              let codeTo = null;
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "CodeInfo") info = doc.sliceString(child.from, child.to).trim();
                if (child.name === "CodeText") {
                  codeFrom ??= child.from;
                  codeTo = child.to;
                }
              }
              const code = codeFrom === null ? "" : doc.sliceString(codeFrom, codeTo);
              const firstLine = doc.lineAt(node.from);
              widgets.push(Decoration.widget({ widget: new CodeToolsWidget(info.split(/\s+/)[0], code, onCopy), side: 1 }).range(firstLine.to));
              return false;
            },
          });
        }
        return Decoration.set(widgets, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
