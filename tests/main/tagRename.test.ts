// Rename Tag… (FOP-13) across a vault on disk: closed notes are rewritten
// atomically, open ones through their document, and Undo puts it all back.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordingEditor, TempVault } from "./helpers";

let temp: TempVault;
beforeEach(() => {
  temp = new TempVault();
});
afterEach(async () => {
  await temp.cleanup();
});

describe("renameTag", () => {
  it("rewrites the tag and nested tags in every note that has them, with Undo", async () => {
    temp.write("A.md", "---\ntags: [project, lore]\n---\n# A\n\nDone #Project/alpha.\r\n");
    temp.write("B.md", "Only `#project` in code and [[X#project]].\n");
    temp.write("C.md", "Nothing tagged.\n");
    temp.write("Open.md", "#project/beta is open\n");
    const editor = recordingEditor();
    const vault = temp.open({ editor });
    await vault.indexingFinished();
    vault.open("Open.md");

    expect(vault.renameTag("project", "work")).toBe(2);
    expect(temp.read("A.md")).toBe("---\ntags: [work, lore]\n---\n# A\n\nDone #work/alpha.\r\n");
    expect(temp.read("B.md")).toBe("Only `#project` in code and [[X#project]].\n");
    expect(temp.read("C.md")).toBe("Nothing tagged.\n");
    expect(vault.documents.get("Open.md")?.text).toBe("#work/beta is open\n");
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[2] === "#work/beta is open\n")).toBe(true);
    expect(vault.toast?.message).toBe("Renamed #project to #work in 2 notes");
    expect(vault.index.allTags().map((tag) => tag.tag).sort()).toEqual(["lore", "work", "work/alpha", "work/beta"]);

    vault.runToastAction();
    expect(temp.read("A.md")).toBe("---\ntags: [project, lore]\n---\n# A\n\nDone #Project/alpha.\r\n");
    expect(vault.documents.get("Open.md")?.text).toBe("#project/beta is open\n");
    expect(vault.index.allTags().map((tag) => tag.tag).sort()).toEqual(["Project/alpha", "lore", "project", "project/beta"]);
  });

  it("merges into an existing tag, rejects bad names and reports tags nobody uses", async () => {
    temp.write("A.md", "#old and #new\n");
    temp.write("B.md", "#new only\n");
    const vault = temp.open();
    await vault.indexingFinished();

    expect(vault.renameTag("old", "new")).toBe(1);
    expect(temp.read("A.md")).toBe("#new and #new\n");
    expect(vault.index.allTags()).toEqual([{ tag: "new", count: 2 }]);

    expect(vault.renameTag("new", "1st")).toBe(-1);
    expect(vault.errorMessage).toContain("can’t start with a digit");
    expect(temp.read("A.md")).toBe("#new and #new\n");

    expect(vault.renameTag("nobody", "x")).toBe(0);
    expect(vault.toast?.message).toBe("No notes are tagged #nobody");
    expect(vault.renameTag("new", "new")).toBe(0);
  });

  it("builds the tag tree and remembers expanded tags per vault", async () => {
    temp.write("A.md", "#project/alpha #project\n");
    temp.write("B.md", "#project/alpha #lore\n");
    const vault = temp.open();
    await vault.indexingFinished();
    const tree = vault.tagTree("count");
    expect(tree.map((node) => [node.tag, node.count, node.total])).toEqual([
      ["project", 1, 2],
      ["lore", 1, 1],
    ]);
    expect(tree[0].children.map((node) => [node.tag, node.count])).toEqual([["project/alpha", 2]]);

    expect(vault.expandedTags).toEqual([]);
    vault.setExpandedTags(["project"]);
    expect(temp.store.get("tagTree:" + temp.root)).toEqual(["project"]);
    expect(temp.open().expandedTags).toEqual(["project"]);
    vault.setExpandedTags([]);
    expect(temp.store.get("tagTree:" + temp.root)).toBeUndefined();
  });
});
