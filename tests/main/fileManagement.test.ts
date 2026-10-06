// Port of FileManagementTests.swift: new notes and folders, rename, move,
// copy-in, duplicate and delete, with toasts and Undo restoring files and
// links. Plus Windows specifics (forbidden names, case-only renames, CRLF).

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrash } from "../../src/main/fsx";
import type { Vault } from "../../src/main/vault";
import { TempVault, allFiles, makeTempDir, removeDir, waitFor } from "./helpers";

let temp: TempVault;
let vault: Vault;

beforeEach(() => {
  temp = new TempVault();
  temp.write("Lore/Crystals/Kyber.md", "# Kyber\nSee [[Ilum]] and [the log](Crystal%20Log.md).\n");
  temp.write("Lore/Crystals/Crystal Log.md", "# Log\n");
  temp.write("Lore/Crystals/Ilum.md", "# Ilum\nBack to [[Kyber#Attunement|kyber notes]].\n");
  temp.write("Orders/Saber.md", "Needs [[Kyber]], [[Lore/Crystals/Kyber]] and [crystal](../Lore/Crystals/Kyber.md).\n");
  temp.write("Daily/Today.md", "`[[Kyber]]` in code stays. Plain [[Kyber]] changes.\n");
  vault = temp.open();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Renaming and moving", () => {
  it("renaming a note updates links everywhere", async () => {
    await vault.indexingFinished();
    expect(vault.rename("Lore/Crystals/Kyber.md", "Kyber Crystals")).toBe("Lore/Crystals/Kyber Crystals.md");

    expect(temp.exists("Lore/Crystals/Kyber Crystals.md")).toBe(true);
    expect(temp.exists("Lore/Crystals/Kyber.md")).toBe(false);
    expect(temp.read("Lore/Crystals/Ilum.md")).toBe("# Ilum\nBack to [[Kyber Crystals#Attunement|kyber notes]].\n");
    expect(temp.read("Orders/Saber.md")).toBe(
      "Needs [[Kyber Crystals]], [[Lore/Crystals/Kyber Crystals]] and [crystal](../Lore/Crystals/Kyber%20Crystals.md).\n",
    );
    expect(temp.read("Daily/Today.md")).toBe("`[[Kyber]]` in code stays. Plain [[Kyber Crystals]] changes.\n");
  });

  it("renaming works before the index is ready", () => {
    vault.rename("Lore/Crystals/Kyber.md", "Kyber Crystals");
    expect(temp.read("Orders/Saber.md")).toContain("[[Kyber Crystals]]");
  });

  it("moving a note keeps name links and fixes path links", async () => {
    await vault.indexingFinished();
    vault.move(["Lore/Crystals/Kyber.md"], "Orders");

    expect(temp.exists("Orders/Kyber.md")).toBe(true);
    // Name-based links still resolve, so they're left as they were.
    expect(temp.read("Lore/Crystals/Ilum.md")).toContain("[[Kyber#Attunement|kyber notes]]");
    expect(temp.read("Orders/Saber.md")).toBe("Needs [[Kyber]], [[Orders/Kyber]] and [crystal](Kyber.md).\n");
    // The moved note's own relative markdown link is fixed too.
    expect(temp.read("Orders/Kyber.md")).toBe("# Kyber\nSee [[Ilum]] and [the log](../Lore/Crystals/Crystal%20Log.md).\n");
  });

  it("renaming a folder moves its notes and fixes path links", async () => {
    await vault.indexingFinished();
    expect(vault.rename("Lore/Crystals", "Kyber Crystals")).toBe("Lore/Kyber Crystals");

    expect(temp.exists("Lore/Kyber Crystals/Kyber.md")).toBe(true);
    expect(temp.read("Orders/Saber.md")).toBe(
      "Needs [[Kyber]], [[Lore/Kyber Crystals/Kyber]] and [crystal](../Lore/Kyber%20Crystals/Kyber.md).\n",
    );
  });

  it("folder names keep any dot in them", () => {
    expect(vault.rename("Lore/Crystals", "v1.2")).toBe("Lore/v1.2");
    expect(temp.exists("Lore/v1.2/Kyber.md")).toBe(true);
  });

  it("renaming without updating links leaves notes alone", async () => {
    await vault.indexingFinished();
    vault.updatesLinksOverride = false;
    vault.rename("Lore/Crystals/Kyber.md", "Renamed");
    expect(temp.read("Orders/Saber.md")).toContain("[[Kyber]]");
  });

  it("the setting turns link updates off too", async () => {
    temp.settings.updateLinksOnMove = false;
    await vault.indexingFinished();
    vault.rename("Lore/Crystals/Kyber.md", "Renamed");
    expect(temp.read("Orders/Saber.md")).toContain("[[Kyber]]");
  });

  it("open notes follow their file", async () => {
    await vault.indexingFinished();
    vault.open("Lore/Crystals/Kyber.md");
    vault.open("Lore/Crystals/Ilum.md", true);
    vault.activateTab(vault.tabs[0].id);
    vault.editorChanged("Lore/Crystals/Kyber.md", vault.document!.text + "Unsaved edit.\n");

    vault.rename("Lore/Crystals/Kyber.md", "Kyber Crystals");

    const renamed = "Lore/Crystals/Kyber Crystals.md";
    expect(vault.document?.file).toBe(temp.abs(renamed));
    expect(vault.documents.has(renamed)).toBe(true);
    expect(vault.documents.has("Lore/Crystals/Kyber.md")).toBe(false);
    expect(vault.tabs[0].path).toBe(renamed);
    expect(vault.selection).toBe(renamed);
    expect(vault.recentNotes).toContain(renamed);
    expect(temp.read(renamed).endsWith("Unsaved edit.\n")).toBe(true);
    // The other open note's link was rewritten in place (and saved).
    expect(vault.documents.get("Lore/Crystals/Ilum.md")?.text).toContain("[[Kyber Crystals#Attunement");
    expect(temp.read("Lore/Crystals/Ilum.md")).toContain("[[Kyber Crystals#Attunement");
    // Editing the renamed note still saves to the new file.
    vault.editorChanged(renamed, vault.document!.text + "After.\n");
    vault.saveAll();
    expect(temp.read(renamed).endsWith("After.\n")).toBe(true);
    expect(temp.exists("Lore/Crystals/Kyber.md")).toBe(false);
  });

  it("case-only renames work on a case-insensitive file system", async () => {
    await vault.indexingFinished();
    expect(vault.rename("Orders/Saber.md", "saber")).toBe("Orders/saber.md");
    expect(temp.names("Orders")).toEqual(["saber.md"]);
    expect(vault.allNotes).toContain("Orders/saber.md");
    expect(vault.toast?.message).toBe("Renamed “Saber” to “saber”");
  });

  it("case-only renames of open notes (kyber.md → Kyber.md) keep the tab and links", async () => {
    temp.write("kyber.md", "# kyber\n");
    temp.write("Links.md", "[[kyber]] and [k](kyber.md)\n");
    vault.reload();
    await vault.indexingFinished();
    vault.open("kyber.md");
    vault.editorChanged("kyber.md", "# kyber\nedited\n");

    vault.rename("kyber.md", "Kyber");
    expect(temp.names().filter((name) => name.toLowerCase() === "kyber.md")).toEqual(["Kyber.md"]);
    expect(vault.activeTab?.path).toBe("Kyber.md");
    expect(vault.document?.text).toBe("# kyber\nedited\n");
    expect(temp.read("Kyber.md")).toBe("# kyber\nedited\n");
    expect(temp.read("Links.md")).toBe("[[Kyber]] and [k](Kyber.md)\n");
    expect(temp.names().filter((name) => name.startsWith("."))).toEqual([]);

    vault.runToastAction(); // Undo
    expect(temp.names().filter((name) => name.toLowerCase() === "kyber.md")).toEqual(["kyber.md"]);
    expect(temp.read("Links.md")).toBe("[[kyber]] and [k](kyber.md)\n");
  });

  it("case-only folder renames", () => {
    vault.rename("Orders", "orders");
    expect(temp.names()).toContain("orders");
    expect(temp.exists("orders/Saber.md")).toBe(true);
  });

  it("rename rejects bad names and collisions", () => {
    expect(() => vault.rename("Orders/Saber.md", "a/b")).toThrow("Names can’t be empty");
    expect(() => vault.rename("Orders/Saber.md", ".hidden")).toThrow("Names can’t be empty");
    expect(() => vault.rename("Orders/Saber.md", "  ")).toThrow("Names can’t be empty");
    expect(() => vault.rename("Orders/Saber.md", "a:b")).toThrow("Names can’t be empty");
    expect(() => vault.rename("Orders/Saber.md", "a\\b")).toThrow("Names can’t be empty");
    expect(() => vault.rename("Lore/Crystals/Ilum.md", "Kyber")).toThrow("There’s already an item named “Kyber.md” there.");
    expect(temp.read("Lore/Crystals/Ilum.md")).toBe("# Ilum\nBack to [[Kyber#Attunement|kyber notes]].\n");
  });

  it("rename rejects names Windows forbids", () => {
    for (const name of ["a<b", "a>b", 'say "hi"', "a|b", "what?", "star*", "trailing.", "CON", "prn", "aux.md", "NUL.txt", "COM1", "lpt9"]) {
      expect(() => vault.rename("Orders/Saber.md", name), name).toThrow();
    }
    expect(temp.names("Orders")).toEqual(["Saber.md"]);
    // Names that merely contain a device name are fine.
    expect(vault.rename("Orders/Saber.md", "Console")).toBe("Orders/Console.md");
  });

  it("rename keeps the extension unless the new name has one", () => {
    expect(vault.rename("Orders/Saber.md", "Lightsaber")).toBe("Orders/Lightsaber.md");
    expect(vault.rename("Orders/Lightsaber.md", "Blade.markdown")).toBe("Orders/Blade.markdown");
    expect(vault.rename("Orders/Blade.markdown", "Saber v2.0")).toBe("Orders/Saber v2.0.markdown");
  });

  it("an unchanged name shows no toast", () => {
    expect(vault.rename("Orders/Saber.md", " Saber ")).toBe("Orders/Saber.md");
    expect(vault.toast).toBeNull();
  });

  it("commitRename reports errors as an alert", () => {
    vault.startRenaming("Orders/Saber.md");
    expect(vault.renaming).toBe("Orders/Saber.md");
    vault.commitRename("Orders/Saber.md", "a/b");
    expect(vault.renaming).toBeNull();
    expect(vault.errorMessage).toBe("Couldn’t rename “Saber.md”: Names can’t be empty, start with a dot, or contain “/” or “:”.");
  });

  it("folders can't move into themselves", () => {
    vault.move(["Lore"], "Lore/Crystals");
    expect(vault.errorMessage).toBe("Couldn’t move “Lore”: A folder can’t be moved into itself.");
    expect(temp.exists("Lore/Crystals/Kyber.md")).toBe(true);
    expect(vault.toast).toBeNull();
  });

  it("items already in the target folder are skipped", () => {
    vault.move(["Orders/Saber.md"], "Orders");
    expect(vault.toast).toBeNull();
    expect(vault.errorMessage).toBeNull();
  });

  it("moving onto an existing name is an error", () => {
    temp.write("Orders/Ilum.md", "other");
    vault.reload();
    vault.move(["Lore/Crystals/Ilum.md"], "Orders");
    expect(vault.errorMessage).toBe("Couldn’t move “Ilum.md”: There’s already an item named “Ilum.md” there.");
    expect(temp.read("Orders/Ilum.md")).toBe("other");
  });

  it("files from outside are copied in", () => {
    const outside = temp.outside();
    const external = path.join(outside, "Holonet.md");
    fs.writeFileSync(external, "# Holonet\n");
    vault.move([external], "Orders");
    expect(temp.read("Orders/Holonet.md")).toBe("# Holonet\n");
    expect(fs.existsSync(external)).toBe(true);
    expect(vault.toast?.message).toBe("Copied “Holonet” into Orders");
    expect(vault.allNotes).toContain("Orders/Holonet.md");
  });

  it("copies from outside get unique names, and folders copy whole", () => {
    const outside = temp.outside();
    fs.writeFileSync(path.join(outside, "Saber.md"), "outside saber");
    fs.mkdirSync(path.join(outside, "Pack"));
    fs.writeFileSync(path.join(outside, "Pack", "One.md"), "one");
    vault.move([path.join(outside, "Saber.md"), path.join(outside, "Pack")], "Orders");
    expect(temp.read("Orders/Saber.md")).toContain("Needs");
    expect(temp.read("Orders/Saber 2.md")).toBe("outside saber");
    expect(temp.read("Orders/Pack/One.md")).toBe("one");
    expect(vault.toast?.message).toBe("Copied 2 items into Orders");
  });

  it("undoing a copy-in trashes the copies silently", async () => {
    const outside = temp.outside();
    const external = path.join(outside, "Holonet.md");
    fs.writeFileSync(external, "# Holonet\n");
    vault.move([external], "Orders");
    vault.runToastAction();
    await waitFor(() => !temp.exists("Orders/Holonet.md"));
    await waitFor(() => !vault.allNotes.includes("Orders/Holonet.md"));
    expect(vault.toast).toBeNull();
    expect(fs.existsSync(external)).toBe(true);
  });

  it("a mixed batch only announces the moves", () => {
    const outside = temp.outside();
    const external = path.join(outside, "Holonet.md");
    fs.writeFileSync(external, "# Holonet\n");
    vault.move([external, "Daily/Today.md"], "Orders");
    expect(temp.exists("Orders/Holonet.md")).toBe(true);
    expect(temp.exists("Orders/Today.md")).toBe(true);
    expect(vault.toast?.message).toBe("Moved “Today” to Orders");
  });

  it("absolute paths inside the vault are moved, not copied", () => {
    vault.move([temp.abs("Daily/Today.md")], "Orders");
    expect(temp.exists("Orders/Today.md")).toBe(true);
    expect(temp.exists("Daily/Today.md")).toBe(false);
    expect(vault.toast?.message).toBe("Moved “Today” to Orders");
  });

  it("moving to the vault root and moving several items", () => {
    vault.move(["Daily/Today.md"], "");
    expect(temp.exists("Today.md")).toBe(true);
    expect(vault.toast?.message).toBe("Moved “Today” to the top of the vault");

    vault.move(["Today.md", "Orders/Saber.md", "Lore/Crystals"], "Daily");
    expect(vault.toast?.message).toBe("Moved 3 items to Daily");
    expect(temp.exists("Daily/Crystals/Kyber.md")).toBe(true);
  });

  it("toasts name attachments with their extension", () => {
    temp.write("Lore/map.png", "PNG");
    vault.reload();
    vault.move(["Lore/map.png"], "Orders");
    expect(vault.toast?.message).toBe("Moved “map.png” to Orders");
  });
});

