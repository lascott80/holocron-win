// Split view (UI-40): a second pane with its own note, sharing documents with the tabs.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { recordingEditor, TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;
let main: ReturnType<typeof recordingEditor>;
let split: ReturnType<typeof recordingEditor>;

beforeEach(() => {
  temp = new TempVault();
  temp.write("A.md", "a\n");
  temp.write("B.md", "b\n");
  main = recordingEditor();
  split = recordingEditor();
  vault = temp.open({ saveDelay: 60_000, editor: main, splitEditor: split });
});

afterEach(async () => {
  await temp.cleanup();
});

const lastShow = (editor: ReturnType<typeof recordingEditor>) => editor.calls.filter((c) => c.method === "show").at(-1)?.args;

describe("Split view", () => {
  it("shows a note in the right-hand pane and reports it", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    expect(lastShow(split)).toEqual(["B.md", "b\n"]);
    expect(vault.view().split).toMatchObject({ path: "B.md", title: "B" });
    expect(vault.documents.has("B.md")).toBe(true);
  });

  it("keeps the split note loaded when no tab shows it, and unloads it on close", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.open("A.md"); // tabs change: B must stay
    expect(vault.documents.has("B.md")).toBe(true);
    vault.closeSplit();
    expect(vault.documents.has("B.md")).toBe(false);
    expect(lastShow(split)).toEqual([null, null]);
    expect(vault.view().split).toBeNull();
  });

  it("mirrors edits into the other pane when both show the same note", () => {
    vault.open("A.md");
    vault.splitActiveNote();
    vault.editorChanged("A.md", "a!\n", "split");
    expect(vault.documents.get("A.md")?.text).toBe("a!\n");
    expect(main.calls.at(-1)).toEqual({ method: "externalChange", args: ["A.md", "a\n", "a!\n"] });
    vault.editorChanged("A.md", "a!!\n", "main");
    expect(split.calls.at(-1)).toEqual({ method: "externalChange", args: ["A.md", "a!\n", "a!!\n"] });
  });

  it("ignores changes from a pane for a note it isn't showing", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.editorChanged("A.md", "nope\n", "split");
    expect(vault.documents.get("A.md")?.text).toBe("a\n");
  });

  it("follows renames and closes when its note is deleted", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.rename("B.md", "Bee");
    expect(vault.view().split?.path).toBe("Bee.md");
    expect(split.calls.some((c) => c.method === "documentDidMove" && c.args[1] === "Bee.md")).toBe(true);
  });

  it("is restored when the vault is opened again", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.close();
    const again = temp.open({ saveDelay: 60_000, editor: recordingEditor(), splitEditor: recordingEditor() });
    expect(again.view().split?.path).toBe("B.md");
  });

  it("moves the split note into a tab", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.splitToTab();
    expect(vault.view().split).toBeNull();
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["A.md", "B.md"]);
  });
});
