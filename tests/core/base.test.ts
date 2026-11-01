// Base files (UI-46, §9.5): the YAML subset they're written in, the column
// model, sorting by type and the Obsidian-syntax check.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_COLUMNS, cellValue, columnKind, columnLabel, compareCells, defaultBase, isBuiltinColumn, OBSIDIAN_BASE_MESSAGE,
  parseBase, parseYaml, prefilledProperties, searchRows, serializeBase, sortRows, usesObsidianSyntax, yamlString, type BaseRow, type ColumnKind,
} from "@core/base";

const sample = `# A base
filters: "[status:active] tag:project -path:Archive"   # a Holocron search query
views:
  - type: table            # or cards
    name: Active
    columns: [file.name, status, due, tags, file.mtime]
    sort: [{ column: due, direction: asc }]
    limit: 200
  - type: cards
    name: Board
    columns: [file.name, status]
`;

const row = (overrides: Partial<BaseRow>): BaseRow => ({
  path: "Notes/A.md",
  title: "A",
  folder: "Notes",
  mtime: null,
  ctime: null,
  tags: [],
  links: null,
  backlinks: null,
  properties: {},
  preview: "",
  ...overrides,
});

describe("parseYaml", () => {
  it("reads mappings, lists, inline lists and maps, quotes, numbers and booleans", () => {
    const { value, errors } = parseYaml(`a: 1\nb: "two: 2"\nc: 'it''s'\nd: [x, "y, z", 3]\ne: { k: v, n: 2 }\nf:\n  - p\n  - q: 1\n    r: true\ng:\n  nested:\n    deep: ~\nh: yes\n`);
    expect(errors).toEqual([]);
    expect(value).toEqual({
      a: 1,
      b: "two: 2",
      c: "it's",
      d: ["x", "y, z", 3],
      e: { k: "v", n: 2 },
      f: ["p", { q: 1, r: true }],
      g: { nested: { deep: null } },
      h: "yes",
    });
  });

  it("accepts comments, CRLF, a BOM, a list at the key's column and tabs", () => {
    const { value, errors } = parseYaml("﻿views:\r\n- type: table\r\n  name: T # named\r\n\tcolumns: [a]\r\n");
    expect(errors).toEqual([]);
    expect(value).toEqual({ views: [{ type: "table", name: "T", columns: ["a"] }] });
  });

  it("reports what it can't read with the line and keeps going", () => {
    const { value, errors } = parseYaml("a: 1\njust words\nb: [unclosed\nc: 3\n");
    expect(value).toEqual({ a: 1, b: [], c: 3 });
    expect(errors).toEqual([
      { line: 2, message: 'Expected "key: value", got "just words"' },
      { line: 3, message: "Unclosed [ list" },
    ]);
  });

  it("writes strings that read back the same", () => {
    for (const text of ["plain", "a: b", "[x]", "-dash", "yes", "12", "", "say \"hi\"", "#tag"]) {
      expect(parseYaml(`k: ${yamlString(text)}`).value).toEqual({ k: text });
    }
  });
});

describe("parseBase / serializeBase", () => {
  it("reads the documented shape", () => {
    const result = parseBase(sample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.base).toEqual({
      filters: "[status:active] tag:project -path:Archive",
      views: [
        { type: "table", name: "Active", columns: ["file.name", "status", "due", "tags", "file.mtime"], sort: [{ column: "due", direction: "asc" }], limit: 200 },
        { type: "cards", name: "Board", columns: ["file.name", "status"], sort: [] },
      ],
    });
  });

  it("round-trips through the serialiser, keeping the line ending asked for", () => {
    const first = parseBase(sample);
    if (!first.ok) throw new Error("parse failed");
    const text = serializeBase(first.base, "\r\n");
    expect(text.split("\r\n").length).toBeGreaterThan(5);
    expect(text).not.toMatch(/[^\r]\n/);
    const again = parseBase(text);
    expect(again).toEqual(first);
  });

  it("fills in defaults and ignores unknown keys", () => {
    expect(parseBase("")).toEqual({ ok: true, base: defaultBase(), warnings: [] });
    const result = parseBase("filters: tag:x\nsomethingElse: 1\nviews:\n  - name: Only\n    extra: true\n");
    expect(result).toEqual({ ok: true, base: { filters: "tag:x", views: [{ type: "table", name: "Only", columns: defaultBase().views[0]!.columns, sort: [] }] }, warnings: [] });
    expect(parseBase("filters: [status:active]")).toMatchObject({ ok: true, base: { filters: "[status:active]" } });
    expect(parseBase("views:\n  - sort: [due desc, title]\n")).toMatchObject({ ok: true, base: { views: [{ sort: [{ column: "due", direction: "desc" }, { column: "title", direction: "asc" }] }] } });
  });

  it("rejects what isn't a mapping", () => {
    expect(parseBase("- a\n- b\n")).toEqual({ ok: false, reason: "The file isn’t a YAML mapping", line: 1 });
  });

  it("recognises Obsidian's own filter syntax and says so instead of erroring", () => {
    const obsidian = `filters:\n  and:\n    - status == "active"\n    - file.hasTag("project")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n`;
    expect(usesObsidianSyntax(parseYaml(obsidian).value)).toBe(true);
    expect(parseBase(obsidian)).toEqual({ ok: false, reason: OBSIDIAN_BASE_MESSAGE, obsidian: true });
    expect(parseBase('filters: status == "active"\n')).toMatchObject({ ok: false, obsidian: true });
    expect(parseBase("filters: tag:project\nviews:\n  - type: table\n    order: [file.name]\n")).toMatchObject({ ok: false, obsidian: true });
    expect(usesObsidianSyntax(parseYaml(sample).value)).toBe(false);
  });
});

