// CSS snippets (§16.11): `.holocron/snippets/*.css` inside the vault. The
// folder is hidden, so the tree, index and vault watcher never see it
// (VLT-03); this module keeps its own small watch on the folder and
// remembers which snippets are on, per vault, in the state store.

import fs from "node:fs";
import path from "node:path";
import { compareSnippetNames, isSnippetFile, MAX_SNIPPET_LENGTH, sanitizeSnippet, snippetName, snippetsKey, SNIPPETS_FOLDER, type SnippetView } from "@shared/snippets";
import type { StateStore } from "./store";

/** The snippet files of a vault, sanitised and in file-name order (without enabled flags). */
export function readSnippetFiles(root: string): { name: string; css: string }[] {
  const folder = path.join(root, ...SNIPPETS_FOLDER.split("/"));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && isSnippetFile(entry.name))
    .map((entry) => entry.name)
    .sort(compareSnippetNames);
  const result: { name: string; css: string }[] = [];
  for (const file of files) {
    try {
      const css = fs.readFileSync(path.join(folder, file), "utf8");
      if (css.length > MAX_SNIPPET_LENGTH) continue;
      result.push({ name: snippetName(file), css: sanitizeSnippet(css) });
    } catch {
      // Being written, or unreadable: skip it this time.
    }
  }
  return result;
}

export class SnippetManager {
  readonly folder: string;
  private files: { name: string; css: string }[] = [];
  private enabled: Set<string>;
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    readonly root: string,
    private readonly store: StateStore,
    private readonly onChange: () => void = () => {},
  ) {
    this.folder = path.join(root, ...SNIPPETS_FOLDER.split("/"));
    const stored = store.get<unknown>(snippetsKey(root));
    this.enabled = new Set(Array.isArray(stored) ? stored.filter((name): name is string => typeof name === "string") : []);
    this.reload();
  }

  /** Every snippet file with its enabled flag and sanitised CSS, in file-name order. */
  view(): SnippetView[] {
    return this.files.map(({ name, css }) => ({ name, css, enabled: this.enabled.has(name) }));
  }

  /** Re-reads the folder (Settings › Reload, and on file changes). */
  reload() {
    if (this.closed) return;
    this.files = readSnippetFiles(this.root);
    this.watch();
    this.onChange();
  }

  setEnabled(name: string, enabled: boolean) {
    if (!this.files.some((file) => file.name === name)) return;
    if (enabled) this.enabled.add(name);
    else this.enabled.delete(name);
    this.store.set(snippetsKey(this.root), [...this.enabled]);
    this.onChange();
  }

  /** Makes sure the folder exists (for "Open snippets folder"). */
  ensureFolder(): string {
    fs.mkdirSync(this.folder, { recursive: true });
    this.watch();
    return this.folder;
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  /** Watches the folder once it exists; changes are coalesced for 300 ms. */
  private watch() {
    if (this.watcher || this.closed || !fs.existsSync(this.folder)) return;
    try {
      this.watcher = fs.watch(this.folder, { persistent: false }, () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.reload();
        }, 300);
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null;
    }
  }
}
