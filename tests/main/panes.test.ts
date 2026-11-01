// The pane layout (UI-40, UI-47), stacked tabs (UI-48) and workspaces (UI-49)
// in the vault model: splits, focus, document sharing across N panes,
// persistence and restore with missing files.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leaves, MAIN_PANE } from "../../src/core/layout";
import { Vault } from "../../src/main/vault";
import { recordingEditor, TempVault } from "./helpers";

type Recorder = ReturnType<typeof recordingEditor>;

let temp: TempVault;
let vault: Vault;
let main: Recorder;
let ports: Record<string, Recorder>;

function openVault(): Vault {
  main = recordingEditor();
  ports = {};
  return temp.open({ saveDelay: 60_000, editor: main, paneEditor: (id) => (ports[id] ??= recordingEditor()) });
}

beforeEach(() => {
  temp = new TempVault();
  temp.write("A.md", "a\n");
  temp.write("B.md", "b\n");
  temp.write("C.md", "c\n");
  temp.write("Board.canvas", JSON.stringify({ nodes: [], edges: [] }));
  vault = openVault();
});

afterEach(async () => {
  await temp.cleanup();
});

const lastShow = (editor: Recorder) => editor.calls.filter((c) => c.method === "show").at(-1)?.args;
const paneIds = (v: Vault) => leaves(v.layout.root).map((leaf) => leaf.id);
const others = (v: Vault) => paneIds(v).filter((id) => id !== MAIN_PANE);

describe("Splitting", () => {
  it("Split Right shows the focused pane's note beside it and focuses the new pane", () => {
    vault.open("A.md");
    vault.splitActiveNote();
    const [id] = others(vault);
    expect(id).toBeDefined();
    expect(vault.layout.root).toMatchObject({ kind: "split", direction: "row" });
    expect(vault.focusedPane).toBe(id);
    expect(lastShow(ports[id])).toEqual(["A.md", "a\n"]);
    expect(vault.view().panes[id]).toMatchObject({ path: "A.md", title: "A", kind: "note" });
  });

  it("Split Down stacks under the focused pane, nesting splits", () => {
    vault.open("A.md");
    vault.splitActiveNote("row");
    const right = vault.focusedPane;
    vault.splitActiveNote("column");
    expect(paneIds(vault)).toHaveLength(3);
    const root = vault.layout.root as { children: { kind: string; direction?: string; children?: { id: string }[] }[] };
    expect(root.children[1]).toMatchObject({ kind: "split", direction: "column" });
    expect(root.children[1].children?.[0].id).toBe(right);
  });

  it("Open to the Right / Open Below show another note in a new pane", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.openInSplit("C.md", "column");
    const [right, below] = others(vault);
    expect(vault.view().panes[right].path).toBe("B.md");
    expect(vault.view().panes[below].path).toBe("C.md");
    expect(vault.documents.has("B.md") && vault.documents.has("C.md")).toBe(true);
  });

  it("shows a canvas in a pane without an editor", () => {
    vault.open("A.md");
    vault.openInSplit("Board.canvas");
    const [id] = others(vault);
    expect(vault.view().panes[id]).toMatchObject({ path: "Board.canvas", kind: "canvas", title: "Board.canvas" });
    expect(lastShow(ports[id])).toEqual([null, null]);
  });

  it("refuses a ninth pane with a toast", () => {
    vault.open("A.md");
    for (let i = 0; i < 7; i++) vault.splitActiveNote();
    expect(paneIds(vault)).toHaveLength(8);
    expect(vault.splitActiveNote()).toBeUndefined();
    expect(paneIds(vault)).toHaveLength(8);
    expect(vault.view().toast?.message).toMatch(/at most 8 panes/);
  });
});

