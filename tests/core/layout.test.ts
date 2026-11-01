// The pane tree (UI-40, UI-47): splitting, closing, focus, ratios, repair of a stored layout, linked-scroll maths.

import { describe, expect, it } from "vitest";
import {
  findLeaf,
  findSplit,
  focusPane,
  leaves,
  MAIN_PANE,
  mapPaths,
  MAX_PANES,
  neighbourPane,
  paneCount,
  proportionalLine,
  removePane,
  sanitizeLayout,
  setRatios,
  singlePane,
  splitPane,
  updatePane,
  type Layout,
  type PaneLeaf,
} from "../../src/core/layout";

const pane = (id: string, path: string | null = `${id}.md`): PaneLeaf => ({ kind: "pane", id, path });
const ids = (layout: Layout) => leaves(layout.root).map((leaf) => leaf.id);

describe("splitPane", () => {
  it("replaces a pane with a two-way split, the new pane after it", () => {
    const layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    expect(layout.root).toMatchObject({ kind: "split", direction: "row", ratios: [0.5, 0.5] });
    expect(ids(layout)).toEqual([MAIN_PANE, "a"]);
  });

  it("puts the new pane before the target when asked", () => {
    const layout = splitPane(singlePane(), MAIN_PANE, "column", pane("a"), true)!;
    expect(ids(layout)).toEqual(["a", MAIN_PANE]);
    expect((layout.root as { direction: string }).direction).toBe("column");
  });

  it("adds a sibling (half the target's share) when the split already runs that way", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    layout = setRatios(layout, (layout.root as { id: string }).id, [0.6, 0.4]);
    layout = splitPane(layout, "a", "row", pane("b"))!;
    expect(layout.root.kind).toBe("split");
    expect(ids(layout)).toEqual([MAIN_PANE, "a", "b"]);
    expect((layout.root as { ratios: number[] }).ratios.map((r) => Math.round(r * 100))).toEqual([60, 20, 20]);
  });

  it("nests a split of the other direction", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    layout = splitPane(layout, "a", "column", pane("b"))!;
    const root = layout.root as { children: Layout["root"][] };
    expect(root.children[1]).toMatchObject({ kind: "split", direction: "column" });
    expect(ids(layout)).toEqual([MAIN_PANE, "a", "b"]);
  });

  it("refuses an unknown target and a ninth pane", () => {
    expect(splitPane(singlePane(), "nope", "row", pane("a"))).toBeNull();
    let layout = singlePane();
    for (let i = 1; i < MAX_PANES; i++) layout = splitPane(layout, MAIN_PANE, "row", pane(`p${i}`))!;
    expect(paneCount(layout)).toBe(MAX_PANES);
    expect(splitPane(layout, MAIN_PANE, "row", pane("extra"))).toBeNull();
  });
});

describe("removePane", () => {
  it("collapses a split left with one child and moves the focus to the previous pane", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    layout = splitPane(layout, "a", "column", pane("b"))!;
    layout = focusPane(layout, "b");
    layout = removePane(layout, "b");
    expect(ids(layout)).toEqual([MAIN_PANE, "a"]);
    expect(layout.root.kind).toBe("split");
    expect(layout.focused).toBe("a");
    layout = removePane(layout, "a");
    expect(layout.root).toEqual({ kind: "pane", id: MAIN_PANE, path: null });
    expect(layout.focused).toBe(MAIN_PANE);
  });

  it("renormalises the remaining shares", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    layout = splitPane(layout, "a", "row", pane("b"))!;
    layout = setRatios(layout, (layout.root as { id: string }).id, [0.5, 0.25, 0.25]);
    layout = removePane(layout, "a");
    expect((layout.root as { ratios: number[] }).ratios.map((r) => Math.round(r * 100))).toEqual([67, 33]);
  });

  it("never removes the primary pane", () => {
    const layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    expect(removePane(layout, MAIN_PANE)).toBe(layout);
  });
});

