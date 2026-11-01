// The property rewriting shared by the editor's panel (ED-75) and main's
// `setProperty` (UI-46): one property's lines change, nothing else does.

import { describe, expect, it } from "vitest";
import { frontmatterRange, lineEnding, parseProperties, propertyType, removePropertyChange, applyChange, setProperty, setPropertyChange, yamlScalar } from "@core/properties";

const note = "---\ntitle: Kyber\ntags:\n  - lore\n  - crystals\nstatus: active\n---\n# Kyber\n";

describe("frontmatterRange", () => {
  it("finds the block and the YAML inside it", () => {
    const range = frontmatterRange(note)!;
    expect(note.slice(range.from, range.to)).toBe("---\ntitle: Kyber\ntags:\n  - lore\n  - crystals\nstatus: active\n---");
    expect(note.slice(range.yamlFrom, range.yamlTo)).toBe("title: Kyber\ntags:\n  - lore\n  - crystals\nstatus: active");
  });

  it("needs --- on line 1 and a closing --- or ...", () => {
    expect(frontmatterRange("# No frontmatter\n---\n")).toBeNull();
    expect(frontmatterRange("---\nopen: true\n")).toBeNull();
    expect(frontmatterRange("---\na: 1\n...\nbody")).not.toBeNull();
    expect(frontmatterRange("---\r\na: 1\r\n---\r\nbody")?.yamlTo).toBe("---\r\na: 1".length + 1);
  });
});

describe("parseProperties", () => {
  it("reads scalars, inline and block lists, booleans and nested YAML", () => {
    expect(parseProperties("a: 1\nb: [x, 'y z']\nc:\n  - p\n  - q\nd: true\ne:\n  k: v\nf:")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: ["x", "y z"] },
      { key: "c", value: ["p", "q"] },
      { key: "d", value: true },
      { key: "e", value: "k: v", nested: true },
      { key: "f", value: null },
    ]);
  });

  it("infers types like the panel", () => {
    expect(propertyType({ key: "n", value: "4.5" })).toBe("number");
    expect(propertyType({ key: "d", value: "2026-11-01" })).toBe("date");
    expect(propertyType({ key: "d", value: "2026-11-01T14:30" })).toBe("datetime");
    expect(propertyType({ key: "tags", value: "a" })).toBe("list");
    expect(propertyType({ key: "ok", value: false })).toBe("checkbox");
    expect(propertyType({ key: "t", value: "words" })).toBe("text");
  });
});

describe("setProperty", () => {
  it("rewrites one property and leaves the rest byte for byte", () => {
    expect(setProperty(note, "status", "done")).toBe(note.replace("status: active", "status: done"));
    expect(setProperty(note, "title", "a: b")).toBe(note.replace("title: Kyber", 'title: "a: b"'));
  });

  it("keeps block lists as block lists and writes other lists inline", () => {
    expect(setProperty(note, "tags", ["lore"])).toBe("---\ntitle: Kyber\ntags:\n  - lore\nstatus: active\n---\n# Kyber\n");
    expect(setProperty(note, "aliases", ["a", "b c"])).toBe(note.replace("status: active\n", "status: active\naliases: [a, b c]\n"));
    expect(setProperty("---\ntags: [a]\n---\n", "tags", [])).toBe("---\ntags: []\n---\n");
  });

  it("adds a property at the end of the block, or creates the block", () => {
    expect(setProperty(note, "due", "2026-12-01")).toBe(note.replace("---\n# Kyber", "due: 2026-12-01\n---\n# Kyber"));
    expect(setProperty("# Plain\n", "done", true)).toBe("---\ndone: true\n---\n# Plain\n");
    expect(setProperty("", "k", "v")).toBe("---\nk: v\n---\n");
  });

  it("keeps CRLF line endings everywhere it writes", () => {
    const crlf = "---\r\ntitle: Kyber\r\ntags:\r\n  - lore\r\n---\r\nBody\r\n";
    expect(setProperty(crlf, "title", "Ilum")).toBe("---\r\ntitle: Ilum\r\ntags:\r\n  - lore\r\n---\r\nBody\r\n");
    expect(setProperty(crlf, "tags", ["a", "b"])).toBe("---\r\ntitle: Kyber\r\ntags:\r\n  - a\r\n  - b\r\n---\r\nBody\r\n");
    expect(setProperty(crlf, "new", "x")).toBe("---\r\ntitle: Kyber\r\ntags:\r\n  - lore\r\nnew: x\r\n---\r\nBody\r\n");
    expect(setProperty("Body\r\n", "k", "v")).toBe("---\r\nk: v\r\n---\r\nBody\r\n");
    expect(lineEnding(crlf)).toBe("\r\n");
    expect(lineEnding(note)).toBe("\n");
  });

  it("describes the change as offsets the editor can dispatch", () => {
    const change = setPropertyChange(note, "status", "done");
    expect(note.slice(change.from, change.to)).toBe("status: active");
    expect(change.insert).toBe("status: done");
    expect(applyChange(note, change)).toBe(setProperty(note, "status", "done"));
  });
});

describe("removePropertyChange", () => {
  it("drops the property's lines, block lists included", () => {
    expect(applyChange(note, removePropertyChange(note, "tags"))).toBe("---\ntitle: Kyber\nstatus: active\n---\n# Kyber\n");
    const crlf = "---\r\na: 1\r\nb: 2\r\n---\r\n";
    expect(applyChange(crlf, removePropertyChange(crlf, "a"))).toBe("---\r\nb: 2\r\n---\r\n");
    expect(removePropertyChange(note, "missing")).toBeNull();
  });
});

describe("yamlScalar", () => {
  it("quotes only what YAML would misread", () => {
    expect(yamlScalar("plain")).toBe("plain");
    expect(yamlScalar("yes")).toBe('"yes"');
    expect(yamlScalar("-3")).toBe("-3");
    expect(yamlScalar("[[Note]]")).toBe('"[[Note]]"');
  });
});
