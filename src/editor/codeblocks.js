// Fenced code blocks: syntax colouring for common languages, plus a
// language label and a Copy button in the block's corner.
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { codeHeading } from "./modes/tags.js";

// Every language loads on first use (in its own chunk); until then a block
// shows plain and is re-highlighted when the parser arrives.
const legacy = (load) => () => load().then((mode) => new LanguageSupport(StreamLanguage.define(mode)));
const legacyMode = (load, name, retag) => legacy(() => load().then((m) => (retag ? retagged(m[name], retag) : m[name])));

/** A stream mode whose token names are rewritten by `retag(token, stream)`. */
function retagged(mode, retag) {
  return { ...mode, token: (stream, state) => retag(mode.token(stream, state), stream) };
}

// PowerShell: $variables in the variable colour, -Parameters as attributes.
const powerShellTokens = (token, stream) => {
  if (token !== "variable") return token;
  if (stream.current().startsWith("$")) return "variableName.special";
  return stream.string[stream.start - 1] === "-" && /^\s?$/.test(stream.string.charAt(stream.start - 2)) ? "attributeName" : token;
};
// INI / properties: [section] headers as types (not markdown headings).
const iniTokens = (token) => (token === "header" ? "typeName" : token);
const javascript = (config) => () => import("@codemirror/lang-javascript").then((m) => m.javascript(config));

/** [name, aliases (as written after ```), loader]. */
const LANGUAGES = [
  ["javascript", ["js", "mjs", "cjs"], javascript()],
  ["jsx", [], javascript({ jsx: true })],
  ["typescript", ["ts", "mts", "cts"], javascript({ typescript: true })],
  ["tsx", [], javascript({ typescript: true, jsx: true })],
  ["python", ["py"], () => import("@codemirror/lang-python").then((m) => m.python())],
  ["json", ["jsonc"], () => import("@codemirror/lang-json").then((m) => m.json())],
  ["html", ["htm", "svelte", "vue"], () => import("@codemirror/lang-html").then((m) => m.html())],
  ["css", ["scss", "less"], () => import("@codemirror/lang-css").then((m) => m.css())],
  ["sql", ["postgres", "mysql", "sqlite"], () => import("@codemirror/lang-sql").then((m) => m.sql())],
  ["go", ["golang"], () => import("@codemirror/lang-go").then((m) => m.go())],
  ["xml", ["plist", "svg"], () => import("@codemirror/lang-xml").then((m) => m.xml())],
  ["yaml", ["yml"], () => import("@codemirror/lang-yaml").then((m) => m.yaml())],
  ["php", [], () => import("./modes/php.js").then((m) => m.php())],
  ["elixir", ["ex", "exs"], () => import("codemirror-lang-elixir").then((m) => m.elixir())],
  ["rust", ["rs"], legacyMode(() => import("@codemirror/legacy-modes/mode/rust"), "rust")],
  ["c", ["h"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "c")],
  ["cpp", ["c++", "hpp", "cc", "cxx"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "cpp")],
  ["java", [], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "java")],
  ["kotlin", ["kt", "kts"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "kotlin")],
  ["csharp", ["cs", "c#"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "csharp")],
  ["objc", ["objective-c", "objectivec"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "objectiveC")],
  ["scala", ["sc"], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "scala")],
  ["dart", [], legacyMode(() => import("@codemirror/legacy-modes/mode/clike"), "dart")],
  ["swift", [], legacyMode(() => import("@codemirror/legacy-modes/mode/swift"), "swift")],
  ["shell", ["sh", "bash", "zsh", "console", "shellsession"], legacyMode(() => import("@codemirror/legacy-modes/mode/shell"), "shell")],
  ["powershell", ["ps1", "pwsh", "ps", "psm1", "psd1"], legacyMode(() => import("@codemirror/legacy-modes/mode/powershell"), "powerShell", powerShellTokens)],
  ["batch", ["bat", "cmd", "dos"], legacyMode(() => import("./modes/batch.js"), "batch")],
  ["ruby", ["rb"], legacyMode(() => import("@codemirror/legacy-modes/mode/ruby"), "ruby")],
  ["toml", [], legacyMode(() => import("@codemirror/legacy-modes/mode/toml"), "toml")],
  ["ini", ["cfg", "conf", "env", "dotenv", "properties", "editorconfig", "gitconfig"], legacyMode(() => import("@codemirror/legacy-modes/mode/properties"), "properties", iniTokens)],
  ["dockerfile", ["docker"], legacyMode(() => import("@codemirror/legacy-modes/mode/dockerfile"), "dockerFile")],
  ["makefile", ["make", "mk", "mak"], legacyMode(() => import("./modes/makefile.js"), "makefile")],
  ["cmake", [], legacyMode(() => import("@codemirror/legacy-modes/mode/cmake"), "cmake")],
  ["nginx", ["nginxconf"], legacyMode(() => import("@codemirror/legacy-modes/mode/nginx"), "nginx")],
  ["lua", [], legacyMode(() => import("@codemirror/legacy-modes/mode/lua"), "lua")],
  ["perl", ["pl", "pm"], legacyMode(() => import("@codemirror/legacy-modes/mode/perl"), "perl")],
  ["r", ["rscript"], legacyMode(() => import("@codemirror/legacy-modes/mode/r"), "r")],
  ["julia", ["jl"], legacyMode(() => import("@codemirror/legacy-modes/mode/julia"), "julia")],
  ["haskell", ["hs"], legacyMode(() => import("@codemirror/legacy-modes/mode/haskell"), "haskell")],
  ["ocaml", ["ml"], legacyMode(() => import("@codemirror/legacy-modes/mode/mllike"), "oCaml")],
  ["fsharp", ["fs", "f#"], legacyMode(() => import("@codemirror/legacy-modes/mode/mllike"), "fSharp")],
  ["erlang", ["erl"], legacyMode(() => import("@codemirror/legacy-modes/mode/erlang"), "erlang")],
  ["clojure", ["clj", "cljs", "cljc", "edn"], legacyMode(() => import("@codemirror/legacy-modes/mode/clojure"), "clojure")],
  ["scheme", ["racket", "rkt", "scm"], legacyMode(() => import("@codemirror/legacy-modes/mode/scheme"), "scheme")],
  ["groovy", ["gradle"], legacyMode(() => import("@codemirror/legacy-modes/mode/groovy"), "groovy")],
  ["tcl", [], legacyMode(() => import("@codemirror/legacy-modes/mode/tcl"), "tcl")],
  ["verilog", ["v", "systemverilog", "sv"], legacyMode(() => import("@codemirror/legacy-modes/mode/verilog"), "verilog")],
  ["vhdl", ["vhd"], legacyMode(() => import("@codemirror/legacy-modes/mode/vhdl"), "vhdl")],
  ["fortran", ["f90", "f95", "f03"], legacyMode(() => import("@codemirror/legacy-modes/mode/fortran"), "fortran")],
  ["pascal", ["delphi", "pas"], legacyMode(() => import("@codemirror/legacy-modes/mode/pascal"), "pascal")],
  ["vbnet", ["vb", "vb.net", "visualbasic"], legacyMode(() => import("@codemirror/legacy-modes/mode/vb"), "vb")],
  ["vbscript", ["vbs"], legacyMode(() => import("@codemirror/legacy-modes/mode/vbscript"), "vbScript")],
  ["latex", ["tex"], legacyMode(() => import("@codemirror/legacy-modes/mode/stex"), "stex")],
  ["protobuf", ["proto"], legacyMode(() => import("@codemirror/legacy-modes/mode/protobuf"), "protobuf")],
  ["graphql", ["gql"], legacyMode(() => import("./modes/graphql.js"), "graphql")],
  ["markdown", ["md"], legacyMode(() => import("./modes/markdown.js"), "markdownCode")],
  ["diff", ["patch"], legacyMode(() => import("@codemirror/legacy-modes/mode/diff"), "diff")],
];

