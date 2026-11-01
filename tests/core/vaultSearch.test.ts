import { describe, expect, it } from "vitest";
import {
  compileQuery,
  INVALID_REGEX_MESSAGE,
  parseQuery,
  replaceMatches,
  resultsAsMarkdown,
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
describe("replaceMatches", () => {
  it("replaces every term match, case- and accent-insensitively, keeping line endings", () => {
    const text = "Kyber on Ilum.\r\nkyber, KYBER and kybér.\r\n";
    const result = replaceMatches(text, parseQuery("kyber"), "crystal");
    expect(result).toEqual({ text: "crystal on Ilum.\r\ncrystal, crystal and crystal.\r\n", count: 4 });
  });

  it("respects match case and replaces each term of a multi-word query", () => {
    expect(replaceMatches("Kyber kyber", parseQuery("kyber", { matchCase: true }), "x")).toEqual({ text: "Kyber x", count: 1 });
    expect(replaceMatches("red and blue", parseQuery("red blue"), "_")).toEqual({ text: "_ and _", count: 2 });
  });

  it("inserts the replacement literally outside regex mode", () => {
    expect(replaceMatches("a.b", parseQuery("."), "$&$1").text).toBe("a$&$1b");
  });

  it("changes nothing for filter-only or excluded-only queries", () => {
    expect(replaceMatches("tagged #lore", parseQuery("tag:lore"), "x")).toEqual({ text: "tagged #lore", count: 0 });
    expect(replaceMatches("ilum", parseQuery("-ilum"), "x")).toEqual({ text: "ilum", count: 0 });
    expect(replaceMatches("ilum", parseQuery(""), "x").count).toBe(0);
  });

  it("supports regex groups and skips empty matches", () => {
    const query = parseQuery("(\\w+)@(\\w+)", { useRegex: true });
    expect(replaceMatches("mail ahsoka@temple now", query, "$2:$1 ($&)")).toEqual({ text: "mail temple:ahsoka (ahsoka@temple) now", count: 1 });
    expect(replaceMatches("aaa", parseQuery("x*", { useRegex: true }), "-")).toEqual({ text: "aaa", count: 0 });
    expect(replaceMatches("a1\nb2", parseQuery("^(\\w)", { useRegex: true }), "[$1]")).toEqual({ text: "[a]1\n[b]2", count: 2 });
    expect(replaceMatches("cost $5", parseQuery("\\$(\\d)", { useRegex: true }), "$$$1.00")).toEqual({ text: "cost $5.00", count: 1 });
  });

  it("throws on an invalid pattern", () => {
    expect(() => replaceMatches("x", parseQuery("(", { useRegex: true }), "")).toThrow();
  });
});

// Operators and property search (SRCH-11)
describe("parseQuery operators", () => {
  const expr = (text: string) => parseQuery(text).expr;

  it("binds AND tighter than OR and lets parentheses override", () => {
    expect(expr("a OR b c")).toEqual({ kind: "or", nodes: [{ kind: "term", text: "a" }, { kind: "and", nodes: [{ kind: "term", text: "b" }, { kind: "term", text: "c" }] }] });
    expect(expr("(a OR b) c")).toEqual({ kind: "and", nodes: [{ kind: "or", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: "b" }] }, { kind: "term", text: "c" }] });
    expect(expr("-(a OR b)")).toEqual({ kind: "not", node: { kind: "or", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: "b" }] } });
  });

  it("ignores a dangling OR, empty groups and stray parentheses", () => {
    expect(expr("OR a OR")).toEqual({ kind: "term", text: "a" });
    expect(expr("a OR OR b")).toEqual({ kind: "or", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: "b" }] });
    expect(expr("() a")).toEqual({ kind: "term", text: "a" });
    expect(expr("(a")).toEqual({ kind: "term", text: "a" });
    expect(expr("a )")).toEqual({ kind: "and", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: ")" }] }); // no group open: a word
    expect(parseQuery("OR").expr).toBeNull();
  });

  it("keeps parentheses inside words and quotes", () => {
    expect(expr("f(x)")).toEqual({ kind: "term", text: "f(x)" });
    expect(expr('"(a OR b)"')).toEqual({ kind: "term", text: "(a OR b)" });
    expect(expr('"OR"')).toEqual({ kind: "term", text: "OR" });
  });

  it("parses scoped, task and content operators", () => {
    expect(expr("line:(a b)")).toEqual({ kind: "scope", scope: "line", node: { kind: "and", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: "b" }] } });
    expect(expr("Block:word")).toEqual({ kind: "scope", scope: "block", node: { kind: "term", text: "word" } });
    expect(expr('section:"a b"')).toEqual({ kind: "scope", scope: "section", node: { kind: "term", text: "a b" } });
    expect(expr("task:")).toEqual({ kind: "task", status: "any", node: null });
    expect(expr("task-todo:x")).toEqual({ kind: "task", status: "todo", node: { kind: "term", text: "x" } });
    expect(expr("task-done:(a OR b)")).toEqual({ kind: "task", status: "done", node: { kind: "or", nodes: [{ kind: "term", text: "a" }, { kind: "term", text: "b" }] } });
    expect(expr("content:(a -b)")).toEqual({ kind: "and", nodes: [{ kind: "content", text: "a" }, { kind: "not", node: { kind: "content", text: "b" } }] });
    expect(expr("-line:(a)")).toEqual({ kind: "not", node: { kind: "scope", scope: "line", node: { kind: "term", text: "a" } } });
    expect(expr("line:")).toEqual({ kind: "term", text: "line:" });
    expect(expr("line:()")).toBeNull();
  });

  it("parses properties, quoted values included, but not wikilinks", () => {
    expect(expr("[status]")).toEqual({ kind: "property", key: "status", value: null });
    expect(expr("[status:active]")).toEqual({ kind: "property", key: "status", value: "active" });
    expect(expr('[status:"in progress"]')).toEqual({ kind: "property", key: "status", value: "in progress" });
    expect(expr("[[Note]]")).toEqual({ kind: "term", text: "[[Note]]" });
    expect(expr("[]")).toEqual({ kind: "term", text: "[]" });
  });

  it("excludes phrases and filters", () => {
    expect(expr('-"red shift"')).toEqual({ kind: "not", node: { kind: "term", text: "red shift" } });
    expect(expr("-tag:lore")).toEqual({ kind: "not", node: { kind: "tag", value: "lore" } });
  });

  it("fills the flat fields from the top level", () => {
    const query = parseQuery("(a OR b) -c tag:x line:(d e) -(f g)");
    expect(query.terms).toEqual(["a", "b", "d", "e"]);
    expect(query.excluded).toEqual(["c"]);
    expect(query.tags).toEqual(["x"]);
  });
});

