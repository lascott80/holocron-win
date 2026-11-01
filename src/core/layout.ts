// The detail column's pane layout (UI-40, UI-47): a tree of splits whose
// leaves are panes. The primary pane ("main") shows the active tab and is
// never removed; every other pane shows one file of its own. Pure and
// immutable: every operation returns a new layout.

export type SplitDirection = "row" | "column";
export type PaneMode = "live" | "source" | "reading";

export interface PaneLeaf {
  kind: "pane";
  id: string;
  /** The vault path shown (a note or a canvas), or null for an empty pane. Ignored for the primary pane. */
  path: string | null;
  /** Follows the primary pane's file and scroll position (UI-47). */
  linked?: boolean;
  /** The pane's own view mode; unset follows the editor mode setting. */
  mode?: PaneMode;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  /** "row": children side by side; "column": stacked top to bottom. */
  direction: SplitDirection;
  children: LayoutNode[];
  /** One share per child, summing to 1. */
  ratios: number[];
}

export type LayoutNode = PaneLeaf | PaneSplit;

export interface Layout {
  root: LayoutNode;
  /** The pane commands act on: the one last clicked. */
  focused: string;
}

export const MAIN_PANE = "main";
export const MAX_PANES = 8;

export function singlePane(): Layout {
  return { root: { kind: "pane", id: MAIN_PANE, path: null }, focused: MAIN_PANE };
}

/** Every pane in reading order (left to right, top to bottom). */
export function leaves(node: LayoutNode): PaneLeaf[] {
  return node.kind === "pane" ? [node] : node.children.flatMap(leaves);
}

export function findLeaf(layout: Layout, id: string): PaneLeaf | null {
  return leaves(layout.root).find((leaf) => leaf.id === id) ?? null;
}

function splits(node: LayoutNode): PaneSplit[] {
  return node.kind === "pane" ? [] : [node, ...node.children.flatMap(splits)];
}

export function findSplit(layout: Layout, id: string): PaneSplit | null {
  return splits(layout.root).find((split) => split.id === id) ?? null;
}

export function paneCount(layout: Layout): number {
  return leaves(layout.root).length;
}

/** Equal shares for `count` children. */
function evenRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeRatios(ratios: number[], count: number): number[] {
  const clean = ratios.slice(0, count).map((r) => (Number.isFinite(r) && r > 0 ? r : 0));
  while (clean.length < count) clean.push(0);
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return evenRatios(count);
  return clean.map((r) => (r > 0 ? r / total : 0)).map((r) => (r > 0 ? r : 0.0001 / count));
}

/**
 * Splits pane `targetId` in `direction`, putting `leaf` after it (or before
 * it). A target already inside a split of that direction gets a new sibling
 * (half of its share); otherwise it's replaced by a two-way split. Returns
 * null when the target doesn't exist or the layout already has MAX_PANES.
 */
export function splitPane(layout: Layout, targetId: string, direction: SplitDirection, leaf: PaneLeaf, before = false, splitId = `split-${leaf.id}`): Layout | null {
  if (!findLeaf(layout, targetId) || paneCount(layout) >= MAX_PANES) return null;
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") {
      if (node.id !== targetId) return node;
      return { kind: "split", id: splitId, direction, children: before ? [leaf, node] : [node, leaf], ratios: [0.5, 0.5] };
    }
    const index = node.children.findIndex((child) => child.kind === "pane" && child.id === targetId);
    if (index >= 0 && node.direction === direction) {
      const children = [...node.children];
      const ratios = [...node.ratios];
      const share = ratios[index] / 2;
      ratios[index] = share;
      children.splice(before ? index : index + 1, 0, leaf);
      ratios.splice(before ? index : index + 1, 0, share);
      return { ...node, children, ratios };
    }
    return { ...node, children: node.children.map(insert) };
  };
  return { root: insert(layout.root), focused: layout.focused };
}

/**
 * Removes a pane; a split left with one child collapses into it. The primary
 * pane can't be removed. When the removed pane was focused, the pane before
 * it in reading order (else the first) takes the focus.
 */
export function removePane(layout: Layout, id: string): Layout {
  if (id === MAIN_PANE || !findLeaf(layout, id)) return layout;
  const order = leaves(layout.root).map((leaf) => leaf.id);
  const remove = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === "pane") return node.id === id ? null : node;
    const kept: LayoutNode[] = [];
    const ratios: number[] = [];
    node.children.forEach((child, index) => {
      const next = remove(child);
      if (next) {
        kept.push(next);
        ratios.push(node.ratios[index]);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    return { ...node, children: kept, ratios: normalizeRatios(ratios, kept.length) };
  };
  const root = remove(layout.root) ?? { kind: "pane", id: MAIN_PANE, path: null };
  let focused = layout.focused;
  if (focused === id) {
    const index = order.indexOf(id);
    focused = order[index - 1] ?? order.find((other) => other !== id) ?? MAIN_PANE;
  }
  return { root, focused };
}

/** Changes a pane's path, link or mode. */
export function updatePane(layout: Layout, id: string, patch: Partial<Omit<PaneLeaf, "kind" | "id">>): Layout {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") return node.id === id ? { ...node, ...patch } : node;
    return { ...node, children: node.children.map(update) };
  };
  return { root: update(layout.root), focused: layout.focused };
}

