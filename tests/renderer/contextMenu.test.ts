import { describe, expect, it, vi } from "vitest";
import type { ContextMenuParams } from "@shared/ipc";
import { buildContextMenu, mermaidCodeAt, tidySeparators, type ContextActions, type ContextTarget, type MenuEntry, type MenuItem } from "../../src/renderer/src/lib/contextMenu";

vi.mock("electron", () => ({ clipboard: {}, ClipboardItem: class {}, shell: {} }));
const { isEditAction, parseAssetUrl, spellingWord } = await import("../../src/main/commands");

function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    x: 10,
    y: 20,
    misspelledWord: "",
    suggestions: [],
    isEditable: true,
    selectionText: "",
    editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true, canUndo: false, canRedo: false },
    linkURL: "",
    mediaType: "none",
    ...overrides,
  };
}

function actions(): ContextActions & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    replaceMisspelling: record("replaceMisspelling"),
    addToDictionary: record("addToDictionary"),
    openLink: record("openLink"),
    openUrl: record("openUrl"),
    copyText: record("copyText"),
    searchTag: record("searchTag"),
    expandDiagram: record("expandDiagram"),
    copyDiagram: record("copyDiagram"),
    copyImage: record("copyImage"),
    openImage: record("openImage"),
    edit: record("edit"),
    copyMarkdown: record("copyMarkdown"),
    pastePlainText: record("pastePlainText"),
    selectAll: record("selectAll"),
  };
}

const labels = (entries: MenuEntry[]) => entries.map((entry) => (entry === "-" ? "-" : entry.label));
const item = (entries: MenuEntry[], label: string) => entries.find((entry): entry is MenuItem => entry !== "-" && entry.label === label)!;
const editor: ContextTarget = { inEditor: true };
const field: ContextTarget = { inEditor: false };

describe("buildContextMenu", () => {
  it("offers up to five suggestions, Add to Dictionary, then the edit items", () => {
    const a = actions();
    const entries = buildContextMenu(params({ misspelledWord: "recieve", suggestions: ["receive", "relieve", "recite", "receiver", "reprieve", "recede"] }), editor, a);
    expect(labels(entries)).toEqual([
      "receive", "relieve", "recite", "receiver", "reprieve",
      "Add “recieve” to Dictionary",
      "-",
      "Cut", "Copy", "Copy as Markdown", "Paste", "Paste as Plain Text", "Select All",
    ]);
    item(entries, "receive").run!();
    item(entries, "Add “recieve” to Dictionary").run!();
    expect(a.calls).toEqual([["replaceMisspelling", "receive"], ["addToDictionary", "recieve"]]);
  });

  it("shows a disabled No Suggestions when the spell checker has none", () => {
    const entries = buildContextMenu(params({ misspelledWord: "zxqv" }), editor, actions());
    expect(labels(entries).slice(0, 3)).toEqual(["No Suggestions", "Add “zxqv” to Dictionary", "-"]);
    expect(item(entries, "No Suggestions").disabled).toBe(true);
  });

  it("enables edit items from Chromium's edit flags and routes them through edit actions", () => {
    const a = actions();
    const entries = buildContextMenu(params({ editFlags: { canCut: true, canCopy: true, canPaste: false, canSelectAll: true, canUndo: false, canRedo: false } }), editor, a);
    expect(item(entries, "Cut").disabled).toBe(false);
    expect(item(entries, "Paste").disabled).toBe(true);
    expect(item(entries, "Paste as Plain Text").disabled).toBe(true);
    expect(item(entries, "Cut").shortcut).toBe("Ctrl+X");
    item(entries, "Cut").run!();
    item(entries, "Copy").run!();
    item(entries, "Copy as Markdown").run!();
    expect(a.calls).toEqual([["edit", "cut"], ["edit", "copy"], ["copyMarkdown"]]);
  });

  it("hides Cut, Paste and formatting in reading view", () => {
    const format = [{ label: "Bold", shortcut: "Ctrl+B", run: () => {} }];
    const entries = buildContextMenu(params({ isEditable: false, selectionText: "hello" }), editor, actions(), format);
    expect(labels(entries)).toEqual(["Copy", "Copy as Markdown", "Select All"]);
  });

  it("adds a Format submenu for a selection in the editor", () => {
    const bold = vi.fn();
    const entries = buildContextMenu(params({ selectionText: "word" }), editor, actions(), [{ label: "Bold", shortcut: "Ctrl+B", run: bold }]);
    expect(labels(entries).slice(-2)).toEqual(["-", "Format"]);
    const submenu = item(entries, "Format").items as MenuItem[];
    expect(submenu.map((entry) => entry.label)).toEqual(["Bold"]);
    submenu[0].run!();
    expect(bold).toHaveBeenCalled();
  });

  it("gives text fields spelling and edit items only", () => {
    const entries = buildContextMenu(params({ misspelledWord: "teh", suggestions: ["the"], selectionText: "teh" }), field, actions(), [{ label: "Bold", run: () => {} }]);
    expect(labels(entries)).toEqual(["the", "Add “teh” to Dictionary", "-", "Cut", "Copy", "Paste", "Select All"]);
  });

  it("shows nothing for plain UI, or just Copy for selected text there", () => {
    expect(buildContextMenu(params({ isEditable: false }), field, actions())).toEqual([]);
    expect(labels(buildContextMenu(params({ isEditable: false, selectionText: "Backlinks" }), field, actions()))).toEqual(["Copy"]);
  });

  it("opens wikilinks in this tab or a new one", () => {
    const a = actions();
    const entries = buildContextMenu(params(), { inEditor: true, wikilink: "Kyber Crystals" }, a);
    expect(labels(entries).slice(0, 3)).toEqual(["Open Link", "Open in New Tab", "-"]);
    item(entries, "Open Link").run!();
    item(entries, "Open in New Tab").run!();
    expect(a.calls).toEqual([["openLink", "Kyber Crystals", false], ["openLink", "Kyber Crystals", true]]);
  });

  it("opens and copies URLs, including Chromium's own link URL", () => {
    const a = actions();
    const entries = buildContextMenu(params(), { inEditor: true, url: "https://example.com" }, a);
    expect(labels(entries).slice(0, 3)).toEqual(["Open Link", "Copy Link Address", "-"]);
    item(entries, "Copy Link Address").run!();
    expect(a.calls).toEqual([["copyText", "https://example.com"]]);
    expect(labels(buildContextMenu(params({ linkURL: "https://a.b/" }), editor, actions()))[0]).toBe("Open Link");
    expect(labels(buildContextMenu(params({ linkURL: "javascript:alert(1)" }), editor, actions()))[0]).toBe("Cut");
  });

  it("searches for tags", () => {
    const a = actions();
    const entries = buildContextMenu(params(), { inEditor: true, tag: "lore/jedi" }, a);
    item(entries, "Search for #lore/jedi").run!();
    expect(a.calls).toEqual([["searchTag", "lore/jedi"]]);
  });

  it("expands and copies diagrams; copies and opens images", () => {
    const diagram = buildContextMenu(params({ isEditable: false }), { inEditor: true, diagram: { canCopy: true } }, actions());
    expect(labels(diagram).slice(0, 3)).toEqual(["Expand Diagram", "Copy Image", "-"]);
    const embedded = buildContextMenu(params({ isEditable: false }), { inEditor: true, diagram: { canCopy: false } }, actions());
    expect(labels(embedded).slice(0, 2)).toEqual(["Expand Diagram", "-"]);
    const a = actions();
    const image = buildContextMenu(params(), { inEditor: true, image: "holocron-asset://embed/a.png?from=n.md" }, a);
    expect(labels(image).slice(0, 3)).toEqual(["Copy Image", "Open Image", "-"]);
    item(image, "Open Image").run!();
    expect(a.calls).toEqual([["openImage", "holocron-asset://embed/a.png?from=n.md"]]);
  });
});

