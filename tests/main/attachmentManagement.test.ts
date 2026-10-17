// Attachment housekeeping: one folder per note (and moving it with the
// note), deleting a note's own attachments with it, Clean Up Unused
// Attachments… and Organise Attachments….

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, waitFor } from "./helpers";

let temp: TempVault;
let vault: Vault;
const png = new TextEncoder().encode("PNG");

beforeEach(async () => {
  temp = new TempVault();
  temp.write("Lore/Kyber.md", "# Kyber\n![[crystal.png]]\n![map](../Attachments/Lore/Kyber/map.png)\n");
  temp.write("Attachments/Lore/Kyber/crystal.png", "PNG");
  temp.write("Attachments/Lore/Kyber/map.png", "PNG");
  temp.write("Ilum.md", "![[logo.png]]\n");
  temp.write("Lore/Holocron.md", "![[logo.png]] ![[Attachments/Lore/Kyber/crystal.png]]\n");
  temp.write("Attachments/logo.png", "PNG");
  temp.write("Attachments/stray.png", "PNG");
  temp.write("Attachments/Old/forgotten.pdf", "PDF");
  vault = temp.open();
  await vault.indexingFinished();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("A folder for each note", () => {
  it("saves pasted and dropped files in the shown note's folder", () => {
    vault.open("Ilum.md");
    expect(vault.saveAttachment(png, "photo.png")).toBe("![[photo.png]]");
    expect(temp.exists("Attachments/Ilum/photo.png")).toBe(true);
  });

  it("uses the attachment folder itself with one folder, or with no note shown", () => {
    vault.saveAttachment(png, "loose.png");
    expect(temp.exists("Attachments/loose.png")).toBe(true);
    temp.settings.attachmentLayout = "single";
    vault.open("Ilum.md");
    vault.saveAttachment(png, "flat.png");
    expect(temp.exists("Attachments/flat.png")).toBe(true);
  });

  it("moves a note's folder when the note is renamed, keeping links, and Undo puts it back", () => {
    vault.rename("Lore/Kyber.md", "Kyber Crystals");
    expect(temp.exists("Attachments/Lore/Kyber Crystals/crystal.png")).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber")).toBe(false);
    expect(temp.read("Lore/Kyber Crystals.md")).toBe(
      "# Kyber\n![[crystal.png]]\n![map](../Attachments/Lore/Kyber%20Crystals/map.png)\n",
    );
    expect(temp.read("Lore/Holocron.md")).toBe("![[logo.png]] ![[crystal.png]]\n");

    vault.runToastAction();
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
    expect(temp.read("Lore/Kyber.md")).toContain("](../Attachments/Lore/Kyber/map.png)");
  });

  it("moves the folder when the note moves to another folder", () => {
    vault.move(["Lore/Kyber.md"], "");
    expect(temp.exists("Attachments/Kyber/map.png")).toBe(true);
    // Attachments/Lore is now empty and gone.
    expect(temp.exists("Attachments/Lore")).toBe(false);
    expect(temp.read("Kyber.md")).toContain("![map](Attachments/Kyber/map.png)");
  });

  it("moves a whole folder's attachments when the folder moves", () => {
    vault.rename("Lore", "Legends");
    expect(temp.exists("Attachments/Legends/Kyber/crystal.png")).toBe(true);
    expect(temp.read("Legends/Kyber.md")).toContain("](../Attachments/Legends/Kyber/map.png)");
  });

  it("leaves attachments alone with one folder", () => {
    temp.settings.attachmentLayout = "single";
    vault.rename("Lore/Kyber.md", "Kyber Crystals");
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
  });
});

describe("Deleting a note with its attachments", () => {
  it("offers only the files no other note uses", async () => {
    vault.requestDeletion(["Lore/Kyber.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    // crystal.png is also used by Holocron.md.
    expect(vault.pendingDeletionAttachments).toEqual(["Attachments/Lore/Kyber/map.png"]);
  });

  it("moves them to the Recycle Bin together, and Undo restores everything", async () => {
    vault.requestDeletion(["Ilum.md", "Lore/Holocron.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion(true);
    expect(temp.exists("Ilum.md")).toBe(false);
    expect(temp.exists("Attachments/logo.png")).toBe(false);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true); // Kyber still uses it
    expect(vault.toast?.message).toBe("Moved 2 items and 1 attachment to the Recycle Bin");

    vault.runToastAction();
    expect(temp.exists("Ilum.md")).toBe(true);
    expect(temp.exists("Attachments/logo.png")).toBe(true);
  });

  it("keeps the attachments when the box is unticked", async () => {
    vault.requestDeletion(["Ilum.md", "Lore/Holocron.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion(false);
    expect(temp.exists("Ilum.md")).toBe(false);
    expect(temp.exists("Attachments/logo.png")).toBe(true);
  });

  it("removes the note's folder once it's empty", async () => {
    temp.write("Solo.md", "![[only.png]]");
    temp.write("Attachments/Solo/only.png", "PNG");
    vault.reload(["Solo.md"]);
    vault.requestDeletion(["Solo.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion();
    expect(temp.exists("Attachments/Solo")).toBe(false);
    expect(temp.exists("Attachments")).toBe(true);
  });
});

describe("Clean Up Unused Attachments", () => {
  it("lists unused files in the attachment folder with their sizes", async () => {
    temp.write("Elsewhere/kept.png", "PNG"); // outside the attachment folder
    vault.reload();
    await vault.requestAttachmentCleanup();
    expect(vault.attachmentCleanup).toEqual([
      { path: "Attachments/Old/forgotten.pdf", size: 3, isImage: false },
      { path: "Attachments/stray.png", size: 3, isImage: true },
    ]);
    vault.cancelAttachmentCleanup();
    expect(vault.attachmentCleanup).toBeNull();
  });

  it("trashes only chosen files that were offered, and Undo restores them", async () => {
    await vault.requestAttachmentCleanup();
    await vault.confirmAttachmentCleanup(["Attachments/Old/forgotten.pdf", "Attachments/logo.png"]);
    expect(temp.exists("Attachments/Old")).toBe(false);
    expect(temp.exists("Attachments/logo.png")).toBe(true); // in use, never offered
    expect(temp.exists("Attachments/stray.png")).toBe(true); // not chosen
    expect(vault.toast?.message).toBe("Moved 1 unused attachment to the Recycle Bin");
    vault.runToastAction();
    expect(temp.exists("Attachments/Old/forgotten.pdf")).toBe(true);
  });

  it("says so when there's nothing to clean up", async () => {
    temp.remove("Attachments/stray.png");
    temp.remove("Attachments/Old");
    vault.reload();
    await vault.requestAttachmentCleanup();
    expect(vault.attachmentCleanup).toBeNull();
    expect(vault.toast?.message).toBe("No unused attachments");
  });
});

describe("Organise Attachments", () => {
  it("previews, sorts files into note and Shared folders, and Undo puts them back", async () => {
    temp.write("Ilum.md", "![[logo.png]] ![[Attachments/stray.png]]\n");
    vault.reload(["Ilum.md"]);
    await vault.requestAttachmentOrganise();
    expect(vault.attachmentOrganise).toEqual({
      moves: [
        { from: "Attachments/Lore/Kyber/crystal.png", to: "Attachments/Shared/crystal.png" },
        { from: "Attachments/logo.png", to: "Attachments/Shared/logo.png" },
        { from: "Attachments/stray.png", to: "Attachments/Ilum/stray.png" },
      ],
      notesChanged: 2,
    });

    await vault.confirmAttachmentOrganise();
    expect(temp.exists("Attachments/Shared/logo.png")).toBe(true);
    expect(temp.read("Ilum.md")).toBe("![[logo.png]] ![[stray.png]]\n");
    expect(temp.read("Lore/Holocron.md")).toBe("![[logo.png]] ![[crystal.png]]\n");
    expect(temp.exists("Attachments/Old/forgotten.pdf")).toBe(true); // unused: left for clean-up

    vault.runToastAction();
    expect(temp.exists("Attachments/logo.png")).toBe(true);
    expect(temp.exists("Attachments/Shared")).toBe(false);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
  });

  it("says so when everything is in place", async () => {
    temp.write("Lore/Holocron.md", "nothing here");
    temp.write("Ilum.md", "nothing here");
    vault.reload(["Lore/Holocron.md", "Ilum.md"]);
    await vault.requestAttachmentOrganise();
    expect(vault.attachmentOrganise).toBeNull();
    expect(vault.toast?.message).toBe("Attachments are already organised");
  });
});
