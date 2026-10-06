// Port of SyncTests.swift (ExternalChangeTests) and VaultTests.swift
// (NoteDocumentTests): saving, reconciling with disk, merging and conflicts.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteDocument } from "../../src/main/noteDocument";
import { allFiles, makeTempDir, removeDir, waitFor } from "./helpers";

/** Simulates another app or device changing a note on disk. */
function changeOnDisk(file: string, text: string) {
  const temp = file + ".other-app";
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function readDisk(file: string) {
  return fs.readFileSync(file, "utf8");
}

let dir: string;
const documents: NoteDocument[] = [];

function open(file: string, options: ConstructorParameters<typeof NoteDocument>[1] = { saveDelay: 60_000 }) {
  const document = new NoteDocument(file, options);
  documents.push(document);
  return document;
}

beforeEach(() => {
  dir = makeTempDir();
});

afterEach(() => {
  for (const document of documents.splice(0)) document.dispose();
  removeDir(dir);
});

describe("NoteDocument basics", () => {
  it("loads and saves atomically", () => {
    const file = path.join(dir, "Kyber.md");
    fs.writeFileSync(file, "# Kyber\n");
    const document = open(file);
    expect(document.text).toBe("# Kyber\n");
    expect(document.isDirty).toBe(false);

    document.setText(document.text + "Attuned on Ilum.\n");
    expect(document.isDirty).toBe(true);

    document.save();
    expect(document.isDirty).toBe(false);
    expect(document.saveError).toBeNull();
    expect(document.lastSaved).not.toBeNull();
    expect(readDisk(file)).toBe("# Kyber\nAttuned on Ilum.\n");
    // The atomic write leaves no temp file behind.
    expect(allFiles(dir)).toEqual(["Kyber.md"]);
  });

  it("autosaves after typing stops", async () => {
    const file = path.join(dir, "Daily.md");
    fs.writeFileSync(file, "");
    const document = open(file, { saveDelay: 20 });
    document.setText("Hel");
    document.setText("Hello");
    expect(readDisk(file)).toBe("");
    await waitFor(() => !document.isDirty);
    expect(readDisk(file)).toBe("Hello");
  });

  it("reverting edits clears the dirty flag", () => {
    const file = path.join(dir, "Note.md");
    fs.writeFileSync(file, "abc");
    const document = open(file);
    document.setText("abcd");
    document.setText("abc");
    expect(document.isDirty).toBe(false);
  });

  it("reports text changes and state changes", () => {
    const file = path.join(dir, "Note.md");
    fs.writeFileSync(file, "abc");
    const document = open(file);
    const texts: string[] = [];
    let states = 0;
    document.onTextChange = (text) => texts.push(text);
    document.onStateChange = () => states++;
    document.setText("abc"); // unchanged: nothing happens
    document.setText("abcd");
    expect(texts).toEqual(["abcd"]);
    expect(states).toBeGreaterThan(0);
  });

  it("counts words and takes its title from the file name", () => {
    const file = path.join(dir, "Kyber Crystal.md");
    fs.writeFileSync(file, "# Kyber\n\n  one two\tthree\n");
    const document = open(file);
    expect(document.title).toBe("Kyber Crystal");
    expect(document.wordCount).toBe(5);
  });

  it("round-trips CRLF text byte-identically", () => {
    const file = path.join(dir, "Windows.md");
    const original = "# Title\r\n\r\nLine one\r\nLine two\r\n";
    fs.writeFileSync(file, original);
    const before = fs.statSync(file).mtimeMs;
    const document = open(file);
    expect(document.text).toBe(original);
    document.save(); // nothing changed: nothing written
    expect(fs.statSync(file).mtimeMs).toBe(before);
    document.setText(original + "Line three\r\n");
    document.save();
    expect(fs.readFileSync(file).equals(Buffer.from(original + "Line three\r\n", "utf8"))).toBe(true);
  });

  it("records a save error and stays dirty when the write fails", () => {
    const file = path.join(dir, "Note.md");
    fs.writeFileSync(file, "abc");
    const document = open(file);
    // Replace the file by a folder of the same name: renaming over it fails.
    fs.rmSync(file);
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "keep.txt"), "x");
    document.reconcileWithDisk(); // a folder is "there" but can't be read as text
    document.setText("abcd");
    document.save();
    expect(document.saveError).not.toBeNull();
    expect(document.isDirty).toBe(true);
    // The failed write's temp file was removed.
    expect(allFiles(dir).filter((name) => name.includes("holocron-tmp"))).toEqual([]);
  });
});

