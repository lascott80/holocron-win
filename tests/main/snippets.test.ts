// CSS snippets in a vault (src/main/snippets.ts, REQUIREMENTS §16.11): the
// files are read from .holocron/snippets, and which ones are on is remembered
// per vault in the state store.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snippetsKey } from "../../src/shared/snippets";
import { MemoryStore } from "../../src/main/store";
import { readSnippetFiles, SnippetManager } from "../../src/main/snippets";
import { makeTempDir, removeDir } from "./helpers";

describe("SnippetManager", () => {
  let root: string;
  let other: string;
  let store: MemoryStore;
  const managers: SnippetManager[] = [];

  function writeSnippet(vault: string, name: string, css: string) {
    const folder = path.join(vault, ".holocron", "snippets");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), css);
  }

  function open(vault: string, onChange?: () => void) {
    const manager = new SnippetManager(vault, store, onChange);
    managers.push(manager);
    return manager;
  }

  beforeEach(() => {
    root = makeTempDir("holocron-snippets-");
    other = makeTempDir("holocron-snippets-other-");
    store = new MemoryStore();
  });

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.close();
    removeDir(root);
    removeDir(other);
  });

  it("lists the vault's .css files in name order, sanitised, all off to begin with", () => {
    writeSnippet(root, "b-wide.css", ".cm-content { max-width: 900px; }");
    writeSnippet(root, "A-fonts.css", "@import url(https://x.example/f.css);\n:root { --hc-font: serif; }");
    writeSnippet(root, "notes.txt", "not a snippet");
    const manager = open(root);
    expect(manager.view()).toEqual([
      { name: "A-fonts", enabled: false, css: "\n:root { --hc-font: serif; }" },
      { name: "b-wide", enabled: false, css: ".cm-content { max-width: 900px; }" },
    ]);
  });

  it("is empty without the folder", () => {
    expect(readSnippetFiles(root)).toEqual([]);
    expect(open(root).view()).toEqual([]);
  });

  it("persists the enabled set per vault in the state store", () => {
    writeSnippet(root, "wide.css", "a{}");
    writeSnippet(root, "serif.css", "b{}");
    writeSnippet(other, "wide.css", "c{}");
    let changes = 0;
    const manager = open(root, () => changes++);
    manager.setEnabled("wide", true);
    manager.setEnabled("serif", true);
    manager.setEnabled("serif", false);
    manager.setEnabled("missing", true); // not a file: ignored
    expect(store.get<string[]>(snippetsKey(root))).toEqual(["wide"]);
    expect(store.get<string[]>(snippetsKey(other))).toBeUndefined();
    expect(changes).toBeGreaterThanOrEqual(3);

    // The other vault has its own set; reopening this one restores it.
    expect(open(other).view().map((s) => s.enabled)).toEqual([false]);
    const reopened = open(root);
    expect(reopened.view().filter((s) => s.enabled).map((s) => s.name)).toEqual(["wide"]);
  });

  it("re-reads the folder on reload", () => {
    const manager = open(root);
    expect(manager.view()).toEqual([]);
    writeSnippet(root, "new.css", "x{}");
    manager.reload();
    expect(manager.view().map((s) => s.name)).toEqual(["new"]);
  });

  it("ensureFolder creates the hidden snippets folder", () => {
    const manager = open(root);
    const folder = manager.ensureFolder();
    expect(folder).toBe(path.join(root, ".holocron", "snippets"));
    expect(fs.statSync(folder).isDirectory()).toBe(true);
  });
});
