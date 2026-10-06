// Port of SyncTests.swift (VaultWatcherTests), driven through
// `vault.handleDiskChanges` instead of a real watcher, plus the missing-file
// banner (REQUIREMENTS §14.2, §19 bug #1).

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, recordingEditor, sleep, waitFor } from "./helpers";

let temp: TempVault;

beforeEach(() => {
  temp = new TempVault();
});

afterEach(async () => {
  await temp.cleanup();
});

function changeOnDisk(vaultPath: string, text: string) {
  const file = temp.abs(vaultPath);
  fs.writeFileSync(file + ".tmp", text);
  fs.renameSync(file + ".tmp", file);
}

describe("Vault and outside changes", () => {
  it("picks up changes from other apps", async () => {
    temp.write("Kyber.md", "Original\n");
    const editor = recordingEditor();
    const vault = temp.open({ editor });
    vault.select("Kyber.md");
    expect(vault.document?.text).toBe("Original\n");

    changeOnDisk("Kyber.md", "From another device\n");
    temp.write("New Note.md", "");
    vault.handleDiskChanges(["Kyber.md", "New Note.md"]);

    expect(vault.document?.text).toBe("From another device\n");
    expect(vault.noteCount).toBe(2);
    expect(vault.allNotes).toEqual(["Kyber.md", "New Note.md"]);
    // The editor got the change as an external edit.
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[2] === "From another device\n")).toBe(true);
    await vault.indexingFinished();
    expect(vault.index.hasPath("New Note.md")).toBe(true);
  });

  it("a change to a parent folder or the root reconciles notes inside it", () => {
    temp.write("Lore/Kyber.md", "Original\n");
    const vault = temp.open();
    vault.open("Lore/Kyber.md");
    changeOnDisk("Lore/Kyber.md", "Changed\n");
    vault.handleDiskChanges(["Lore"]);
    expect(vault.document?.text).toBe("Changed\n");

    changeOnDisk("Lore/Kyber.md", "Changed again\n");
    vault.handleDiskChanges([""]);
    expect(vault.document?.text).toBe("Changed again\n");
  });

  it("unrelated changes leave open notes alone", () => {
    temp.write("Kyber.md", "Original\n");
    temp.write("Other.md", "x");
    const vault = temp.open();
    vault.open("Kyber.md");
    changeOnDisk("Kyber.md", "Changed\n");
    vault.handleDiskChanges(["Other.md"]);
    expect(vault.document?.text).toBe("Original\n");
  });

  it("closes notes deleted elsewhere after the grace period", async () => {
    temp.write("Doomed.md", "Bye\n");
    const vault = temp.open();
    vault.select("Doomed.md");
    expect(vault.document).not.toBeNull();

    temp.remove("Doomed.md");
    vault.handleDiskChanges(["Doomed.md"]);
    expect(vault.noteCount).toBe(0);
    expect(vault.document?.isMissingOnDisk).toBe(true); // still open during the grace period

    await waitFor(() => vault.document === null);
    expect(vault.tabs).toEqual([]);
    expect(vault.documents.size).toBe(0);
    expect(temp.exists("Doomed.md")).toBe(false); // closing didn't write it back
  });

  it("keeps a note open when the file comes back within the grace period", async () => {
    temp.write("Synced.md", "v1\n");
    const vault = temp.open({ missingFileGracePeriod: 60 });
    vault.open("Synced.md");

    temp.remove("Synced.md");
    vault.handleDiskChanges(["Synced.md"]);
    expect(vault.document?.isMissingOnDisk).toBe(true);
    temp.write("Synced.md", "v2\n");
    await sleep(120);

    expect(vault.document).not.toBeNull();
    expect(vault.activeTab?.path).toBe("Synced.md");
    vault.handleDiskChanges(["Synced.md"]);
    expect(vault.document?.isMissingOnDisk).toBe(false);
    expect(vault.document?.text).toBe("v2\n");
  });

  it("keeps a deleted note with unsaved edits open with a warning", async () => {
    temp.write("Draft.md", "Draft\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("Draft.md");
    vault.editorChanged("Draft.md", "Draft\nUnsaved.\n");

    temp.remove("Draft.md");
    vault.handleDiskChanges(["Draft.md"]);
    await sleep(80);

    expect(vault.document?.isMissingOnDisk).toBe(true);
    expect(vault.view().doc?.isMissing).toBe(true);
    expect(vault.view().tabs[0].hasWarning).toBe(true);
    expect(temp.exists("Draft.md")).toBe(false);
  });

  it("Restore writes the note back", async () => {
    temp.write("Draft.md", "Draft\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("Draft.md");
    vault.editorChanged("Draft.md", "Draft\nUnsaved.\n");
    temp.remove("Draft.md");
    vault.handleDiskChanges(["Draft.md"]);

    vault.restoreMissing("Draft.md");
    expect(temp.read("Draft.md")).toBe("Draft\nUnsaved.\n");
    expect(vault.document?.isMissingOnDisk).toBe(false);
    expect(vault.noteCount).toBe(1);
  });

  it("Discard Edits drops the note without re-creating the file (§19 #1)", async () => {
    temp.write("Draft.md", "Draft\n");
    temp.write("Other.md", "Other\n");
    const vault = temp.open({ saveDelay: 20 });
    vault.open("Other.md");
    vault.open("Draft.md", true);
    vault.editorChanged("Draft.md", "Draft\nUnsaved.\n");
    temp.remove("Draft.md");
    vault.handleDiskChanges(["Draft.md"]);

    vault.discardMissing("Draft.md");
    expect(vault.documents.has("Draft.md")).toBe(false);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Other.md"]);
    vault.saveAll();
    await sleep(60); // past the autosave delay
    vault.close();
    expect(temp.exists("Draft.md")).toBe(false);
  });

  it("re-indexes notes changed on disk", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Daily.md", "Nothing yet.\n");
    const vault = temp.open();
    await vault.indexingFinished();
    expect(vault.index.backlinks("Ilum.md")).toEqual([]);

    temp.write("Daily.md", "See [[Ilum]].\n");
    temp.write("New.md", "[[Ilum]]\n");
    vault.handleDiskChanges(["Daily.md", "New.md"]);
    await vault.indexingFinished();
    expect(vault.index.backlinks("Ilum.md").map((link) => link.title)).toEqual(["Daily", "New"]);
  });

  it("does nothing once closed", () => {
    temp.write("Kyber.md", "Original\n");
    const vault: Vault = temp.open();
    vault.open("Kyber.md");
    vault.close();
    changeOnDisk("Kyber.md", "Changed\n");
    vault.handleDiskChanges(["Kyber.md"]);
    expect(vault.document?.text).toBe("Original\n");
  });
});

