import { beforeEach, describe, expect, test } from "vitest";
import { VaultIndex } from "@core/vaultIndex";

const files: Record<string, string> = {
  "Lore/Crystals/Kyber Crystal Notes.md":
    "---\naliases: [Kyber]\n---\n# Kyber Crystal Notes\n\nFound on [[Ilum]]. #lore\n\n## Attunement\n",
  "Lore/Crystals/Ilum.md": "# Ilum\n\nMethods in [[Kyber Crystal Notes]].\nAlso [[Kyber Crystal Notes#Attunement]].\n#lore/planets\n",
  "Orders/Lightsaber Construction.md":
    "Step 4 needs an attuned [crystal](../Lore/Crystals/Kyber%20Crystal%20Notes.md). #lore\n",
  "Daily/2026-10-02.md": "Attuned the kyber crystal today.\nRead kyber crystal notes again.\n",
};

function build(contents: Record<string, string>): VaultIndex {
  const index = new VaultIndex();
  const toRead = index.setPaths(Object.keys(contents));
  for (const path of toRead) index.update(path, contents[path]);
  return index;
}

describe("VaultIndex", () => {
  let index: VaultIndex;
  beforeEach(() => {
    index = build(files);
  });

  test("finds backlinks from wiki and markdown links", () => {
    const backlinks = index.backlinks("Lore/Crystals/Kyber Crystal Notes.md");
    expect(backlinks.map((b) => b.title)).toEqual(["Ilum", "Lightsaber Construction"]);
    expect(backlinks[0].contexts).toEqual(["Methods in [[Kyber Crystal Notes]].", "Also [[Kyber Crystal Notes#Attunement]]."]);
  });

  test("finds unlinked mentions including aliases", () => {
    const mentions = index.unlinkedMentions("Lore/Crystals/Kyber Crystal Notes.md");
    expect(mentions.map((m) => m.title)).toEqual(["2026-10-02"]);
    expect(mentions[0].context).toBe("Attuned the kyber crystal today.");
  });

  test("counts tags", () => {
    expect(index.allTags()[0]).toEqual({ tag: "lore", count: 2 });
    expect(index.notesTaggedWith("lore").length).toBe(3);
    expect(index.notesTaggedWith("#lore/planets")).toEqual(["Lore/Crystals/Ilum.md"]);
  });

  test("outgoing links resolve", () => {
    const outgoing = index.outgoingLinks("Lore/Crystals/Kyber Crystal Notes.md");
    expect(outgoing.map((o) => o.target)).toEqual(["Ilum"]);
    expect(outgoing[0].resolved).toBe("Lore/Crystals/Ilum.md");
  });

  test("live edits update the index", () => {
    index.update("Daily/2026-10-02.md", "Linked [[Kyber Crystal Notes]] now.\n");
    expect(index.backlinks("Lore/Crystals/Kyber Crystal Notes.md").length).toBe(3);
  });

  test("disk changes reindex", () => {
    const toRead = index.setPaths([...Object.keys(files), "New.md"]);
    expect(toRead).toEqual(["New.md"]);
    index.update("Daily/2026-10-02.md", "See [[Ilum]].\n");
    index.update("New.md", "[[Ilum]]\n");
    expect(index.backlinks("Lore/Crystals/Ilum.md").map((b) => b.title)).toEqual(["2026-10-02", "Kyber Crystal Notes", "New"]);
  });

  test("removed paths drop out of the index", () => {
    index.setPaths(Object.keys(files).filter((path) => path !== "Lore/Crystals/Ilum.md"));
    expect(index.info("Lore/Crystals/Ilum.md")).toBeNull();
    expect(index.backlinks("Lore/Crystals/Kyber Crystal Notes.md").map((b) => b.title)).toEqual(["Lightsaber Construction"]);
    expect(index.outgoingLinks("Lore/Crystals/Kyber Crystal Notes.md")).toEqual([{ target: "Ilum", resolved: null }]);
    expect(index.searchSnapshot().map((n) => n.path)).not.toContain("Lore/Crystals/Ilum.md");
  });

  test("unchanged text is not re-parsed", () => {
    const revision = index.revision;
    expect(index.update("Daily/2026-10-02.md", files["Daily/2026-10-02.md"])).toBe(false);
    expect(index.revision).toBe(revision);
  });

  test("search snapshot has text and tags", () => {
    const note = index.searchSnapshot().find((n) => n.path === "Lore/Crystals/Ilum.md");
    expect(note).toEqual({ path: "Lore/Crystals/Ilum.md", text: files["Lore/Crystals/Ilum.md"], tags: ["lore/planets"] });
  });

  test("outgoing links skip attachments and same-note headings", () => {
    const attachments = build({ "Lore/Kyber.md": "![[crystal.png]] [[#Top]] [[Ilum]] [[ilum#Caves]] [[Dagobah]]\n", "Ilum.md": "" });
    expect(attachments.outgoingLinks("Lore/Kyber.md")).toEqual([
      { target: "Ilum", resolved: "Ilum.md" },
      { target: "Dagobah", resolved: null },
    ]);
  });

  test("mentions skip lines that already link and respect the limit", () => {
    const many: Record<string, string> = { "Ilum.md": "# Ilum\n" };
    for (let i = 0; i < 60; i++) many[`Notes/${i}.md`] = "Went to Ilum.\n";
    many["Linked.md"] = "[[Ilum]] — Ilum again\nPlain Ilum mention.\n";
    const big = build(many);
    expect(big.unlinkedMentions("Ilum.md").length).toBe(50);
    expect(big.unlinkedMentions("Ilum.md", 100).find((m) => m.source === "Linked.md")?.context).toBe("Plain Ilum mention.");
  });
});

describe("containsWord", () => {
  test("matches whole words ignoring case and accents", () => {
    expect(VaultIndex.containsWord("kyber", "The Kyber crystal")).toBe(true);
    expect(VaultIndex.containsWord("kyber", "Kyberstone")).toBe(false);
    expect(VaultIndex.containsWord("kyber", "sKyber kyber.")).toBe(true);
    expect(VaultIndex.containsWord("Padme", "Padmé Amidala")).toBe(true);
    expect(VaultIndex.containsWord("Padmé", "padme")).toBe(true);
    expect(VaultIndex.containsWord("ilum", "ilum2")).toBe(false);
    expect(VaultIndex.containsWord("", "anything")).toBe(false);
  });

  test("title is the file name without extension", () => {
    expect(VaultIndex.title("Lore/Crystals/Kyber Crystal Notes.md")).toBe("Kyber Crystal Notes");
    expect(VaultIndex.title("Specs/v1.2 notes.markdown")).toBe("v1.2 notes");
  });
});
