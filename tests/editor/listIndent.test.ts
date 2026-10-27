import { describe, expect, it } from "vitest";
import { shiftListItem } from "../../src/editor/commands.js";
import { makeView } from "./helpers";

/** Runs Tab (1) or Shift-Tab (-1) with the cursor at the end of the line containing `on`. */
const run = (doc: string, on: string, direction = 1) => {
  const line = doc.split("\n").findIndex((text) => text.includes(on));
  const cursor = doc.split("\n").slice(0, line + 1).join("\n").length;
  const view = makeView(doc, cursor);
  const handled = shiftListItem(view, direction);
  return { handled, doc: view.state.doc.toString() };
};

describe("Tab on a list item", () => {
  it("nests a numbered item under the one above, starting at 1", () => {
    expect(run("1. a\n2. b", "b").doc).toBe("1. a\n   1. b");
    expect(run("1. a\n2. ", "2.").doc).toBe("1. a\n   1. ");
  });
  it("continues the numbering of existing children and closes the gap it leaves", () => {
    expect(run("1. a\n   1. x\n2. b\n3. c", "b").doc).toBe("1. a\n   1. x\n   2. b\n2. c");
  });
  it("carries its children along", () => {
    expect(run("1. a\n2. b\n   1. x\n3. c", "b").doc).toBe("1. a\n   1. b\n      1. x\n2. c");
  });
  it("uses the content column of wider markers and bullets", () => {
    expect(run("10. a\n11. b", "b").doc).toBe("10. a\n    1. b");
    expect(run("- a\n- b", "b").doc).toBe("- a\n  - b");
    expect(run("- a\n1. b", "b").doc).toBe("- a\n  1. b");
  });
  it("keeps a lazy list lazy and keeps the ) delimiter", () => {
    expect(run("1. a\n1. b\n1. c", "b").doc).toBe("1. a\n   1. b\n1. c");
    expect(run("1) a\n2) b", "b").doc).toBe("1) a\n   1) b");
  });
  it("falls through when there's nothing to nest under", () => {
    expect(run("1. a", "a").handled).toBe(false);
    expect(run("1. a\n   1. b", "b").handled).toBe(false);
    expect(run("plain", "plain").handled).toBe(false);
  });
});

describe("Shift-Tab on a list item", () => {
  it("moves a nested item back out and numbers it after its parent", () => {
    expect(run("1. a\n   1. b\n2. c", "b", -1).doc).toBe("1. a\n2. b\n3. c");
  });
  it("leaves the siblings below it as its children, renumbered from 1", () => {
    expect(run("1. a\n   1. x\n   2. b\n   3. y", "b", -1).doc).toBe("1. a\n   1. x\n2. b\n   1. y");
  });
  it("falls through at the top level", () => {
    expect(run("1. a", "a", -1).handled).toBe(false);
  });
});
