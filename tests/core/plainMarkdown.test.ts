import { describe, expect, it } from "vitest";
import { stripMarkdown } from "@core/plainMarkdown";
import { plainSnippet } from "@core/vaultSearch";

const plain = (line: string, block = false) => stripMarkdown(line, { block }).text;

describe("stripMarkdown", () => {
  it("strips inline syntax", () => {
    expect(plain("**Bold** [[Ilum|planet]] and [link](x.md) `code` ~~old~~ ==hi==")).toBe("Bold planet and link code old hi");
  });

  it("leaves wiki brackets inside code spans alone", () => {
    expect(plain("Type `[[` to link to another note: [[Linked Note]].")).toBe("Type [[ to link to another note: Linked Note.");
  });

  it("drops the embed mark and shows heading targets", () => {
    expect(plain("`![[Linked Note#A section]]`")).toBe("![[Linked Note#A section]]");
    expect(plain("![[Linked Note#A section]]")).toBe("Linked Note › A section");
  });

  it("keeps underscores inside words", () => {
    expect(plain("snake_case and _emphasis_")).toBe("snake_case and emphasis");
  });

  it("strips block markers only when asked", () => {
    expect(plain("## Ways to view", true)).toBe("Ways to view");
    expect(plain("> [!note]- Click the title", true)).toBe("Click the title");
    expect(plain("- [ ] a task", true)).toBe("a task");
    expect(plain("## Ways", false)).toBe("## Ways");
  });

  it("maps every character back to the source", () => {
    const line = "a **b** c";
    const { text, map } = stripMarkdown(line);
    expect([...text].every((ch, i) => line[map[i]!] === ch)).toBe(true);
  });
});

describe("plainSnippet", () => {
  it("moves matches onto the plain text", () => {
    const line = "...to **Holocron**. Your notes";
    const at = line.indexOf("Holocron");
    const result = plainSnippet(line, [{ location: at, length: 8 }]);
    expect(result.text).toBe("...to Holocron. Your notes");
    expect(result.text.slice(result.ranges[0]!.location, result.ranges[0]!.location + 8)).toBe("Holocron");
  });

  it("falls back to the raw line when a match is in the syntax", () => {
    expect(plainSnippet("a **b**", [{ location: 2, length: 2 }]).text).toBe("a **b**");
  });
});
