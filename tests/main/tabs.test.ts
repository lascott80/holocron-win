// Port of TabTests.swift (REQUIREMENTS §7), plus EditorTab history.

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorTab } from "../../src/main/editorTab";
import type { Vault } from "../../src/main/vault";
import { TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;
const a = "A.md";
const b = "Folder/B.md";
const c = "C.md";

beforeEach(() => {
  temp = new TempVault();
  temp.write(a, "a\n");
  temp.write(b, "b\n");
  temp.write(c, "c\n");
  vault = temp.open({ saveDelay: 60_000 });
});

afterEach(async () => {
  await temp.cleanup();
});

const tabPaths = () => vault.tabs.map((tab) => tab.path);

describe("Tabs", () => {
  it("opening replaces the active tab", () => {
    vault.open(a);
    vault.open(b);
    expect(tabPaths()).toEqual([b]);
    expect(vault.document?.file).toBe(temp.abs(b));
    expect(vault.selection).toBe(b);
  });

  it("new tabs open after the active one", () => {
    vault.open(a);
    vault.open(c, true);
    vault.activateTab(vault.tabs[0].id);
    vault.open(b, true);
    expect(tabPaths()).toEqual([a, b, c]);
    expect(vault.activeTab?.path).toBe(b);
  });

  it("opening an open note switches to its tab", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(a);
    expect(tabPaths()).toEqual([a, b]);
    expect(vault.activeTab?.path).toBe(a);
  });

  it("empty tabs are reused", () => {
    vault.newTab();
    expect(vault.tabs.length).toBe(1);
    expect(vault.document).toBeNull();
    vault.open(a, true);
    expect(tabPaths()).toEqual([a]);
  });

  it("closing activates the neighbour", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.activateTab(vault.tabs[1].id);
    vault.closeTab(vault.tabs[1].id);
    expect(tabPaths()).toEqual([a, c]);
    expect(vault.activeTab?.path).toBe(c);

    vault.closeTab(vault.tabs[1].id);
    expect(vault.activeTab?.path).toBe(a); // no right neighbour: the last tab
    vault.closeTab(vault.tabs[0].id);
    expect(vault.tabs).toEqual([]);
    expect(vault.document).toBeNull();
    expect(vault.documents.size).toBe(0);
    expect(vault.selection).toBeNull();
  });

  it("close others and to the right", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.closeTabsToTheRight(vault.tabs[0].id);
    expect(tabPaths()).toEqual([a]);
    expect(vault.activeTab?.path).toBe(a);
    vault.open(b, true);
    vault.closeOtherTabs(vault.tabs[1].id);
    expect(tabPaths()).toEqual([b]);
    expect([...vault.documents.keys()]).toEqual([b]);
  });

  it("back and forward within a tab", () => {
    vault.open(a);
    vault.open(b);
    vault.open(c);
    vault.goBack();
    expect(vault.activeTab?.path).toBe(b);
    vault.goBack();
    expect(vault.activeTab?.path).toBe(a);
    expect(vault.canGoBack).toBe(false);
    vault.goForward();
    expect(vault.activeTab?.path).toBe(b);
    expect(vault.document?.file).toBe(temp.abs(b));
    vault.open(c);
    expect(vault.canGoForward).toBe(false);
  });

  it("back skips deleted notes", () => {
    vault.open(a);
    vault.open(b);
    vault.open(c);
    fs.rmSync(temp.abs(b));
    vault.goBack();
    expect(vault.activeTab?.path).toBe(a);
  });

  it("switching tabs saves edits", () => {
    vault.open(a);
    vault.open(b, true);
    vault.activateTab(vault.tabs[0].id);
    vault.editorChanged(a, "a, edited\n");
    vault.activateTab(vault.tabs[1].id);
    expect(temp.read(a)).toBe("a, edited\n");
  });

  it("navigating the active tab saves edits", () => {
    vault.open(a);
    vault.editorChanged(a, "a, edited\n");
    vault.open(b);
    expect(temp.read(a)).toBe("a, edited\n");
  });

  it("only the active tab's note takes editor changes", () => {
    vault.open(a);
    vault.open(b, true);
    vault.editorChanged(a, "stray\n");
    vault.saveAll();
    expect(temp.read(a)).toBe("a\n");
  });

  it("notes no tab shows are unloaded", () => {
    vault.open(a);
    vault.open(b);
    expect([...vault.documents.keys()]).toEqual([b]);
  });

  it("one document is shared per file", () => {
    vault.open(a);
    const document = vault.document;
    vault.open(b, true);
    vault.open(a);
    expect(vault.document).toBe(document);
  });

  it("an unresolved conflict is kept as a copy when its tab closes", () => {
    vault.open(a);
    vault.editorChanged(a, "mine\n");
    fs.writeFileSync(temp.abs(a), "theirs\n");
    vault.document?.reconcileWithDisk();
    expect(vault.document?.conflict).not.toBeNull();

    vault.closeActiveTab();

    const copies = temp.names().filter((name) => name.startsWith("A (conflicted copy"));
    expect(copies.length).toBe(1);
    expect(temp.read(copies[0])).toBe("mine\n");
    expect(temp.read(a)).toBe("theirs\n");
    expect(vault.allNotes).toContain(copies[0]);
  });

  it("tabs are restored when the vault reopens", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.newTab(); // empty tabs aren't remembered
    vault.activateTab(vault.tabs[1].id);
    vault.close();

    const reopened = temp.open();
    expect(reopened.tabs.map((tab) => tab.path)).toEqual([a, b, c]);
    expect(reopened.activeTab?.path).toBe(b);
    expect(reopened.document?.file).toBe(temp.abs(b));
  });

  it("restoring drops missing notes and clamps the active index", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.close();
    fs.rmSync(temp.abs(c));
    fs.rmSync(temp.abs(b));

    const reopened = temp.open();
    expect(reopened.tabs.map((tab) => tab.path)).toEqual([a]);
    expect(reopened.activeTab?.path).toBe(a);
  });

  it("tab numbers and cycling", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.selectTabNumber(1);
    expect(vault.activeTab?.path).toBe(a);
    vault.selectTabNumber(9);
    expect(vault.activeTab?.path).toBe(c);
    vault.selectNextTab();
    expect(vault.activeTab?.path).toBe(a);
    vault.selectPreviousTab();
    expect(vault.activeTab?.path).toBe(c);
    vault.selectTabNumber(2);
    expect(vault.activeTab?.path).toBe(b);
    vault.selectTabNumber(7); // no such tab
    expect(vault.activeTab?.path).toBe(b);
  });

  it("reordering tabs", () => {
    vault.open(a);
    vault.open(b, true);
    vault.open(c, true);
    vault.moveTab(vault.tabs[2].id, vault.tabs[0].id);
    expect(tabPaths()).toEqual([c, a, b]);
  });

  it("new notes open in a new tab", () => {
    vault.open(a);
    const created = vault.createNote();
    expect(tabPaths().length).toBe(2);
    expect(vault.activeTab?.path).toBe(created);
  });

  it("recent notes are remembered per vault, most recent first", () => {
    vault.open(a);
    vault.open(b);
    vault.open(c, true);
    vault.open(a);
    expect(vault.recentNotes.slice(0, 3)).toEqual([a, c, b]);
    expect(temp.store.get<string[]>("recentNotes:" + vault.root)?.slice(0, 3)).toEqual([a, c, b]);
  });

  it("recent notes drop deleted files and follow renames", async () => {
    vault.open(a);
    vault.open(b);
    vault.rename(b, "Bee");
    expect(vault.recentNotes).toContain("Folder/Bee.md");
    expect(vault.recentNotes).not.toContain(b);
    fs.rmSync(temp.abs(a));
    vault.handleDiskChanges([a]);
    expect(vault.recentNotes).not.toContain(a);
  });

  it("selecting a folder doesn't open anything", () => {
    vault.select("Folder");
    expect(vault.selection).toBe("Folder");
    expect(vault.tabs).toEqual([]);
    vault.select(b);
    expect(vault.activeTab?.path).toBe(b);
  });

  it("the view describes tabs", () => {
    vault.open(a);
    vault.newTab();
    const view = vault.view();
    expect(view.tabs.map((tab) => tab.title)).toEqual(["A", "New Tab"]);
    expect(view.activeTabId).toBe(vault.tabs[1].id);
    expect(view.doc).toBeNull();
  });
});

