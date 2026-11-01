// JSON Canvas parsing, validation and geometry for the read-only viewer (UI-45).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { anchorPoint, autoSide, canvasBounds, canvasCounts, colorOf, edgeGeometry, parseCanvas, type CanvasEdge, type CanvasNode } from "@core/canvas";
import { isCanvas } from "@core/paths";

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "sample.canvas"), "utf8");

function parsed() {
  const result = parseCanvas(fixture);
  if (!result.ok) throw new Error(result.reason);
  return result.canvas;
}

describe("isCanvas", () => {
  it("recognises the extension in any case", () => {
    expect(isCanvas("Board.canvas")).toBe(true);
    expect(isCanvas("Plans/Q4.CANVAS")).toBe(true);
    expect(isCanvas("Board.md")).toBe(false);
    expect(isCanvas("canvas")).toBe(false);
  });
});

describe("parseCanvas", () => {
  it("reads nodes of every type and keeps their fields", () => {
    const canvas = parsed();
    expect(canvas.nodes.map((node) => node.id)).toEqual(["group1", "text1", "file1", "image1", "link1"]);
    expect(canvas.nodes[0]).toEqual({ id: "group1", type: "group", x: -40, y: -60, width: 720, height: 360, label: "Planning", color: "4" });
    expect(canvas.nodes[1]).toMatchObject({ type: "text", text: "# Idea\n\nA **bold** thought with `code`.", color: "1" });
    expect(canvas.nodes[2]).toMatchObject({ type: "file", file: "Notes/Kyber.md", subpath: "#Crystals" });
    expect(canvas.nodes[3]).toMatchObject({ type: "file", file: "Attachments/pic.png", color: "#ff8800" });
    expect(canvas.nodes[4]).toMatchObject({ type: "link", url: "https://jsoncanvas.org/", color: "6" });
  });

  it("drops nodes the spec doesn't allow and duplicate ids", () => {
    const ids = parsed().nodes.map((node) => node.id);
    expect(ids).not.toContain("bad1"); // text without text
    expect(ids).not.toContain("bad2"); // unknown type
    expect(parsed().nodes.filter((node) => node.id === "text1")).toHaveLength(1);
    expect((parsed().nodes[1] as CanvasNode & { type: "text" }).text).not.toBe("duplicate id");
  });

  it("reads edges with their defaults and drops ones whose nodes don't exist", () => {
    const edges = parsed().edges;
    expect(edges.map((edge) => edge.id)).toEqual(["edge1", "edge2", "edge4"]);
    expect(edges[0]).toEqual({ id: "edge1", fromNode: "text1", toNode: "file1", fromSide: "right", toSide: "left", fromEnd: "none", toEnd: "arrow", label: "leads to", color: "2" });
    expect(edges[1]).toMatchObject({ fromEnd: "arrow", toEnd: "none" });
    expect(edges[1].fromSide).toBeUndefined();
    // An invalid side or colour is ignored rather than failing the edge.
    expect(edges[2]).toEqual({ id: "edge4", fromNode: "image1", toNode: "link1", fromEnd: "none", toEnd: "arrow" });
  });

  it("accepts an empty canvas and a 1.x version", () => {
    expect(parseCanvas("{}")).toEqual({ ok: true, canvas: { nodes: [], edges: [] } });
    expect(parseCanvas('{"version":"1.0","nodes":[],"edges":[]}').ok).toBe(true);
    expect(parseCanvas('﻿{"nodes":[]}').ok).toBe(true);
  });

  it("explains why a file can't be read", () => {
    const invalid = parseCanvas("{nodes: [");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toMatch(/^it isn’t valid JSON/);
    expect(parseCanvas("[1, 2]")).toEqual({ ok: false, reason: "it isn’t a JSON Canvas file" });
    expect(parseCanvas('"text"')).toEqual({ ok: false, reason: "it isn’t a JSON Canvas file" });
    expect(parseCanvas('{"version":"2.0"}')).toEqual({ ok: false, reason: "version 2.0 isn’t supported (Holocron reads JSON Canvas 1.0)" });
    expect(parseCanvas('{"nodes":{}}')).toEqual({ ok: false, reason: "its nodes aren’t a list" });
    expect(parseCanvas('{"edges":"x"}')).toEqual({ ok: false, reason: "its edges aren’t a list" });
  });
});

