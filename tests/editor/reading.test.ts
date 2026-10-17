import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { isMostlyLight, withImageWidth } from "../../src/editor/images.js";
import { parseCodeInfo } from "../../src/editor/codeblocks.js";
import { compareCells } from "../../src/editor/tables.js";
import { footnoteText } from "../../src/editor/footnotes.js";
import { headingTrail, noteHeadings, plainHeading } from "../../src/editor/headings.js";
import { findDisplayMath } from "../../src/editor/math.js";
import { withTableOfContents } from "../../src/editor/exporter.js";
import { exportFileName } from "../../src/main/exporter";

const doc = (lines: string[]) => Text.of(lines);

describe("Image widths", () => {
  it("sets, replaces and removes the size of embeds and markdown images", () => {
    expect(withImageWidth("![[a.png]]", 300)).toBe("![[a.png|300]]");
    expect(withImageWidth("![[a.png|120x80]]", 299.6)).toBe("![[a.png|300]]");
    expect(withImageWidth("![[a.png|120]]", null)).toBe("![[a.png]]");
    expect(withImageWidth("![Alt](a.png)", 240)).toBe("![Alt|240](a.png)");
    expect(withImageWidth("![Alt|100](a b.png \"t\")", null)).toBe("![Alt](a b.png \"t\")");
  });
});

describe("Light images", () => {
  const pixels = (rgba: number[], count: number) => new Uint8ClampedArray(Array.from({ length: count }, () => rgba).flat());
  it("counts white and transparent pixels as light, photos and dark images as not", () => {
    expect(isMostlyLight(pixels([255, 255, 255, 255], 100))).toBe(true);
    expect(isMostlyLight(pixels([0, 0, 0, 0], 100))).toBe(true); // transparent: dark ink would vanish
    expect(isMostlyLight(pixels([40, 90, 200, 255], 100))).toBe(false);
    expect(isMostlyLight(new Uint8ClampedArray([...pixels([255, 255, 255, 255], 50), ...pixels([20, 20, 20, 255], 50)]))).toBe(false);
  });
});

describe("Code block info strings", () => {
  it("reads the language, title, highlighted lines and line numbers", () => {
    const info = parseCodeInfo('ts title="sync.ts" {2,4-5} linenos');
    expect(info.language).toBe("ts");
    expect(info.title).toBe("sync.ts");
    expect([...info.highlight]).toEqual([2, 4, 5]);
    expect(info.lineNumbers).toBe(true);
    expect(parseCodeInfo("python")).toEqual({ language: "python", title: null, highlight: new Set(), lineNumbers: false });
    expect(parseCodeInfo("title='a b.js'").title).toBe("a b.js");
    expect(parseCodeInfo("title='a b.js'").language).toBe("");
  });
});

describe("Table sorting", () => {
  it("compares numbers by value, text naturally, and puts empty cells last", () => {
    const sorted = (cells: string[]) => [...cells].sort(compareCells);
    expect(sorted(["30", "4", "1,000", "200"])).toEqual(["4", "30", "200", "1,000"]);
    expect(sorted(["$3.50", "45%", "-2"])).toEqual(["-2", "$3.50", "45%"]);
    expect(sorted(["Item 10", "item 2", "", "Item 1"])).toEqual(["Item 1", "item 2", "Item 10", ""]);
  });
});

describe("Footnotes", () => {
  it("reads a definition and its indented continuation lines", () => {
    const text = "Text[^a].\n\n[^a]: First line\n  second line\n\tthird\nNot part.\n[^b.c]: Other";
    expect(footnoteText(text, "a")).toBe("First line second line third");
    expect(footnoteText(text, "b.c")).toBe("Other");
    expect(footnoteText(text, "missing")).toBeNull();
  });
});

describe("Headings", () => {
  const lines = ["---", "title: x", "---", "# Top", "## **Bold** [[Note|link]]", "```", "# not a heading", "```", "### Deep `code` ##", "## Next", "text"];
  it("finds headings outside code and frontmatter, as plain text", () => {
    expect(noteHeadings(doc(lines)).map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "Top", 4],
      [2, "Bold link", 5],
      [3, "Deep code", 9],
      [2, "Next", 10],
    ]);
    expect(plainHeading("A [b](c.md) ==hi==")).toBe("A b hi");
  });

  it("works out the trail of headings around a line", () => {
    const headings = noteHeadings(doc(lines));
    expect(headingTrail(headings, 9).map((h) => h.text)).toEqual(["Top", "Bold link", "Deep code"]);
    expect(headingTrail(headings, 11).map((h) => h.text)).toEqual(["Top", "Next"]);
    expect(headingTrail(headings, 2)).toEqual([]);
  });
});

describe("Maths in quotes and callouts", () => {
  it("finds $$ blocks inside quotes, starting after the first line's markers", () => {
    const text = doc(["> [!note] Maths", "> $$", "> e^{i\\pi} + 1 = 0", "> $$", "", "$$", "x^2", "$$"]);
    const blocks = findDisplayMath(text);
    expect(blocks.map((b) => [b.source, b.quoted])).toEqual([
      ["e^{i\\pi} + 1 = 0", true],
      ["x^2", false],
    ]);
    expect(text.sliceString(blocks[0].from, blocks[0].from + 2)).toBe("$$");
  });

  it("stops at a change in quote depth", () => {
    expect(findDisplayMath(doc(["> $$", "> a", "b", "> $$"]))).toEqual([]);
  });
});

describe("Export", () => {
  it("turns [TOC] into a list of headings, but not inside code", () => {
    const out = withTableOfContents("# A\n\n[TOC]\n\n## B\n\n```\n[TOC]\n```\n");
    expect(out).toContain("**Contents**\n\n- A\n  - B\n");
    expect(out).toContain("```\n[TOC]\n```");
  });

  it("names files after the note, without characters Windows forbids", () => {
    expect(exportFileName("Kyber: notes?", "pdf")).toBe("Kyber notes.pdf");
    expect(exportFileName("  ...  ", "html")).toBe("Note.html");
  });
});