describe("Closing and focus", () => {
  it("Close Pane collapses the parent split and focuses the pane before it", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    const [id] = others(vault);
    vault.closePane();
    expect(vault.layout.root).toEqual({ kind: "pane", id: MAIN_PANE, path: null });
    expect(vault.focusedPane).toBe(MAIN_PANE);
    expect(lastShow(ports[id])).toEqual([null, null]);
    expect(vault.documents.has("B.md")).toBe(false);
    expect(vault.usesPane(id)).toBe(false);
  });

  it("Close Pane on the primary pane only beeps", () => {
    const beeps: string[] = [];
    const v = temp.open({ saveDelay: 60_000, editor: recordingEditor(), ui: (request) => beeps.push(request.type) });
    v.open("A.md");
    v.openInSplit("B.md");
    v.focusPane(MAIN_PANE);
    v.closePane();
    expect(beeps).toEqual(["beep"]);
    expect(paneIds(v)).toHaveLength(2);
  });

  it("Close Other Panes leaves the primary pane alone", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.openInSplit("C.md");
    vault.closeSplit();
    expect(paneIds(vault)).toEqual([MAIN_PANE]);
    expect(vault.documents.has("B.md")).toBe(false);
  });

  it("Focus Next / Previous Pane wrap around in reading order", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.openInSplit("C.md");
    const [b, c] = others(vault);
    vault.focusPane(MAIN_PANE);
    vault.focusNextPane(1);
    expect(vault.focusedPane).toBe(b);
    vault.focusNextPane(1);
    expect(vault.focusedPane).toBe(c);
    vault.focusNextPane(1);
    expect(vault.focusedPane).toBe(MAIN_PANE);
    vault.focusNextPane(-1);
    expect(vault.focusedPane).toBe(c);
  });

  it("moves a pane's note into a tab", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.splitToTab();
    expect(paneIds(vault)).toEqual([MAIN_PANE]);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["A.md", "B.md"]);
  });

  it("remembers divider ratios", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    const splitId = (vault.layout.root as { id: string }).id;
    vault.setPaneRatios(splitId, [0.3, 0.7]);
    expect((vault.layout.root as { ratios: number[] }).ratios).toEqual([0.3, 0.7]);
  });
});

describe("Shared documents", () => {
  it("mirrors an edit in one pane to every other pane showing the note, never back to its source", () => {
    vault.open("A.md");
    vault.splitActiveNote();
    vault.splitActiveNote();
    const [p1, p2] = others(vault);
    vault.editorChanged("A.md", "a!\n", p1);
    expect(vault.documents.get("A.md")?.text).toBe("a!\n");
    expect(main.calls.at(-1)).toEqual({ method: "externalChange", args: ["A.md", "a\n", "a!\n"] });
    expect(ports[p2].calls.at(-1)).toEqual({ method: "externalChange", args: ["A.md", "a\n", "a!\n"] });
    expect(ports[p1].calls.some((c) => c.method === "externalChange")).toBe(false);
    vault.editorChanged("A.md", "a!!\n", MAIN_PANE);
    expect(ports[p1].calls.at(-1)).toEqual({ method: "externalChange", args: ["A.md", "a!\n", "a!!\n"] });
  });

  it("ignores a change from a pane for a note it isn't showing", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    const [id] = others(vault);
    vault.editorChanged("A.md", "nope\n", id);
    vault.editorChanged("B.md", "nope\n", "unknown-pane");
    expect(vault.documents.get("A.md")?.text).toBe("a\n");
    expect(vault.documents.get("B.md")?.text).toBe("b\n");
  });

  it("keeps a pane's note loaded when no tab shows it", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.open("A.md");
    vault.open("C.md");
    expect(vault.documents.has("B.md")).toBe(true);
  });

  it("follows renames and closes a pane whose note is deleted", async () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    const [id] = others(vault);
    vault.rename("B.md", "Bee");
    expect(vault.view().panes[id].path).toBe("Bee.md");
    expect(ports[id].calls.some((c) => c.method === "documentDidMove" && c.args[1] === "Bee.md")).toBe(true);
    await vault.delete(["Bee.md"]);
    expect(paneIds(vault)).toEqual([MAIN_PANE]);
  });
});

describe("Linked panes (UI-47)", () => {
  it("Open Reading View Beside makes a linked reading pane that follows the active tab", () => {
    vault.open("A.md");
    vault.openReadingViewBeside();
    const [id] = others(vault);
    expect(vault.view().layout.root).toMatchObject({ children: [{ id: MAIN_PANE }, { id, linked: true, mode: "reading", path: "A.md" }] });
    vault.open("B.md");
    expect(vault.view().panes[id].path).toBe("B.md");
    expect(lastShow(ports[id])).toEqual(["B.md", "b\n"]);
    expect(vault.documents.has("A.md")).toBe(false);
  });

  it("unlinking keeps the note it shows; linking again jumps to the active tab", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    const [id] = others(vault);
    vault.setPaneLinked(id, true);
    expect(vault.view().panes[id].path).toBe("A.md");
    vault.setPaneLinked(id, false);
    vault.open("C.md");
    expect(vault.view().panes[id].path).toBe("A.md");
    vault.setPaneMode(id, "source");
    expect(leaves(vault.layout.root).find((leaf) => leaf.id === id)?.mode).toBe("source");
  });

  it("a linked pane empties rather than closing when its note is deleted", async () => {
    vault.open("A.md");
    vault.openReadingViewBeside();
    const [id] = others(vault);
    vault.open("B.md");
    await vault.delete(["B.md"]);
    expect(paneIds(vault)).toEqual([MAIN_PANE, id]);
  });
});

