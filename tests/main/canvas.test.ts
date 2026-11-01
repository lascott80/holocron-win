// JSON Canvas files in the vault (UI-45): listed beside notes but neither
// indexed nor treated as attachments, opened in a tab without a document,
// reloaded when they change on disk, and renamed keeping their extension.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { scanVault } from "../../src/main/vault";
import { recordingEditor, TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;
let editor: ReturnType<typeof recordingEditor>;

const board = "Plans/Board.canvas";
const note = "Notes/Kyber.md";
const canvasText = JSON.stringify({ nodes: [{ id: "n1", type: "file", x: 0, y: 0, width: 100, height: 100, file: note }], edges: [] });

beforeEach(() => {
  temp = new TempVault();
  temp.write(note, "---\ntags: [lore]\n---\n# Kyber\n\nLine 1\nLine 2\n");
  temp.write("Attachments/pic.png", "png");
  temp.write(board, canvasText);
  editor = recordingEditor();
  vault = temp.open({ editor });
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Canvas files", () => {
  it("sit in the tree with their own kind, outside notes and attachments", () => {
    const scan = scanVault(temp.root);
    const plans = scan.tree.find((node) => node.path === "Plans");
    expect(plans?.children).toEqual([{ path: board, name: "Board", isDir: false, kind: "canvas", noteCount: 0 }]);
    expect(plans?.noteCount).toBe(0);
    expect(scan.notes).toEqual([note]);
    expect(scan.attachments).toEqual(["Attachments/pic.png"]);
    expect(scan.canvases).toEqual([board]);
    expect(vault.canvases).toEqual([board]);
    expect(vault.noteCount).toBe(1);
  });

  it("open in a tab without a document and show the viewer instead of the editor", () => {
    vault.open(board);
    expect(vault.tabs.map((tab) => tab.path)).toEqual([board]);
    expect(vault.document).toBeNull();
    expect(vault.documents.size).toBe(0);
    const view = vault.view();
    expect(view.doc).toBeNull();
    expect(view.canvas).toEqual({ path: board, title: "Board", revision: 0 });
    expect(view.tabs[0].title).toBe("Board");
    expect(editor.calls.at(-1)).toEqual({ method: "show", args: [null, null] });
    expect(vault.recentNotes).toEqual([]);
    expect(vault.canvasText(board)).toBe(canvasText);
  });

  it("open from the sidebar, a link and the remembered tabs", () => {
    vault.select(board);
    expect(vault.activeTab?.path).toBe(board);
    vault.open(note);
    vault.openLink("Board.canvas", true);
    expect(vault.tabs.map((tab) => tab.path)).toEqual([note, board]);
    expect(vault.activeTab?.path).toBe(board);
    vault.close();
    const reopened = temp.open();
    expect(reopened.tabs.map((tab) => tab.path)).toEqual([note, board]);
    expect(reopened.activeTab?.path).toBe(board);
  });

  it("reload when the file changes on disk and close when it goes away", () => {
    vault.open(board);
    temp.write(board, "{}");
    vault.handleDiskChanges([board]);
    expect(vault.view().canvas?.revision).toBe(1);
    temp.remove(board);
    vault.handleDiskChanges([board]);
    expect(vault.tabs).toEqual([]);
    expect(vault.view().canvas).toBeNull();
  });

  it("keep their extension when renamed", () => {
    expect(vault.rename(board, "Roadmap")).toBe("Plans/Roadmap.canvas");
    expect(temp.exists("Plans/Roadmap.canvas")).toBe(true);
    expect(vault.rename("Plans/Roadmap.canvas", "Board.canvas")).toBe(board);
  });

  it("give file cards a note's first lines without its frontmatter", () => {
    expect(vault.notePreview("notes/kyber.md", 2)).toEqual({ path: note, text: "# Kyber\n" });
    expect(vault.notePreview(note, 40)).toEqual({ path: note, text: "# Kyber\n\nLine 1\nLine 2\n" });
    expect(vault.notePreview("Attachments/pic.png", 40)).toBeNull();
    expect(vault.notePreview("Missing.md", 40)).toBeNull();
    expect(vault.canvasText(note)).toBeNull();
  });
});
