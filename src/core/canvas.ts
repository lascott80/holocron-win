// JSON Canvas files (".canvas", https://jsoncanvas.org/spec/1.0/): parsing
// and validation for the read-only viewer (UI-45), the drawing's bounds, and
// the geometry of edges between cards. Pure functions, no DOM, so the viewer
// and its tests share them.

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEnd = "none" | "arrow";

/** A preset "1"–"6" or a "#rrggbb" colour, as written in the file. */
export type CanvasColor = string;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export type CanvasNode =
  | (NodeBase & { type: "text"; text: string })
  | (NodeBase & { type: "file"; file: string; subpath?: string })
  | (NodeBase & { type: "link"; url: string })
  | (NodeBase & { type: "group"; label?: string });

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  /** Default "none". */
  fromEnd: CanvasEnd;
  /** Default "arrow". */
  toEnd: CanvasEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export type CanvasParseResult = { ok: true; canvas: CanvasData } | { ok: false; reason: string };

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const SIDES = new Set<string>(["top", "right", "bottom", "left"]);
const ENDS = new Set<string>(["none", "arrow"]);
const COLOR = /^#[0-9a-f]{6}$/i;

/** Preset colours "1"–"6" by name (REQUIREMENTS UI-45). */
export const PRESET_COLORS = ["red", "orange", "yellow", "green", "cyan", "purple"] as const;
export type PresetColor = (typeof PRESET_COLORS)[number];

/**
 * What a node's or edge's colour means: a preset family, a hex colour, or
 * nothing (the default look). Anything the spec doesn't allow counts as no colour.
 */
export function colorOf(color: CanvasColor | undefined): { preset: PresetColor } | { hex: string } | null {
  if (color === undefined) return null;
  const preset = /^[1-6]$/.test(color) ? PRESET_COLORS[Number(color) - 1] : null;
  if (preset) return { preset };
  if (COLOR.test(color)) return { hex: color.toLowerCase() };
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const optionalColor = (value: unknown): CanvasColor | undefined => (typeof value === "string" && colorOf(value) ? value : undefined);

/** A node as the spec describes it, or null (with why) when it can't be shown. */
function readNode(raw: unknown): CanvasNode | null {
  if (!isRecord(raw)) return null;
  const { id, type, x, y, width, height } = raw;
  if (typeof id !== "string" || id === "" || !finite(x) || !finite(y) || !finite(width) || !finite(height) || width < 0 || height < 0) return null;
  const base: NodeBase = { id, x, y, width, height };
  const color = optionalColor(raw.color);
  if (color !== undefined) base.color = color;
  switch (type) {
    case "text":
      return typeof raw.text === "string" ? { ...base, type, text: raw.text } : null;
    case "file": {
      if (typeof raw.file !== "string" || raw.file === "") return null;
      const subpath = optionalString(raw.subpath);
      return subpath !== undefined ? { ...base, type, file: raw.file, subpath } : { ...base, type, file: raw.file };
    }
    case "link":
      return typeof raw.url === "string" ? { ...base, type, url: raw.url } : null;
    case "group": {
      const label = optionalString(raw.label);
      return label !== undefined ? { ...base, type, label } : { ...base, type };
    }
    default:
      return null;
  }
}

function readEdge(raw: unknown, nodeIds: Set<string>): CanvasEdge | null {
  if (!isRecord(raw)) return null;
  const { id, fromNode, toNode } = raw;
  if (typeof id !== "string" || id === "" || typeof fromNode !== "string" || typeof toNode !== "string") return null;
  if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) return null;
  const edge: CanvasEdge = {
    id,
    fromNode,
    toNode,
    fromEnd: typeof raw.fromEnd === "string" && ENDS.has(raw.fromEnd) ? (raw.fromEnd as CanvasEnd) : "none",
    toEnd: typeof raw.toEnd === "string" && ENDS.has(raw.toEnd) ? (raw.toEnd as CanvasEnd) : "arrow",
  };
  if (typeof raw.fromSide === "string" && SIDES.has(raw.fromSide)) edge.fromSide = raw.fromSide as CanvasSide;
  if (typeof raw.toSide === "string" && SIDES.has(raw.toSide)) edge.toSide = raw.toSide as CanvasSide;
  const color = optionalColor(raw.color);
  if (color !== undefined) edge.color = color;
  const label = optionalString(raw.label);
  if (label !== undefined && label !== "") edge.label = label;
  return edge;
}

/**
 * Parses a .canvas file. Fails (with a reason for "Couldn’t read this
 * canvas: …") when the text isn't JSON, isn't a JSON Canvas object, or
 * declares a version other than 1.x. Nodes the spec doesn't allow and edges
 * whose ends don't exist are left out rather than failing the whole file;
 * duplicate ids keep the first.
 */
