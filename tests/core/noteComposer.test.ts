import { describe, expect, test } from "vitest";
import { appendToNote, bodyWithoutFrontmatter, headingRename, locateSelection, promoteHeadings, sectionAt } from "@core/noteComposer";
import { parse } from "@core/noteParser";

const note = ["# Kyber", "Intro.", "", "## Attunement", "Hold it.", "", "### Steps", "1. Breathe", "", "## Colours", "Blue.", ""].join("\n");

describe("Note composer", () => {
  test("sectionAt finds the section around a line and promotes its subheadings", () => {
    const section = sectionAt(note, 5)!;
    expect(section.heading.text).toBe("Attunement");
    expect(note.slice(section.from, section.to)).toBe("## Attunement\nHold it.\n\n### Steps\n1. Breathe\n\n");
    expect(section.body).toBe("Hold it.\n\n# Steps\n1. Breathe\n");
    // On the heading line itself, and in a nested section.
    expect(sectionAt(note, 4)!.heading.text).toBe("Attunement");
    expect(sectionAt(note, 8)!.heading.text).toBe("Steps");
    // The last section runs to the end; no heading above the first line → null.
    const last = sectionAt(note, 11)!;
    expect(last.heading.text).toBe("Colours");
    expect(last.to).toBe(note.length);
    expect(sectionAt("Plain text\n\n# Later", 1)).toBeNull();
  });

  test("sectionAt keeps CRLF and ignores headings in code and frontmatter", () => {
    const crlf = "---\r\n# not: a heading\r\n---\r\n# Top\r\n```\r\n# code\r\n```\r\n## Real\r\nText\r\n";
    const section = sectionAt(crlf, 9)!;
    expect(section.heading.text).toBe("Real");
    expect(section.eol).toBe("\r\n");
    expect(section.body).toBe("Text\r\n");
    expect(sectionAt(crlf, 6)!.heading.text).toBe("Top");
  });

  test("promoteHeadings leaves headings alone when one would go past H1", () => {
    expect(promoteHeadings(["## A", "### B", "text"], 1)).toEqual(["# A", "## B", "text"]);
    expect(promoteHeadings(["# A", "## B"], 1)).toEqual(["# A", "## B"]);
    expect(promoteHeadings(["```", "## code", "```", "## B"], 1)).toEqual(["```", "## code", "```", "# B"]);
  });

  test("bodyWithoutFrontmatter", () => {
    expect(bodyWithoutFrontmatter("---\ntags: [a]\n---\n# Title\nBody\n")).toBe("# Title\nBody\n");
    expect(bodyWithoutFrontmatter("---\nunclosed\n")).toBe("---\nunclosed\n");
    expect(bodyWithoutFrontmatter("# Title\n")).toBe("# Title\n");
  });

  test("appendToNote adds one blank line, an optional heading and the target's line endings", () => {
    expect(appendToNote("# Target\nText\n\n\n", "\n# Old\nBody\n\n", "Old")).toBe("# Target\nText\n\n## Old\n\n# Old\nBody\n");
    expect(appendToNote("# Target\r\nText", "Body\nMore", null)).toBe("# Target\r\nText\r\n\r\nBody\r\nMore\r\n");
    expect(appendToNote("", "Body", null)).toBe("Body\n");
  });

  test("locateSelection checks the text and maps CRLF offsets", () => {
    expect(locateSelection("abc def", 4, 7, "def")).toEqual([4, 7]);
    expect(locateSelection("abc\r\ndef\r\nghi", 4, 7, "def")).toEqual([5, 8]);
    expect(locateSelection("abc\r\ndef\r\nghi", 4, 7, "xyz")).toBeNull();
    // Moved, but still unique: found again.
    expect(locateSelection("x abc def", 4, 7, "def")).toEqual([6, 9]);
    expect(locateSelection("def def", 0, 3, "def")).toEqual([0, 3]);
    expect(locateSelection("adef def", 1, 4, "ef")).toBeNull();
  });

  test("headingRename spots exactly one changed heading", () => {
    const before = parse("# A\n## B\n## C\n").headings;
    expect(headingRename(before, parse("# A\n## Bee\n## C\n").headings)).toEqual({ from: "B", to: "Bee" });
    expect(headingRename(before, parse("# A\n## B\n").headings)).toBeNull();
    expect(headingRename(before, parse("# A\n## Bee\n## Sea\n").headings)).toBeNull();
    expect(headingRename(before, parse("# A\n## B\n## C\n").headings)).toBeNull();
    expect(headingRename(before, parse("# A\n### B\n## C\n").headings)).toBeNull();
  });
});
