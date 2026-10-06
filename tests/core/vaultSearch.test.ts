import { describe, expect, it } from "vitest";
import {
  INVALID_REGEX_MESSAGE,
  parseQuery,
  runSearch,
  search,
  snippet,
  type SearchNote,
  type SearchRange,
} from "@core/vaultSearch";

const sub = (text: string, range: SearchRange) => text.slice(range.location, range.location + range.length);

describe("parseQuery", () => {
  it("parses words, phrases, exclusions and filters", () => {
    const query = parseQuery(`kyber "red shift" -ilum tag:#lore path:Lore/Crystals file:log`);
    expect(query.terms).toEqual(["kyber", "red shift"]);
    expect(query.excluded).toEqual(["ilum"]);
    expect(query.tags).toEqual(["lore"]);
    expect(query.paths).toEqual(["Lore/Crystals"]);
    expect(query.files).toEqual(["log"]);
  });

  it("keeps spaces in quoted filter values", () => {
    const query = parseQuery(`path:"Jedi Orders" saber`);
    expect(query.paths).toEqual(["Jedi Orders"]);
    expect(query.terms).toEqual(["saber"]);
  });

  it("takes the whole query in regex mode", () => {
    const query = parseQuery("kyb(er)? -x", { useRegex: true });
    expect(query.regex).toBe("kyb(er)? -x");
    expect(query.terms).toEqual([]);
  });

  it("treats a lone dash as a term and filter prefixes case-insensitively", () => {
    const query = parseQuery("- TAG:Lore Path:Daily FILE:log tag:");
    expect(query.terms).toEqual(["-", "tag:"]);
    expect(query.tags).toEqual(["Lore"]);
    expect(query.paths).toEqual(["Daily"]);
    expect(query.files).toEqual(["log"]);
  });
});

describe("runSearch", () => {
  const notes: SearchNote[] = [
    {
      path: "Lore/Crystals/Kyber Crystal Notes.md",
      text: "# Kyber Crystal Notes\n\nCrystals are gathered on Ilum.\nA red shift means the crystal was bled.\n",
      tags: ["lore", "crystals"],
    },
    { path: "Lore/Crystals/Ilum.md", text: "# Ilum\n\nPrimary source of kyber.\n", tags: ["lore/planets"] },
    { path: "Daily/2026-10-05.md", text: "Started Holocron.\nCafé meeting about the KYBER log.\n", tags: [] },
    { path: "Orders/Lightsaber Construction.md", text: "Step 4 needs an attuned crystal.\n", tags: ["lore"] },
  ];
  const search = (text: string, matchCase = false, useRegex = false) =>
    runSearch(parseQuery(text, { matchCase, useRegex }), notes);
  const titles = (text: string, matchCase = false, useRegex = false) =>
    search(text, matchCase, useRegex).hits.map((hit) => hit.title);

  it("finds all words anywhere in a note", () => {
    expect(titles("crystal ilum")).toEqual(["Kyber Crystal Notes"]);
  });

  it("reports lines and UTF-16 ranges", () => {
    const hit = search("kyber").hits.find((h) => h.title === "2026-10-05")!;
    expect(hit.lines.map((l) => l.line)).toEqual([2]);
    const line = hit.lines[0]!;
    expect(sub(line.text, line.ranges[0]!)).toBe("KYBER");
  });

  it("ranks title matches first", () => {
    expect(titles("kyber")[0]).toBe("Kyber Crystal Notes");
  });

  it("handles phrases, exclusions and case", () => {
    expect(titles(`"red shift"`)).toEqual(["Kyber Crystal Notes"]);
    expect(titles("crystal -ilum")).toEqual(["Lightsaber Construction"]); // Kyber note mentions Ilum
    expect(titles("KYBER", true)).toEqual(["2026-10-05"]);
    expect(titles("cafe")).toEqual(["2026-10-05"]); // ignores accents
  });

  it("filters by tag, path and file", () => {
    expect(new Set(titles("tag:lore"))).toEqual(new Set(["Kyber Crystal Notes", "Ilum", "Lightsaber Construction"]));
    expect(titles("crystal path:orders")).toEqual(["Lightsaber Construction"]);
    expect(titles("file:ilum")).toEqual(["Ilum"]);
    expect(search("tag:lore").hits.every((hit) => hit.lines.length === 0)).toBe(true);
  });

  it("searches with regular expressions", () => {
    expect(new Set(titles("^#\\s", false, true))).toEqual(new Set(["Kyber Crystal Notes", "Ilum"]));
    const outcome = search("(", false, true);
    expect(outcome.error).toBe(INVALID_REGEX_MESSAGE);
    expect(outcome.hits).toEqual([]);
  });

  it("counts every match", () => {
    const hit = search("crystal").hits.find((h) => h.title === "Kyber Crystal Notes")!;
    expect(hit.matchCount).toBe(3); // heading, "Crystals", "crystal"
    expect(search("").hits).toEqual([]);
  });

  it("merges overlapping terms", () => {
    const hit = search(`kyber "kyber crystal"`).hits.find((h) => h.title === "Kyber Crystal Notes")!;
    const heading = hit.lines[0]!;
    expect(heading.ranges.length).toBe(1);
    expect(sub(heading.text, heading.ranges[0]!)).toBe("Kyber Crystal");
  });
});