describe("New notes and folders", () => {
  it("new notes are numbered in the selected folder", () => {
    temp.write("Lore/Untitled.md");
    vault.reload();
    vault.select("Lore");
    const created = vault.createNote();
    expect(created).toBe("Lore/Untitled 2.md");
    expect(vault.activeTab?.path).toBe(created);
    expect(vault.createNote()).toBe("Lore/Untitled 3.md");
  });

  it("new notes go beside the selected note, else at the root", () => {
    expect(vault.createNote()).toBe("Untitled.md");
    vault.select("Orders/Saber.md");
    expect(vault.createNote()).toBe("Orders/Untitled.md");
  });

  it("new folders are numbered and renamable", () => {
    const first = vault.createFolder("Orders");
    const second = vault.createFolder("Orders");
    expect(first).toBe("Orders/Untitled Folder");
    expect(second).toBe("Orders/Untitled Folder 2");
    expect(vault.renaming).toBe(second);
    expect(fs.statSync(temp.abs(second!)).isDirectory()).toBe(true);
  });

  it("new folders go into the selected folder", () => {
    vault.select("Lore");
    expect(vault.createFolder()).toBe("Lore/Untitled Folder");
  });

  it("Quick Open's Create note respects the selected folder (§19 #10)", () => {
    vault.select("Lore");
    vault.createNoteNamed("Hoth: base");
    expect(temp.exists("Lore/Hoth- base.md")).toBe(true);
    expect(vault.activeTab?.path).toBe("Lore/Hoth- base.md");

    // A name with a path is taken as written, from the vault root.
    vault.select("Lore");
    vault.createNoteNamed("Planets/Dagobah");
    expect(temp.exists("Planets/Dagobah.md")).toBe(true);
    expect(temp.exists("Lore/Planets/Dagobah.md")).toBe(false);

    // Beside the selected note when a note is selected; nothing for blank names.
    vault.select("Orders/Saber.md");
    vault.createNoteNamed("Hilt");
    expect(temp.exists("Orders/Hilt.md")).toBe(true);
    const before = allFiles(temp.root).length;
    vault.createNoteNamed("   ");
    expect(allFiles(temp.root).length).toBe(before);
  });

  it("Create note opens an existing note of that name instead", () => {
    vault.createNoteNamed("Saber");
    expect(vault.activeTab?.path).toBe("Orders/Saber.md");
    expect(temp.exists("Saber.md")).toBe(false);
  });
});

