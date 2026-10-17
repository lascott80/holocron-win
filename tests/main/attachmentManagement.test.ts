// Attachment housekeeping: one folder per note (and moving it with the
// note), deleting a note's own attachments with it, Clean Up Unused
// Attachments… into a holding folder, Organise Attachments…, and the safety
// net under all of them: refusing when a note can't be read, checked and
// rolled-back moves, and a lasting log with Undo Last Attachment Change….

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, waitFor } from "./helpers";

let temp: TempVault;
let vault: Vault;
const png = new TextEncoder().encode("PNG");
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const unused = `Attachments/_Unused/${today}`;

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
  vi.restoreAllMocks();
  await temp.cleanup();
});

/** Makes `note` unreadable to the vault, like a cloud file that isn't downloaded. */
function makeUnreadable(note: string) {
  const textFor = (vault as unknown as { textFor(path: string): string | null }).textFor.bind(vault);
  vi.spyOn(vault as unknown as { textFor(path: string): string | null }, "textFor").mockImplementation((path) =>
    path === note ? null : textFor(path),
  );
}

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

  it("updates HTML links to the moved files too", () => {
    temp.write("Ilum.md", '<img src="Attachments/Lore/Kyber/map.png" width="300">\n');
    vault.reload(["Ilum.md"]);
    vault.rename("Lore/Kyber.md", "Kyber Crystals");
    expect(temp.read("Ilum.md")).toBe('<img src="Attachments/Lore/Kyber Crystals/map.png" width="300">\n');
  });

  it("moves the folder when the note moves to another folder", () => {
    vault.move(["Lore/Kyber.md"], "");
    expect(temp.exists("Attachments/Kyber/map.png")).toBe(true);
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

  it("leaves the folder (and says why) when another note mentions a file in a way it can't update", () => {
    temp.write("Ilum.md", "```\nAttachments/Lore/Kyber/map.png\n```\n");
    vault.reload(["Ilum.md"]);
    vault.rename("Lore/Kyber.md", "Kyber Crystals");
    expect(temp.exists("Lore/Kyber Crystals.md")).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber/map.png")).toBe(true);
    expect(vault.errorMessage).toContain("because “Ilum” mentions “map.png”");
  });

  it("leaves the folder when a note can't be read", () => {
    makeUnreadable("Ilum.md");
    vault.rename("Lore/Kyber.md", "Kyber Crystals");
    expect(temp.exists("Attachments/Lore/Kyber/map.png")).toBe(true);
    expect(vault.errorMessage).toContain("couldn’t read “Ilum”");
  });
});

