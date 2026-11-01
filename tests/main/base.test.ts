// Bases in the vault (UI-46): `.base` files are a file kind beside notes,
// canvases and attachments; File › New Base… writes a default one; a base's
// cells set properties through an open document or an atomic rewrite; and
// `baseRows` gathers the notes a filter matches.

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBase } from "@core/base";
import type { Vault } from "../../src/main/vault";
import { bodyPreview, scanVault } from "../../src/main/vault";
import { recordingEditor, TempVault, waitFor } from "./helpers";

let temp: TempVault;
let vault: Vault;
let editor: ReturnType<typeof recordingEditor>;

const base = "Plans/Tasks.base";
const kyber = "Notes/Kyber.md";
const ilum = "Notes/Ilum.md";
const baseText = 'filters: "tag:lore"\nviews:\n  - type: table\n    name: Table\n    columns: [file.name, status]\n';

beforeEach(() => {
  temp = new TempVault();
  temp.write(kyber, "---\ntags: [lore]\nstatus: active\n---\n# Kyber\n\nLine 1\n[[Ilum]]\n");
  temp.write(ilum, "---\r\ntags:\r\n  - lore\r\nstatus: done\r\n---\r\n# Ilum\r\n\r\nBody\r\n");
  temp.write("Notes/Other.md", "No frontmatter, links to [[Kyber]].\n");
  temp.write(base, baseText);
  editor = recordingEditor();
  vault = temp.open({ editor });
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Base files", () => {
  it("sit in the tree with their own kind, outside notes, canvases and attachments", () => {
    const scan = scanVault(temp.root);
    const plans = scan.tree.find((node) => node.path === "Plans");
    expect(plans?.children).toEqual([{ path: base, name: "Tasks", isDir: false, kind: "base", noteCount: 0 }]);
    expect(scan.notes.sort()).toEqual([ilum, kyber, "Notes/Other.md"]);
    expect(scan.attachments).toEqual([]);
    expect(scan.canvases).toEqual([]);
    expect(scan.bases).toEqual([base]);
    expect(vault.bases).toEqual([base]);
    expect(vault.noteCount).toBe(3);
  });

  it("open in a tab without a document and show the Base view instead of the editor", () => {
    vault.open(base);
    expect(vault.document).toBeNull();
    const view = vault.view();
    expect(view.doc).toBeNull();
    expect(view.canvas).toBeNull();
    expect(view.base).toEqual({ path: base, title: "Tasks", revision: 0 });
    expect(editor.calls.at(-1)).toEqual({ method: "show", args: [null, null] });
    expect(vault.recentNotes).toEqual([]);
    expect(vault.baseText(base)).toBe(baseText);
    expect(vault.baseText(kyber)).toBeNull();
  });

  it("open from a link and keep their extension when renamed", () => {
    vault.open(kyber);
    vault.openLink("Tasks.base");
    expect(vault.activeTab?.path).toBe(base);
    expect(vault.rename(base, "Projects")).toBe("Plans/Projects.base");
    expect(temp.exists("Plans/Projects.base")).toBe(true);
  });

  it("reload when the file changes on disk and close when it goes", async () => {
    vault.open(base);
    temp.write(base, baseText + "  - type: cards\n    name: Cards\n");
    vault.handleDiskChanges([base]);
    expect(vault.view().base?.revision).toBe(1);
    temp.remove(base);
    vault.handleDiskChanges([base]);
    expect(vault.tabs.some((tab) => tab.path === base)).toBe(false);
  });

  it("are written atomically by the view", () => {
    const text = 'filters: ""\nviews:\n  - type: cards\n    name: Board\n    columns: [file.name]\n';
    expect(vault.writeBase(base, text)).toBe(true);
    expect(temp.read(base)).toBe(text);
    expect(vault.writeBase(kyber, text)).toBe(false);
  });
});

describe("New Base", () => {
  it("creates Untitled.base in the selected folder with the default view and opens it", () => {
    vault.select("Plans");
    const path = vault.createBase();
    expect(path).toBe("Plans/Untitled.base");
    const parsed = parseBase(temp.read("Plans/Untitled.base"));
    expect(parsed.ok && parsed.base).toEqual({ filters: "", views: [{ type: "table", name: "Table", columns: ["file.name", "file.mtime", "file.tags"], sort: [] }] });
    expect(vault.activeTab?.path).toBe(path);
    expect(vault.bases).toContain(path);
    expect(vault.createBase()).toBe("Plans/Untitled 2.base");
  });
});

