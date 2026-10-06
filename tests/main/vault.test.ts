// Port of VaultTests.swift (FileTreeTests, VaultTests), plus vault-level
// saving, the view model and timing-sensitive behaviour.

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanVault } from "../../src/main/vault";
import { TempVault, waitFor } from "./helpers";

let temp: TempVault;

beforeEach(() => {
  temp = new TempVault();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("File tree", () => {
  it("scans notes and folders only", () => {
    temp.write("Ilum.md");
    temp.write("Lore/Crystals/Kyber Crystal Notes.md");
    temp.write("Lore/map.png");
    temp.write(".obsidian/workspace.json");
    temp.write("README.markdown");

    const { tree, notes, attachments } = scanVault(temp.root);
    expect(tree.map((node) => node.name)).toEqual(["Lore", "Ilum", "README"]);
    const lore = tree[0];
    expect(lore.isDir).toBe(true);
    expect(lore.children?.[0].children?.map((node) => node.name)).toEqual(["Kyber Crystal Notes"]);
    expect(tree.reduce((sum, node) => sum + node.noteCount, 0)).toBe(3);
    expect(notes).toEqual(["Lore/Crystals/Kyber Crystal Notes.md", "Ilum.md", "README.markdown"]);
    expect(attachments).toEqual(["Lore/map.png"]);
  });

  it("sorts like Explorer/Finder", () => {
    for (const name of ["Note 10.md", "note 2.md", "Note 1.md"]) temp.write(name);
    expect(scanVault(temp.root).tree.map((node) => node.name)).toEqual(["Note 1", "note 2", "Note 10"]);
  });

  it("skips hidden files and Holocron's temp files", () => {
    temp.write("A.md");
    temp.write(".A.md.1234abcd.holocron-tmp", "partial");
    temp.write(".hidden/B.md");
    expect(scanVault(temp.root).notes).toEqual(["A.md"]);
  });

  it("follows directory junctions", () => {
    const outside = temp.outside();
    fs.writeFileSync(`${outside}/Linked.md`, "x");
    fs.symlinkSync(outside, temp.abs("Link"), "junction");
    expect(scanVault(temp.root).notes).toEqual(["Link/Linked.md"]);
  });
});

describe("Vault", () => {
  it("creates uniquely named notes in the selected folder", () => {
    temp.write("Lore/Untitled.md");
    const vault = temp.open();
    vault.select("Lore");
    const created = vault.createNote();
    expect(created).toBe("Lore/Untitled 2.md");
    expect(vault.document?.file).toBe(temp.abs("Lore/Untitled 2.md"));
    expect(vault.noteCount).toBe(2);
  });

  it("switching notes saves the previous one", () => {
    temp.write("A.md", "a");
    temp.write("B.md", "b");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.select("A.md");
    vault.editorChanged("A.md", "a, edited");
    vault.select("B.md");
    expect(vault.activeTab?.path).toBe("B.md");
    expect(temp.read("A.md")).toBe("a, edited");
  });

  it("autosaves edits from the editor", async () => {
    temp.write("A.md", "a");
    const vault = temp.open({ saveDelay: 10 });
    vault.open("A.md");
    vault.editorChanged("A.md", "typed");
    expect(vault.view().doc?.isDirty).toBe(true);
    await waitFor(() => temp.read("A.md") === "typed");
    expect(vault.view().doc?.isDirty).toBe(false);
  });

  it("closing saves everything", () => {
    temp.write("A.md", "a");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("A.md");
    vault.editorChanged("A.md", "before close");
    vault.close();
    expect(temp.read("A.md")).toBe("before close");
  });

  it("counts notes and names the vault", () => {
    temp.write("A.md");
    temp.write("Sub/B.markdown");
    temp.write("Sub/c.png");
    const vault = temp.open();
    expect(vault.noteCount).toBe(2);
    expect(vault.allNotes).toEqual(["Sub/B.markdown", "A.md"]);
    expect(vault.attachments).toEqual(["Sub/c.png"]);
    expect(vault.name).toBe("Vault");
    expect(vault.abs("Sub/B.markdown")).toBe(temp.abs("Sub/B.markdown"));
    expect(vault.relative(temp.abs("Sub/B.markdown"))).toBe("Sub/B.markdown");
  });

  it("reload only reports tree changes when something changed", () => {
    temp.write("A.md");
    let treeChanges = 0;
    const vault = temp.open({ onTreeChange: () => treeChanges++ });
    expect(treeChanges).toBe(1); // the initial scan
    treeChanges = 0;
    const revision = vault.treeRevision;
    vault.reload();
    vault.reload();
    expect(treeChanges).toBe(0);
    expect(vault.treeRevision).toBe(revision);
    temp.write("B.md");
    vault.reload();
    expect(treeChanges).toBe(1);
    expect(vault.treeRevision).toBe(revision + 1);
  });

  it("renaming a folder right after opening works while indexing is under way", () => {
    for (let i = 0; i < 200; i++) temp.write(`Lore/Note ${i}.md`, `# Note ${i}\n[[Note ${i + 1}]]\n`);
    const vault = temp.open();
    expect(vault.rename("Lore", "Archive")).toBe("Archive");
    expect(temp.exists("Archive/Note 199.md")).toBe(true);
    expect(vault.errorMessage).toBeNull();
  });

  it("live edits update the index after a pause", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Daily.md", "nothing\n");
    let indexChanges = 0;
    const vault = temp.open({ onIndexChange: () => indexChanges++ });
    await vault.indexingFinished();
    vault.open("Daily.md");
    const before = indexChanges;
    vault.editorChanged("Daily.md", "Now [[Ilum]]\n");
    await waitFor(() => vault.index.backlinks("Ilum.md").length === 1);
    expect(indexChanges).toBeGreaterThan(before);
    expect(vault.details("Ilum.md").backlinks.map((link) => link.source)).toEqual(["Daily.md"]);
  });

  it("indexes the open note's unsaved text", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Daily.md", "nothing\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("Daily.md");
    vault.editorChanged("Daily.md", "Unsaved [[Ilum]]\n");
    vault.handleDiskChanges(["Daily.md"]);
    await vault.indexingFinished();
    expect(vault.index.backlinks("Ilum.md").map((link) => link.source)).toEqual(["Daily.md"]);
  });

  it("details describe a note", async () => {
    temp.write("Kyber.md", "---\naliases: [Crystal]\ntype: lore\n---\n# Kyber\n## Attunement\n#lore [[Ilum]]\n");
    temp.write("Ilum.md", "See [[Kyber]]. Kyber again.\n");
    const vault = temp.open();
    await vault.indexingFinished();
    const details = vault.details("Kyber.md");
    expect(details.headings.map((heading) => heading.text)).toEqual(["Kyber", "Attunement"]);
    expect(details.backlinks.map((link) => link.source)).toEqual(["Ilum.md"]);
    expect(details.outgoing.map((link) => link.resolved)).toEqual(["Ilum.md"]);
    expect(details.tags).toEqual(["lore"]);
    expect(details.aliases).toEqual(["Crystal"]);
  });

  it("the view reflects the open note", () => {
    temp.write("A.md", "a");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("A.md");
    vault.editorChanged("A.md", "b");
    const view = vault.view();
    expect(view.doc).toMatchObject({ path: "A.md", title: "A", isDirty: true, hasConflict: false, isMissing: false });
    expect(view.doc?.modified).not.toBeNull();
    expect(view.tabs[0]).toMatchObject({ path: "A.md", title: "A", isDirty: true, hasWarning: false });
    expect(view.noteCount).toBe(1);
  });

  it("shows the active note in the editor", () => {
    temp.write("A.md", "text of a");
    const shown: [string | null, string | null][] = [];
    const vault = temp.open({
      editor: {
        show: (path, text) => shown.push([path, text]),
        documentDidMove() {},
        externalChange() {},
        forget() {},
        focus() {},
        reveal() {},
        applyTemplate() {},
        insertAtCursor() {},
        setVaultData() {},
      },
    });
    vault.open("A.md");
    expect(shown.at(-1)).toEqual(["A.md", "text of a"]);
    vault.closeActiveTab();
    expect(shown.at(-1)).toEqual([null, null]);
  });

  it("an unreadable note shows an error instead of opening", () => {
    temp.write("A.md", "a");
    const vault = temp.open();
    vault.open("Missing.md");
    expect(vault.tabs).toEqual([]);
    expect(vault.errorMessage).toMatch(/^Couldn’t open “Missing.md”/);
  });
});
