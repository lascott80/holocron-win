import { describe, expect, it } from "vitest";
import { isPlaceholderName, titleFromContent } from "@core/autoTitle";

describe("titleFromContent", () => {
  it("uses the first line without markdown", () => {
    expect(titleFromContent("# Council of **Ilum**\n\nBody")).toBe("Council of Ilum");
    expect(titleFromContent("\n\n  Plain first line  \nmore")).toBe("Plain first line");
    expect(titleFromContent("- [ ] Buy [[Kyber]] crystals ^task")).toBe("Buy Kyber crystals");
    expect(titleFromContent("> Quoted [link](https://x.y) and [[Ilum|the planet]]")).toBe("Quoted link and the planet");
    expect(titleFromContent("12) Numbered `code`")).toBe("Numbered code");
  });

  it("skips properties and empty notes", () => {
    expect(titleFromContent("---\ntags: [x]\n---\n## Meeting notes\n")).toBe("Meeting notes");
    expect(titleFromContent("")).toBeNull();
    expect(titleFromContent("#\n   \n")).toBeNull();
  });

  it("removes characters file names can't have", () => {
    expect(titleFromContent("Q3: plan/review? <draft> | v2")).toBe("Q3 planreview draft v2");
    expect(titleFromContent("...dots trimmed...")).toBe("dots trimmed");
    // Control and format characters go before whitespace is collapsed, so a tab joins words (as in Swift).
    expect(titleFromContent("Tab\there\u0007 and\u200b zero width")).toBe("Tabhere and zero width");
  });

  it("shortens long lines at a word", () => {
    const title = titleFromContent("lightsaber ".repeat(20));
    expect(title).not.toBeNull();
    expect(Array.from(title!).length).toBeLessThanOrEqual(80);
    expect(title!.endsWith("lightsaber")).toBe(true);
  });

  it("cuts long words without spaces at 80 characters", () => {
    expect(titleFromContent("x".repeat(100))).toBe("x".repeat(80));
  });

  it("drops trailing dots left by the cut", () => {
    expect(titleFromContent("a".repeat(70) + " end. " + "b".repeat(20))).toBe("a".repeat(70) + " end");
  });

  it("avoids Windows reserved names", () => {
    expect(titleFromContent("# CON")).toBe("CON note");
    expect(titleFromContent("nul")).toBe("nul note");
    expect(titleFromContent("Com1")).toBe("Com1 note");
    expect(titleFromContent("LPT9")).toBe("LPT9 note");
    expect(titleFromContent("COM0")).toBe("COM0");
    expect(titleFromContent("CON.txt")).toBe("CON.txt");
    expect(titleFromContent("Console")).toBe("Console");
  });
});

describe("isPlaceholderName", () => {
  it("recognises placeholder names", () => {
    expect(isPlaceholderName("Untitled.md")).toBe(true);
    expect(isPlaceholderName("Lore/Untitled 12.md")).toBe(true);
    expect(isPlaceholderName("Untitled plans.md")).toBe(false);
    expect(isPlaceholderName("Ilum.md")).toBe(false);
    expect(isPlaceholderName("untitled.md")).toBe(false);
  });
});