describe("runSearch operators", () => {
  const notes: SearchNote[] = [
    {
      path: "Lore/Kyber.md",
      text: [
        "---",
        "status: active",
        "tags: [lore]",
        "---",
        "# Kyber",
        "",
        "Kyber crystals grow on Ilum.",
        "Red shift happens when a crystal is bled.",
        "",
        "## Caves",
        "",
        "The caves of Ilum are cold.",
        "- [ ] Attune the crystal",
        "- [x] Visit the caves",
        "- [/] Polish the hilt",
        "",
        "## Forging",
        "",
        "| part | note |",
        "| --- | --- |",
        "| hilt | steel |",
        "",
      ].join("\n"),
      tags: ["lore"],
      properties: [
        { key: "status", values: ["active"] },
        { key: "tags", values: ["lore"] },
      ],
    },
    {
      // No `properties`: they're parsed from the text.
      path: "Orders/Saber.md",
      text: ["---", "status: in progress", "owners: [Ahsoka, Café]", "---", "Intro line about a saber.", "", "## Parts", "", "A saber needs a kyber crystal.", "", "## Steps", "", "Red", "shift", ""].join("\n"),
      tags: [],
    },
    { path: "Daily/Log.md", text: "Nothing here.\n- [ ] Buy milk\n", tags: [] },
  ];
  const find = (text: string, matchCase = false) => runSearch(parseQuery(text, { matchCase }), notes);
  const titles = (text: string, matchCase = false) => find(text, matchCase).hits.map((hit) => hit.title);
  const highlighted = (text: string, title: string) => {
    const hit = find(text).hits.find((h) => h.title === title)!;
    return hit.lines.map((line) => [line.line, ...line.ranges.map((range) => sub(line.text, range))]);
  };

  it("matches either side of OR and highlights both", () => {
    expect(titles("milk OR saber")).toEqual(["Saber", "Log"]);
    expect(highlighted("milk OR saber", "Saber")).toEqual([[5, "saber"], [9, "saber"]]);
  });

  it("applies precedence and parentheses", () => {
    expect(titles("kyber milk OR saber")).toEqual(["Saber"]);
    expect(titles("kyber (milk OR saber)")).toEqual(["Saber"]);
    expect(titles("(milk OR saber) -kyber")).toEqual(["Log"]);
  });

  it("excludes groups", () => {
    expect(titles("-(saber OR milk)")).toEqual(["Kyber"]);
    expect(titles("-(kyber OR milk)")).toEqual([]);
    expect(titles("ilum -line:(red shift)")).toEqual([]);
    expect(titles("-tag:lore")).toEqual(["Log", "Saber"]);
  });

  it("scopes to one line, block or section", () => {
    expect(titles("line:(red shift)")).toEqual(["Kyber"]);
    expect(titles("block:(red shift)")).toEqual(["Kyber", "Saber"]);
    expect(titles("block:(part steel)")).toEqual(["Kyber"]); // a table is one block
    expect(titles("line:(part steel)")).toEqual([]);
    expect(titles("block:(cold attune)")).toEqual([]); // a list item is its own block
    expect(titles("section:(kyber shift)")).toEqual(["Kyber"]); // H1 holds its subsections
    expect(titles("section:(saber kyber)")).toEqual(["Saber"]);
    expect(titles("section:(intro saber)")).toEqual(["Saber"]); // the text before the first heading
    expect(titles("section:(attune steel)")).toEqual(["Kyber"]);
    expect(titles("section:(kyber steps)")).toEqual([]);
  });

  it("highlights only the lines of the regions that matched", () => {
    expect(highlighted("line:(red shift)", "Kyber")).toEqual([[8, "Red", "shift"]]);
    // Only the Parts section holds both words; the intro's "saber" (line 5) isn't highlighted.
    expect(highlighted("section:(saber kyber)", "Saber")).toEqual([[9, "saber", "kyber"]]);
    expect(find("section:(saber kyber)").hits[0]!.matchCount).toBe(2);
  });

  it("matches checklist lines by status", () => {
    expect(titles("task:")).toEqual(["Kyber", "Log"]);
    expect(titles("task:attune")).toEqual(["Kyber"]);
    expect(titles("task:milk")).toEqual(["Log"]);
    expect(titles("task:cold")).toEqual([]); // not a task line
    expect(titles("task-done:caves")).toEqual(["Kyber"]);
    expect(titles("task-todo:caves")).toEqual([]);
    expect(titles("task-todo:hilt")).toEqual(["Kyber"]); // a custom status counts as open
    expect(titles("task-done:hilt")).toEqual([]);
    expect(titles("-task:")).toEqual(["Saber"]);
    expect(highlighted("task-todo:(attune OR hilt)", "Kyber")).toEqual([[13, "Attune"], [15, "hilt"]]);
    expect(highlighted("task:", "Log")).toEqual([[2, "Buy milk"]]);
  });

  it("matches content: in the text only", () => {
    expect(titles("log")).toEqual(["Log"]);
    expect(titles("content:log")).toEqual([]);
    expect(titles("content:(crystal -bled)")).toEqual(["Saber"]);
  });

  it("matches properties by key and value, lists and quotes included", () => {
    expect(titles("[status]")).toEqual(["Kyber", "Saber"]);
    expect(titles("[Status:ACTIVE]")).toEqual(["Kyber"]);
    expect(titles('[status:"in progress"]')).toEqual(["Saber"]);
    expect(titles("[owners:cafe]")).toEqual(["Saber"]); // list item, accent-insensitive
    expect(titles("[owners:ahsoka] kyber")).toEqual(["Saber"]);
    expect(titles("[missing]")).toEqual([]);
    expect(titles("[status:Active]", true)).toEqual([]);
    expect(titles("[status:active] OR milk")).toEqual(["Log", "Kyber"]); // Log's one match ranks above Kyber's none
  });

  it("lists property-only matches without lines", () => {
    const hit = find("[status]").hits[0]!;
    expect(hit.lines).toEqual([]);
    expect(hit.matchCount).toBe(0);
    expect(find("[status]").totalMatches).toBe(0);
  });

  it("still matches a word in the file name, except inside a scope", () => {
    expect(titles("saber")).toEqual(["Saber"]);
    expect(find("saber").hits[0]!.titleMatches).toBe(true);
    expect(titles("line:(log)")).toEqual([]);
  });

  it("compiles a query into a note filter", () => {
    const paths = (filter: (note: SearchNote) => boolean) => notes.filter(filter).map((note) => note.path);
    expect(paths(compileQuery("milk OR saber"))).toEqual(["Orders/Saber.md", "Daily/Log.md"]);
    expect(paths(compileQuery("[status:active] task-todo:attune"))).toEqual(["Lore/Kyber.md"]);
    expect(paths(compileQuery(parseQuery("-tag:lore")))).toEqual(["Orders/Saber.md", "Daily/Log.md"]);
    expect(paths(compileQuery(""))).toHaveLength(3);
    expect(paths(compileQuery("^## ", { useRegex: true }))).toEqual(["Lore/Kyber.md", "Orders/Saber.md"]);
    expect(() => compileQuery("(", { useRegex: true })).toThrow(INVALID_REGEX_MESSAGE);
  });

  it("copies results as markdown", () => {
    const outcome = find("red shift");
    expect(resultsAsMarkdown(outcome.hits)).toBe("- [[Kyber]]\n    Red shift happens when a crystal is bled.\n- [[Saber]]\n    Red\n    shift\n");
    expect(resultsAsMarkdown(find("[status]").hits)).toBe("- [[Kyber]]\n- [[Saber]]\n");
    expect(resultsAsMarkdown([])).toBe("");
  });

  it("replaces exactly what the results highlight", () => {
    expect(replaceMatches("milk and saber", parseQuery("milk OR saber"), "x")).toEqual({ text: "x and x", count: 2 });
    expect(replaceMatches("a b\na\n", parseQuery("line:(a b)"), "_")).toEqual({ text: "_ _\na\n", count: 2 });
    expect(replaceMatches("- [ ] a\na\n", parseQuery("task:a"), "_")).toEqual({ text: "- [ ] _\na\n", count: 1 });
    expect(replaceMatches("a", parseQuery("a [status:x]"), "_")).toEqual({ text: "_", count: 1 }); // filters picked the note already
  });
});
