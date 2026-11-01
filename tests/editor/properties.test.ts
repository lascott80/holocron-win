import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { parseProperties, propertyType, removePropertyChanges, serializeProperty, setPropertyChanges, yamlScalar } from "../../src/editor/properties.js";

const applied = (doc: string, changes: { from: number; to?: number; insert?: string }[]) => {
  let text = doc;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, change.from) + (change.insert ?? "") + text.slice(change.to ?? change.from);
  }
  return text;
};
const set = (doc: string, key: string, value: unknown) => applied(doc, setPropertyChanges(Text.of(doc.split("\n")), key, value));
const remove = (doc: string, key: string) => applied(doc, removePropertyChanges(Text.of(doc.split("\n")), key));

describe("serializing properties", () => {
  it("quotes only when YAML would read the text differently", () => {
    expect(yamlScalar("plain words")).toBe("plain words");
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar("#not-a-comment")).toBe('"#not-a-comment"');
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("-3")).toBe("-3");
    expect(yamlScalar("- item")).toBe('"- item"');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("writes each kind of value", () => {
    expect(serializeProperty("done", true)).toBe("done: true");
    expect(serializeProperty("tags", ["a", "b c"])).toBe("tags: [a, b c]");
    expect(serializeProperty("tags", ["a", "b"], { blockList: true })).toBe("tags:\n  - a\n  - b");
    expect(serializeProperty("status", "")).toBe("status:");
    expect(serializeProperty("due", "2026-10-26")).toBe("due: 2026-10-26");
  });

  it("writes numbers and date-times unquoted", () => {
    expect(serializeProperty("rating", "4")).toBe("rating: 4");
    expect(serializeProperty("price", "9.5")).toBe("price: 9.5");
    expect(serializeProperty("temperature", "-3")).toBe("temperature: -3");
    expect(serializeProperty("when", "2026-11-01T14:30")).toBe("when: 2026-11-01T14:30");
    expect(serializeProperty("when", "2026-11-01 14:30")).toBe("when: 2026-11-01 14:30");
  });
});

describe("property types", () => {
  it("tells numbers, dates and date-times from text", () => {
    expect(propertyType({ key: "rating", value: "4" })).toBe("number");
    expect(propertyType({ key: "price", value: "9.5" })).toBe("number");
    expect(propertyType({ key: "version", value: "1.2.3" })).toBe("text");
    expect(propertyType({ key: "due", value: "2026-11-01" })).toBe("date");
    expect(propertyType({ key: "when", value: "2026-11-01T14:30" })).toBe("datetime");
    expect(propertyType({ key: "when", value: "2026-11-01 14:30" })).toBe("datetime");
    expect(propertyType({ key: "done", value: true })).toBe("checkbox");
    expect(propertyType({ key: "tags", value: "a b" })).toBe("list");
    expect(propertyType({ key: "mentors", value: ["a"] })).toBe("list");
    expect(propertyType({ key: "author", value: "name: x", nested: true })).toBe("text");
    expect(propertyType({ key: "status", value: null })).toBe("text");
  });

  it("reads numbers and date-times back as strings the panel types", () => {
    const yaml = "rating: 4\nprice: 9.5\nwhen: 2026-11-01T14:30\nseen: 2026-11-01 14:30";
    expect(parseProperties(yaml)).toEqual([
      { key: "rating", value: "4" },
      { key: "price", value: "9.5" },
      { key: "when", value: "2026-11-01T14:30" },
      { key: "seen", value: "2026-11-01 14:30" },
    ]);
  });
});

describe("editing properties", () => {
  const note = "---\ntitle: Old\ntags:\n  - one\n  - two\ndone: false\n---\nBody";

  it("rewrites just the edited property", () => {
    expect(set(note, "title", "New: title")).toBe('---\ntitle: "New: title"\ntags:\n  - one\n  - two\ndone: false\n---\nBody');
  });

  it("keeps a block list as a block list", () => {
    expect(set(note, "tags", ["one", "two", "three"])).toBe("---\ntitle: Old\ntags:\n  - one\n  - two\n  - three\ndone: false\n---\nBody");
  });

  it("adds new properties before the closing ---, or creates the block", () => {
    expect(set(note, "due", "2026-10-26")).toBe("---\ntitle: Old\ntags:\n  - one\n  - two\ndone: false\ndue: 2026-10-26\n---\nBody");
    expect(set("Body", "tags", ["a"])).toBe("---\ntags: [a]\n---\nBody");
  });

  it("rewrites numbers and date-times in place", () => {
    const typed = "---\nrating: 3\nwhen: 2026-11-01 09:00\n---\nBody";
    expect(set(typed, "rating", "4.5")).toBe("---\nrating: 4.5\nwhen: 2026-11-01 09:00\n---\nBody");
    expect(set(typed, "when", "2026-11-02 10:15")).toBe("---\nrating: 3\nwhen: 2026-11-02 10:15\n---\nBody");
    expect(set(typed, "starts", "2026-11-03T08:00")).toBe("---\nrating: 3\nwhen: 2026-11-01 09:00\nstarts: 2026-11-03T08:00\n---\nBody");
  });

  it("removes a property and its lines", () => {
    expect(remove(note, "tags")).toBe("---\ntitle: Old\ndone: false\n---\nBody");
  });

  it("round-trips through the parser", () => {
    const text = set(set(note, "title", "#1: start"), "done", true);
    const yaml = text.split("---\n")[1];
    expect(parseProperties(yaml)).toEqual([
      { key: "title", value: "#1: start" },
      { key: "tags", value: ["one", "two"] },
      { key: "done", value: true },
    ]);
  });

  it("marks nested YAML so it isn't flattened by an edit", () => {
    expect(parseProperties("author:\n  name: Ahsoka\n  rank: Commander")).toEqual([{ key: "author", value: "name: Ahsoka, rank: Commander", nested: true }]);
  });
});
