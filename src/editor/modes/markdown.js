// Markdown inside a ```markdown fence: a small stream mode. A full nested
// lang-markdown parse would share tags (headings, links) with the note
// itself, so this one uses its own heading tag and stays shallow.
import { codeHeading } from "./tags.js";

export const markdownCode = {
  name: "markdown",
  startState: () => ({ fence: null }),
  token(stream, state) {
    if (stream.sol()) {
      const fence = stream.match(/^\s*(`{3,}|~{3,})/, false);
      if (state.fence) {
        if (fence && fence[1][0] === state.fence[0] && fence[1].length >= state.fence.length) {
          stream.skipToEnd();
          state.fence = null;
          return "meta";
        }
        stream.skipToEnd();
        return "string";
      }
      if (fence) {
        state.fence = fence[1];
        stream.skipToEnd();
        return "meta";
      }
      if (stream.match(/^ {0,3}#{1,6}(\s|$)/)) {
        stream.skipToEnd();
        return "codeHeading";
      }
      if (stream.match(/^ {0,3}([-*_])(\s*\1){2,}\s*$/)) return "meta";
      if (stream.match(/^\s*>+/)) return "meta";
      if (stream.match(/^\s*([-*+]|\d+[.)])(?=\s)/)) {
        stream.match(/^\s*\[[ xX]\]/);
        return "meta";
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^`+[^`]*`+/)) return "string";
    if (stream.match(/^(\*\*|__)(?=\S)(.*?\S)\1/)) return "strong";
    if (stream.match(/^([*_])(?=\S)(.*?\S)\1/)) return "emphasis";
    if (stream.match(/^~~(?=\S)(.*?\S)~~/)) return "strikethrough";
    if (stream.match(/^!?\[\[[^\]]*\]\]/)) return "link";
    if (stream.match(/^!?\[[^\]]*\](?=[([])/)) return "link";
    if (stream.match(/^\([^)\s]*(\s+"[^"]*")?\)/) || stream.match(/^<https?:[^>]*>/)) return "url";
    if (stream.match(/^<\/?[A-Za-z][^>]*>/)) return "tagName";
    if (stream.match(/^\\./)) return null;
    stream.match(/^[^\s`*_~![(<\\]+/) || stream.next();
    return null;
  },
  tokenTable: { codeHeading },
};
