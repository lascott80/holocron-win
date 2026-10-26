// Sync conflict copies (UI-41): found beside their notes and settled from the review sheet.

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;
const copy = "Plan (Lawrence's conflicted copy 2026-10-26).md";

beforeEach(async () => {
  temp = new TempVault();
  temp.write("Plan.md", "- milk\n- eggs\n");
  temp.write(copy, "- milk\n- bread\n");
  temp.write("Other.md", "x\n");
  vault = temp.open({ saveDelay: 60_000, hostname: "DESKTOP-1" });
  await vault.indexingFinished();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Sync conflicts", () => {
  it("lists conflict copies in the vault view", () => {
    expect(vault.view().syncConflicts).toEqual([{ copy, original: "Plan.md", service: "Dropbox", device: "Lawrence" }]);
    expect(vault.syncConflictTexts(copy)).toEqual({ original: "- milk\n- eggs\n", copy: "- milk\n- bread\n" });
  });

  it("keeps the note and bins the copy", async () => {
    await vault.resolveSyncConflict(copy, "original");
    expect(temp.read("Plan.md")).toBe("- milk\n- eggs\n");
    expect(fs.existsSync(temp.abs(copy))).toBe(false);
    expect(vault.view().syncConflicts).toEqual([]);
  });

  it("uses the copy's text", async () => {
    await vault.resolveSyncConflict(copy, "copy");
    expect(temp.read("Plan.md")).toBe("- milk\n- bread\n");
    expect(fs.existsSync(temp.abs(copy))).toBe(false);
  });

  it("combines both versions", async () => {
    await vault.resolveSyncConflict(copy, "combine");
    expect(temp.read("Plan.md")).toBe("- milk\n- eggs\n- bread\n");
  });

  it("updates an open note through its editor document", async () => {
    vault.open("Plan.md");
    await vault.resolveSyncConflict(copy, "copy");
    expect(vault.documents.get("Plan.md")?.text).toBe("- milk\n- bread\n");
  });

  it("keeps both notes and stops listing the pair", async () => {
    await vault.resolveSyncConflict(copy, "keepBoth");
    expect(fs.existsSync(temp.abs(copy))).toBe(true);
    expect(vault.view().syncConflicts).toEqual([]);
  });
});