describe("runSearch details", () => {
  it("maps accent-folded matches back to original offsets", () => {
    const notes: SearchNote[] = [
      { path: "a.md", text: "intro\r\n😀 Ünïcode café — and Café again\r\nlast CAFÉ", tags: [] },
    ];
    const outcome = runSearch(parseQuery("cafe"), notes);
    const hit = outcome.hits[0]!;
    expect(hit.matchCount).toBe(3);
    expect(hit.lines.map((l) => l.line)).toEqual([2, 3]);
    const [second, third] = hit.lines;
    expect(second!.ranges.map((r) => sub(second!.text, r))).toEqual(["café", "Café"]);
    expect(third!.ranges.map((r) => sub(third!.text, r))).toEqual(["CAFÉ"]);
    expect(runSearch(parseQuery("unicode"), notes).hits[0]!.lines[0]!.ranges.map((r) => sub(second!.text, r))).toEqual([
      "Ünïcode",
    ]);
  });

  it("folds context-dependent lowercase consistently", () => {
    const notes: SearchNote[] = [{ path: "a.md", text: "ΟΔΟΣ and İstanbul ﬁne", tags: [] }];
    for (const term of ["οδος", "οδοσ", "ΟΔΟΣ"]) {
      const line = runSearch(parseQuery(term), notes).hits[0]!.lines[0]!;
      expect(sub(line.text, line.ranges[0]!)).toBe("ΟΔΟΣ");
    }
    const line = runSearch(parseQuery("istanbul"), notes).hits[0]!.lines[0]!;
    expect(sub(line.text, line.ranges[0]!)).toBe("İstanbul");
  });

  it("keeps line numbers and offsets right across many accented lines", () => {
    const text = Array.from({ length: 25 }, (_, i) => `${"é".repeat(i)}́ Ŝtar ${i}`).join("\r\n");
    const notes: SearchNote[] = [{ path: "a.md", text, tags: [] }];
    const hit = runSearch(parseQuery("star"), notes).hits[0]!;
    expect(hit.matchCount).toBe(25);
    expect(hit.lines.length).toBe(20);
    hit.lines.forEach((line, i) => {
      expect(line.line).toBe(i + 1);
      expect(line.ranges).toEqual([{ location: i + 2, length: 4 }]);
    });
    // A decomposed accent in the query folds away too.
    expect(runSearch(parseQuery(`"Ŝtar 2́"`), notes).hits[0]!.matchCount).toBe(6); // lines 2 and 20–24
  });

  it("matches case and accents exactly with match case on", () => {
    const notes: SearchNote[] = [{ path: "a.md", text: "Café cafe", tags: [] }];
    const hit = runSearch(parseQuery("cafe", { matchCase: true }), notes).hits[0]!;
    expect(hit.matchCount).toBe(1);
    expect(hit.lines[0]!.ranges).toEqual([{ location: 5, length: 4 }]);
  });

  it("matches a term in the title alone", () => {
    const notes: SearchNote[] = [{ path: "Holocron Ideas.md", text: "nothing here", tags: [] }];
    const hit = runSearch(parseQuery("holocron"), notes).hits[0]!;
    expect(hit.titleMatches).toBe(true);
    expect(hit.matchCount).toBe(0);
    expect(hit.lines).toEqual([]);
  });

  it("matches nested tags but not tag prefixes", () => {
    const notes: SearchNote[] = [
      { path: "a.md", text: "", tags: ["Lore/Planets"] },
      { path: "b.md", text: "", tags: ["lorem"] },
    ];
    expect(runSearch(parseQuery("tag:lore"), notes).hits.map((h) => h.path)).toEqual(["a.md"]);
  });

  it("limits lines and notes", () => {
    const text = Array.from({ length: 30 }, () => "kyber kyber").join("\n");
    const notes: SearchNote[] = Array.from({ length: 5 }, (_, i) => ({ path: `Note ${i}.md`, text, tags: [] }));
    const outcome = runSearch(parseQuery("kyber"), notes, 3);
    expect(outcome.hits.length).toBe(3);
    expect(outcome.truncated).toBe(true);
    expect(outcome.totalMatches).toBe(300);
    expect(outcome.hits[0]!.lines.length).toBe(20);
    expect(outcome.hits[0]!.matchCount).toBe(60);
  });

  it("orders by count then natural path", () => {
    const notes: SearchNote[] = [
      { path: "Note 10.md", text: "x", tags: [] },
      { path: "Note 2.md", text: "x", tags: [] },
      { path: "Note 1.md", text: "x x", tags: [] },
    ];
    expect(runSearch(parseQuery("x"), notes).hits.map((h) => h.path)).toEqual(["Note 1.md", "Note 2.md", "Note 10.md"]);
  });

  it("anchors regexes at line breaks and skips empty matches", () => {
    const notes: SearchNote[] = [{ path: "a.md", text: "one\ntwo\n", tags: [] }];
    const hit = runSearch(parseQuery("o$", { useRegex: true }), notes).hits[0]!;
    expect(hit.lines).toEqual([{ line: 2, text: "two", ranges: [{ location: 2, length: 1 }] }]);
    expect(runSearch(parseQuery("x*", { useRegex: true }), notes).hits[0]!.matchCount).toBe(0);
  });
});