describe("EditorTab", () => {
  it("navigates like a browser", () => {
    const tab = new EditorTab("a");
    expect(tab.canGoBack).toBe(false);
    tab.navigate("b");
    tab.navigate("b"); // same note: no new entry
    tab.navigate("c");
    expect(tab.goBack(() => false)).toBe("b");
    tab.navigate("d"); // drops "c"
    expect(tab.canGoForward).toBe(false);
    expect(tab.goBack(() => false)).toBe("b");
    expect(tab.goBack(() => false)).toBe("a");
    expect(tab.goBack(() => false)).toBeNull();
    expect(tab.goForward((path) => path === "b")).toBe("d");
  });

  it("an empty tab has no history", () => {
    const tab = new EditorTab();
    expect(tab.path).toBeNull();
    expect(tab.canGoBack).toBe(false);
    expect(tab.canGoForward).toBe(false);
    tab.navigate("a");
    expect(tab.path).toBe("a");
    expect(tab.canGoBack).toBe(false);
  });

  it("keeps at most 100 entries", () => {
    const tab = new EditorTab("0");
    for (let i = 1; i <= 150; i++) tab.navigate(String(i));
    let steps = 0;
    while (tab.goBack(() => false) !== null) steps++;
    expect(steps).toBe(99);
    expect(tab.path).toBe("51");
  });

  it("remaps history after moves", () => {
    const tab = new EditorTab("Old/a.md");
    tab.navigate("b.md");
    tab.remap((path) => path.replace("Old/", "New/"));
    expect(tab.goBack(() => false)).toBe("New/a.md");
  });
});