describe("Duplicate and delete", () => {
  it("duplicate opens the copy", () => {
    const copy = vault.duplicate("Orders/Saber.md");
    expect(copy).toBe("Orders/Saber copy.md");
    expect(temp.read("Orders/Saber copy.md")).toBe(temp.read("Orders/Saber.md"));
    expect(vault.activeTab?.path).toBe(copy);
    expect(vault.document?.file).toBe(temp.abs(copy!));
    expect(vault.duplicate("Orders/Saber.md")).toBe("Orders/Saber copy 2.md");
  });

  it("duplicate saves unsaved edits first", () => {
    vault.open("Orders/Saber.md");
    vault.editorChanged("Orders/Saber.md", "edited\n");
    vault.duplicate("Orders/Saber.md");
    expect(temp.read("Orders/Saber copy.md")).toBe("edited\n");
  });

  it("deleting closes tabs without resurrecting files", async () => {
    vault.open("Lore/Crystals/Kyber.md");
    vault.open("Lore/Crystals/Ilum.md", true);
    vault.editorChanged("Lore/Crystals/Ilum.md", vault.document!.text + "Edit that goes with it.\n");

    vault.requestDeletion(["Lore/Crystals"]);
    expect(vault.pendingDeletion).toEqual(["Lore/Crystals"]);
    await vault.confirmDeletion();

    expect(vault.pendingDeletion).toBeNull();
    expect(temp.exists("Lore/Crystals")).toBe(false);
    expect(vault.tabs).toEqual([]);
    expect(vault.documents.size).toBe(0);
    expect(vault.noteCount).toBe(2);
    expect(vault.selection).toBeNull();
    expect(vault.errorMessage).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 40)); // past any autosave
    expect(temp.exists("Lore/Crystals")).toBe(false);
    // The trashed copy doesn't have the unsaved edit either.
    const trashedIlum = allFiles(temp.trashDir).find((name) => name.endsWith("Crystals/Ilum.md"))!;
    expect(fs.readFileSync(path.join(temp.trashDir, trashedIlum), "utf8")).not.toContain("Edit that goes with it.");
  });

  it("deleting a folder whose notes fill several tabs reports no errors", async () => {
    vault.open("Orders/Saber.md");
    vault.open("Lore/Crystals/Ilum.md", true);
    vault.open("Lore/Crystals/Kyber.md", true);
    vault.activateTab(vault.tabs[1].id); // Ilum, with Kyber to its right
    await vault.delete(["Lore/Crystals"]);
    expect(vault.errorMessage).toBeNull();
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Orders/Saber.md"]);
    expect(vault.activeTab?.path).toBe("Orders/Saber.md");
  });

  it("requestDeletion ignores the root and missing items", () => {
    vault.requestDeletion(["", "Nope.md"]);
    expect(vault.pendingDeletion).toBeNull();
    vault.requestDeletion(["Orders/Saber.md"]);
    vault.cancelDeletion();
    expect(vault.pendingDeletion).toBeNull();
    expect(temp.exists("Orders/Saber.md")).toBe(true);
  });

  it("a failing trash shows an error and keeps the file", async () => {
    const failing = temp.open({
      trash: async () => {
        throw new Error("Access is denied.");
      },
    });
    await failing.delete(["Orders/Saber.md"]);
    expect(failing.errorMessage).toBe("Couldn’t move “Saber.md” to the Recycle Bin: Access is denied.");
    expect(temp.exists("Orders/Saber.md")).toBe(true);
    expect(failing.toast).toBeNull();
  });

  it("no Undo when the Recycle Bin can't say where the item went", async () => {
    const unknown = temp.open({
      trash: async (file) => {
        fs.rmSync(file, { recursive: true });
        return null;
      },
    });
    await unknown.delete(["Orders/Saber.md"]);
    expect(unknown.toast?.message).toBe("Moved “Saber” to the Recycle Bin");
    expect(unknown.toast?.actionTitle).toBeNull();
  });
});

