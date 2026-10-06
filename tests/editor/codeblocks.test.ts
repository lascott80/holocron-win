import { describe, expect, it } from "vitest";
import { LanguageDescription } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { codeHighlight, codeLanguage, codeLanguageNames } from "../../src/editor/codeblocks.js";

/** Texts of the tokens codeHighlight colours when `code` is parsed as `lang`. */
async function coloured(lang: string, code: string) {
  const description = codeLanguage(lang)!;
  const support = await description.load();
  const tree = support.language.parser.parse(code);
  const tokens: string[] = [];
  highlightTree(tree, codeHighlight, (from, to) => tokens.push(code.slice(from, to)));
  return tokens;
}

// [aliases, sample, tokens that must be coloured]
const CASES: [string[], string, string[]][] = [
  [["powershell", "ps1", "pwsh", "ps", "psm1", "psd1"],
    "# note\n$name = 'World'\nGet-ChildItem -Path $env:TEMP | Where-Object { $_.Length -gt 1KB }",
    ["# note", "$name", "'World'", "Get-ChildItem", "Path", "$env:TEMP", "1KB"]],
  [["batch", "bat", "cmd", "dos"],
    '@echo off\nREM comment\n:: also\nset NAME=World\necho Hello %NAME% !X!\nif exist "%~dp0a.txt" goto :done\nfor %%i in (*.txt) do call :sub %%i\n:done\nexit /b 0',
    ["REM comment", ":: also", "echo", "NAME", "%NAME%", "!X!", "if", "exist", "%~dp0", "goto", ":done", "%%i", "/b", "0"]],
  [["php"], "<?php\n$x = strlen('a'); // c\nfunction f() { return null; }", ["$x", "'a'", "// c", "function", "return"]],
  [["php"], "$x = 1; echo \"hi\";", ["$x", "1", "echo", '"hi"']],
  [["r", "rscript"], "# c\nf <- function(a) TRUE", ["# c", "function", "TRUE"]],
  [["scala", "sc"], "object A { val s = \"x\" }", ["object", "val", '"x"']],
  [["haskell", "hs"], "-- c\nmodule Main where\nmain = putStrLn \"hi\"", ["-- c", "module", '"hi"']],
  [["perl", "pl", "pm"], "# c\nsub f { return 1; }", ["# c", "sub", "return"]],
  [["graphql", "gql"], "query Q($id: ID!) { user(id: $id) { name } }", ["query", "Q", "$id", "ID", "name"]],
  [["makefile", "make", "mk", "mak"], "CC := gcc\nall: app\n\t$(CC) -o $@ $^ # c", ["CC", "all", "$(CC)", "$@", "$^"]],
  [["ini", "cfg", "conf", "env", "dotenv", "properties", "editorconfig", "gitconfig"], "; c\n[section]\nkey=value", ["; c", "[section]", "key"]],
  [["elixir", "ex", "exs"], "defmodule A do\n  def f(x), do: :ok # c\nend", ["defmodule", "def", ":ok", "# c"]],
  [["clojure", "clj", "cljs", "cljc", "edn"], "(defn f [x] :kw) ; c", ["defn", ":kw", "; c"]],
  [["erlang", "erl"], "% c\nf(X) -> \"s\".", ["% c", '"s"']],
  [["fsharp", "fs", "f#"], "// c\nlet f x = 1", ["// c", "let", "1"]],
  [["julia", "jl"], "# c\nfunction f(x) end", ["# c", "function", "end"]],
  [["groovy", "gradle"], "// c\ndef x = 'a'", ["// c", "def", "'a'"]],
  [["dart"], "// c\nvoid main() { var x = 'a'; }", ["// c", "'a'"]],
  [["nginx", "nginxconf"], "server { listen 80; }", ["server", "listen"]],
  [["protobuf", "proto"], 'syntax = "proto3";\nmessage A { int32 id = 1; }', ["syntax", '"proto3"', "message"]],
  [["latex", "tex"], "% c\n\\section{Intro} $x^2$", ["% c", "\\section"]],
  [["cmake"], "# c\nset(SRC main.cpp)", ["# c"]],
  [["vbnet", "vb", "vb.net", "visualbasic"], "' c\nDim x As Integer = 1", ["' c", "Dim", "As"]],
  [["vbscript", "vbs"], "' c\nDim x", ["' c", "Dim"]],
  [["fortran", "f90", "f95", "f03"], "! c\nprogram hello\nend program hello", ["! c", "program"]],
  [["pascal", "delphi", "pas"], "{ c }\nbegin writeln('hi'); end.", ["{ c }", "begin", "'hi'"]],
  [["ocaml", "ml"], "(* c *)\nlet x = 1 in x", ["(* c *)", "let", "in"]],
  [["scheme", "racket", "rkt", "scm"], "; c\n(define x \"s\")", ["; c", '"s"']],
  [["tcl"], "# c\nset x 1\nputs $x", ["# c", "set", "$x"]],
  [["verilog", "v", "systemverilog", "sv"], "// c\nmodule m; endmodule", ["// c", "module", "endmodule"]],
  [["vhdl", "vhd"], "-- c\nentity e is end e;", ["-- c", "entity"]],
  [["markdown", "md"], "# Title\n\n- item `code`\n```js\nlet a\n```", ["# Title", "-", "`code`", "let a"]],
  // Existing languages still resolve.
  [["javascript", "js", "mjs", "cjs", "jsx", "typescript", "ts", "mts", "cts", "tsx"], "const s = 'x'; // c", ["const", "'x'", "// c"]],
  [["python", "py"], "def f(): return 'x'", ["def", "return", "'x'"]],
  [["shell", "sh", "bash", "zsh", "console", "shellsession"], "echo \"hi\" # c", ['"hi"', "# c"]],
  [["rust", "rs"], "fn main() {}", ["fn"]],
  [["c", "h", "cpp", "c++", "hpp", "cc", "cxx", "java", "kotlin", "kt", "kts", "csharp", "cs", "c#", "objc", "objective-c", "objectivec"], "return 1; // c", ["return", "// c"]],
  [["json", "jsonc"], '{"a": 1}', ['"a"', "1"]],
  [["html", "htm", "svelte", "vue", "xml", "plist", "svg"], "<a href=\"x\"></a>", ["a", "href"]],
  [["css", "scss", "less"], "a { color: red; }", ["color"]],
  [["sql", "postgres", "mysql", "sqlite"], "SELECT 1", ["SELECT", "1"]],
  [["go", "golang"], "func main() {}", ["func"]],
  [["yaml", "yml"], "a: 1", ["a"]],
  [["swift"], "let x = 1", ["let"]],
  [["ruby", "rb"], "def f; end", ["def", "end"]],
  [["toml"], "[a]\nb = 1", ["1"]],
  [["dockerfile", "docker"], "FROM node", ["FROM"]],
  [["lua"], "local x = 1", ["local"]],
  [["diff", "patch"], "+added\n-removed", ["+added", "-removed"]],
];

describe("code block languages", () => {
  it("resolves names case-insensitively and only exactly", () => {
    expect(codeLanguage("PowerShell")).toBeInstanceOf(LanguageDescription);
    expect(codeLanguage("ps1 title=x")?.name).toBe("powershell");
    expect(codeLanguage("text")).toBeNull(); // not "tex"
    expect(codeLanguage("mermaid")).toBeNull();
    expect(codeLanguage("")).toBeNull();
  });

  it("every alias is covered by a test case", () => {
    const tested = new Set(CASES.flatMap(([aliases]) => aliases));
    expect(codeLanguageNames.filter((name) => !tested.has(name))).toEqual([]);
  });

  for (const [aliases, code, expected] of CASES) {
    it(`highlights ${aliases.join(" / ")}`, async () => {
      for (const alias of aliases) {
        const tokens = await coloured(alias, code);
        for (const token of expected) expect(tokens, `${alias}: ${token}`).toContain(token);
      }
    });
  }
});