describe("Conflicts through the vault", () => {
  it("resolves the active note's conflict", () => {
    temp.write("A.md", "a\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("A.md");
    vault.editorChanged("A.md", "mine\n");
    changeOnDisk("A.md", "theirs\n");
    vault.handleDiskChanges(["A.md"]);
    expect(vault.view().conflict).toMatchObject({ path: "A.md", mine: "mine\n", theirs: "theirs\n", canMerge: false });

    vault.resolveConflict("both");
    expect(vault.document?.conflict).toBeNull();
    expect(vault.document?.text).toBe("theirs\n");
    const copy = vault.allNotes.find((path) => path.startsWith("A (conflicted copy"));
    expect(copy).toBeDefined();
    expect(temp.read(copy!)).toBe("mine\n");
  });

  it("Keep My Edits overwrites the disk", () => {
    temp.write("A.md", "a\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("A.md");
    vault.editorChanged("A.md", "mine\n");
    changeOnDisk("A.md", "theirs\n");
    vault.handleDiskChanges(["A.md"]);
    vault.resolveConflict("mine");
    expect(temp.read("A.md")).toBe("mine\n");
  });

  it("respects the auto-merge setting", () => {
    temp.settings.autoMergeExternalChanges = false;
    temp.write("A.md", "one\ntwo\nthree\n");
    const vault = temp.open({ saveDelay: 60_000 });
    vault.open("A.md");
    vault.editorChanged("A.md", "ONE\ntwo\nthree\n");
    changeOnDisk("A.md", "one\ntwo\nTHREE\n");
    vault.handleDiskChanges(["A.md"]);
    expect(vault.view().conflict?.canMerge).toBe(true);
    vault.resolveConflict("merge");
    expect(temp.read("A.md")).toBe("ONE\ntwo\nTHREE\n");
  });
});
