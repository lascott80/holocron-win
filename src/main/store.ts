// A small persistent key-value store: a JSON file in the app's data folder,
// written atomically shortly after each change. Plays the part of
// UserDefaults on the Mac (settings, recent vaults, per-vault tabs).

import fs from "node:fs";
import { writeAtomic } from "./fsx";

/** Where per-vault state is remembered. Tests use `MemoryStore`. */
export interface StateStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export class MemoryStore implements StateStore {
  protected values: Record<string, unknown> = {};
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
  set(key: string, value: unknown): void {
    if (value === undefined) delete this.values[key];
    else this.values[key] = value;
  }
}

export class FileStore extends MemoryStore {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    super();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") this.values = parsed;
    } catch {
      // Missing or unreadable: start fresh.
    }
  }

  override set(key: string, value: unknown): void {
    super.set(key, value);
    this.timer ??= setTimeout(() => this.flush(), 250);
  }

  /** Writes pending changes now (also called on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      writeAtomic(this.file, JSON.stringify(this.values, null, 2));
    } catch (error) {
      console.error("Couldn’t save settings:", error);
    }
  }
}