describe("snippet", () => {
  it("returns short lines unchanged", () => {
    expect(snippet("a kyber b", [{ location: 2, length: 5 }])).toEqual({
      text: "a kyber b",
      ranges: [{ location: 2, length: 5 }],
    });
  });

  it("starts at a word boundary before the first match", () => {
    const line = "The quick brown fox jumps over the lazy dog and finds a kyber crystal";
    const at = line.indexOf("kyber");
    const result = snippet(line, [{ location: at, length: 5 }]);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text).toBe("…lazy dog and finds a kyber crystal");
    expect(sub(result.text, result.ranges[0]!)).toBe("kyber");
  });

  it("caps the length and clips ranges", () => {
    const line = "kyber " + "x".repeat(300);
    const result = snippet(line, [{ location: 0, length: 5 }, { location: 237, length: 10 }, { location: 260, length: 3 }]);
    expect(result.text.length).toBe(241);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.ranges).toEqual([{ location: 0, length: 5 }, { location: 237, length: 3 }]);
  });

  it("falls back to a character boundary without spaces", () => {
    const line = "😀".repeat(30) + "kyber";
    const result = snippet(line, [{ location: 60, length: 5 }]);
    expect(result.text).toBe("…" + "😀".repeat(12) + "kyber");
    expect(sub(result.text, result.ranges[0]!)).toBe("kyber");
  });
});

describe("truncation", () => {
  it("keeps the best-ranked notes, not the first found", () => {
    const notes = Array.from({ length: 205 }, (_, i) => ({ path: `n${String(i).padStart(3, "0")}.md`, text: "kyber", tags: [] }));
    notes.push({ path: "zz-best.md", text: "kyber kyber kyber kyber", tags: [] });
    const outcome = search("kyber", notes);
    expect(outcome.truncated).toBe(true);
    expect(outcome.hits).toHaveLength(200);
    expect(outcome.hits[0]!.path).toBe("zz-best.md");
    expect(outcome.hits[0]!.lines).toHaveLength(1);
    expect(outcome.totalMatches).toBe(209);
  });
});