// Quick capture into the vault (Vault.appendCapture): today's daily note or
// the inbox, through the open document when the note is open, otherwise a
// read-modify-write of the file. REQUIREMENTS §22, §14 (P2).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, normalizeShortcut, sanitizeSettings, shortcutLabel } from "@shared/settings";
import { appendEntry, formatCapture, inboxNotePath, type Vault } from "../../src/main/vault";
import { recordingEditor, TempVault, waitFor } from "./helpers";

const at = (hours: number, minutes: number) => new Date(2026, 9, 6, hours, minutes);

describe("formatCapture", () => {
  it("makes a bullet with the time", () => {
    expect(formatCapture("Call Ahsoka", at(14, 32))).toBe("- 14:32 Call Ahsoka");
    expect(formatCapture("early", at(9, 5))).toBe("- 09:05 early");
  });

  it("indents later lines under the bullet and keeps blank lines inside", () => {
    expect(formatCapture("Groceries\nmilk\r\n  eggs\n\nbread", at(8, 0))).toBe("- 08:00 Groceries\n  milk\n    eggs\n\n  bread");
  });

  it("drops surrounding blank lines and trailing spaces", () => {
    expect(formatCapture("\n\n  idea   \n\n", at(8, 0))).toBe("- 08:00 idea");
  });

  it("returns null when there's nothing to save", () => {
    expect(formatCapture("  \n\t\n", at(8, 0))).toBeNull();
  });
});

describe("appendEntry", () => {
  it("adds a blank line before the entry and a line break after", () => {
    expect(appendEntry("# Today\n", "- 10:00 x")).toBe("# Today\n\n- 10:00 x\n");
    expect(appendEntry("# Today", "- 10:00 x")).toBe("# Today\n\n- 10:00 x\n");
  });

  it("doesn't add a second blank line", () => {
    expect(appendEntry("# Today\n\n", "- 10:00 x")).toBe("# Today\n\n- 10:00 x\n");
    expect(appendEntry("a\n\n\n", "- 10:00 x")).toBe("a\n\n\n- 10:00 x\n");
  });

  it("an empty note gets just the entry", () => {
    expect(appendEntry("", "- 10:00 x")).toBe("- 10:00 x\n");
    expect(appendEntry("﻿", "- 10:00 x")).toBe("﻿- 10:00 x\n");
  });

  it("keeps CRLF notes CRLF, including multi-line entries", () => {
    expect(appendEntry("# Today\r\nline\r\n", "- 10:00 a\n  b")).toBe("# Today\r\nline\r\n\r\n- 10:00 a\r\n  b\r\n");
    expect(appendEntry("# Today\r\nline", "- 10:00 a")).toBe("# Today\r\nline\r\n\r\n- 10:00 a\r\n");
  });

  it("never changes what's already there", () => {
    const existing = "---\ntags: [x]\n---\n# Hi  \n\t\n";
    expect(appendEntry(existing, "- 10:00 x").startsWith(existing)).toBe(true);
  });
});

describe("inboxNotePath", () => {
  it("adds .md and accepts folders", () => {
    expect(inboxNotePath("Inbox")).toBe("Inbox.md");
    expect(inboxNotePath(" Notes\\Inbox.markdown ")).toBe("Notes/Inbox.markdown");
    expect(inboxNotePath("/Notes//Inbox")).toBe("Notes/Inbox.md");
  });

  it("refuses paths that leave the vault or are hidden", () => {
    expect(inboxNotePath("../outside")).toBeNull();
    expect(inboxNotePath(".obsidian/inbox")).toBeNull();
    expect(inboxNotePath("   ")).toBeNull();
  });

  it("replaces characters Windows forbids", () => {
    expect(inboxNotePath("In:box?")).toBe("In-box-.md");
  });
});

