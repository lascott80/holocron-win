// GraphQL: a small stream mode (schema and query documents).

const KEYWORDS = new Set([
  "query", "mutation", "subscription", "fragment", "on", "type", "interface", "union", "enum", "input",
  "scalar", "schema", "extend", "implements", "directive", "repeatable",
]);
const ATOMS = new Set(["true", "false", "null"]);

export const graphql = {
  name: "graphql",
  startState: () => ({ blockString: false }),
  token(stream, state) {
    if (state.blockString) {
      if (stream.skipTo('"""')) {
        stream.match('"""');
        state.blockString = false;
      } else stream.skipToEnd();
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match('"""')) {
      state.blockString = true;
      return "string";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\$[_A-Za-z]\w*/)) return "variableName.special";
    if (stream.match(/^@[_A-Za-z]\w*/)) return "meta";
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
    if (stream.match("...")) return "operator";
    if (stream.match(/^[{}()[\]]/)) return "bracket";
    if (stream.match(/^[:!=|&,]/)) return "punctuation";
    const word = stream.match(/^[_A-Za-z]\w*/);
    if (word) {
      if (KEYWORDS.has(word[0])) return "keyword";
      if (ATOMS.has(word[0])) return "atom";
      if (/^[A-Z]/.test(word[0])) return "typeName";
      // Fields taking arguments read as calls; other names are fields.
      return stream.match(/^\s*\(/, false) ? "variableName.function" : "propertyName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
