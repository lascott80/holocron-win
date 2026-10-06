// One editor tab: the note it shows plus its back/forward history (vault
// paths). An empty tab ("New Tab") has an empty history. (REQUIREMENTS TAB-01)

import { randomUUID } from "node:crypto";

const MAX_HISTORY = 100;

export class EditorTab {
  readonly id: string = randomUUID();
  private history: string[];
  private index: number;

  constructor(path: string | null = null) {
    this.history = path === null ? [] : [path];
    this.index = path === null ? -1 : 0;
  }

  get path(): string | null {
    return this.index >= 0 && this.index < this.history.length ? this.history[this.index] : null;
  }

  get canGoBack() {
    return this.index > 0;
  }

  get canGoForward() {
    return this.index < this.history.length - 1;
  }

  /** Rewrites history entries after files were renamed or moved. */
  remap(transform: (path: string) => string) {
    this.history = this.history.map(transform);
  }

  /** Shows `path`, dropping any forward history (like a browser). */
  navigate(path: string) {
    if (path === this.path) return;
    this.history = [...this.history.slice(0, this.index + 1), path];
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    this.index = this.history.length - 1;
  }

  /** Moves back, skipping notes that no longer exist; returns the path to show, or null. */
  goBack(missing: (path: string) => boolean): string | null {
    let index = this.index - 1;
    while (index >= 0 && missing(this.history[index])) index--;
    if (index < 0) return null;
    this.index = index;
    return this.history[index];
  }

  goForward(missing: (path: string) => boolean): string | null {
    let index = this.index + 1;
    while (index < this.history.length && missing(this.history[index])) index++;
    if (index >= this.history.length) return null;
    this.index = index;
    return this.history[index];
  }
}