describe("Persistence", () => {
  it("restores the tree, ratios, focus and modes, dropping panes whose files are gone", () => {
    vault.open("A.md");
    vault.openInSplit("B.md");
    vault.openInSplit("C.md", "column");
    const [b, c] = others(vault);
    vault.setPaneMode(c, "reading");
    vault.setPaneRatios((vault.layout.root as { id: string }).id, [0.4, 0.6]);
    vault.focusPane(b);
    vault.close();
    temp.remove("B.md");
    const again = openVault();
    expect(paneIds(again)).toEqual([MAIN_PANE, c]);
    expect(again.layout.root).toMatchObject({ kind: "split", direction: "row", ratios: [0.4, 0.6] });
    expect(again.view().panes[c]).toMatchObject({ path: "C.md" });
    expect(leaves(again.layout.root).find((leaf) => leaf.id === c)?.mode).toBe("reading");
    expect(again.focusedPane).toBe(MAIN_PANE);
    expect(lastShow(ports[c])).toEqual(["C.md", "c\n"]);
  });

  it("stores nothing for a single pane and migrates 0.10's split pane", () => {
    vault.open("A.md");
    expect(temp.store.get("layout:" + vault.root)).toBeUndefined();
    vault.close();
    temp.store.set("openTabs:" + vault.root + ":split", "B.md");
    const again = openVault();
    expect(others(again)).toHaveLength(1);
    expect(again.view().panes[others(again)[0]].path).toBe("B.md");
    expect(temp.store.get("openTabs:" + vault.root + ":split")).toBeUndefined();
  });
});

describe("Stacked tabs (UI-48)", () => {
  it("shows every tab in a column editor of its own and shares their documents", () => {
    vault.open("A.md");
    vault.open("B.md", true);
    vault.setStackTabs(true);
    expect(vault.view().stackTabs).toBe(true);
    expect(temp.store.get("stackTabs:" + vault.root)).toBe(true);
    const [a, b] = vault.tabs.map((tab) => Vault.tabPane(tab.id));
    expect(lastShow(ports[a])).toEqual(["A.md", "a\n"]);
    expect(lastShow(ports[b])).toEqual(["B.md", "b\n"]);
    vault.editorChanged("B.md", "b!\n", b);
    expect(vault.documents.get("B.md")?.text).toBe("b!\n");
    expect(main.calls.at(-1)).toEqual({ method: "externalChange", args: ["B.md", "b\n", "b!\n"] });
    vault.closeTab(vault.tabs[0].id);
    expect(lastShow(ports[a])).toEqual([null, null]);
    vault.setStackTabs(false);
    expect(lastShow(ports[b])).toEqual([null, null]);
  });
});

describe("Workspaces (UI-49)", () => {
  const ui = { showSidebar: false, showInspector: true, sidebarWidth: 300, inspectorWidth: 290, sidebarMode: "search" as const, inspectorTab: "links" as const };

  it("saves the panes, tabs and side panels, and loads them back with missing notes dropped", () => {
    vault.open("A.md");
    vault.open("B.md", true);
    vault.togglePinTab(vault.tabs[0].id);
    vault.openInSplit("C.md");
    vault.saveWorkspace("Writing", ui);
    expect(vault.view().workspaces).toEqual(["Writing"]);
    expect(vault.view().lastWorkspace).toBe("Writing");

    vault.closeSplit();
    vault.open("C.md");
    vault.closeOtherTabs(vault.activeTabId!);
    vault.editorChanged("C.md", "edited\n", MAIN_PANE);
    temp.remove("B.md");

    const restored = vault.loadWorkspace("Writing");
    expect(restored).toEqual(ui);
    expect(temp.read("C.md")).toBe("edited\n"); // loading saves first
    expect(vault.tabs.map((tab) => [tab.path, tab.pinned])).toEqual([["A.md", true]]);
    expect(vault.activeTab?.path).toBe("A.md");
    expect(others(vault)).toHaveLength(1);
    expect(vault.view().panes[others(vault)[0]].path).toBe("C.md");
  });

  it("loads the last workspace and deletes by name", () => {
    vault.open("A.md");
    vault.saveWorkspace("One");
    vault.open("B.md", true);
    vault.saveWorkspace("Two");
    expect(vault.view().workspaces).toEqual(["One", "Two"]);
    vault.loadWorkspace("One");
    vault.open("C.md", true);
    expect(vault.loadLastWorkspace()).toBeNull(); // no ui stored
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["A.md"]);
    vault.deleteWorkspace("One");
    expect(vault.view().workspaces).toEqual(["Two"]);
    expect(vault.view().lastWorkspace).toBeNull();
    expect(vault.loadWorkspace("Nope")).toBeNull();
  });
});
