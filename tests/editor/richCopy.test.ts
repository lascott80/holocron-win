import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { copiedText, copyMarkdown } from "../../src/editor/richCopy.js";

vi.mock("electron", () => ({ clipboard: {}, ClipboardItem: class {}, shell: {} }));
const { clipboardStillHolds, MAX_CLIPBOARD_LENGTH } = await import("../../src/main/commands");

function state(doc: string, ranges: [number, number][], extensions = [] as any[]) {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h))),
    extensions: [EditorState.allowMultipleSelections.of(true), ...extensions],
  });
}

describe("copiedText (what CodeMirror copies)", () => {
  it("copies the selection", () => {
    expect(copiedText(state("# Title\n**bold** text", [[8, 16]]))).toEqual({ text: "**bold**", linewise: false });
  });

  it("joins several selections with line breaks", () => {
    expect(copiedText(state("one two three", [[0, 3], [8, 13]])).text).toBe("one\nthree");
  });

  it("copies whole lines for empty selections, once per line", () => {
    expect(copiedText(state("first\nsecond\nthird", [[2, 2], [3, 3], [15, 15]]))).toEqual({ text: "first\nthird", linewise: true });
  });

  it("applies clipboard output filters", () => {
    const upper = EditorView.clipboardOutputFilter.of((text: string) => text.toUpperCase());
    expect(copiedText(state("abc", [[0, 2]], [upper])).text).toBe("AB");
  });
});

describe("copyMarkdown", () => {
  it("hands the markdown to the callback", () => {
    const onCopy = vi.fn();
    const view = { state: state("Some **bold**", [[5, 13]]) };
    expect(copyMarkdown(onCopy)(view)).toBe(true);
    expect(onCopy).toHaveBeenCalledWith("**bold**");
  });

  it("does nothing on an empty line", () => {
    const onCopy = vi.fn();
    expect(copyMarkdown(onCopy)({ state: state("a\n\nb", [[2, 2]]) })).toBe(false);
    expect(onCopy).not.toHaveBeenCalled();
  });
});

describe("clipboardStillHolds (main's guard for the late HTML rewrite)", () => {
  it("is true only while the clipboard holds the copied markdown", () => {
    expect(clipboardStillHolds("# Note\n**b**", "# Note\n**b**")).toBe(true);
    expect(clipboardStillHolds("something newer", "# Note")).toBe(false);
    expect(clipboardStillHolds("", "# Note")).toBe(false);
    expect(clipboardStillHolds("", "")).toBe(false);
  });

  it("ignores CRLF line endings added by the Windows clipboard", () => {
    expect(clipboardStillHolds("a\r\nb\r\n", "a\nb\n")).toBe(true);
    expect(clipboardStillHolds("a\r\nb", "a\nc")).toBe(false);
  });

  it("caps the size at 50 MB", () => {
    expect(MAX_CLIPBOARD_LENGTH).toBe(50 * 1024 * 1024);
  });
});
