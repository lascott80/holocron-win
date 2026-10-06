// Port of AutoTitleTests.swift (AutoTitleTests): naming new notes from their
// first line (FOP-05). The pure title rules are covered in tests/core.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, sleep, waitFor } from "./helpers";

let temp: TempVault;
let vault: Vault;

beforeEach(() => {
  temp = new TempVault();
  temp.write("Ilum.md", "# Ilum\n");
  // Long delays so only explicit applyAutoTitle calls rename (except where a test opts in).
  vault = temp.open({ autoTitleDelay: 60_000, saveDelay: 60_000 });
  vault.namesFromFirstLineOverride = true;
});

afterEach(async () => {
  await temp.cleanup();
});

const names = () => temp.names();

function type(text: string) {
  const path = vault.activeTab!.path!;
  vault.editorChanged(path, text);
  return vault.document!;
}

describe("Naming notes from their first line", () => {
  it("new notes take their first line as the name", () => {
    vault.createNote();
    const document = type("# Council of Ilum\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Council of Ilum.md", "Ilum.md"]);
    expect(vault.activeTab?.path).toBe("Council of Ilum.md");
    expect(vault.document).toBe(document);

    // Still following the first line while the note stays open.
    type("# Council of Ilum, day two\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Council of Ilum, day two.md", "Ilum.md"]);
    expect(temp.read("Council of Ilum, day two.md")).toBe("# Council of Ilum, day two\n");
  });

  it("clashing names are numbered", () => {
    vault.createNote();
    const document = type("# Ilum\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum 2.md", "Ilum.md"]);
  });

  it("a case-only change of its own name is allowed", () => {
    vault.createNote();
    const document = type("# council\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "council.md"]);
    type("# Council\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Council.md", "Ilum.md"]);
  });

  it("named notes are never renamed", () => {
    vault.open("Ilum.md");
    const document = type("# Something else entirely\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md"]);
  });

  it("leaving the note stops following", () => {
    vault.createNote();
    type("# First idea\n");
    vault.open("Ilum.md"); // switching away finishes the name
    expect(names()).toEqual(["First idea.md", "Ilum.md"]);
    expect(temp.read("First idea.md")).toBe("# First idea\n");

    vault.open("First idea.md");
    const reopened = type("# Changed my mind\n");
    vault.applyAutoTitle(reopened);
    expect(names()).toEqual(["First idea.md", "Ilum.md"]);
  });

  it("renaming by hand stops following", () => {
    const created = vault.createNote()!;
    const document = vault.document!;
    vault.rename(created, "My name");
    type("# Another title\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "My name.md"]);
  });

  it("names the note after typing pauses", async () => {
    const quick = temp.open({ autoTitleDelay: 10, saveDelay: 60_000 });
    quick.namesFromFirstLineOverride = true;
    const created = quick.createNote()!;
    quick.editorChanged(created, "# Typed");
    quick.editorChanged(created, "# Typed then paused\n");
    await waitFor(() => names().includes("Typed then paused.md"));
    expect(names()).toEqual(["Ilum.md", "Typed then paused.md"]);
    expect(quick.activeTab?.path).toBe("Typed then paused.md");
  });

  it("respects the setting", () => {
    vault.namesFromFirstLineOverride = false;
    vault.createNote();
    const document = type("# Should stay untitled\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "Untitled.md"]);
  });

  it("follows the app setting when not overridden", async () => {
    temp.settings.nameNotesFromFirstLine = false;
    const other = temp.open({ autoTitleDelay: 10 });
    const created = other.createNote()!;
    other.editorChanged(created, "# Stays untitled\n");
    await sleep(50);
    expect(names()).toEqual(["Ilum.md", "Untitled.md"]);
  });

  it("empty titles don't rename", () => {
    vault.createNote();
    const document = type("#\n   \n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "Untitled.md"]);
  });

  it("characters Windows forbids are removed from the name", () => {
    vault.createNote();
    const document = type("Q3: plan/review? <draft> | v2\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "Q3 planreview draft v2.md"]);
  });

  it("existing Untitled notes are named when opened and edited", () => {
    temp.write("Untitled 3.md", "");
    vault.reload();
    vault.open("Untitled 3.md");
    const document = type("# Picked up later\n");
    vault.applyAutoTitle(document);
    expect(names()).toEqual(["Ilum.md", "Picked up later.md"]);
  });
});