describe("tidySeparators", () => {
  it("drops leading, trailing and doubled separators", () => {
    expect(tidySeparators(["-", { label: "A" }, "-", "-", { label: "B" }, "-"]).map((e) => (e === "-" ? "-" : e.label))).toEqual(["A", "-", "B"]);
  });
});

describe("mermaidCodeAt", () => {
  const text = "# Note\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nafter\n";
  const pos = text.indexOf("flowchart");
  it("reads the block up to its closing fence", () => {
    expect(mermaidCodeAt(text, pos)).toBe("flowchart LR\n  A --> B");
    expect(mermaidCodeAt(text.replaceAll("\n", "\r\n"), text.replaceAll("\n", "\r\n").indexOf("flowchart"))).toBe("flowchart LR\n  A --> B");
  });
  it("refuses positions that aren't line starts, and unclosed blocks", () => {
    expect(mermaidCodeAt(text, pos + 1)).toBeNull();
    expect(mermaidCodeAt(text, Number.NaN)).toBeNull();
    expect(mermaidCodeAt("```mermaid\nflowchart LR", 11)).toBeNull();
  });
});

describe("context-menu main commands", () => {
  it("allows only the listed edit actions", () => {
    for (const name of ["cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "undo", "redo"]) expect(isEditAction(name)).toBe(true);
    for (const name of ["close", "loadURL", "executeJavaScript", "toggleDevTools", "", 3, null]) expect(isEditAction(name)).toBe(false);
  });

  it("checks spelling words", () => {
    expect(spellingWord("recieve")).toBe("recieve");
    expect(() => spellingWord("")).toThrow();
    expect(() => spellingWord("two\nlines")).toThrow();
    expect(() => spellingWord("x".repeat(201))).toThrow();
    expect(() => spellingWord(5)).toThrow();
  });

  it("parses asset URLs and nothing else", () => {
    expect(parseAssetUrl("holocron-asset://embed/Attachments%2Fmap%20one.png?from=Lore%2FKyber.md")).toEqual({ kind: "embed", target: "Attachments/map one.png", from: "Lore/Kyber.md" });
    expect(parseAssetUrl("holocron-asset://relative/img.png")).toEqual({ kind: "relative", target: "img.png", from: "" });
    expect(parseAssetUrl("holocron-asset://other/img.png")).toBeNull();
    expect(parseAssetUrl("file:///C:/Windows/notepad.exe")).toBeNull();
    expect(parseAssetUrl("not a url")).toBeNull();
  });
});