describe("Toasts and Undo", () => {
  it("moving offers Undo that restores links", async () => {
    await vault.indexingFinished();
    const saber = temp.read("Orders/Saber.md");
    const kyber = temp.read("Lore/Crystals/Kyber.md");
    vault.move(["Lore/Crystals/Kyber.md"], "Orders");
    expect(vault.toast?.message).toBe("Moved “Kyber” to Orders");
    expect(vault.toast?.actionTitle).toBe("Undo");

    vault.runToastAction();
    expect(temp.exists("Lore/Crystals/Kyber.md")).toBe(true);
    expect(temp.exists("Orders/Kyber.md")).toBe(false);
    expect(temp.read("Orders/Saber.md")).toBe(saber);
    expect(temp.read("Lore/Crystals/Kyber.md")).toBe(kyber);
    expect(vault.toast).toBeNull();
  });

  it("undoing a move after the index caught up restores links too", async () => {
    await vault.indexingFinished();
    const saber = temp.read("Orders/Saber.md");
    vault.move(["Lore/Crystals/Kyber.md"], "Orders");
    await vault.indexingFinished();
    vault.runToastAction();
    expect(temp.read("Orders/Saber.md")).toBe(saber);
  });

  it("renaming offers Undo", async () => {
    await vault.indexingFinished();
    const saber = temp.read("Orders/Saber.md");
    vault.rename("Lore/Crystals/Kyber.md", "Lightsaber Crystal");
    expect(vault.toast?.message).toBe("Renamed “Kyber” to “Lightsaber Crystal”");
    vault.runToastAction();
    expect(temp.exists("Lore/Crystals/Kyber.md")).toBe(true);
    expect(temp.exists("Lore/Crystals/Lightsaber Crystal.md")).toBe(false);
    expect(temp.read("Orders/Saber.md")).toBe(saber);
  });

  it("renaming a folder offers Undo that restores open tabs", async () => {
    await vault.indexingFinished();
    vault.open("Lore/Crystals/Kyber.md");
    vault.rename("Lore/Crystals", "Gems");
    expect(vault.toast?.message).toBe("Renamed “Crystals” to “Gems”");
    expect(vault.activeTab?.path).toBe("Lore/Gems/Kyber.md");
    vault.runToastAction();
    expect(vault.activeTab?.path).toBe("Lore/Crystals/Kyber.md");
    expect(temp.read("Orders/Saber.md")).toContain("[[Lore/Crystals/Kyber]]");
  });

  it("trashing offers Undo", async () => {
    const text = temp.read("Lore/Crystals/Ilum.md");
    vault.requestDeletion(["Lore/Crystals/Ilum.md"]);
    await vault.confirmDeletion();
    expect(vault.toast?.message).toBe("Moved “Ilum” to the Recycle Bin");
    expect(vault.toast?.actionTitle).toBe("Undo");
    expect(temp.exists("Lore/Crystals/Ilum.md")).toBe(false);
    expect(vault.allNotes).not.toContain("Lore/Crystals/Ilum.md");

    vault.runToastAction();
    expect(temp.read("Lore/Crystals/Ilum.md")).toBe(text);
    expect(vault.allNotes).toContain("Lore/Crystals/Ilum.md");
  });

  it("trashing several items, then Undo recreates parent folders", async () => {
    await vault.delete(["Daily", "Orders/Saber.md"]);
    expect(vault.toast?.message).toBe("Moved 2 items to the Recycle Bin");
    expect(temp.exists("Daily")).toBe(false);
    vault.runToastAction();
    expect(temp.exists("Daily/Today.md")).toBe(true);
    expect(temp.exists("Orders/Saber.md")).toBe(true);
  });

  it("undoing a duplicate removes the copy", async () => {
    const copy = vault.duplicate("Orders/Saber.md")!;
    expect(vault.toast?.message).toBe("Duplicated “Saber”");
    vault.runToastAction();
    await waitFor(() => !temp.exists(copy));
    expect(vault.toast).toBeNull(); // undoing doesn't announce a second trash
    expect(vault.tabs.some((tab) => tab.path === copy)).toBe(false);
  });

  it("toasts expire", async () => {
    vault.showToast("Hello", null);
    expect(vault.toast?.message).toBe("Hello");
    vault.dismissToast();
    expect(vault.toast).toBeNull();
  });
});

