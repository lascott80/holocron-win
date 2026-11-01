import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { htmlTagCompletions, linkCompletions, propertyCompletions, setCurrentNote, setVaultData } from "../../src/editor/completions.js";
import { makeView } from "./helpers";

// The editor is untyped JS; results are checked at runtime by the assertions.
function complete(doc: string, explicit = false): { view: ReturnType<typeof makeView>; result: any } {
  const view = makeView(doc, doc.length);
  return { view, result: htmlTagCompletions(new CompletionContext(view.state, doc.length, explicit)) };
}

describe("HTML tag completion", () => {
  it("offers the tags live preview renders after < + letters", () => {
    const { result } = complete("Press <k");
    expect(result).not.toBeNull();
    expect(result.from).toBe("Press ".length);
    const labels = result.options.map((o: any) => o.label);
    for (const tag of ["kbd", "mark", "sup", "sub", "u", "b", "i", "s", "small", "ins", "del", "br", "details", "summary"]) {
      expect(labels).toContain(`<${tag}>`);
    }
  });

  it("needs a letter unless invoked explicitly", () => {
    expect(complete("a <").result).toBeNull();
    expect(complete("a <", true).result).not.toBeNull();
    expect(complete("a < b").result).toBeNull();
  });

  it("stays quiet in code and frontmatter", () => {
    expect(complete("```\n<k").result).toBeNull();
    expect(complete("---\ntitle: <k").result).toBeNull();
  });

  it("inserts a tag pair with the cursor inside", () => {
    const { view, result } = complete("Press <k");
    const kbd = result.options.find((o: any) => o.label === "<kbd>");
    kbd.apply(view, kbd, result.from, "Press <k".length);
    expect(view.state.doc.toString()).toBe("Press <kbd></kbd>");
    expect(view.state.selection.main.head).toBe("Press <kbd>".length);
  });

  it("inserts <br> alone", () => {
    const { view, result } = complete("<b");
    const br = result.options.find((o: any) => o.label === "<br>");
    br.apply(view, br, result.from, 2);
    expect(view.state.doc.toString()).toBe("<br>");
  });
});

describe("[[ link completion", () => {
  const links = (doc: string) => {
    const view = makeView(doc, doc.length);
    return linkCompletions(new CompletionContext(view.state, doc.length, false)) as any;
  };
  setVaultData({ notes: [
    { path: "Probe.md", title: "Probe", aliases: [] },
    { path: "Lore/Kyber.md", title: "Kyber", aliases: ["Crystal"] },
  ] });

  it("leaves out the note being edited", () => {
    setCurrentNote("Probe.md");
    expect(links("[[").options.map((o: any) => o.label)).toEqual(["Kyber", "Crystal"]);
    setCurrentNote("");
  });

  it("offers to create a note nobody has written yet", () => {
    const create = links("[[Ilum").options.find((o: any) => o.detail === "New note");
    expect(create.displayLabel).toBe("Create “Ilum”");
    expect(links("[[kyber").options.some((o: any) => o.detail === "New note")).toBe(false);
    expect(links("[[crystal").options.some((o: any) => o.detail === "New note")).toBe(false);
    expect(links("![[Ilum").options.some((o: any) => o.detail === "New note")).toBe(false);
  });
});

describe("frontmatter property completion", () => {
  // "|" marks the cursor; the rest of the note follows it.
  const complete = (text: string) => {
    const cursor = text.indexOf("|");
    const doc = text.replace("|", "");
    const view = makeView(doc, cursor);
    return propertyCompletions(new CompletionContext(view.state, cursor, false)) as any;
  };
  const properties = [
    { key: "status", count: 12, type: "text", values: [["draft", 8], ["final", 4]] },
    { key: "tags", count: 9, type: "list", values: [["lore", 6], ["crystals", 3]] },
    { key: "rating", count: 1, type: "number", values: [["4", 1]] },
  ];

  it("offers known keys at the start of a frontmatter line, by count, and inserts key: ", () => {
    setVaultData({ notes: [], properties });
    const result = complete("---\ntitle: x\nst|\n---\nBody");
    expect(result.from).toBe("---\ntitle: x\n".length);
    expect(result.options.map((o: any) => [o.label, o.detail, o.apply])).toEqual([
      ["status", "12 notes", "status: "],
      ["tags", "9 notes", "tags: "],
      ["rating", "1 note", "rating: "],
    ]);
  });

  it("offers a key's values after key: and in a block list item", () => {
    setVaultData({ notes: [], properties });
    const scalar = complete("---\nstatus: dr|\n---\n");
    expect(scalar.from).toBe("---\nstatus: ".length);
    expect(scalar.options.map((o: any) => o.label)).toEqual(["draft", "final"]);
    const inline = complete("---\ntags: [lore, cr|\n---\n");
    expect(inline.from).toBe("---\ntags: [lore, ".length);
    expect(inline.options.map((o: any) => o.label)).toEqual(["lore", "crystals"]);
    const block = complete("---\ntags:\n  - lore\n  - |\n---\n");
    expect(block.from).toBe("---\ntags:\n  - lore\n  - ".length);
    expect(block.options.map((o: any) => o.label)).toEqual(["lore", "crystals"]);
    expect(complete("---\nunknown: |\n---\n")).toBeNull();
  });

  it("stays quiet outside the frontmatter and without data", () => {
    setVaultData({ notes: [], properties });
    expect(complete("---\nstatus: x\n---\nst|")).toBeNull();
    expect(complete("st|\n---\nstatus: x\n---\n")).toBeNull();
    expect(complete("---\nstatus: x\n--|-\n")).toBeNull();
    setVaultData({ notes: [] });
    expect(complete("---\nst|\n---\n")).toBeNull();
  });
});