describe("setProperty", () => {
  it("goes through the open document, so the editor is updated in place and the note is saved", async () => {
    vault.open(kyber);
    const document = vault.documents.get(kyber)!;
    document.setText(document.text + "Unsaved line\n");
    expect(vault.setProperty(kyber, "status", "done")).toBe(true);
    expect(document.text).toBe("---\ntags: [lore]\nstatus: done\n---\n# Kyber\n\nLine 1\n[[Ilum]]\nUnsaved line\n");
    const external = editor.calls.find((call) => call.method === "externalChange");
    expect(external?.args[0]).toBe(kyber);
    expect(external?.args[2]).toContain("status: done");
    await waitFor(() => temp.read(kyber).includes("status: done"));
    expect(vault.index.info(kyber)?.properties.find((property) => property.key === "status")?.values).toEqual(["done"]);
  });

  it("rewrites a closed note on disk, keeping CRLF line endings", () => {
    expect(vault.setProperty(ilum, "status", "active")).toBe(true);
    expect(temp.read(ilum)).toBe("---\r\ntags:\r\n  - lore\r\nstatus: active\r\n---\r\n# Ilum\r\n\r\nBody\r\n");
    expect(vault.setProperty(ilum, "tags", ["lore", "planets"])).toBe(true);
    expect(temp.read(ilum)).toBe("---\r\ntags:\r\n  - lore\r\n  - planets\r\nstatus: active\r\n---\r\n# Ilum\r\n\r\nBody\r\n");
    expect(vault.setProperty(ilum, "done", true)).toBe(true);
    expect(temp.read(ilum)).toContain("done: true\r\n---\r\n");
    expect(vault.setProperty("Notes/Missing.md", "a", "b")).toBe(false);
  });

  it("creates the frontmatter when a note has none", () => {
    expect(vault.setProperty("Notes/Other.md", "status", "new")).toBe(true);
    expect(temp.read("Notes/Other.md")).toBe("---\nstatus: new\n---\nNo frontmatter, links to [[Kyber]].\n");
  });
});

describe("baseRows", () => {
  it("lists the notes a filter matches with their properties, tags and links", async () => {
    await vault.indexingFinished();
    const { rows, error } = vault.baseRows("tag:lore", ["backlinks"]);
    expect(error).toBeNull();
    expect(rows.map((row) => row.path).sort()).toEqual([ilum, kyber]);
    const row = rows.find((candidate) => candidate.path === kyber)!;
    expect(row).toMatchObject({ title: "Kyber", folder: "Notes", tags: ["lore"], links: 1, backlinks: 1, properties: { tags: ["lore"], status: "active" }, mtime: null, preview: "" });
    expect(rows.find((candidate) => candidate.path === ilum)?.backlinks).toBe(1);
  });

  it("gathers times and previews only when asked, and every note for an empty filter", async () => {
    await vault.indexingFinished();
    expect(vault.baseRows("").rows).toHaveLength(3);
    const { rows } = vault.baseRows("file:Kyber", ["times", "preview"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mtime).toBeGreaterThan(0);
    expect(rows[0]!.ctime).toBeGreaterThan(0);
    expect(rows[0]!.preview).toBe("Kyber\nLine 1\nIlum");
  });

  it("reports a filter it can't run", async () => {
    await vault.indexingFinished();
    expect(vault.baseRows("[status:active]").rows.map((row) => row.path)).toEqual([kyber]);
    expect(bodyPreview("---\na: 1\n---\n\n# Title\n\n```js\ncode\n```\n- item **bold**\n\n---\nmore\n", 2)).toBe("Title\nitem bold");
  });
});

describe("New note from a base", () => {
  it("prefills the frontmatter the filter asks for", () => {
    const path = vault.createNote("Plans", "---\nstatus: active\ntags: [project]\n---\n");
    expect(path).toBe("Plans/Untitled.md");
    expect(fs.readFileSync(temp.abs(path!), "utf8")).toBe("---\nstatus: active\ntags: [project]\n---\n");
  });
});
