import { describe, expect, test } from "vitest";
import { encodeMarkdownPath, relativePath, rewrite } from "@core/linkRewriter";

function rename(text: string, from: string, to: string): string {
  return rewrite(text, (target) => (target.path.toLowerCase() === from.toLowerCase() ? to : null));
}

describe("LinkRewriter", () => {
  test("rewrites wiki links keeping headings and aliases", () => {
    const text = "See [[Ilum]], [[Ilum#Caves]], [[Ilum|the planet]] and ![[Ilum]].\n";
    expect(rename(text, "Ilum", "Ilum Prime")).toBe(
      "See [[Ilum Prime]], [[Ilum Prime#Caves]], [[Ilum Prime|the planet]] and ![[Ilum Prime]].\n",
    );
  });

  test("leaves other links and code alone", () => {
    const text = ["[[Dagobah]] and `[[Ilum]]` stay.", "```", "[[Ilum]]", "```", "But [[Ilum]] changes."].join("\n");
    expect(rename(text, "Ilum", "Hoth")).toBe(
      ["[[Dagobah]] and `[[Ilum]]` stay.", "```", "[[Ilum]]", "```", "But [[Hoth]] changes."].join("\n"),
    );
  });

  test("rewrites markdown links keeping encoding, fragments and titles", () => {
    const encoded = '[log](Crystal%20Log.md#2026) and [raw](<Crystal Log.md>) [titled](Crystal%20Log.md "Log")';
    const result = rewrite(encoded, (t) => (t.path === "Crystal Log.md" ? "Archive/Crystal Log.md" : null));
    expect(result).toBe(
      '[log](Archive/Crystal%20Log.md#2026) and [raw](<Archive/Crystal Log.md>) [titled](Archive/Crystal%20Log.md "Log")',
    );
  });

  test("ignores web links", () => {
    const text = "[site](https://example.com/Ilum.md)";
    expect(rewrite(text, () => "changed")).toBe(text);
  });

  test("returns the same text when nothing changes", () => {
    const text = "No links here.\r\nOr here.\n";
    expect(rewrite(text, () => null)).toBe(text);
  });

  test("computes relative paths", () => {
    expect(relativePath("Lore/Crystals", "Orders/Saber.md")).toBe("../../Orders/Saber.md");
    expect(relativePath("Lore/Crystals", "Lore/Crystals/Ilum.md")).toBe("Ilum.md");
    expect(relativePath("", "Lore/Ilum.md")).toBe("Lore/Ilum.md");
    expect(relativePath("Lore", "Ilum.md")).toBe("../Ilum.md");
    expect(relativePath("Lore", "Lore Extra/Ilum.md")).toBe("../Lore Extra/Ilum.md");
  });

  // REQUIREMENTS §19 #8: whitespace inside [[ Ilum ]] was lost on rewrite.
  test("keeps spacing around wiki link targets", () => {
    expect(rename("[[ Ilum ]] and [[ Ilum |planet]]", "Ilum", "Hoth")).toBe("[[ Hoth ]] and [[ Hoth |planet]]");
    const unchanged = "[[ Ilum ]]";
    expect(rewrite(unchanged, (t) => t.path)).toBe(unchanged);
  });

  test("keeps CRLF line endings when rewriting", () => {
    expect(rename("[[Ilum]]\r\n```\r\n[[Ilum]]\r\n```\r\n[[Ilum]]\r\n", "Ilum", "Hoth")).toBe(
      "[[Hoth]]\r\n```\r\n[[Ilum]]\r\n```\r\n[[Hoth]]\r\n",
    );
  });

  test("handles links after non-BMP characters", () => {
    expect(rename("🔷 `x` [[Ilum]] 🔷 [l](Ilum.md)", "Ilum", "Hoth")).toBe("🔷 `x` [[Hoth]] 🔷 [l](Ilum.md)");
    expect(rewrite("🔷 [l](Ilum.md)", (t) => (t.path === "Ilum.md" ? "Planets/Hoth Prime.md" : null))).toBe(
      "🔷 [l](Planets/Hoth%20Prime.md)",
    );
  });

  test("percent-encodes like the Mac app", () => {
    expect(encodeMarkdownPath("A (b) [c] <d> e%.md")).toBe("A%20%28b%29%20%5Bc%5D%20%3Cd%3E%20e%25.md");
    expect(encodeMarkdownPath("Café/ü.md")).toBe("Caf%C3%A9/%C3%BC.md");
  });
});