/** Lower-case name or alias → its LanguageDescription (which caches the loaded support). */
const descriptions = new Map();
for (const [name, alias, load] of LANGUAGES) {
  const description = LanguageDescription.of({ name, alias, load });
  for (const key of [name, ...alias]) descriptions.set(key, description);
}

/** Every fence name that gets highlighting. */
export const codeLanguageNames = [...descriptions.keys()];

/**
 * For markdown({ codeLanguages }): the language for an info string's first
 * word (exact, case-insensitive). Markdown loads it on demand.
 */
export function codeLanguage(info) {
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  return descriptions.get(name) ?? null;
}

/** Token colours; values come from --hc-syn-* variables (set per theme; fallbacks in editor.css). */
const syn = (name, fallback) => `var(--hc-syn-${name}, ${fallback})`;
export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: syn("keyword", "#C792EA") },
  { tag: [t.controlKeyword, t.moduleKeyword], color: syn("control", syn("keyword", "#C792EA")) },
  { tag: codeHeading, color: syn("keyword", "#C792EA"), fontWeight: "700" },
  { tag: [t.string, t.special(t.string), t.character, t.escape], color: syn("string", "#A5D6A7") },
  { tag: t.regexp, color: syn("regexp", syn("string", "#A5D6A7")) },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: syn("number", "#F78C6C") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syn("comment", "#6B7280"), fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.standard(t.variableName)], color: syn("function", "#82AAFF") },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: syn("type", "#FFCB6B") },
  { tag: [t.propertyName, t.special(t.variableName), t.definition(t.variableName)], color: syn("property", "#89DDFF") },
  { tag: t.attributeName, color: syn("attribute", syn("property", "#89DDFF")) },
  { tag: t.variableName, color: syn("variable", "inherit") },
  { tag: [t.tagName, t.angleBracket], color: syn("tag", "#F07178") },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], color: syn("punctuation", "#9AA1AD") },
  { tag: [t.inserted], color: syn("string", "#A5D6A7") },
  { tag: [t.deleted, t.invalid], color: syn("tag", "#F07178") },
  { tag: [t.meta, t.annotation, t.self, t.labelName], color: syn("meta", "#C3A6FF") },
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
