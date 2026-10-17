import { describe, expect, it } from "vitest";
import { tidyMarkdown } from "../../src/editor/tidy.js";

const tidy = (lines: string[]) => tidyMarkdown(lines.join("\n"));

describe("Tidy Note", () => {
  it("spaces headings and collapses blank lines", () => {
    expect(tidy(["#  Title", "Text", "", "", "", "##Not a heading", "## Section", "More"])).toBe(
      ["# Title", "", "Text", "", "##Not a heading", "", "## Section", "", "More", ""].join("\n"),
    );
  });

  it("uses - for bullets but leaves horizontal rules and bold text alone", () => {
    expect(tidy(["* one", "+ two", "  * nested", "* * *", "**bold** text", "- [ ] task", "* [x] done"])).toBe(
      ["- one", "- two", "  - nested", "* * *", "**bold** text", "- [ ] task", "- [x] done", ""].join("\n"),
    );
  });

  it("renumbers ordered lists from their first number, nested lists too", () => {
    expect(tidy(["1. a", "1. b", "   1. x", "   5. y", "7. c", "", "Para", "", "3. new", "3. list"])).toBe(
      ["1. a", "2. b", "   1. x", "   2. y", "3. c", "", "Para", "", "3. new", "4. list", ""].join("\n"),
    );
  });

  it("trims trailing spaces but keeps a hard break before more text", () => {
    expect(tidy(["Line one  ", "line two   ", "", "end \t"])).toBe(["Line one  ", "line two", "", "end", ""].join("\n"));
  });

  it("aligns tables", () => {
    expect(tidy(["| a | long header |", "|-|:-:|", "| 1 | 2 |"])).toBe(
      ["| a   | long header |", "| --- | :---------: |", "| 1   |      2      |", ""].join("\n"),
    );
  });

  it("never touches code, maths, HTML, comments or the frontmatter", () => {
    const text = [
      "---",
      "tags:   [a]   ",
      "---",
      "```js",
      "* not a bullet   ",
      "",
      "",
      "1. x",
      "```",
      "",
      "$$",
      "a  ",
      "$$",
      "",
      "<div>",
      "  * html   ",
      "</div>",
      "",
      "%%",
      "* hidden  ",
      "%%",
      "",
    ].join("\n");
    expect(tidyMarkdown(text)).toBe(text);
  });

  it("keeps CRLF line endings and is idempotent", () => {
    const once = tidyMarkdown("# A\r\nText\r\n* b\r\n");
    expect(once).toBe("# A\r\n\r\nText\r\n- b\r\n");
    expect(tidyMarkdown(once)).toBe(once);
  });

  it("leaves a tidy or empty note unchanged", () => {
    const tidyText = "# Title\n\nText.\n";
    expect(tidyMarkdown(tidyText)).toBe(tidyText);
    expect(tidyMarkdown("")).toBe("");
  });
});
