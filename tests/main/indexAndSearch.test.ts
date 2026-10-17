// Port of IndexAndSearchTests.swift (VaultIndexTests through a real vault,
// CompletionDataTests, EmbedContentTests). Fuzzy matching, Quick Open and
// the index itself are covered in tests/core.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, recordingEditor } from "./helpers";

let temp: TempVault;

beforeEach(() => {
  temp = new TempVault();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("The vault's index", () => {
  let vault: Vault;

  beforeEach(() => {
    temp.write("Lore/Crystals/Kyber Crystal Notes.md", "---\naliases: [Kyber]\n---\n# Kyber Crystal Notes\n\nFound on [[Ilum]]. #lore\n\n## Attunement\n");
    temp.write("Lore/Crystals/Ilum.md", "# Ilum\n\nMethods in [[Kyber Crystal Notes]].\nAlso [[Kyber Crystal Notes#Attunement]].\n#lore/planets\n");
    temp.write("Orders/Lightsaber Construction.md", "Step 4 needs an attuned [crystal](../Lore/Crystals/Kyber%20Crystal%20Notes.md). #lore\n");
    temp.write("Daily/2026-10-02.md", "Attuned the kyber crystal today.\nRead kyber crystal notes again.\n");
    vault = temp.open();
  });

  it("finds backlinks from wiki and markdown links", async () => {
    await vault.indexingFinished();
    const backlinks = vault.index.backlinks("Lore/Crystals/Kyber Crystal Notes.md");
    expect(backlinks.map((link) => link.title)).toEqual(["Ilum", "Lightsaber Construction"]);
    expect(backlinks[0].contexts).toEqual(["Methods in [[Kyber Crystal Notes]].", "Also [[Kyber Crystal Notes#Attunement]]."]);
  });

  it("finds unlinked mentions including aliases", async () => {
    await vault.indexingFinished();
    const mentions = vault.index.unlinkedMentions("Lore/Crystals/Kyber Crystal Notes.md");
    expect(mentions.map((mention) => mention.title)).toEqual(["2026-10-02"]);
    expect(mentions[0].context).toBe("Attuned the kyber crystal today.");
  });

  it("counts tags", async () => {
    await vault.indexingFinished();
    expect(vault.index.allTags()[0]).toEqual({ tag: "lore", count: 2 });
    expect(vault.index.notesTaggedWith("lore").length).toBe(3);
  });

  it("outgoing links resolve", async () => {
    await vault.indexingFinished();
    const outgoing = vault.index.outgoingLinks("Lore/Crystals/Kyber Crystal Notes.md");
    expect(outgoing.map((link) => link.target)).toEqual(["Ilum"]);
    expect(outgoing[0].resolved).toBe("Lore/Crystals/Ilum.md");
  });

  it("live edits update the index", async () => {
    await vault.indexingFinished();
    vault.index.update("Daily/2026-10-02.md", "Linked [[Kyber Crystal Notes]] now.\n");
    expect(vault.index.backlinks("Lore/Crystals/Kyber Crystal Notes.md").length).toBe(3);
  });

  it("disk changes re-index", async () => {
    await vault.indexingFinished();
    temp.write("Daily/2026-10-02.md", "See [[Ilum]].\n");
    temp.write("New.md", "[[Ilum]]\n");
    vault.handleDiskChanges(["Daily/2026-10-02.md", "New.md"]);
    await vault.indexingFinished();
    expect(vault.index.backlinks("Lore/Crystals/Ilum.md").map((link) => link.title)).toEqual(["2026-10-02", "Kyber Crystal Notes", "New"]);
  });

  it("deleted notes leave the index", async () => {
    const removed: string[][] = [];
    const watched = temp.open({ onIndexChange: (_updated, gone) => removed.push(gone) });
    await watched.indexingFinished();
    temp.remove("Lore/Crystals/Ilum.md");
    watched.handleDiskChanges(["Lore/Crystals/Ilum.md"]);
    await watched.indexingFinished();
    expect(removed.at(-1)).toEqual(["Lore/Crystals/Ilum.md"]);
    vault.handleDiskChanges(["Lore/Crystals/Ilum.md"]);
    await vault.indexingFinished();
    expect(vault.index.hasPath("Lore/Crystals/Ilum.md")).toBe(false);
    expect(vault.index.backlinks("Lore/Crystals/Kyber Crystal Notes.md").map((link) => link.title)).toEqual(["Lightsaber Construction"]);
  });

  it("reports isIndexing while reading", async () => {
    const states: boolean[] = [];
    let watched: Vault | undefined = undefined;
    watched = temp.open({ onChange: () => states.push(watched?.isIndexing ?? false) });
    await watched.indexingFinished();
    expect(states).toContain(true);
    expect(watched.isIndexing).toBe(false);
  });
});

describe("Completion data", () => {
  it("describes notes, attachments and tags", async () => {
    temp.write("Lore/Kyber.md", "---\naliases: [Crystal]\n---\n# Kyber\n## Attunement\n#lore\n");
    temp.write("Ilum.md", "Ice.\n");
    temp.write("Attachments/hilt.png", "PNG");
    const vault = temp.open();
    await vault.indexingFinished();
    vault.open("Ilum.md");

    const data = vault.completionData();
    const kyber = data.notes.find((note) => note.title === "Kyber")!;
    expect(kyber.path).toBe("Lore/Kyber.md");
    expect(kyber.aliases).toEqual(["Crystal"]);
    expect(kyber.headings.map((heading) => heading.text)).toEqual(["Kyber", "Attunement"]);
    expect(kyber.headings.map((heading) => heading.level)).toEqual([1, 2]);
    expect(kyber.recent).toBe(0);
    expect(data.notes.find((note) => note.title === "Ilum")?.recent).toBe(10);
    expect(data.attachments).toEqual(["Attachments/hilt.png"]);
    expect(data.tags[0].tag).toBe("lore");
  });

  it("is sent to the editor after indexing", async () => {
    temp.write("Ilum.md", "Ice.\n");
    const editor = recordingEditor();
    const vault = temp.open({ editor });
    await vault.indexingFinished();
    const call = editor.calls.filter((c) => c.method === "setVaultData").at(-1);
    const make = call?.args[0] as () => ReturnType<Vault["completionData"]>;
    expect(make().notes.map((note) => note.path)).toEqual(["Ilum.md"]);
  });
});

describe("Embed content", () => {
  it("supplies the current text of embedded notes", () => {
    temp.write("Lore/Ilum Survey.md", "# Ilum Survey\n");
    const vault = temp.open({ saveDelay: 60_000 });

    expect(vault.embedContent("ilum survey")).toEqual({ title: "Ilum Survey", path: "Lore/Ilum Survey.md", text: "# Ilum Survey\n" });

    // Unsaved edits in an open tab are what the embed shows.
    vault.open("Lore/Ilum Survey.md");
    vault.editorChanged("Lore/Ilum Survey.md", "# Ilum Survey\nUnsaved line.\n");
    expect(vault.embedContent("Ilum Survey#Caves")?.text).toBe("# Ilum Survey\nUnsaved line.\n");

    expect(vault.embedContent("Dagobah")).toBeNull();
  });
});

describe("Search and replace", () => {
  it("replaces across closed notes on disk and open notes through their document", async () => {
    temp.write("Ilum.md", "Kyber grows on Ilum.\nMore kyber.\n");
    temp.write("Lore/Kyber.md", "# Kyber\n\nkyber, Kyber.\n");
    temp.write("Other.md", "Nothing here.\n");
    const editor = recordingEditor();
    const vault = temp.open({ editor });
    await vault.indexingFinished();
    vault.open("Lore/Kyber.md");
    const result = vault.replaceInNotes("kyber", "crystal", false, false);
    expect(result).toEqual({ notes: 2, matches: 5 });
    expect(temp.read("Ilum.md")).toBe("crystal grows on Ilum.\nMore crystal.\n");
    expect(vault.documents.get("Lore/Kyber.md")?.text).toBe("# crystal\n\ncrystal, crystal.\n");
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[2] === "# crystal\n\ncrystal, crystal.\n")).toBe(true);
    expect(temp.read("Other.md")).toBe("Nothing here.\n");
    expect(vault.toast?.message).toBe("Replaced 5 matches in 2 notes");

    vault.runToastAction();
    expect(temp.read("Ilum.md")).toBe("Kyber grows on Ilum.\nMore kyber.\n");
    expect(vault.documents.get("Lore/Kyber.md")?.text).toBe("# Kyber\n\nkyber, Kyber.\n");
  });

  it("can limit itself to one note, honours filters and reports invalid patterns", async () => {
    temp.write("A.md", "kyber #lore\n");
    temp.write("B.md", "kyber\n");
    const vault = temp.open();
    await vault.indexingFinished();
    expect(vault.replaceInNotes("kyber", "x", false, false, "B.md")).toEqual({ notes: 1, matches: 1 });
    expect(temp.read("A.md")).toBe("kyber #lore\n");
    expect(temp.read("B.md")).toBe("x\n");
    expect(vault.replaceInNotes("kyber tag:lore", "y", false, false)).toEqual({ notes: 1, matches: 1 });
    expect(temp.read("A.md")).toBe("y #lore\n");
    expect(vault.replaceInNotes("(", "y", false, true)).toEqual({ notes: 0, matches: 0 });
    expect(vault.errorMessage).toBe("That isn’t a valid regular expression.");
    expect(vault.replaceInNotes("tag:lore", "y", false, false)).toEqual({ notes: 0, matches: 0 });
    expect(vault.toast?.message).toBe("Nothing to replace");
  });
});

describe("Tasks view", () => {
  it("toggles a task in a closed note on disk and in an open note through its document", async () => {
    temp.write("Plan.md", "- [ ] one\r\n- [x] two\r\n");
    temp.write("Open.md", "- [ ] three\n");
    const editor = recordingEditor();
    const vault = temp.open({ editor });
    await vault.indexingFinished();
    vault.open("Open.md");

    vault.toggleTask("Plan.md", 1);
    expect(temp.read("Plan.md")).toBe("- [x] one\r\n- [x] two\r\n");
    vault.toggleTask("Plan.md", 2);
    expect(temp.read("Plan.md")).toBe("- [x] one\r\n- [ ] two\r\n");
    expect(vault.index.allTasks().map((note) => [note.path, note.tasks.map((t) => t.text)])).toEqual([
      ["Open.md", ["three"]],
      ["Plan.md", ["two"]],
    ]);

    vault.toggleTask("Open.md", 1);
    expect(vault.documents.get("Open.md")?.text).toBe("- [x] three\n");
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[2] === "- [x] three\n")).toBe(true);
    vault.toggleTask("Open.md", 7); // not a task line: nothing happens
    expect(vault.documents.get("Open.md")?.text).toBe("- [x] three\n");
  });
});
