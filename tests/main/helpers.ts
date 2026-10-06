// Shared fixtures for the main-process model tests: a throwaway vault folder,
// a fake Recycle Bin, a recording editor port and a polling `waitFor`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultSettings, type Settings } from "@shared/settings";
import { MemoryStore } from "../../src/main/store";
import { Vault, nullEditor, type EditorPort, type TrashItem, type VaultOptions } from "../../src/main/vault";

/** Polls `condition` every 5 ms for up to `timeout` ms. */
export async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A temporary folder (resolved to its long, real path). */
export function makeTempDir(prefix = "holocron-"): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function removeDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
}

/**
 * A "Recycle Bin" folder outside the vault: trashing moves the item in, the
 * returned function moves it back (recreating parent folders).
 */
export function fakeTrash(trashDir: string): TrashItem & { trashed: string[] } {
  const trashed: string[] = [];
  const trash = async (file: string) => {
    const target = path.join(trashDir, randomUUID(), path.basename(file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(file, target);
    trashed.push(target);
    return () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.renameSync(target, file);
    };
  };
  return Object.assign(trash, { trashed });
}

export interface EditorCall {
  method: keyof EditorPort;
  args: unknown[];
}

/** An editor port that records every call. */
export function recordingEditor(): EditorPort & { calls: EditorCall[] } {
  const calls: EditorCall[] = [];
  const editor = { calls } as EditorPort & { calls: EditorCall[] };
  for (const method of Object.keys(nullEditor) as (keyof EditorPort)[]) {
    (editor as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      calls.push({ method, args });
    };
  }
  return editor;
}

/** A throwaway vault folder plus everything needed to open `Vault`s on it. */
export class TempVault {
  readonly root: string;
  readonly base: string;
  readonly trashDir: string;
  readonly store = new MemoryStore();
  readonly trash: ReturnType<typeof fakeTrash>;
  settings: Partial<Settings> = {};
  private readonly vaults: Vault[] = [];
  private readonly extraDirs: string[] = [];

  constructor() {
    this.base = makeTempDir();
    this.root = path.join(this.base, "Vault");
    fs.mkdirSync(this.root);
    this.trashDir = path.join(this.base, "Trash");
    this.trash = fakeTrash(this.trashDir);
  }

  abs(vaultPath: string): string {
    return path.join(this.root, ...vaultPath.split("/"));
  }

  write(vaultPath: string, contents: string | Uint8Array = ""): string {
    const file = this.abs(vaultPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  }

  read(vaultPath: string): string {
    return fs.readFileSync(this.abs(vaultPath), "utf8");
  }

  exists(vaultPath: string): boolean {
    return fs.existsSync(this.abs(vaultPath));
  }

  remove(vaultPath: string) {
    fs.rmSync(this.abs(vaultPath), { recursive: true, force: true });
  }

  /** Sorted entry names of a vault folder. */
  names(folder = ""): string[] {
    return fs.readdirSync(this.abs(folder)).sort();
  }

  /** A second temporary folder outside the vault (cleaned up too). */
  outside(): string {
    const dir = makeTempDir("holocron-outside-");
    this.extraDirs.push(dir);
    return dir;
  }

  open(options: Partial<VaultOptions> = {}): Vault {
    const vault = new Vault(this.root, {
      store: this.store,
      settings: () => ({ ...defaultSettings, ...this.settings }),
      saveDelay: 10,
      autoTitleDelay: 10,
      liveIndexDelay: 10,
      missingFileGracePeriod: 30,
      trash: this.trash,
      ...options,
    });
    this.vaults.push(vault);
    return vault;
  }

  async cleanup() {
    for (const vault of this.vaults) {
      vault.close();
      await vault.indexingFinished();
    }
    removeDir(this.base);
    for (const dir of this.extraDirs) removeDir(dir);
  }
}

/** Every file name under `dir` (recursive), for temp-file checks. */
export function allFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).map((name) => name.split(path.sep).join("/"));
}