/** New shares for a split's children (normalised to sum to 1). */
export function setRatios(layout: Layout, splitId: string, ratios: number[]): Layout {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") return node;
    if (node.id === splitId) return { ...node, ratios: normalizeRatios(ratios, node.children.length) };
    return { ...node, children: node.children.map(update) };
  };
  return { root: update(layout.root), focused: layout.focused };
}

export function focusPane(layout: Layout, id: string): Layout {
  return findLeaf(layout, id) ? { root: layout.root, focused: id } : layout;
}

/** The pane `delta` steps from `id` in reading order, wrapping around. */
export function neighbourPane(layout: Layout, id: string, delta: 1 | -1): string {
  const order = leaves(layout.root).map((leaf) => leaf.id);
  const index = Math.max(0, order.indexOf(id));
  return order[(index + delta + order.length) % order.length];
}

/** Rewrites every pane's path (after files were renamed or moved). */
export function mapPaths(layout: Layout, transform: (path: string) => string): Layout {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") return node.path === null ? node : { ...node, path: transform(node.path) };
    return { ...node, children: node.children.map(update) };
  };
  return { root: update(layout.root), focused: layout.focused };
}

/**
 * A layout read from storage, checked: the shape is repaired, panes whose
 * file fails `keep` are dropped (an empty primary pane stays), a missing
 * primary pane is added at the left, and the focus is clamped. `newId`
 * names a split that lacks one.
 */
export function sanitizeLayout(raw: unknown, keep: (path: string) => boolean, newId: () => string): Layout {
  const seen = new Set<string>();
  const read = (value: unknown): LayoutNode | null => {
    if (!value || typeof value !== "object") return null;
    const node = value as Record<string, unknown>;
    if (node.kind === "pane") {
      const id = typeof node.id === "string" && node.id !== "" && !seen.has(node.id) ? node.id : null;
      if (!id) return null;
      seen.add(id);
      const path = typeof node.path === "string" && node.path !== "" ? node.path : null;
      if (id !== MAIN_PANE && path !== null && !keep(path)) return null;
      const leaf: PaneLeaf = { kind: "pane", id, path: id === MAIN_PANE ? null : path };
      if (node.linked === true) leaf.linked = true;
      if (node.mode === "live" || node.mode === "source" || node.mode === "reading") leaf.mode = node.mode;
      return leaf;
    }
    if (node.kind !== "split" || !Array.isArray(node.children)) return null;
    const direction: SplitDirection = node.direction === "column" ? "column" : "row";
    const children: LayoutNode[] = [];
    const ratios: number[] = [];
    const storedRatios = Array.isArray(node.ratios) ? (node.ratios as unknown[]) : [];
    node.children.forEach((child, index) => {
      const next = read(child);
      if (!next) return;
      children.push(next);
      const ratio = storedRatios[index];
      ratios.push(typeof ratio === "number" ? ratio : 0);
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    const id = typeof node.id === "string" && node.id !== "" ? node.id : newId();
    return { kind: "split", id, direction, children, ratios: normalizeRatios(ratios, children.length) };
  };
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let root = read(stored.root) ?? { kind: "pane", id: MAIN_PANE, path: null };
  if (!leaves(root).some((leaf) => leaf.id === MAIN_PANE)) {
    const main: PaneLeaf = { kind: "pane", id: MAIN_PANE, path: null };
    root = { kind: "split", id: newId(), direction: "row", children: [main, root], ratios: [0.5, 0.5] };
  }
  while (leaves(root).length > MAX_PANES) {
    const extra = leaves(root).filter((leaf) => leaf.id !== MAIN_PANE).at(-1)!;
    root = removePane({ root, focused: MAIN_PANE }, extra.id).root;
  }
  const focused = typeof stored.focused === "string" && leaves(root).some((leaf) => leaf.id === stored.focused) ? stored.focused : MAIN_PANE;
  return { root, focused };
}

/**
 * Linked scrolling (UI-47): the line of a note of `toLines` lines that sits
 * at the same proportion of the way through as `line` does in a note of
 * `fromLines` lines. Lines are 1-based and may be fractional (a part-way
 * scrolled line); the result is clamped to the target.
 */
export function proportionalLine(line: number, fromLines: number, toLines: number): number {
  const from = Math.max(1, fromLines);
  const to = Math.max(1, toLines);
  if (from <= 1 || to <= 1) return 1;
  const fraction = Math.min(1, Math.max(0, (line - 1) / (from - 1)));
  return 1 + fraction * (to - 1);
}