describe("Windows file details", () => {
  it("rewriting links keeps CRLF line endings, and untouched notes stay byte-identical", async () => {
    const saber = "Needs [[Kyber]]\r\nand [crystal](../Lore/Crystals/Kyber.md).\r\n";
    const other = "No links here.\r\nOr [[Ilum]].\r\n";
    temp.write("Orders/Saber.md", saber);
    temp.write("Orders/Other.md", other);
    vault.handleDiskChanges(["Orders/Saber.md", "Orders/Other.md"]);
    await vault.indexingFinished();
    const otherBefore = fs.statSync(temp.abs("Orders/Other.md")).mtimeMs;

    vault.rename("Lore/Crystals/Kyber.md", "Kyber Crystals");
    expect(fs.readFileSync(temp.abs("Orders/Saber.md")).equals(
      Buffer.from("Needs [[Kyber Crystals]]\r\nand [crystal](../Lore/Crystals/Kyber%20Crystals.md).\r\n"),
    )).toBe(true);
    expect(fs.readFileSync(temp.abs("Orders/Other.md")).equals(Buffer.from(other))).toBe(true);
    expect(fs.statSync(temp.abs("Orders/Other.md")).mtimeMs).toBe(otherBefore);
  });

  it("an open CRLF note that isn't edited is never rewritten", async () => {
    const text = "# Title\r\nBody\r\n";
    temp.write("Crlf.md", text);
    vault.reload();
    const before = fs.statSync(temp.abs("Crlf.md")).mtimeMs;
    vault.open("Crlf.md");
    vault.open("Orders/Saber.md");
    vault.close();
    expect(fs.readFileSync(temp.abs("Crlf.md")).equals(Buffer.from(text))).toBe(true);
    expect(fs.statSync(temp.abs("Crlf.md")).mtimeMs).toBe(before);
  });

  it("file operations leave no temporary files behind", async () => {
    await vault.indexingFinished();
    vault.open("Orders/Saber.md");
    vault.editorChanged("Orders/Saber.md", "edited\n");
    vault.saveAll();
    vault.rename("Lore/Crystals/Kyber.md", "Kyber Crystals");
    vault.rename("Orders/Saber.md", "saber");
    vault.duplicate("Orders/saber.md");
    vault.createNote();
    const leftovers = allFiles(temp.root).filter((name) => name.includes("holocron-tmp") || name.includes(".holocron-rename"));
    expect(leftovers).toEqual([]);
  });
});

