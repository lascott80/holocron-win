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
