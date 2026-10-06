// Watches a vault folder recursively and reports changed vault paths
// ("Lore/Ilum.md") in batches. Hidden paths (.git, .obsidian, our own temp
// files…) are filtered out. Uses @parcel/watcher (ReadDirectoryChangesW on
// Windows).

import path from "node:path";
import watcher from "@parcel/watcher";
import { isHidden } from "@core/paths";

export class VaultWatcher {
  private subscription: watcher.AsyncSubscription | null = null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly root: string,
    private readonly onChange: (paths: string[]) => void,
    private readonly latency = 200,
  ) {}

  async start(): Promise<void> {
    const subscription = await watcher.subscribe(
      this.root,
      (error, events) => {
        if (error || this.stopped) return;
        for (const event of events) {
          const relative = this.relativePath(event.path);
          if (relative !== null && !isHidden(relative)) this.pending.add(relative);
        }
        if (this.pending.size) this.timer ??= setTimeout(() => this.deliver(), this.latency);
      },
      // Use the native Windows API directly; otherwise the watcher first probes
      // for Watchman and prints "'watchman' is not recognized" when it's absent.
      { ignore: [".git", ".obsidian", ".trash"], ...(process.platform === "win32" ? { backend: "windows" as const } : {}) },
    );
    if (this.stopped) await subscription.unsubscribe();
    else this.subscription = subscription;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    await this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private deliver() {
    this.timer = null;
    const paths = [...this.pending];
    this.pending.clear();
    if (paths.length && !this.stopped) this.onChange(paths);
  }

  /** The vault path for an event path; "" for the root itself, null if outside. */
  private relativePath(file: string): string | null {
    const relative = path.relative(this.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
  }
}