export function parseCanvas(text: string): CanvasParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    return { ok: false, reason: `it isn’t valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!isRecord(raw)) return { ok: false, reason: "it isn’t a JSON Canvas file" };
  if (raw.version !== undefined) {
    const version = String(raw.version);
    if (!/^1(\.\d+)*$/.test(version)) return { ok: false, reason: `version ${version} isn’t supported (Holocron reads JSON Canvas 1.0)` };
  }
  if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) return { ok: false, reason: "its nodes aren’t a list" };
  if (raw.edges !== undefined && !Array.isArray(raw.edges)) return { ok: false, reason: "its edges aren’t a list" };
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const item of (raw.nodes ?? []) as unknown[]) {
    const node = readNode(item);
    if (!node || ids.has(node.id)) continue;
    ids.add(node.id);
    nodes.push(node);
  }
  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const item of (raw.edges ?? []) as unknown[]) {
    const edge = readEdge(item, ids);
    if (!edge || edgeIds.has(edge.id)) continue;
    edgeIds.add(edge.id);
    edges.push(edge);
  }
  return { ok: true, canvas: { nodes, edges } };
}

/** The rectangle every node fits in, or null for an empty canvas. */
export function canvasBounds(nodes: readonly CanvasNode[]): Bounds | null {
  if (!nodes.length) return null;
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const node of nodes) {
    bounds.minX = Math.min(bounds.minX, node.x);
    bounds.minY = Math.min(bounds.minY, node.y);
    bounds.maxX = Math.max(bounds.maxX, node.x + node.width);
    bounds.maxY = Math.max(bounds.maxY, node.y + node.height);
  }
  return bounds;
}

/** What the status bar counts: cards (every node but groups) and connections. */
export function canvasCounts(canvas: CanvasData): { cards: number; connections: number } {
  return { cards: canvas.nodes.filter((node) => node.type !== "group").length, connections: canvas.edges.length };
}

/** The side of `from` an edge leaves by when the file doesn't say: facing the other node. */
export function autoSide(from: NodeBase, to: NodeBase): CanvasSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** The middle of a node's side, where an edge attaches. */
export function anchorPoint(node: NodeBase, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/** The outward unit vector of a side. */
export function sideNormal(side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

export interface EdgeGeometry {
  fromSide: CanvasSide;
  toSide: CanvasSide;
  /** Where the curve starts and ends (the anchors, pulled in for arrowheads). */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** The anchors on the cards themselves. */
  fromAnchor: { x: number; y: number };
  toAnchor: { x: number; y: number };
  /** An SVG path: a cubic Bézier leaving and arriving square to the sides. */
  path: string;
  /** The curve's midpoint, for the label. */
  mid: { x: number; y: number };
  /** Arrowhead polygons (three points each), when the ends have arrows. */
  fromArrow: string | null;
  toArrow: string | null;
}

/** The arrowhead's length (and half its width is `ARROW/2`), in canvas units. */
export const ARROW = 12;

/**
 * Lays out an edge between two nodes: sides from the file or facing each
 * other, a cubic Bézier whose control points leave the sides squarely, and
 * arrowheads at the ends that have one.
 */
export function edgeGeometry(edge: CanvasEdge, from: NodeBase, to: NodeBase): EdgeGeometry {
  const fromSide = edge.fromSide ?? autoSide(from, to);
  const toSide = edge.toSide ?? autoSide(to, from);
  const fromAnchor = anchorPoint(from, fromSide);
  const toAnchor = anchorPoint(to, toSide);
  const fromNormal = sideNormal(fromSide);
  const toNormal = sideNormal(toSide);
  // The curve stops short of the card so the arrow's tip, not its shaft, touches it.
  const start = edge.fromEnd === "arrow" ? { x: fromAnchor.x + fromNormal.x * ARROW, y: fromAnchor.y + fromNormal.y * ARROW } : fromAnchor;
  const end = edge.toEnd === "arrow" ? { x: toAnchor.x + toNormal.x * ARROW, y: toAnchor.y + toNormal.y * ARROW } : toAnchor;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const reach = Math.max(40, Math.min(200, distance / 2));
  const c1 = { x: start.x + fromNormal.x * reach, y: start.y + fromNormal.y * reach };
  const c2 = { x: end.x + toNormal.x * reach, y: end.y + toNormal.y * reach };
  const path = `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`;
  const mid = bezierPoint(start, c1, c2, end, 0.5);
  return {
    fromSide,
    toSide,
    start,
    end,
    fromAnchor,
    toAnchor,
    path,
    mid,
    fromArrow: edge.fromEnd === "arrow" ? arrowhead(fromAnchor, fromNormal) : null,
    toArrow: edge.toEnd === "arrow" ? arrowhead(toAnchor, toNormal) : null,
  };
}

/** A triangle whose tip is at `tip`, pointing against `normal` (into the card). */
function arrowhead(tip: { x: number; y: number }, normal: { x: number; y: number }): string {
  const base = { x: tip.x + normal.x * ARROW, y: tip.y + normal.y * ARROW };
  const side = { x: -normal.y * (ARROW / 2), y: normal.x * (ARROW / 2) };
  return [tip, { x: base.x + side.x, y: base.y + side.y }, { x: base.x - side.x, y: base.y - side.y }].map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

type Point = { x: number; y: number };

const round = (value: number) => Math.round(value * 100) / 100;
