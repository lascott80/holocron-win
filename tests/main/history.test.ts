// Version history (src/main/history.ts and the vault's use of it): snapshots
// on save, coalescing, the session baseline, renames, pruning and restore.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HISTORY_INTERVAL, HISTORY_MAX_AGE, HISTORY_MAX_PER_NOTE, historyFolder, NoteHistory } from "../../src/main/history";
import { recordingEditor, TempVault } from "./helpers";

let temp: TempVault;
let folder: string;

beforeEach(() => {
  temp = new TempVault();
  folder = temp.outside();
});

afterEach(async () => {
  await temp.cleanup();
});

/** A clock the tests move by hand. */
function clock(start = new Date(2026, 9, 17, 12, 0, 0)) {
  let now = start.getTime();
  return { now: () => new Date(now), advance: (ms: number) => (now += ms) };
}

describe("NoteHistory", () => {
  it("keeps the session's starting text, coalesces quick saves and separates slow ones", () => {
    const time = clock();
    const history = new NoteHistory(path.join(folder, "v"), time.now);
    history.record("A.md", "start\n", "one\n");
    expect(history.list("A.md").map((v) => history.read("A.md", v.id))).toEqual(["one\n", "start\n"]);
    time.advance(1000);
    history.record("A.md", "one\n", "two\n");
    expect(history.list("A.md").map((v) => history.read("A.md", v.id))).toEqual(["two\n", "start\n"]);
    time.advance(HISTORY_INTERVAL + 1);
    history.record("A.md", "two\n", "three\n");
    expect(history.list("A.md").map((v) => history.read("A.md", v.id))).toEqual(["three\n", "two\n", "start\n"]);
    expect(history.list("A.md")[0]!.size).toBe(6);
    expect(history.read("A.md", "nope")).toBeNull();
    expect(history.list("B.md")).toEqual([]);
  });

  it("doesn't duplicate a baseline the newest snapshot already holds", () => {
    const time = clock();
    const first = new NoteHistory(path.join(folder, "v"), time.now);
    first.record("A.md", "start\n", "one\n");
    time.advance(HISTORY_INTERVAL + 1);
    // A new session (fresh object): its "previous" is what the last snapshot holds.
    const second = new NoteHistory(path.join(folder, "v"), time.now);
    second.record("A.md", "one\n", "two\n");
    expect(second.list("A.md").map((v) => second.read("A.md", v.id))).toEqual(["two\n", "one\n", "start\n"]);
  });

  it("follows renames and prunes by count and age", () => {
    const time = clock();
    const history = new NoteHistory(path.join(folder, "v"), time.now);
    history.record("Old.md", null, "x\n");
    history.rename("Old.md", "Sub/New.md");
    expect(history.list("Old.md")).toEqual([]);
    expect(history.list("Sub/New.md").map((v) => history.read("Sub/New.md", v.id))).toEqual(["x\n"]);

    for (let i = 0; i < HISTORY_MAX_PER_NOTE + 5; i++) {
      time.advance(HISTORY_INTERVAL + 1);
      history.record("Many.md", null, `v${i}\n`);
    }
    expect(history.list("Many.md").length).toBe(HISTORY_MAX_PER_NOTE);
    expect(history.read("Many.md", history.list("Many.md")[0]!.id)).toBe(`v${HISTORY_MAX_PER_NOTE + 4}\n`);

    time.advance(HISTORY_MAX_AGE + 1);
    history.record("Many.md", null, "fresh\n");
    expect(history.list("Many.md").map((v) => history.read("Many.md", v.id))).toEqual(["fresh\n"]);
    expect(history.size()).toBeGreaterThan(0);
    history.clear();
    expect(history.list("Many.md")).toEqual([]);
    expect(history.size()).toBe(0);
  });

  it("puts each vault's history in its own folder", () => {
    expect(historyFolder(folder, "C:\\A")).not.toBe(historyFolder(folder, "C:\\B"));
    expect(historyFolder(folder, "c:\\a")).toBe(historyFolder(folder, "C:\\A"));
  });
});

describe("Version history in the vault", () => {
  it("snapshots saves of open notes and writes to closed ones, and restores with undo", async () => {
    const time = clock();
    temp.write("Note.md", "start\n");
    temp.write("Closed.md", "kyber\n");
    const editor = recordingEditor();
    const vault = temp.open({ historyFolder: folder, now: time.now, editor });
    await vault.indexingFinished();

    vault.open("Note.md");
    const document = vault.documents.get("Note.md")!;
    document.setText("edited\n");
    document.save();
    expect(vault.noteHistory("Note.md").map((v) => vault.historyText("Note.md", v.id))).toEqual(["edited\n", "start\n"]);

    // A write to a closed note (Replace All here) is snapshotted too.
    vault.replaceInNotes("kyber", "crystal", false, false, "Closed.md");
    expect(vault.noteHistory("Closed.md").map((v) => vault.historyText("Closed.md", v.id))).toEqual(["crystal\n", "kyber\n"]);

    const baseline = vault.noteHistory("Note.md")[1]!;
    time.advance(HISTORY_INTERVAL + 1);
    expect(vault.restoreVersion("Note.md", baseline.id)).toBe(true);
    expect(document.text).toBe("start\n");
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[2] === "start\n")).toBe(true);
    expect(vault.toast?.message).toMatch(/^Restored the version from /);
    vault.runToastAction();
    expect(document.text).toBe("edited\n");

    expect(vault.restoreVersion("Note.md", "123")).toBe(false);
    expect(vault.errorMessage).toBe("That version isn’t available any more.");

    // History follows a rename.
    vault.rename("Note.md", "Renamed");
    expect(vault.noteHistory("Renamed.md").length).toBeGreaterThan(0);
    expect(vault.noteHistory("Note.md")).toEqual([]);
    expect(fs.existsSync(historyFolder(folder, vault.root))).toBe(true);
    expect(vault.historySize()).toBeGreaterThan(0);
  });

  it("records nothing when the setting is off", async () => {
    temp.settings = { keepHistory: false };
    temp.write("Note.md", "start\n");
    const vault = temp.open({ historyFolder: folder });
    vault.open("Note.md");
    const document = vault.documents.get("Note.md")!;
    document.setText("edited\n");
    document.save();
    expect(vault.noteHistory("Note.md")).toEqual([]);
  });
});
