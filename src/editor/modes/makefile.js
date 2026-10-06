// Makefiles: a small stream mode. Comments, directives, variable
// definitions, rule targets, $(VAR) / $@ references and make functions.

const DIRECTIVES = /^(-?include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|private|vpath|undefine)\b/;
const FUNCTIONS = /^\$[({](subst|patsubst|strip|findstring|filter|filter-out|sort|word|wordlist|words|firstword|lastword|dir|notdir|suffix|basename|addsuffix|addprefix|join|wildcard|realpath|abspath|error|warning|info|shell|origin|flavor|foreach|if|or|and|call|eval|file|value|let)(?=\s)/;

export const makefile = {
  name: "makefile",
  startState: () => ({ recipe: false, lineStart: true, string: null }),
  token(stream, state) {
    if (stream.sol()) {
      state.recipe = stream.peek() === "\t";
      state.lineStart = true;
      state.string = null;
    }
    if (stream.eatSpace()) return null;
    if (state.lineStart) {
      state.lineStart = false;
      if (!state.recipe) {
        if (stream.match(/^#.*/)) return "comment";
        if (stream.match(/^[\w.\-/$(){}]+(?=\s*(::=|:=|\?=|\+=|!=|=))/)) return "variableName.definition";
        if (stream.match(DIRECTIVES)) return "keyword";
        // `targets: prerequisites` (but not `:=`)
        if (stream.match(/^[^:#=\s][^:#=]*?(?=::?(?!=))/)) return "variableName.function";
      } else if (stream.match(/^[@+-]+/)) {
        return "meta";
      }
    }
    // Strings in recipes; $(VAR) inside them is still highlighted.
    if (state.string && stream.peek() !== "$") {
      while (!stream.eol() && stream.peek() !== "$") {
        if (stream.next() === state.string) {
          state.string = null;
          break;
        }
      }
      return "string";
    }
    if (stream.match(FUNCTIONS)) return "variableName.standard";
    if (stream.match(/^\$[({][\w.-]+(:[^)}]*)?[)}]/) || stream.match(/^\$[@<^*?%+|$]/) || stream.match(/^\$[({][@<^*?%][DF]?[)}]/)) {
      return "variableName.special";
    }
    if (stream.match(/^\$[({]/)) return "variableName.special";
    if (!state.recipe && stream.match(/^(::=|:=|\?=|\+=|!=|=|::?|\|)/)) return "operator";
    if (stream.peek() === "#" && !state.recipe) {
      stream.skipToEnd();
      return "comment";
    }
    if (state.recipe && (stream.peek() === '"' || stream.peek() === "'")) {
      state.string = stream.next();
      return "string";
    }
    if (stream.match(/^[)}]/)) return "punctuation";
    if (stream.match(/^\d+\b/)) return "number";
    if (stream.match(/^[^\s$#"')}]+/)) return null;
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
