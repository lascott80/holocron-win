// Port of TemplateTests.swift (VaultTemplateTests). Rendering rules are
// covered in tests/core/templates.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, recordingEditor } from "./helpers";

let temp: TempVault;
let vault: Vault;
let editor: ReturnType<typeof recordingEditor>;

beforeEach(() => {
  temp = new TempVault();
  temp.write("Templates/Meeting.md", "---\ntype: meeting\n---\n# {{title}}\n\nAttendees: {{cursor}}\n");
  temp.write("Templates/Book.md", "# {{title}}\n");
  temp.write("Templates/Sub/Weekly 10.md", "w10");
  temp.write("Templates/Sub/Weekly 2.md", "w2");
  temp.write("Lore/Ilum.md", "# Ilum\n");
  editor = recordingEditor();
  vault = temp.open({ editor });
  vault.templatesFolderOverride = "Templates";
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Templates in the vault", () => {
  it("lists templates by name, subfolders included", () => {
    expect(vault.templates).toEqual(["Templates/Book.md", "Templates/Meeting.md", "Templates/Sub/Weekly 2.md", "Templates/Sub/Weekly 10.md"]);
  });

  it("no templates folder means no templates", () => {
    vault.templatesFolderOverride = "";
    expect(vault.templates).toEqual([]);
  });

  it("creates notes from templates", () => {
    vault.select("Lore/Ilum.md");
    const path = vault.createNoteFromTemplate("Templates/Meeting.md", "Council: Ilum");

    expect(path).toBe("Lore/Council- Ilum.md");
    expect(temp.read(path!)).toBe("---\ntype: meeting\n---\n# Council- Ilum\n\nAttendees: \n");
    expect(vault.activeTab?.path).toBe(path);
    expect(vault.tabs.length).toBe(2); // opened in a new tab
    // The cursor goes where {{cursor}} was: line 6, after "Attendees: ".
    const reveal = editor.calls.filter((call) => call.method === "reveal").at(-1);
    expect(reveal?.args).toEqual([path, 6, 11, 11]);
  });

  it("slashes and backslashes in the name become dashes; empty means Untitled", () => {
    expect(vault.createNoteFromTemplate("Templates/Book.md", "a/b\\c")).toBe("a-b-c.md");
    expect(vault.createNoteFromTemplate("Templates/Book.md", "   ")).toBe("Untitled.md");
    expect(temp.read("Untitled.md")).toBe("# Untitled\n");
  });

  it("new notes never land in the templates folder", () => {
    vault.select("Templates/Book.md");
    const path = vault.createNoteFromTemplate("Templates/Book.md", "Dune");
    expect(path).toBe("Dune.md");
    vault.select("Templates/Sub");
    expect(vault.createNoteFromTemplate("Templates/Book.md", "Arrakis")).toBe("Arrakis.md");
  });

  it("existing names get numbered, and the title follows", () => {
    vault.createNoteFromTemplate("Templates/Book.md", "Dune");
    const second = vault.createNoteFromTemplate("Templates/Book.md", "Dune");
    expect(second).toBe("Dune 2.md");
    expect(temp.read("Dune 2.md")).toBe("# Dune 2\n");
  });

  it("a missing template reports an error", () => {
    expect(vault.createNoteFromTemplate("Templates/Gone.md", "X")).toBeNull();
    expect(vault.errorMessage).toBe("Couldn’t read the template “Gone”.");
    expect(temp.exists("X.md")).toBe(false);
  });

  it("inserting a template sends its parts to the editor", () => {
    vault.open("Lore/Ilum.md");
    vault.insertTemplate("Templates/Meeting.md");
    const call = editor.calls.find((c) => c.method === "applyTemplate");
    expect(call?.args).toEqual(["type: meeting", "# Ilum\n\nAttendees: {{cursor}}\n"]);
  });

  it("inserting without an open note does nothing", () => {
    vault.insertTemplate("Templates/Meeting.md");
    expect(editor.calls.some((c) => c.method === "applyTemplate")).toBe(false);
  });
});
