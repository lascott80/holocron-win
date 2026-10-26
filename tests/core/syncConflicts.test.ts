import { describe, expect, it } from "vitest";
import { combineVersions, findSyncConflicts } from "@core/syncConflicts";

describe("findSyncConflicts", () => {
  it("recognises each sync tool's copies beside their original", () => {
    const paths = [
      "Plan.md",
      "Plan (Lawrence's conflicted copy 2026-10-26).md",
      "Notes/Log.md",
      "Notes/Log (conflicted copy 2026-10-26 101530).md",
      "Ideas.md",
      "Ideas.sync-conflict-20261026-101530-ABCDEFG.md",
      "Todo.md",
      "Todo-DESKTOP-4F2A.md",
      "Todo-DESKTOP-4F2A-1.md",
    ];
    expect(findSyncConflicts(paths, "DESKTOP-4F2A")).toEqual([
      { copy: "Ideas.sync-conflict-20261026-101530-ABCDEFG.md", original: "Ideas.md", service: "Syncthing", device: "ABCDEFG" },
      { copy: "Notes/Log (conflicted copy 2026-10-26 101530).md", original: "Notes/Log.md", service: "Nextcloud", device: null },
      { copy: "Plan (Lawrence's conflicted copy 2026-10-26).md", original: "Plan.md", service: "Dropbox", device: "Lawrence" },
      { copy: "Todo-DESKTOP-4F2A-1.md", original: "Todo.md", service: "OneDrive", device: "DESKTOP-4F2A" },
      { copy: "Todo-DESKTOP-4F2A.md", original: "Todo.md", service: "OneDrive", device: "DESKTOP-4F2A" },
    ]);
  });

  it("ignores look-alikes and copies whose original is gone", () => {
    expect(findSyncConflicts(["Meeting.md", "Meeting-Q4.md"], "DESKTOP-4F2A")).toEqual([]);
    expect(findSyncConflicts(["Plan (Lawrence's conflicted copy 2026-10-26).md"])).toEqual([]);
    expect(findSyncConflicts(["Todo.md", "Todo-DESKTOP-4F2A.md"], null)).toEqual([]);
  });
});

describe("combineVersions", () => {
  it("keeps both sides of every difference, the original first", () => {
    const original = "# Plan\n\n- milk\n- eggs\n\nEnd\n";
    const copy = "# Plan\n\n- milk\n- bread\n\nEnd\nP.S.\n";
    expect(combineVersions(original, copy)).toBe("# Plan\n\n- milk\n- eggs\n- bread\n\nEnd\nP.S.\n");
  });

  it("doesn't glue a last line without a newline to the copy's", () => {
    expect(combineVersions("a\nb", "a\nc")).toBe("a\nb\nc");
  });

  it("returns the text unchanged when the versions match", () => {
    expect(combineVersions("same\n", "same\n")).toBe("same\n");
  });
});
