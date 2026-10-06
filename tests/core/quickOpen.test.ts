import { describe, expect, it } from "vitest";
import { fuzzyMatch, quickOpenSearch, type QuickOpenNote } from "@core/quickOpen";

describe("fuzzyMatch", () => {
  it("matches subsequences and reports indices", () => {
    expect(fuzzyMatch("kyb", "Kyber Crystal Notes")?.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch("kcn", "Kyber Crystal Notes")?.indices).toEqual([0, 6, 14]);
    expect(fuzzyMatch("xyz", "Kyber Crystal Notes")).toBeNull();
    expect(fuzzyMatch("kyberz", "Kyber")).toBeNull();
  });

  it("prefers word starts and runs", () => {
    expect(fuzzyMatch("cl", "Crystal Log")?.indices).toEqual([0, 8]);
    const prefix = fuzzyMatch("log", "Crystal Log")!;
    const scattered = fuzzyMatch("log", "Lightsaber Orders Guide")!;
    expect(prefix.score > scattered.score || prefix.indices.join() === "8,9,10").toBe(true);
  });

  it("scores per the spec", () => {
    // k: 1 + 12 (start); y: +8 adjacent, 1; b: +8, 1 → 31; ×4 − 5.
    expect(fuzzyMatch("kyb", "Kyber")).toEqual({ score: 31 * 4 - 5, indices: [0, 1, 2] });
    // a at 2 after "-": 1 + 10 − 2; c at 4 after gap: −2, 1 + 0 → 8.
    expect(fuzzyMatch("ac", "x-abc")).toEqual({ score: 8 * 4 - 5, indices: [2, 4] });
    // camelCase boundary: L after lowercase scores 8, first character penalised by min(position, 8).
    expect(fuzzyMatch("l", "openLog")).toEqual({ score: (1 + 8 - 4) * 4 - 7, indices: [4] });
    // non-letter → letter: 6.
    expect(fuzzyMatch("b", "2b")).toEqual({ score: (1 + 6 - 1) * 4 - 2, indices: [1] });
  });

  it("ignores case and whitespace in the query", () => {
    expect(fuzzyMatch(" K C ", "kyber crystal")?.indices).toEqual([0, 6]);
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("counts code points for indices", () => {
    expect(fuzzyMatch("k", "🪐 Kyber")?.indices).toEqual([2]);
  });
});

describe("quickOpenSearch", () => {
  const notes: QuickOpenNote[] = [
    { path: "Lore/Crystals/Kyber Crystal Notes.md", aliases: ["Kyber"], tags: ["lore", "crystals"] },
    { path: "Projects/Kyber Supply Routes.md", aliases: [], tags: ["projects"] },
    { path: "Lore/Crystals/Crystal Log.md", aliases: ["Kyber log"], tags: ["lore/crystals"] },
    { path: "Daily/2026-10-05.md", aliases: [], tags: [] },
  ];
  const recent = ["Daily/2026-10-05.md", "Projects/Kyber Supply Routes.md"];
  const search = (query: string) => quickOpenSearch(notes, recent, query);

  it("ranks title matches", () => {
    const hits = search("kyb");
    expect(hits.slice(0, 2).map((hit) => hit.path).sort()).toEqual([
      "Lore/Crystals/Kyber Crystal Notes.md",
      "Projects/Kyber Supply Routes.md",
    ]);
    expect(hits.some((hit) => hit.path === "Lore/Crystals/Crystal Log.md" && hit.field.kind === "alias" && hit.field.alias === "Kyber log")).toBe(true);
  });

  it("lists recent notes for an empty query", () => {
    expect(search("").map((hit) => hit.path)).toEqual(["Daily/2026-10-05.md", "Projects/Kyber Supply Routes.md"]);
    expect(quickOpenSearch(notes, ["Gone.md", ...recent], "  ").map((hit) => hit.path)).toEqual(recent);
  });

  it("includes nested tags in tag queries", () => {
    expect(search("#crystals").map((hit) => hit.path)).toEqual(["Lore/Crystals/Kyber Crystal Notes.md"]);
    expect(new Set(search("#lore").map((hit) => hit.path))).toEqual(
      new Set(["Lore/Crystals/Kyber Crystal Notes.md", "Lore/Crystals/Crystal Log.md"]),
    );
    expect(search("#LORE/Crystals").map((hit) => hit.path)).toEqual(["Lore/Crystals/Crystal Log.md"]);
    // "#" alone: every tagged note, recent first, then by path.
    expect(search("#").map((hit) => hit.path)).toEqual([
      "Projects/Kyber Supply Routes.md",
      "Lore/Crystals/Crystal Log.md",
      "Lore/Crystals/Kyber Crystal Notes.md",
    ]);
  });

  it("falls back to folder paths", () => {
    expect(search("daily").map((hit) => hit.path)).toEqual(["Daily/2026-10-05.md"]);
    expect(search("daily")[0]?.field).toEqual({ kind: "path" });
  });

  it("adds the title and recency bonuses and breaks ties naturally", () => {
    const tied = quickOpenSearch(
      [{ path: "b/Note 10.md", aliases: [], tags: [] }, { path: "a/Note 2.md", aliases: [], tags: [] }, { path: "a/Note 10.md", aliases: [], tags: [] }],
      [],
      "note",
    );
    expect(tied.map((hit) => hit.path)).toEqual(["a/Note 2.md", "a/Note 10.md", "b/Note 10.md"]);
    expect(tied[0]?.score).toBe(fuzzyMatch("note", "Note 2")!.score + 40);

    const boosted = quickOpenSearch(tied.map((hit) => ({ path: hit.path, aliases: [], tags: [] })), ["b/Note 10.md"], "note");
    expect(boosted[0]).toMatchObject({ path: "b/Note 10.md", score: fuzzyMatch("note", "Note 10")!.score + 40 + 20 });
  });

  it("limits results", () => {
    expect(quickOpenSearch(notes, recent, "e", 2)).toHaveLength(2);
  });
});
