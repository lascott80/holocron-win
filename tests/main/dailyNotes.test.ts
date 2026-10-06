// Port of DailyNotesTests.swift (VaultDailyNoteTests). Formatting and path
// rules are covered in tests/core/dailyNotes.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UiRequest } from "@shared/ipc";
import type { Vault } from "../../src/main/vault";
import { TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;
let ui: UiRequest[];

const day = (d: number) => new Date(2026, 9, d, 9);

beforeEach(() => {
  temp = new TempVault();
  temp.write("Templates/Daily.md", "# {{title}}\n\n← [[{{yesterday}}]] · [[{{tomorrow}}]] →\n\n## Notes\n");
  temp.write("Daily/2026-10-01.md", "Oct 1\n");
  temp.write("Daily/2026-10-03.md", "Oct 3\n");
  temp.write("Daily/Meeting.md", "Not a daily note\n");
  ui = [];
  vault = temp.open({ ui: (request) => ui.push(request) });
  vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily" };
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Daily notes in the vault", () => {
  it("creates today's note from the template", () => {
    const path = vault.openDailyNote(day(5));
    expect(path).toBe("Daily/2026-10-05.md");
    expect(temp.read(path!)).toBe("# 2026-10-05\n\n← [[2026-10-04]] · [[2026-10-06]] →\n\n## Notes\n");
    expect(vault.activeTab?.path).toBe(path);
    expect(vault.allNotes).toContain(path);
  });

  it("finds the template by name or with its extension", () => {
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Daily" };
    expect(temp.read(vault.openDailyNote(day(6))!)).toContain("# 2026-10-06");
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily.md" };
    expect(temp.read(vault.openDailyNote(day(8))!)).toContain("# 2026-10-08");
  });

  it("opens an existing note without touching it", () => {
    const path = vault.openDailyNote(day(3));
    expect(temp.read(path!)).toBe("Oct 3\n");
  });

  it("a missing template still creates the note", () => {
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "Nope" };
    const path = vault.openDailyNote(day(7));
    expect(temp.read(path!)).toBe("");
    expect(vault.errorMessage).toBe("The daily note template “Nope” wasn’t found, so the note was created empty.");
  });

  it("a template outside the vault isn't used", () => {
    vault.dailyNoteSettingsOverride = { folder: "Daily", format: "YYYY-MM-DD", template: "../../outside" };
    const path = vault.openDailyNote(day(9));
    expect(temp.read(path!)).toBe("");
    expect(vault.errorMessage).not.toBeNull();
  });

  it("steps between existing daily notes", () => {
    vault.openDailyNote(day(3));
    vault.openAdjacentDailyNote(-1);
    expect(vault.activeTab?.path).toBe("Daily/2026-10-01.md");
    vault.openAdjacentDailyNote(1);
    expect(vault.activeTab?.path).toBe("Daily/2026-10-03.md");
    vault.openAdjacentDailyNote(1); // nothing later than Oct 3 except notes yet to be written
    expect(vault.activeTab?.path).toBe("Daily/2026-10-03.md");
    expect(ui).toEqual([{ type: "beep" }]);
    vault.openAdjacentDailyNote(-1);
    vault.openAdjacentDailyNote(-1); // nothing before Oct 1
    expect(vault.activeTab?.path).toBe("Daily/2026-10-01.md");
    expect(ui.length).toBe(2);
    expect(temp.names("Daily")).toEqual(["2026-10-01.md", "2026-10-03.md", "Meeting.md"]); // nothing created
  });

  it("from a note that isn't a daily note, steps relative to today", () => {
    vault.open("Daily/Meeting.md");
    vault.openAdjacentDailyNote(-1); // the latest daily note before today, if any
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today > day(3)) expect(vault.activeTab?.path).toBe("Daily/2026-10-03.md");
    else expect(vault.activeTab?.path).toBe("Daily/Meeting.md");
  });

  it("subfolder formats", () => {
    vault.dailyNoteSettingsOverride = { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD", template: "" };
    const path = vault.openDailyNote(day(5));
    expect(path).toBe("Journal/2026/10/2026-10-05.md");
    expect(temp.exists("Journal/2026/10/2026-10-05.md")).toBe(true);
  });

  it("uses the app settings when not overridden", () => {
    vault.dailyNoteSettingsOverride = null;
    temp.settings = { dailyNoteFolder: "Days", dailyNoteFormat: "YYYY-MM-DD dddd", dailyNoteTemplate: "" };
    expect(vault.openDailyNote(day(5))).toBe("Days/2026-10-05 Monday.md");
  });

  it("opens in a new tab when asked", () => {
    vault.open("Daily/Meeting.md");
    vault.openDailyNote(day(3), true);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Daily/Meeting.md", "Daily/2026-10-03.md"]);
  });
});