describe("Vault.appendCapture", () => {
  let temp: TempVault;
  let vault: Vault;
  let editor: ReturnType<typeof recordingEditor>;

  beforeEach(() => {
    temp = new TempVault();
    temp.write("Templates/Daily.md", "# {{title}}\n\n## Log\n");
    temp.write("Notes.md", "# Notes\n");
    editor = recordingEditor();
    vault = temp.open({ editor });
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily" };
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it("creates a missing daily note from the template, then appends", () => {
    const path = vault.appendCapture("First thought", "daily", at(14, 32));
    expect(path).toBe("Daily/2026-10-06.md");
    expect(temp.read(path)).toBe("# 2026-10-06\n\n## Log\n\n- 14:32 First thought\n");
    // Nothing was opened.
    expect(vault.tabs).toEqual([]);
    expect(vault.allNotes).toContain(path);
  });

  it("appends to an existing daily note without opening it", () => {
    temp.write("Daily/2026-10-06.md", "# Today\n\n- 09:00 earlier\n");
    vault.appendCapture("Second\nwith detail", "daily", at(10, 15));
    expect(temp.read("Daily/2026-10-06.md")).toBe("# Today\n\n- 09:00 earlier\n\n- 10:15 Second\n  with detail\n");
    expect(vault.documents.size).toBe(0);
  });

  it("keeps a CRLF note CRLF", () => {
    temp.write("Daily/2026-10-06.md", "# Today\r\n\r\nline\r\n");
    vault.appendCapture("one\ntwo", "daily", at(10, 15));
    expect(temp.read("Daily/2026-10-06.md")).toBe("# Today\r\n\r\nline\r\n\r\n- 10:15 one\r\n  two\r\n");
  });

  it("goes through the open note, keeping unsaved edits and updating the editor", async () => {
    vault.openDailyNote(at(8, 0));
    const path = "Daily/2026-10-06.md";
    const document = vault.documents.get(path)!;
    // Typed in the editor, not saved yet.
    vault.editorChanged(path, document.text + "Unsaved line\n");
    expect(document.isDirty).toBe(true);
    editor.calls.length = 0;

    vault.appendCapture("Captured", "daily", at(11, 0));
    const expected = "# 2026-10-06\n\n## Log\nUnsaved line\n\n- 11:00 Captured\n";
    expect(document.text).toBe(expected);
    const external = editor.calls.find((call) => call.method === "externalChange");
    expect(external?.args).toEqual([path, "# 2026-10-06\n\n## Log\nUnsaved line\n", expected]);
    // Saved straight away, edits and capture together.
    expect(temp.read(path)).toBe(expected);
    expect(document.isDirty).toBe(false);
  });

  it("an outside change to the open note is merged, not overwritten", async () => {
    temp.write("Notes.md", "# Notes\n\nfirst\n");
    vault.open("Notes.md");
    vault.inboxOverride = "Notes.md";
    const document = vault.documents.get("Notes.md")!;
    vault.editorChanged("Notes.md", "# Notes\n\nfirst!\n"); // unsaved edit
    temp.write("Notes.md", "From elsewhere\n# Notes\n\nfirst\n"); // the watcher hasn't reported it yet
    vault.appendCapture("captured", "inbox", at(12, 0));
    await waitFor(() => !document.isDirty);
    expect(temp.read("Notes.md")).toBe("From elsewhere\n# Notes\n\nfirst!\n\n- 12:00 captured\n");
    expect(document.conflict).toBeNull();
  });

  it("an outside change at the same place raises a conflict; nothing is lost", () => {
    temp.write("Notes.md", "# Notes\n\nfirst\n");
    vault.open("Notes.md");
    vault.inboxOverride = "Notes.md";
    const document = vault.documents.get("Notes.md")!;
    temp.write("Notes.md", "# Notes\n\nfirst\nadded elsewhere\n");
    vault.appendCapture("captured", "inbox", at(12, 0));
    expect(document.conflict).not.toBeNull();
    expect(document.text).toBe("# Notes\n\nfirst\n\n- 12:00 captured\n");
    expect(temp.read("Notes.md")).toBe("# Notes\n\nfirst\nadded elsewhere\n");
  });

  it("creates the inbox note (and its folder) when missing", () => {
    vault.inboxOverride = "Notes/Inbox";
    const path = vault.appendCapture("  todo  ", "inbox", at(7, 45));
    expect(path).toBe("Notes/Inbox.md");
    expect(temp.read(path)).toBe("- 07:45 todo\n");
  });

  it("uses the inbox setting", () => {
    temp.settings = { quickCaptureInbox: "Notes.md" };
    vault.appendCapture("x", "inbox", at(7, 45));
    expect(temp.read("Notes.md")).toBe("# Notes\n\n- 07:45 x\n");
  });

  it("refuses an empty capture or an unusable inbox", () => {
    expect(() => vault.appendCapture(" \n ", "daily", at(7, 45))).toThrow("There’s nothing to save.");
    vault.inboxOverride = "../escape";
    expect(() => vault.appendCapture("x", "inbox", at(7, 45))).toThrow(/can’t be used/);
    expect(temp.exists("../escape.md")).toBe(false);
  });

  it("a missing template still creates the note and reports it", () => {
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Nope" };
    vault.appendCapture("x", "daily", at(7, 45));
    expect(temp.read("Daily/2026-10-06.md")).toBe("- 07:45 x\n");
    expect(vault.errorMessage).toContain("wasn’t found");
  });

  it("ensureDailyNote doesn't touch an existing note", () => {
    temp.write("Daily/2026-10-06.md", "keep\n");
    expect(vault.ensureDailyNote(at(1, 0))).toEqual({ path: "Daily/2026-10-06.md", created: false, warning: null });
    expect(temp.read("Daily/2026-10-06.md")).toBe("keep\n");
  });
});

describe("Quick capture settings", () => {
  it("defaults", () => {
    expect(defaultSettings.quickCaptureEnabled).toBe(true);
    expect(defaultSettings.quickCaptureShortcut).toBe("Super+Alt+N");
    expect(defaultSettings.quickCaptureTarget).toBe("daily");
    expect(defaultSettings.quickCaptureInbox).toBe("Inbox.md");
    expect(defaultSettings.runInBackground).toBe(true);
    expect(defaultSettings.launchAtLogin).toBe(false);
  });

  it("normalizes accelerators", () => {
    expect(normalizeShortcut("Alt+Control+space")).toBe("Ctrl+Alt+Space");
    expect(normalizeShortcut("CommandOrControl+Shift+n")).toBe("Ctrl+Shift+N");
    expect(normalizeShortcut("Alt+Super+n")).toBe("Super+Alt+N");
    expect(normalizeShortcut("Win+F5")).toBe("Super+F5");
    expect(normalizeShortcut("Ctrl+Alt+/")).toBe("Ctrl+Alt+/");
    expect(normalizeShortcut("Ctrl+Alt+num5")).toBe("Ctrl+Alt+num5");
  });

  it("rejects shortcuts that would steal typing or aren't valid", () => {
    for (const bad of ["N", "Shift+N", "Ctrl", "Ctrl+Alt", "Ctrl+N+M", "Ctrl+Ctrl+N", "Ctrl+Escape", "Ctrl+Foo", "", "Ctrl+", 42, null]) {
      expect(normalizeShortcut(bad)).toBeNull();
    }
  });

  it("sanitizes stored values", () => {
    const settings = sanitizeSettings({ quickCaptureShortcut: "Shift+A", quickCaptureTarget: "elsewhere" as never });
    expect(settings.quickCaptureShortcut).toBe("Super+Alt+N");
    expect(settings.quickCaptureTarget).toBe("daily");
    expect(sanitizeSettings({ quickCaptureShortcut: "alt+ctrl+k" }).quickCaptureShortcut).toBe("Ctrl+Alt+K");
  });

  it("labels the Windows key as Win", () => {
    expect(shortcutLabel("Super+Alt+N")).toBe("Win+Alt+N");
  });
});