describe("canvasBounds and canvasCounts", () => {
  it("fits every node, groups included", () => {
    expect(canvasBounds(parsed().nodes)).toEqual({ minX: -40, minY: -60, maxX: 680, maxY: 300 });
    expect(canvasBounds([])).toBeNull();
  });

  it("counts cards (not groups) and connections", () => {
    expect(canvasCounts(parsed())).toEqual({ cards: 4, connections: 3 });
  });
});

describe("colorOf", () => {
  it("maps presets 1–6 and hex colours, ignoring anything else", () => {
    expect(colorOf("1")).toEqual({ preset: "red" });
    expect(colorOf("2")).toEqual({ preset: "orange" });
    expect(colorOf("3")).toEqual({ preset: "yellow" });
    expect(colorOf("4")).toEqual({ preset: "green" });
    expect(colorOf("5")).toEqual({ preset: "cyan" });
    expect(colorOf("6")).toEqual({ preset: "purple" });
    expect(colorOf("#FF8800")).toEqual({ hex: "#ff8800" });
    expect(colorOf("7")).toBeNull();
    expect(colorOf("red")).toBeNull();
    expect(colorOf("#fff")).toBeNull();
    expect(colorOf(undefined)).toBeNull();
  });
});

describe("edge geometry", () => {
  const box = (id: string, x: number, y: number): CanvasNode => ({ id, type: "text", text: "", x, y, width: 100, height: 50 });
  const edge = (over: Partial<CanvasEdge> = {}): CanvasEdge => ({ id: "e", fromNode: "a", toNode: "b", fromEnd: "none", toEnd: "arrow", ...over });

  it("anchors on the middle of each side", () => {
    const node = box("a", 10, 20);
    expect(anchorPoint(node, "top")).toEqual({ x: 60, y: 20 });
    expect(anchorPoint(node, "right")).toEqual({ x: 110, y: 45 });
    expect(anchorPoint(node, "bottom")).toEqual({ x: 60, y: 70 });
    expect(anchorPoint(node, "left")).toEqual({ x: 10, y: 45 });
  });

  it("picks the side facing the other node when the file doesn't say", () => {
    const a = box("a", 0, 0);
    expect(autoSide(a, box("b", 300, 0))).toBe("right");
    expect(autoSide(a, box("b", -300, 10))).toBe("left");
    expect(autoSide(a, box("b", 10, 300))).toBe("bottom");
    expect(autoSide(a, box("b", 0, -300))).toBe("top");
  });

  it("honours the written sides and ends", () => {
    const a = box("a", 0, 0);
    const b = box("b", 300, 0);
    const g = edgeGeometry(edge({ fromSide: "bottom", toSide: "top" }), a, b);
    expect(g.fromSide).toBe("bottom");
    expect(g.toSide).toBe("top");
    expect(g.fromAnchor).toEqual({ x: 50, y: 50 });
    expect(g.toAnchor).toEqual({ x: 350, y: 0 });
    expect(g.fromArrow).toBeNull();
    // The arrow's tip sits on the card; the curve stops where the arrow begins.
    expect(g.toArrow).toBe("350,0 356,-12 344,-12");
    expect(g.end).toEqual({ x: 350, y: -12 });
    expect(g.start).toEqual(g.fromAnchor);
    expect(g.path).toMatch(/^M 50 50 C .* 350 -12$/);
  });

  it("puts arrowheads on whichever ends ask for them and the label halfway along", () => {
    const a = box("a", 0, 0);
    const b = box("b", 300, 0);
    const both = edgeGeometry(edge({ fromEnd: "arrow", toEnd: "arrow" }), a, b);
    expect(both.fromArrow).toBe("100,25 112,31 112,19");
    expect(both.toArrow).toBe("300,25 288,19 288,31");
    expect(both.mid).toEqual({ x: 200, y: 25 });
    const none = edgeGeometry(edge({ toEnd: "none" }), a, b);
    expect(none.fromArrow).toBeNull();
    expect(none.toArrow).toBeNull();
    expect(none.start).toEqual({ x: 100, y: 25 });
    expect(none.end).toEqual({ x: 300, y: 25 });
  });
});