describe("Deleting a note with its attachments", () => {
  it("offers only files no other note uses or mentions", async () => {
    vault.requestDeletion(["Lore/Kyber.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    // crystal.png is also used by Holocron.md.
    expect(vault.pendingDeletionAttachments).toEqual(["Attachments/Lore/Kyber/map.png"]);
  });

  it("offers nothing when a note can't be read", async () => {
    makeUnreadable("Ilum.md");
    vault.requestDeletion(["Lore/Kyber.md"]);
    await vault.indexingFinished();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vault.pendingDeletionAttachments).toEqual([]);
  });

  it("keeps the attachments unless asked", async () => {
    vault.requestDeletion(["Ilum.md", "Lore/Holocron.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion();
    expect(temp.exists("Ilum.md")).toBe(false);
    expect(temp.exists("Attachments/logo.png")).toBe(true);
  });

  it("moves them to the unused folder, and one Undo restores everything", async () => {
    vault.requestDeletion(["Ilum.md", "Lore/Holocron.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion(true);
    expect(temp.exists("Ilum.md")).toBe(false);
    expect(temp.exists(`${unused}/logo.png`)).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true); // Kyber still uses it
    expect(vault.toast?.message).toBe("Moved 2 items to the Recycle Bin and 1 attachment to Attachments/_Unused");

    vault.runToastAction();
    expect(temp.exists("Ilum.md")).toBe(true);
    expect(temp.exists("Attachments/logo.png")).toBe(true);
    expect(temp.exists("Attachments/_Unused")).toBe(false);
  });

  it("removes the note's folder once it's empty", async () => {
    temp.write("Solo.md", "![[only.png]]");
    temp.write("Attachments/Solo/only.png", "PNG");
    vault.reload(["Solo.md"]);
    vault.requestDeletion(["Solo.md"]);
    await waitFor(() => vault.pendingDeletionAttachments.length > 0);
    await vault.confirmDeletion(true);
    expect(temp.exists("Attachments/Solo")).toBe(false);
    expect(temp.exists(`${unused}/Solo/only.png`)).toBe(true);
  });
});

describe("Clean Up Unused Attachments", () => {
  it("lists unused files in the attachment folder, flagging ones a note mentions", async () => {
    temp.write("Elsewhere/kept.png", "PNG"); // outside the attachment folder
    temp.write("Ilum.md", "![[logo.png]]\n<!-- old: stray.png -->\n");
    vault.reload(["Ilum.md"]);
    await vault.requestAttachmentCleanup();
    expect(vault.attachmentCleanup).toEqual([
      { path: "Attachments/Old/forgotten.pdf", size: 3, isImage: false, mentionedIn: [] },
      { path: "Attachments/stray.png", size: 3, isImage: true, mentionedIn: ["Ilum.md"] },
    ]);
    vault.cancelAttachmentCleanup();
    expect(vault.attachmentCleanup).toBeNull();
  });

  it("counts HTML and property references as use", async () => {
    temp.write("Ilum.md", '---\ncover: stray.png\n---\n<object data="Attachments/Old/forgotten.pdf"></object>\n![[logo.png]]\n');
    vault.reload(["Ilum.md"]);
    await vault.requestAttachmentCleanup();
    expect(vault.attachmentCleanup).toBeNull();
    expect(vault.toast?.message).toBe("No unused attachments");
  });

  it("refuses when a note can't be read", async () => {
    makeUnreadable("Ilum.md");
    await vault.requestAttachmentCleanup();
    expect(vault.attachmentCleanup).toBeNull();
    expect(vault.errorMessage).toContain("couldn’t read “Ilum”");
  });

  it("moves only chosen, offered files to the unused folder, and Undo puts them back", async () => {
    await vault.requestAttachmentCleanup();
    await vault.confirmAttachmentCleanup(["Attachments/Old/forgotten.pdf", "Attachments/logo.png"]);
    expect(temp.exists(`${unused}/Old/forgotten.pdf`)).toBe(true);
    expect(temp.exists("Attachments/Old")).toBe(false);
    expect(temp.exists("Attachments/logo.png")).toBe(true); // in use, never offered
    expect(temp.exists("Attachments/stray.png")).toBe(true); // not chosen
    expect(vault.toast?.message).toBe("Moved 1 unused attachment to Attachments/_Unused");
    vault.runToastAction();
    expect(temp.exists("Attachments/Old/forgotten.pdf")).toBe(true);
    expect(temp.exists("Attachments/_Unused")).toBe(false);
  });

  it("Empty Unused Attachments… trashes the folder, keeping files notes use again", async () => {
    await vault.requestAttachmentCleanup();
    await vault.confirmAttachmentCleanup(["Attachments/Old/forgotten.pdf", "Attachments/stray.png"]);
    temp.write("Ilum.md", `![[logo.png]] ![[${unused}/stray.png]]`);
    vault.reload(["Ilum.md"]);
    await vault.requestEmptyUnused();
    expect(vault.pendingAttachmentAction?.view.message).toContain("Moves 1 file (3 B) to the Recycle Bin. 1 file that notes use again will stay.");
    await vault.confirmAttachmentAction();
    expect(temp.exists(`${unused}/Old/forgotten.pdf`)).toBe(false);
    expect(temp.exists(`${unused}/stray.png`)).toBe(true);
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
      skipped: [],
      notesChanged: 2,
      scope: null,
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

  it("makes only the chosen moves, and can be limited to one note", async () => {
    await vault.requestAttachmentOrganise("Ilum.md");
    expect(vault.attachmentOrganise?.moves).toEqual([{ from: "Attachments/logo.png", to: "Attachments/Shared/logo.png" }]);
    vault.cancelAttachmentOrganise();
    await vault.requestAttachmentOrganise();
    await vault.confirmAttachmentOrganise(["Attachments/logo.png"]);
    expect(temp.exists("Attachments/Shared/logo.png")).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
  });

  it("skips files a note mentions in a way it can't update", async () => {
    temp.write("Notes.md", "    indented code: logo.png\n");
    vault.reload(["Notes.md"]);
    await vault.requestAttachmentOrganise();
    expect(vault.attachmentOrganise?.skipped).toEqual([{ path: "Attachments/logo.png", notes: ["Notes.md"] }]);
    expect(vault.attachmentOrganise?.moves.map((move) => move.from)).not.toContain("Attachments/logo.png");
  });

  it("puts everything back when writing a note fails part-way", async () => {
    temp.write("Ilum.md", "![[Attachments/logo.png]]\n");
    vault.reload(["Ilum.md"]);
    await vault.requestAttachmentOrganise();
    expect(vault.attachmentOrganise?.notesChanged).toBe(2);
    const writer = vault as unknown as { writeUpdatedLinks(path: string, text: string): boolean };
    const write = writer.writeUpdatedLinks.bind(vault);
    let calls = 0;
    vi.spyOn(writer, "writeUpdatedLinks").mockImplementation((path, text) => (++calls === 2 ? false : write(path, text)));
    const before = temp.read("Lore/Holocron.md");
    await vault.confirmAttachmentOrganise();
    vi.restoreAllMocks();
    expect(vault.errorMessage).toContain("Nothing was moved");
    expect(temp.exists("Attachments/logo.png")).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
    expect(temp.exists("Attachments/Shared")).toBe(false);
    expect(temp.read("Lore/Holocron.md")).toBe(before);
    expect(temp.read("Ilum.md")).toBe("![[Attachments/logo.png]]\n");
  });

  it("puts everything back when the links don't check out afterwards", async () => {
    await vault.requestAttachmentOrganise();
    const reader = vault as unknown as { readAllNotes(): { texts: Map<string, string>; unreadable: string[] } };
    const read = reader.readAllNotes.bind(vault);
    let calls = 0;
    vi.spyOn(reader, "readAllNotes").mockImplementation(() => {
      const result = read();
      // The second read is the check on disk: pretend Holocron.md lost a link.
      if (++calls === 2) result.texts.set("Lore/Holocron.md", "![[logo.png]]\n");
      return result;
    });
    await vault.confirmAttachmentOrganise();
    vi.restoreAllMocks();
    expect(vault.errorMessage).toContain("The change was undone");
    expect(temp.exists("Attachments/logo.png")).toBe(true);
    expect(temp.read("Lore/Holocron.md")).toBe("![[logo.png]] ![[Attachments/Lore/Kyber/crystal.png]]\n");
  });

  it("refuses when a note can't be read", async () => {
    makeUnreadable("Lore/Holocron.md");
    await vault.requestAttachmentOrganise();
    expect(vault.attachmentOrganise).toBeNull();
    expect(vault.errorMessage).toContain("couldn’t read “Holocron”");
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

describe("Undo Last Attachment Change", () => {
  it("logs each change in the vault and undoes the latest one any time later", async () => {
    await vault.requestAttachmentOrganise();
    await vault.confirmAttachmentOrganise();
    vault.dismissToast();
    const log = JSON.parse(temp.read(".holocron/attachment-log.json"));
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ kind: "organise", summary: "Organised 2 attachments" });

    // A second vault session (e.g. after a restart) still has it.
    const later = temp.open();
    await later.indexingFinished();
    later.requestAttachmentUndo();
    expect(later.pendingAttachmentAction?.view.title).toBe("Undo Last Attachment Change?");
    await later.confirmAttachmentAction();
    expect(temp.exists("Attachments/logo.png")).toBe(true);
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(true);
    // Links are updated, not restored: the short name still reaches the file.
    expect(temp.read("Lore/Holocron.md")).toBe("![[logo.png]] ![[crystal.png]]\n");
    expect(JSON.parse(temp.read(".holocron/attachment-log.json")).entries[0].undone).toBe(true);

    later.requestAttachmentUndo();
    expect(later.pendingAttachmentAction).toBeNull();
    expect(later.toast?.message).toBe("No attachment changes to undo");
  });

  it("keeps edits made since, and refuses if a file has gone", async () => {
    await vault.requestAttachmentOrganise();
    await vault.confirmAttachmentOrganise();
    temp.write("Ilum.md", "Edited later. ![[logo.png]]\n");
    vault.reload(["Ilum.md"]);
    vault.requestAttachmentUndo();
    await vault.confirmAttachmentAction();
    expect(temp.read("Ilum.md")).toBe("Edited later. ![[logo.png]]\n");
    expect(temp.exists("Attachments/logo.png")).toBe(true);

    await vault.requestAttachmentOrganise();
    await vault.confirmAttachmentOrganise();
    temp.remove("Attachments/Shared/logo.png");
    vault.reload();
    vault.requestAttachmentUndo();
    await vault.confirmAttachmentAction();
    expect(vault.errorMessage).toContain("is no longer there");
    expect(temp.exists("Attachments/Lore/Kyber/crystal.png")).toBe(false); // nothing half-undone
  });
});
