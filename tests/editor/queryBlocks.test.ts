import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { countLabel, findFencedBlocks, queryText } from "../../src/editor/queryBlocks.js";
import { collectResources, markdownToHtml } from "../../src/editor/markdownToHtml.js";

const blocks = (text: string, language = "query") => findFencedBlocks(Text.of(text.split("\n")), language);

describe("findFencedBlocks", () => {
  it("finds a ```query block with its text and where the text starts", () => {
    const doc = "# Title\n\n```query\ntag:project\n[status:active]\n```\n\nAfter";
    const [block] = blocks(doc);
    expect(block.code).toBe("tag:project\n[status:active]");
    expect(doc.slice(block.from, block.to)).toBe("```query\ntag:project\n[status:active]\n```");
    expect(doc.slice(block.codeFrom)).toMatch(/^tag:project/);
  });

  it("finds ```base blocks too, and leaves other languages, lookalikes and unclosed blocks alone", () => {
    expect(blocks("~~~ Base\nfilters: tag:x\n~~~", "base")).toHaveLength(1);
    expect(blocks("```base\nfilters: tag:x\n```", "query")).toHaveLength(0);
    expect(blocks("```queryx\nabc\n```")).toHaveLength(0);
    expect(blocks("```query\nabc")).toHaveLength(0);
    expect(blocks("```js\nconst a = 1\n```")).toHaveLength(0);
  });

  it("handles several blocks and an empty one", () => {
    expect(blocks("```query\n```\n\n```query\nkyber\n```").map((b) => b.code)).toEqual(["", "kyber"]);
  });
});

describe("queryText", () => {
  it("joins the lines of the block into one query, dropping blank and // lines", () => {
    expect(queryText("tag:project\n\n  [status:active]  \n// a comment\n-path:Archive\n")).toBe("tag:project [status:active] -path:Archive");
    expect(queryText("")).toBe("");
    expect(queryText(undefined)).toBe("");
  });

  it("labels the count", () => {
    expect(countLabel(1)).toBe("1 note");
    expect(countLabel(0)).toBe("0 notes");
    expect(countLabel(12)).toBe("12 notes");
  });
});

describe("export", () => {
  it("collects query blocks as a resource and renders their results as a list", () => {
    const markdown = "Before\n\n```query\ntag:lore\n```\n\n```base\nfilters: tag:x\n```\n";
    expect(collectResources(markdown).queries).toEqual(["tag:lore"]);
    expect(collectResources(markdown).languages).toEqual([]);
    const html = markdownToHtml(markdown, {
      queries: { "tag:lore": { hits: [{ path: "Lore/Kyber.md", title: "Kyber", folder: "Lore", lines: [{ line: 3, text: "a **kyber** crystal", ranges: [] }] }], total: 1, truncated: false, error: null } },
    });
    expect(html).toContain("<strong>1 note</strong>");
    expect(html).toContain("Kyber");
    expect(html).toContain("a **kyber** crystal");
    expect(html).toContain("Base view");
    expect(markdownToHtml("```query\nx\n```")).toContain("[Query results]");
  });
});