describe("columns", () => {
  it("knows the built-ins and labels property columns by their key", () => {
    expect(BUILTIN_COLUMNS.map((column) => column.id)).toEqual(["file.name", "file.path", "file.folder", "file.mtime", "file.ctime", "file.tags", "file.links", "file.backlinks"]);
    expect(isBuiltinColumn("file.mtime")).toBe(true);
    expect(isBuiltinColumn("status")).toBe(false);
    expect(columnLabel("file.backlinks")).toBe("Backlinks");
    expect(columnLabel("status")).toBe("status");
  });

  it("reads cells from the row's fields or its properties (key case-insensitive)", () => {
    const r = row({ mtime: 5, tags: ["a"], links: 2, backlinks: 3, properties: { Status: "active", due: "2026-01-02" } });
    expect(cellValue(r, "file.name")).toBe("A");
    expect(cellValue(r, "file.folder")).toBe("Notes");
    expect(cellValue(r, "file.mtime")).toBe(5);
    expect(cellValue(r, "file.tags")).toEqual(["a"]);
    expect(cellValue(r, "file.links")).toBe(2);
    expect(cellValue(r, "file.backlinks")).toBe(3);
    expect(cellValue(r, "status")).toBe("active");
    expect(cellValue(r, "missing")).toBeNull();
  });

  it("infers a column's kind from the vault summary, then from the rows", () => {
    const rows = [row({ properties: { n: "1", d: "2026-01-01", ok: true } }), row({ properties: { n: "2", d: "words" } })];
    expect(columnKind("file.mtime", rows)).toBe("datetime");
    expect(columnKind("n", rows)).toBe("number");
    expect(columnKind("d", rows)).toBe("date");
    expect(columnKind("ok", rows)).toBe("checkbox");
    expect(columnKind("n", rows, () => "text")).toBe("text");
    expect(columnKind("none", rows)).toBe("text");
  });
});

describe("sorting", () => {
  it("compares by kind with empties last", () => {
    expect(compareCells("10", "9", "number")).toBeGreaterThan(0);
    expect(compareCells("10", "9", "text")).toBeGreaterThan(0); // natural order: 10 after 9
    expect(compareCells("2026-02-01", "2026-01-31 23:00", "date")).toBeGreaterThan(0);
    expect(compareCells(false, true, "checkbox")).toBeLessThan(0);
    expect(compareCells(["b"], ["a", "z"], "list")).toBeGreaterThan(0);
    expect(compareCells(null, "x", "text")).toBeGreaterThan(0);
    expect(compareCells("x", "", "text")).toBeLessThan(0);
    expect(compareCells(null, null, "text")).toBe(0);
  });

  it("sorts rows by every sort in turn, then by title", () => {
    const rows = [
      row({ title: "C", path: "C.md", properties: { due: "2026-03-01", n: "2" } }),
      row({ title: "A", path: "A.md", properties: { due: "2026-01-01", n: "10" } }),
      row({ title: "B", path: "B.md", properties: { n: "10" } }),
      row({ title: "D", path: "D.md", properties: { due: "2026-01-01", n: "10" } }),
    ];
    const kinds = (column: string): ColumnKind => (column === "n" ? "number" : column === "due" ? "date" : "text");
    expect(sortRows(rows, [{ column: "due", direction: "asc" }], kinds).map((r) => r.title)).toEqual(["A", "D", "C", "B"]);
    expect(sortRows(rows, [{ column: "n", direction: "desc" }, { column: "due", direction: "desc" }], kinds).map((r) => r.title)).toEqual(["A", "D", "B", "C"]);
    expect(sortRows(rows, [], kinds).map((r) => r.title)).toEqual(["A", "B", "C", "D"]);
  });

  it("searches within the shown columns, the title, path and tags", () => {
    const rows = [row({ title: "Kyber", tags: ["lore"], properties: { status: "active" } }), row({ title: "Ilum", path: "Planets/Ilum.md", properties: { status: "done" } })];
    const names = (r: BaseRow[]) => r.map((x) => x.title);
    expect(names(searchRows(rows, ["status"], "act", () => "text"))).toEqual(["Kyber"]);
    expect(names(searchRows(rows, ["status"], "planets", () => "text"))).toEqual(["Ilum"]);
    expect(names(searchRows(rows, ["status"], "LORE kyber", () => "text"))).toEqual(["Kyber"]);
    expect(names(searchRows(rows, [], "", () => "text"))).toEqual(["Kyber", "Ilum"]);
  });
});

describe("prefilledProperties", () => {
  it("turns simple [key:value] and tag: filters into frontmatter", () => {
    expect(prefilledProperties("[status:active] tag:project -path:Archive kyber")).toEqual([
      { key: "status", value: "active" },
      { key: "tags", value: ["project"] },
    ]);
    expect(prefilledProperties("tag:#a tag:b [tags:c]")).toEqual([{ key: "tags", value: ["c", "a", "b"] }]);
    expect(prefilledProperties("a OR b")).toEqual([]);
    expect(prefilledProperties("")).toEqual([]);
    expect(prefilledProperties("[status]")).toEqual([]);
  });
});