describe("createTrash (Recycle Bin with Undo staging)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => removeDir(dir));

  it("stages a copy, trashes the item, and restores it on Undo", async () => {
    const binned: string[] = [];
    const trash = createTrash(path.join(dir, "staging"), async (file) => {
      binned.push(file);
      fs.rmSync(file, { recursive: true });
    });
    const folder = path.join(dir, "Vault", "Lore");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "Ilum.md"), "# Ilum\n");

    const restore = await trash.trash(folder);
    expect(binned).toEqual([folder]);
    expect(fs.existsSync(folder)).toBe(false);
    expect(restore).not.toBeNull();
    restore!();
    expect(fs.readFileSync(path.join(folder, "Ilum.md"), "utf8")).toBe("# Ilum\n");
    // The staging copy is gone once restored.
    expect(allFiles(path.join(dir, "staging"))).toEqual([]);
  });

  it("restoring recreates missing parent folders and refuses to overwrite", async () => {
    const trash = createTrash(path.join(dir, "staging"), async (file) => fs.rmSync(file, { recursive: true }));
    const file = path.join(dir, "Vault", "Deep", "Note.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "first");
    const restore = (await trash.trash(file))!;
    fs.rmSync(path.join(dir, "Vault", "Deep"), { recursive: true });
    restore();
    expect(fs.readFileSync(file, "utf8")).toBe("first");

    const restoreAgain = (await trash.trash(file))!;
    fs.writeFileSync(file, "replacement");
    expect(() => restoreAgain()).toThrow("already exists");
    expect(fs.readFileSync(file, "utf8")).toBe("replacement");
  });

  it("removes the staged copy when trashing fails", async () => {
    const staging = path.join(dir, "staging");
    const trash = createTrash(staging, async () => {
      throw new Error("Recycle Bin unavailable");
    });
    const file = path.join(dir, "Note.md");
    fs.writeFileSync(file, "x");
    await expect(trash.trash(file)).rejects.toThrow("Recycle Bin unavailable");
    expect(fs.existsSync(file)).toBe(true);
    expect(allFiles(staging)).toEqual([]);
  });

  it("clears stale staged copies from earlier sessions", () => {
    const staging = path.join(dir, "staging");
    fs.mkdirSync(path.join(staging, "old"), { recursive: true });
    fs.writeFileSync(path.join(staging, "old", "Stale.md"), "x");
    createTrash(staging, async () => {});
    expect(fs.existsSync(staging)).toBe(false);
  });

  it("works as the vault's trash", async () => {
    const trash = createTrash(path.join(dir, "staging"), async (file) => fs.rmSync(file, { recursive: true }));
    const other = temp.open({ trash: (file) => trash.trash(file) });
    await other.delete(["Orders/Saber.md"]);
    expect(temp.exists("Orders/Saber.md")).toBe(false);
    expect(other.toast?.actionTitle).toBe("Undo");
    other.runToastAction();
    expect(temp.read("Orders/Saber.md")).toContain("Needs [[Kyber]]");
  });
});