describe("focus, neighbours, updates and paths", () => {
  it("cycles through panes in reading order, wrapping", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    layout = splitPane(layout, "a", "column", pane("b"))!;
    expect(neighbourPane(layout, MAIN_PANE, 1)).toBe("a");
    expect(neighbourPane(layout, "b", 1)).toBe(MAIN_PANE);
    expect(neighbourPane(layout, MAIN_PANE, -1)).toBe("b");
  });

  it("ignores focus on a pane that doesn't exist", () => {
    const layout = singlePane();
    expect(focusPane(layout, "nope").focused).toBe(MAIN_PANE);
  });

  it("updates a pane's path, link and mode, and remaps paths", () => {
    let layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a", "Old.md"))!;
    layout = updatePane(layout, "a", { linked: true, mode: "reading" });
    expect(findLeaf(layout, "a")).toMatchObject({ path: "Old.md", linked: true, mode: "reading" });
    layout = mapPaths(layout, (path) => (path === "Old.md" ? "New.md" : path));
    expect(findLeaf(layout, "a")?.path).toBe("New.md");
  });

  it("normalises ratios to sum to one", () => {
    const layout = splitPane(singlePane(), MAIN_PANE, "row", pane("a"))!;
    const id = (layout.root as { id: string }).id;
    expect(findSplit(setRatios(layout, id, [3, 1]), id)?.ratios).toEqual([0.75, 0.25]);
    expect(findSplit(setRatios(layout, id, [0, 0]), id)?.ratios).toEqual([0.5, 0.5]);
  });
});

describe("sanitizeLayout", () => {
  const keep = (path: string) => path !== "Gone.md";
  let n = 0;
  const newId = () => `id${++n}`;

  it("drops panes whose file is gone and collapses what's left", () => {
    const stored = {
      root: { kind: "split", id: "s", direction: "row", children: [pane(MAIN_PANE), pane("a", "Gone.md"), pane("b", "B.md")], ratios: [0.5, 0.25, 0.25] },
      focused: "a",
    };
    const layout = sanitizeLayout(stored, keep, newId);
    expect(ids(layout)).toEqual([MAIN_PANE, "b"]);
    expect((layout.root as { ratios: number[] }).ratios.map((r) => Math.round(r * 100))).toEqual([67, 33]);
    expect(layout.focused).toBe(MAIN_PANE);
  });

  it("keeps a linked pane's flags, an empty pane, and gives a split without an id one", () => {
    const stored = { root: { kind: "split", direction: "column", children: [pane(MAIN_PANE), { ...pane("a", null), linked: true, mode: "source" }] }, focused: "a" };
    const layout = sanitizeLayout(stored, keep, newId);
    expect(layout.root).toMatchObject({ kind: "split", id: expect.stringMatching(/^id/), direction: "column", ratios: [0.5, 0.5] });
    expect(findLeaf(layout, "a")).toEqual({ kind: "pane", id: "a", path: null, linked: true, mode: "source" });
    expect(layout.focused).toBe("a");
  });

  it("adds a missing primary pane and falls back to a single pane for junk", () => {
    expect(sanitizeLayout({ root: pane("a", "A.md") }, keep, newId).root).toMatchObject({ kind: "split", children: [{ id: MAIN_PANE }, { id: "a" }] });
    expect(sanitizeLayout(undefined, keep, newId)).toEqual(singlePane());
    expect(sanitizeLayout({ root: { kind: "split", children: "x" } }, keep, newId)).toEqual(singlePane());
    expect(sanitizeLayout({ root: { kind: "pane", id: "dup" }, focused: 3 }, keep, newId).root.kind).toBe("split");
  });

  it("trims a stored layout down to MAX_PANES", () => {
    const children = [pane(MAIN_PANE), ...Array.from({ length: 10 }, (_, i) => pane(`p${i}`))];
    const layout = sanitizeLayout({ root: { kind: "split", id: "s", direction: "row", children } }, keep, newId);
    expect(paneCount(layout)).toBe(MAX_PANES);
    expect(ids(layout)[0]).toBe(MAIN_PANE);
  });
});

describe("proportionalLine (linked scrolling)", () => {
  it("maps the same proportion of the way through, fractions included", () => {
    expect(proportionalLine(1, 100, 50)).toBe(1);
    expect(proportionalLine(100, 100, 50)).toBe(50);
    expect(proportionalLine(51, 101, 11)).toBe(6);
    expect(proportionalLine(5.5, 10, 19)).toBeCloseTo(10);
  });

  it("clamps out-of-range lines and handles one-line notes", () => {
    expect(proportionalLine(200, 100, 50)).toBe(50);
    expect(proportionalLine(-3, 100, 50)).toBe(1);
    expect(proportionalLine(1, 1, 40)).toBe(1);
    expect(proportionalLine(20, 40, 1)).toBe(1);
  });

  it("round-trips without drift", () => {
    const there = proportionalLine(37, 120, 60);
    expect(proportionalLine(there, 60, 120)).toBeCloseTo(37);
  });
});
