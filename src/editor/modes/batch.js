// Windows batch files (.bat / .cmd): a small stream mode. Comments (REM, ::),
// labels, %VAR% / %%i / !VAR! variables, keywords, commands and strings.

const KEYWORDS = new Set([
  "if", "else", "for", "in", "do", "goto", "call", "exit", "setlocal", "endlocal", "shift",
  "not", "exist", "defined", "errorlevel", "equ", "neq", "lss", "leq", "gtr", "geq",
]);
const COMMANDS = new Set([
  "echo", "set", "cd", "chdir", "pushd", "popd", "cls", "copy", "xcopy", "robocopy", "del", "erase",
  "move", "ren", "rename", "md", "mkdir", "rd", "rmdir", "type", "dir", "pause", "start", "title",
  "color", "choice", "timeout", "where", "findstr", "find", "more", "sort", "attrib", "assoc",
  "ftype", "path", "prompt", "verify", "vol", "ver", "date", "time", "break", "mklink", "tasklist",
  "taskkill", "shutdown", "net", "sc", "reg", "powershell", "cmd", "whoami", "hostname", "ping",
  "ipconfig", "netsh", "wmic", "msiexec", "icacls", "subst", "tree", "fc", "comp", "cscript", "wscript",
]);
const SETLOCAL_OPTIONS = /^(enabledelayedexpansion|disabledelayedexpansion|enableextensions|disableextensions)\b/i;

/** %VAR%, %VAR:~0,5%, %~dp0, %1, %*, %%i, %%~nxi, !VAR! */
function variable(stream) {
  return stream.match(/^%%~?[a-z]*[a-z]/i)
    || stream.match(/^%~[a-z]*[0-9]/i)
    || stream.match(/^%[0-9*]/)
    || stream.match(/^%[^%\s"=]+(:[^%]*)?%/)
    || stream.match(/^![^!\s"=]+(:[^!]*)?!/);
}

function atVariable(stream) {
  const pos = stream.pos;
  const found = variable(stream);
  stream.pos = pos;
  return Boolean(found);
}

export const batch = {
  name: "batch",
  startState: () => ({ inString: false, command: null, label: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.inString = false;
      state.command = null;
      state.label = false;
    }
    if (state.inString) {
      if (variable(stream)) return "variableName.special";
      while (!stream.eol()) {
        const ch = stream.peek();
        if (ch === '"') {
          stream.next();
          state.inString = false;
          return "string";
        }
        if (stream.pos > stream.start && (ch === "%" || ch === "!") && atVariable(stream)) return "string";
        stream.next();
      }
      state.inString = false;
      return "string";
    }
    if (stream.eatSpace()) return null;

    // Start of a command: comments, labels and the @ prefix.
    if (state.command === null) {
      if (stream.match("::")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^rem(\s|$)/i)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^:[^\s:]+/)) {
        stream.skipToEnd();
        return "labelName";
      }
      if (stream.eat("@")) return "meta";
    }
    if (state.label) {
      state.label = false;
      if (stream.match(/^:?[^\s&|>)]+/)) return "labelName";
    }

    if (variable(stream)) return "variableName.special";
    if (stream.eat('"')) {
      state.inString = true;
      return "string";
    }
    if (stream.match(/^(&&|\|\||[&|])/)) {
      state.command = null;
      return "operator";
    }
    if (stream.match(/^\d*>>?(&\d)?/) || stream.eat("<") || stream.match("==")) return "operator";
    if (stream.eat("(")) {
      state.command = null;
      return "bracket";
    }
    if (stream.eat(")")) return "bracket";

    // `echo` prints the rest of the command literally (variables aside).
    if (state.command === "echo") {
      if (stream.match(/^(on|off)\s*$/i)) return "atom";
      stream.match(/^[^%!"&|<>()\s]+/) || stream.next();
      return null;
    }
    if (state.command === "set") {
      if (stream.match(/^\/[ap]\b/i)) return "attributeName";
      const name = stream.match(/^[^=\s"&|<>]+(?==)/);
      state.command = "set-value";
      if (name) return "variableName.definition";
    }
    if (stream.match(/^\/[a-z?]+:?/i)) return "attributeName";
    if (stream.match(/^-?\d+(\.\d+)?\b/)) return "number";

    if (stream.eat("=")) return "operator";
    const word = stream.match(/^[^\s%!"&|<>()=,;]+/);
    if (!word) {
      stream.next();
      return null;
    }
    const lower = word[0].toLowerCase();
    if (SETLOCAL_OPTIONS.test(lower)) return "atom";
    // Keywords count anywhere but in a value; commands at the start of a
    // command, or after if/for/do/….
    if (KEYWORDS.has(lower) && state.command !== "set-value") {
      state.command = lower === "do" || lower === "else" ? null : "keyword";
      if (lower === "goto") state.label = true;
      if (lower === "call") state.label = Boolean(stream.match(/^\s*(?=:)/, false));
      return "keyword";
    }
    if (state.command === null || state.command === "keyword") {
      const isEcho = /^echo[.:]?$/.test(lower);
      if (isEcho || COMMANDS.has(lower)) {
        state.command = isEcho ? "echo" : lower === "set" ? "set" : "command";
        return "variableName.standard";
      }
      if (state.command === null) state.command = "command";
      return null;
    }
    return null;
  },
  languageData: { commentTokens: { line: "REM" } },
};