describe("External changes (SyncTests)", () => {
  const original = "# Kyber\n\nIntro.\n\n- [ ] Map caves\n";
  let file: string;
  let document: NoteDocument;

  beforeEach(() => {
    file = path.join(dir, "Kyber.md");
    fs.writeFileSync(file, original);
    document = open(file);
  });

  function makeConflict() {
    document.setText("# Kyber\n\nMy intro.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n");
    document.reconcileWithDisk();
    expect(document.conflict).not.toBeNull();
  }

  it("a clean note reloads quietly", () => {
    const editorUpdates: string[] = [];
    document.onExternalTextChange = (_old, text) => editorUpdates.push(text);

    changeOnDisk(file, "# Kyber\n\nIntro from my phone.\n");
    document.reconcileWithDisk();

    expect(document.text).toBe("# Kyber\n\nIntro from my phone.\n");
    expect(document.isDirty).toBe(false);
    expect(document.conflict).toBeNull();
    expect(document.lastSyncEvent?.kind).toBe("reloaded");
    expect(editorUpdates).toEqual(["# Kyber\n\nIntro from my phone.\n"]);
  });

  it("our own save is not treated as an outside change", () => {
    let editorUpdates = 0;
    document.onExternalTextChange = () => editorUpdates++;
    document.setText(document.text + "More.\n");
    document.save();
    document.reconcileWithDisk();

    expect(editorUpdates).toBe(0);
    expect(document.lastSyncEvent).toBeNull();
  });

  it("an outside change matching our unsaved edits is adopted silently", () => {
    let editorUpdates = 0;
    document.onExternalTextChange = () => editorUpdates++;
    document.setText(original + "Same.\n");
    changeOnDisk(file, original + "Same.\n");
    document.reconcileWithDisk();
    expect(document.isDirty).toBe(false);
    expect(document.savedText).toBe(original + "Same.\n");
    expect(document.lastSyncEvent).toBeNull();
    expect(editorUpdates).toBe(0);
  });

  it("non-overlapping edits merge", () => {
    document.setText("# Kyber\n\nIntro, expanded.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nIntro.\n\n- [x] Map caves\n");
    document.reconcileWithDisk();

    expect(document.conflict).toBeNull();
    expect(document.text).toBe("# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n");
    expect(document.lastSyncEvent?.kind).toBe("merged");
    expect(document.isDirty).toBe(true);

    document.save();
    expect(readDisk(file)).toBe("# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n");
  });

  it("a merged result is autosaved", async () => {
    document.dispose();
    document = open(file, { saveDelay: 10 });
    document.setText("# Kyber\n\nIntro, expanded.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nIntro.\n\n- [x] Map caves\n");
    document.reconcileWithDisk();
    await waitFor(() => !document.isDirty);
    expect(readDisk(file)).toBe("# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n");
  });

  it("overlapping edits raise a conflict and block saving", () => {
    document.setText("# Kyber\n\nMy intro.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n");
    document.reconcileWithDisk();

    const conflict = document.conflict!;
    expect(conflict).not.toBeNull();
    expect(conflict.merge.mergedText).toBeNull();
    expect(conflict.diskText).toContain("Their intro.");
    expect(conflict.origin).toBe("disk");

    document.save();
    expect(readDisk(file)).toContain("Their intro."); // must not overwrite while a conflict is open
  });

  it("an open conflict follows later disk changes", () => {
    makeConflict();
    changeOnDisk(file, "# Kyber\n\nTheir second intro.\n\n- [ ] Map caves\n");
    document.reconcileWithDisk();
    expect(document.conflict?.diskText).toContain("Their second intro.");
    expect(document.text).toContain("My intro.");
  });

  it("auto-merge off always asks", () => {
    document.dispose();
    document = open(file, { saveDelay: 60_000, autoMerge: () => false });
    document.setText("# Kyber\n\nIntro, expanded.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nIntro.\n\n- [x] Map caves\n");
    document.reconcileWithDisk();

    const conflict = document.conflict!;
    expect(conflict).not.toBeNull();
    expect(conflict.merge.mergedText).not.toBeNull();

    document.resolveMerging();
    expect(document.conflict).toBeNull();
    expect(readDisk(file)).toBe("# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n");
    expect(document.isDirty).toBe(false);
  });

  it("save checks the disk first", () => {
    // The watcher hasn't reported the outside change yet when we save.
    document.setText("# Kyber\n\nMy intro.\n\n- [ ] Map caves\n");
    changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n");
    document.save();

    expect(document.conflict).not.toBeNull();
    expect(readDisk(file)).toContain("Their intro.");
  });

  it("resolving keeps mine", () => {
    makeConflict();
    document.resolveKeepingMine();
    expect(document.conflict).toBeNull();
    expect(document.isDirty).toBe(false);
    expect(readDisk(file)).toContain("My intro.");
  });

  it("resolving uses disk", () => {
    makeConflict();
    document.resolveUsingDisk();
    expect(document.conflict).toBeNull();
    expect(document.isDirty).toBe(false);
    expect(document.text).toContain("Their intro.");
    expect(readDisk(file)).toContain("Their intro.");
    expect(document.lastSyncEvent?.kind).toBe("reloaded");
  });

  it("merging is refused while the changes overlap", () => {
    makeConflict();
    document.resolveMerging();
    expect(document.conflict).not.toBeNull();
  });

  it("resolving keeps both as copies", () => {
    makeConflict();
    const copy = document.resolveKeepingBoth()!;
    expect(copy).not.toBeNull();

    expect(path.basename(copy).startsWith("Kyber (conflicted copy ")).toBe(true);
    expect(path.basename(copy)).toMatch(/^Kyber \(conflicted copy \d{4}-\d{2}-\d{2} \d{4}\)\.md$/);
    expect(readDisk(copy)).toContain("My intro.");
    expect(document.text).toContain("Their intro.");
    expect(readDisk(file)).toContain("Their intro.");
    expect(document.conflict).toBeNull();
  });

  it("conflicted copies are numbered when the name is taken", () => {
    const now = new Date(2026, 9, 5, 14, 32);
    document.dispose();
    document = open(file, { saveDelay: 60_000, now: () => now });
    fs.writeFileSync(path.join(dir, "Kyber (conflicted copy 2026-10-05 1432).md"), "older copy");
    makeConflict();
    const copy = document.resolveKeepingBoth()!;
    expect(path.basename(copy)).toBe("Kyber (conflicted copy 2026-10-05 1432) 2.md");
    expect(readDisk(path.join(dir, "Kyber (conflicted copy 2026-10-05 1432).md"))).toBe("older copy");
  });

  it("a deleted file is reported missing and can be restored", () => {
    fs.rmSync(file);
    document.reconcileWithDisk();
    expect(document.isMissingOnDisk).toBe(true);
    expect(document.canBeClosedSafely).toBe(true);

    document.setText(document.text + "Unsaved.\n");
    expect(document.canBeClosedSafely).toBe(false);
    document.save();
    expect(document.isMissingOnDisk).toBe(false);
    expect(readDisk(file).endsWith("Unsaved.\n")).toBe(true);
  });

  it("a missing file without edits is re-created by save", () => {
    fs.rmSync(file);
    document.reconcileWithDisk();
    document.save();
    expect(document.isMissingOnDisk).toBe(false);
    expect(readDisk(file)).toBe(original);
  });

  it("a file that comes back is no longer missing", () => {
    fs.rmSync(file);
    document.reconcileWithDisk();
    expect(document.isMissingOnDisk).toBe(true);
    fs.writeFileSync(file, original);
    document.reconcileWithDisk();
    expect(document.isMissingOnDisk).toBe(false);
    expect(document.text).toBe(original);
  });

  it("follows its file when moved", () => {
    const moved = path.join(dir, "Moved.md");
    fs.renameSync(file, moved);
    document.didMove(moved);
    expect(document.title).toBe("Moved");
    document.setText(original + "After move.\n");
    document.save();
    expect(readDisk(moved)).toBe(original + "After move.\n");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("replaceContents saves immediately and notifies the editor", () => {
    const updates: string[] = [];
    document.onExternalTextChange = (_old, text) => updates.push(text);
    document.replaceContents("# Rewritten\n");
    expect(readDisk(file)).toBe("# Rewritten\n");
    expect(document.isDirty).toBe(false);
    expect(updates).toEqual(["# Rewritten\n"]);
  });

  it("CRLF notes merge outside changes and keep their line endings", () => {
    const crlf = "# Kyber\r\n\r\nIntro.\r\n\r\n- [ ] Map caves\r\n";
    fs.writeFileSync(file, crlf);
    document.dispose();
    document = open(file);
    document.setText("# Kyber\r\n\r\nIntro, expanded.\r\n\r\n- [ ] Map caves\r\n");
    changeOnDisk(file, "# Kyber\r\n\r\nIntro.\r\n\r\n- [x] Map caves\r\n");
    document.reconcileWithDisk();
    expect(document.conflict).toBeNull();
    document.save();
    expect(readDisk(file)).toBe("# Kyber\r\n\r\nIntro, expanded.\r\n\r\n- [x] Map caves\r\n");
  });
});
