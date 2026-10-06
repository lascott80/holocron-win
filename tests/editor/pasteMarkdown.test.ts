import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { handlePaste, insertion, isSpreadsheet, pasteContext, pastePlainText, pastePlan, pasteTracking, singleUrl } from "../../src/editor/pasteMarkdown.js";
import { markdownToHtml } from "../../src/editor/markdownToHtml.js";
import { markHolocronCopy } from "../../src/editor/richCopy.js";
import { makeView, withCursor } from "./helpers";

const domino = createRequire(import.meta.url)("@mixmark-io/domino");
const parse = (html: string) => domino.createDocument(html);
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
// (pastePlan is plain JS; its inferred parameter types are too narrow for these inputs.)
const plan = (input: Record<string, unknown>): any => pastePlan(input as any, { parse });

/** A paste event carrying `text/plain`, `text/html` and files. */
function pasteEvent(data: { text?: string; html?: string; files?: { type: string }[] }) {
  return {
    defaultPrevented: false,
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? (data.text ?? "") : type === "text/html" ? (data.html ?? "") : ""),
      files: data.files ?? [],
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function viewAt(marked: string, anchor?: number) {
  const { doc, cursor } = withCursor(marked);
  return makeView(doc, cursor, [pasteTracking], anchor);
}

describe("pastePlan: precedence", () => {
  const html = "<p>Some <b>bold</b> text</p>";

  it("converts formatted HTML", () => {
    expect(plan({ text: "Some bold text", html }).action).toBe("markdown");
  });

  it("does nothing in a read-only editor", () => {
    expect(plan({ text: "x", html, context: { readOnly: true } }).reason).toBe("readOnly");
  });

  it("pastes plain text inside code and frontmatter", () => {
    expect(plan({ text: "x", html, context: { code: true } })).toEqual({ action: "default", reason: "code" });
    expect(plan({ text: "https://e.com", html, context: { code: true, selection: "sel" } }).reason).toBe("code");
  });

  it("leaves spreadsheets to the table paste (Excel puts TSV and an HTML table)", () => {
    expect(plan({ text: fixture("excel.txt"), html: fixture("excel.html") })).toEqual({ action: "default", reason: "spreadsheet" });
  });

  it("converts an HTML table whose text isn't a rectangular grid", () => {
    expect(plan({ text: "a\tb\nc", html: "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>" }).action).toBe("markdown");
  });

  it("links selected text to a pasted URL, before looking at HTML", () => {
    expect(plan({ text: "https://example.com/x", html: '<a href="https://example.com/x">https://example.com/x</a>', context: { selection: "docs" } })).toEqual({
      action: "link",
      reason: "url",
      url: "https://example.com/x",
    });
    expect(plan({ text: "www.example.com", context: { selection: "docs" } }).url).toBe("https://www.example.com");
    expect(plan({ text: "https://example.com", context: { selection: "two\nlines" } }).action).toBe("default");
    expect(plan({ text: "https://example.com" }).reason).toBe("noHtml");
  });

  it("leaves text-only and image-only clipboards to CodeMirror and images.js", () => {
    expect(plan({ text: "plain" }).reason).toBe("noHtml");
    expect(plan({ imageFiles: 1 }).reason).toBe("image");
    expect(plan({ imageFiles: 1, html: '<img src="https://e.com/cat.png">' }).reason).toBe("image");
  });

  it("converts HTML with text and pictures even when image data is present", () => {
    expect(plan({ imageFiles: 1, text: "Hi", html: fixture("outlook.html") }).action).toBe("markdown");
  });

  it("pastes plain text inside a table", () => {
    expect(plan({ text: "Some bold text", html, context: { table: true } }).reason).toBe("table");
  });

  it("uses the markdown of Holocron's own copy", () => {
    expect(plan({ text: fixture("holocron.txt"), html: fixture("holocron.html") })).toEqual({ action: "default", reason: "holocron" });
    const generated = markHolocronCopy(markdownToHtml("**a** ==b=="));
    expect(generated.startsWith('<div data-holocron-copy="">')).toBe(true);
    expect(plan({ text: "**a** ==b==", html: generated }).reason).toBe("holocron");
  });

  it("pastes the text of trivially plain HTML", () => {
    expect(plan({ text: "Just text", html: "<html><body><!--StartFragment--><p>Just text</p><!--EndFragment--></body></html>" }).reason).toBe("plain");
  });

  it("converts plain-looking HTML when there's no text/plain", () => {
    expect(plan({ html: "<p>Just text</p>" }).action).toBe("markdown");
  });
});

describe("pasteContext", () => {
  const context = (marked: string, anchor?: number) => pasteContext(viewAt(marked, anchor).state);

  it("knows code, frontmatter and tables", () => {
    expect(context("```js\nlet |^|a\n```").code).toBe(true);
    expect(context("a `co|^|de` b").code).toBe(true);
    expect(context("---\ntitle: |^|x\n---\nbody").code).toBe(true);
    expect(context("plain |^|text").code).toBe(false);
    expect(context("| a | b |\n| - | - |\n| 1 | |^|2 |").table).toBe(true);
    expect(context("text |^| here").table).toBe(false);
  });

  it("reports the selected text", () => {
    expect(context("select |^|this", 0).selection).toBe("select ");
    expect(context("no |^|selection").selection).toBe("");
  });

  it("is read-only in reading view", () => {
    const state = EditorState.create({ doc: "x", extensions: [EditorState.readOnly.of(true)] });
    expect(pasteContext(state).readOnly).toBe(true);
  });
});

describe("helpers", () => {
  it("isSpreadsheet", () => {
    expect(isSpreadsheet("a\tb\r\nc\td\r\n")).toBe(true);
    expect(isSpreadsheet("a\tb")).toBe(false);
    expect(isSpreadsheet("a\tb\nc")).toBe(false);
    expect(isSpreadsheet("a\nb")).toBe(false);
  });

  it("singleUrl", () => {
    expect(singleUrl(" https://e.com/a?b=1 ")).toBe("https://e.com/a?b=1");
    expect(singleUrl("www.e.com")).toBe("https://www.e.com");
    expect(singleUrl("see https://e.com")).toBeNull();
    expect(singleUrl("javascript:alert(1)")).toBeNull();
  });

  it("puts block markdown on its own lines when pasted mid-line", () => {
    const doc = Text.of(["before after"]);
    expect(insertion(doc, 7, 7, "# Title\n\nText").changes.insert).toBe("\n\n# Title\n\nText");
    expect(insertion(doc, 7, 7, "**bold** words").changes.insert).toBe("**bold** words");
    expect(insertion(doc, 7, 7, "| a |\n| - |\n| 1 |").changes.insert).toBe("\n\n| a |\n| - |\n| 1 |\n\n");
    const empty = Text.of([""]);
    expect(insertion(empty, 0, 0, "# Title").changes.insert).toBe("# Title");
    expect(insertion(empty, 0, 0, "# Title").cursor).toBe(7);
  });
});

describe("handlePaste", () => {
  it("inserts converted markdown over the selection in one step", () => {
    const view = viewAt("Start |^|end", 0);
    const event = pasteEvent({ text: "Hello bold", html: "<p>Hello <b>bold</b></p>" });
    expect(handlePaste(event, view, {}, { parse })).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("Hello **bold**end");
    expect(view.state.selection.main.head).toBe("Hello **bold**".length);
  });

  it("leaves code blocks, spreadsheets and plain text to the default paste", () => {
    const code = viewAt("```\n|^|\n```");
    const event = pasteEvent({ text: "x", html: "<b>x</b>" });
    expect(handlePaste(event, code, {}, { parse })).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(handlePaste(pasteEvent({ text: fixture("excel.txt"), html: fixture("excel.html") }), viewAt("|^|"), {}, { parse })).toBe(false);
    expect(handlePaste(pasteEvent({ text: "plain" }), viewAt("|^|"), {}, { parse })).toBe(false);
  });

  it("links selected text to a URL", () => {
    const view = viewAt("read the docs|^| now", 9);
    expect(handlePaste(pasteEvent({ text: "https://e.com/docs" }), view, {}, { parse })).toBe(true);
    expect(view.state.doc.toString()).toBe("read the [docs](https://e.com/docs) now");
  });

  it("saves local pictures first, then inserts at the paste position mapped through later edits", async () => {
    const view = viewAt("Intro\n|^|");
    const saveImage = vi.fn(async (mime: string, data: string) => (mime === "image/png" && data === "AAAA" ? "![[Pasted image 1.png]]" : null));
    const importFile = vi.fn(async (file: string) => (file === "C:\\Temp\\clip_image001.png" ? "![[clip_image001.png]]" : null));
    const html = '<p>Look:</p><p><img src="data:image/png;base64,AAAA"></p><p><img src="file:///C:/Temp/clip_image001.png"></p>';
    expect(handlePaste(pasteEvent({ text: "Look:", html }), view, { saveImage, importFile }, { parse })).toBe(true);
    // Typing at the start while the pictures are saved.
    view.dispatch({ changes: { from: 0, insert: "# " } });
    await (handlePaste as any).pending;
    expect(saveImage).toHaveBeenCalledWith("image/png", "AAAA");
    expect(importFile).toHaveBeenCalledWith("C:\\Temp\\clip_image001.png");
    expect(view.state.doc.toString()).toBe("# Intro\nLook:\n\n![[Pasted image 1.png]]\n\n![[clip_image001.png]]");
    expect(view.state.field(pasteTracking).size).toBe(0);
  });

  it("drops pictures that couldn't be saved", async () => {
    const view = viewAt("|^|");
    handlePaste(pasteEvent({ text: "x", html: '<p>x <img src="data:image/png;base64,AAAA" alt="chart"></p>' }), view, { saveImage: async () => null }, { parse });
    await (handlePaste as any).pending;
    expect(view.state.doc.toString()).toBe("x chart");
  });
});

describe("pastePlainText", () => {
  it("inserts the clipboard text as it is", async () => {
    const readText = vi.fn(async () => "**not** converted\r\nhttps://e.com\tx");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    try {
      const view = viewAt("a|^|b");
      expect(pastePlainText(view)).toBe(true);
      await readText.mock.results[0].value;
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe("a**not** converted\nhttps://e.com\txb");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does nothing in a read-only editor", () => {
    const state = EditorState.create({ doc: "x", extensions: [EditorState.readOnly.of(true)] });
    expect(pastePlainText({ state } as any)).toBe(false);
  });
});
