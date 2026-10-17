// The on-disk index cache (src/main/indexCache.ts): a second open takes
// unchanged notes from the cache, re-reads changed ones, and never trusts a
// stale or broken cache file.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheFile, IndexCache } from "../../src/main/indexCache";
import { TempVault } from "./helpers";

let temp: TempVault;
let cacheDir: string;

beforeEach(() => {
  temp = new TempVault();
  cacheDir = temp.outside();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("The index cache", () => {
  it("is written when the vault closes and holds every note's text", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Lore/Kyber.md", "# Kyber\n");
    const vault = temp.open({ indexCacheFolder: cacheDir });
    await vault.indexingFinished();
    vault.close();
    const cache = new IndexCache(cacheDir, vault.root);
    expect(cache.size).toBe(2);
    expect(cache.textIfCurrent("Lore/Kyber.md", temp.abs("Lore/Kyber.md"))).toBe("# Kyber\n");
  });

  it("serves unchanged notes from the cache and re-reads changed ones", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Kyber.md", "# Kyber\n");
    const first = temp.open({ indexCacheFolder: cacheDir });
    await first.indexingFinished();
    first.close();

    // Doctor the cache: a note that still matches on disk shows the cached
    // text (proving it wasn't read), a changed note is read afresh.
    const file = cacheFile(cacheDir, first.root);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.notes["Ilum.md"].text = "# From the cache\n";
    data.notes["Kyber.md"].text = "# Stale\n";
    fs.writeFileSync(file, JSON.stringify(data));
    temp.write("Kyber.md", "# Kyber, edited elsewhere\n");

    const second = temp.open({ indexCacheFolder: cacheDir });
    await second.indexingFinished();
    expect(second.index.text("Ilum.md")).toBe("# From the cache\n");
    expect(second.index.text("Kyber.md")).toBe("# Kyber, edited elsewhere\n");
    second.close();
  });

  it("always re-reads a note the watcher reported, drops deleted notes and ignores a broken cache", async () => {
    temp.write("Ilum.md", "# Ilum\n");
    temp.write("Gone.md", "# Gone\n");
    const first = temp.open({ indexCacheFolder: cacheDir });
    await first.indexingFinished();
    first.close();
    const file = cacheFile(cacheDir, first.root);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.notes["Ilum.md"].text = "# From the cache\n";
    fs.writeFileSync(file, JSON.stringify(data));
    temp.remove("Gone.md");

    const second = temp.open({ indexCacheFolder: cacheDir });
    await second.indexingFinished();
    expect(second.index.text("Ilum.md")).toBe("# From the cache\n");
    // A reported change is read from disk even when size and mtime agree.
    second.handleDiskChanges(["Ilum.md"]);
    await second.indexingFinished();
    expect(second.index.text("Ilum.md")).toBe("# Ilum\n");
    second.close();
    const after = new IndexCache(cacheDir, second.root);
    expect(after.size).toBe(1);
    expect(after.textIfCurrent("Gone.md", temp.abs("Gone.md"))).toBeNull();

    fs.writeFileSync(file, "{not json");
    const third = temp.open({ indexCacheFolder: cacheDir });
    await third.indexingFinished();
    expect(third.index.text("Ilum.md")).toBe("# Ilum\n");
    third.close();
  });

  it("keeps one file per vault and ignores another vault's cache", () => {
    const a = cacheFile(cacheDir, "C:\\Vaults\\A");
    const b = cacheFile(cacheDir, "C:\\Vaults\\B");
    expect(path.dirname(a)).toBe(cacheDir);
    expect(a).not.toBe(b);
    expect(cacheFile(cacheDir, "c:\\vaults\\a")).toBe(a);
  });
});
