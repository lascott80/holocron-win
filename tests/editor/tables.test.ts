import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { displayWidth, findTables, formatTable, nextCell, previousCell } from "../../src/editor/tables.js";
import { tableEditing } from "../../src/editor/tableEditing.js";
import { makeView } from "./helpers";

describe("displayWidth", () => {
  it("counts ASCII as 1 per character", () => {
    expect(displayWidth("")).toBe(0);
    expect(displayWidth("abc")).toBe(3);
  });
  it("counts CJK and fullwidth as 2", () => {
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("한국")).toBe(4);
    expect(displayWidth("ＡＢ")).toBe(4);
    expect(displayWidth("a日b")).toBe(4);
  });
  it("counts emoji as 2, including sequences", () => {
    expect(displayWidth("😀")).toBe(2);
    expect(displayWidth("👍🏽")).toBe(2); // skin tone modifier
    expect(displayWidth("👨‍👩‍👧")).toBe(2); // ZWJ family
    expect(displayWidth("🇯🇵")).toBe(2); // flag
    expect(displayWidth("❤️")).toBe(2); // VS16
    expect(displayWidth("1️⃣")).toBe(2); // keycap
  });
  it("counts combining marks, joiners and variation selectors as 0", () => {
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("a​b")).toBe(2);
    expect(displayWidth("́")).toBe(0);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("Ω")).toBe(1);
  });
});

/** Display width of each "|"-separated segment of each line. */
const segmentWidths = (text: string) => text.split("\n").map((line) => line.split("|").map(displayWidth));

describe("formatTable with wide characters", () => {
  it("aligns columns by display width", () => {
    const doc = EditorState.create({ doc: "| 名前 | x |\n| - | - |\n| a | 😀😀😀 |\n| Ünïcödé | b |" }).doc;
    const [table] = findTables(doc);
    const { text } = formatTable(table);
    const widths = segmentWidths(text);
    for (const row of widths) expect(row).toEqual(widths[0]);
    expect(text.split("\n")[0]).toBe("| 名前    | x      |");
  });
  it("pads centred and right-aligned cells by display width", () => {
    const doc = EditorState.create({ doc: "| a | b |\n| :-: | --: |\n| 日 | 字 |\n| abcdef | abcdef |" }).doc;
    const { text } = formatTable(findTables(doc)[0]);
    expect(text.split("\n")[2]).toBe("|   日   |     字 |");
    const widths = segmentWidths(text);
    for (const row of widths) expect(row).toEqual(widths[0]);
  });
});

describe("Tab / Shift+Tab cell navigation", () => {
  const table = "| a | b |\n| --- | --- |\n| c | d |";

  it("is bound by tableEditing, which is on in every mode (source included)", () => {
    const state = EditorState.create({ extensions: tableEditing });
    const keys = state.facet(keymap).flat().map((binding: any) => binding.key);
    expect(keys).toContain("Tab");
    expect(keys).toContain("Shift-Tab");
  });

  it("moves to the next cell, tidying the table", () => {
    const view = makeView(table, 2); // in "a"
    expect(nextCell(view)).toBe(true);
    const doc = view.state.doc.toString();
    expect(doc).toBe("| a   | b   |\n| --- | --- |\n| c   | d   |");
    expect(doc.slice(view.state.selection.main.head, view.state.selection.main.head + 1)).toBe("b");
  });

  it("wraps across rows and goes back with Shift+Tab", () => {
    const view = makeView(table, table.indexOf("b"));
    nextCell(view);
    const doc = view.state.doc.toString();
    expect(doc[view.state.selection.main.head]).toBe("c");
    previousCell(view);
    expect(view.state.doc.toString()[view.state.selection.main.head]).toBe("b");
  });

  it("adds a row (sized by display width) after the last cell", () => {
    const wide = "| 日本 | b |\n| --- | --- |\n| c | d |";
    const view = makeView(wide, wide.length - 2);
    nextCell(view);
    const lines = view.state.doc.toString().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("|      |     |");
    expect(segmentWidths(lines[3])).toEqual(segmentWidths(lines[0]));
    const head = view.state.selection.main.head;
    expect(view.state.doc.lineAt(head).number).toBe(4);
    expect(head - view.state.doc.line(4).from).toBe(2);
  });

  it("falls through outside tables so Tab still indents", () => {
    const view = makeView("- item\n\ntext | not a table", 3);
    expect(nextCell(view)).toBe(false);
    expect(previousCell(view)).toBe(false);
    const after = makeView("- item\n\ntext | not a table", 12);
    expect(nextCell(after)).toBe(false);
  });
});
