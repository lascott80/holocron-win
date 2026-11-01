<!-- The pane tree (UI-40): a split lays its children out side by side or
     stacked, with a draggable divider between neighbours (shares are kept by
     main); a leaf is the primary pane or a PaneView. The primary pane's
     content (`main`, made once in App) is moved into its leaf rather than
     rendered there, so the editor survives every change to the tree. Every
     leaf takes a tab or a file-tree row dropped on one of its edges
     (highlighted) and splits there; the middle is left to the editor, which
     inserts a link. Clicking anywhere in a pane focuses it. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { MAIN_PANE, type LayoutNode } from "@core/layout";
  import { isCanvas, isNote } from "@core/paths";
  import PaneTree from "./PaneTree.svelte";
  import PaneView from "./PaneView.svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";

  let { node, main }: { node: LayoutNode; main: HTMLElement | undefined } = $props();

  /** Moves the primary pane's content into this leaf, and back where it came from when the leaf goes; scroll positions survive the move. */
  function adopt(slot: HTMLElement, content: HTMLElement | undefined) {
    let parking: HTMLElement | null = null;
    let current: HTMLElement | undefined;
    const take = (element: HTMLElement | undefined) => {
      current = element;
      if (!element || element.parentElement === slot) return;
      parking ??= element.parentElement;
      move(element, slot);
    };
    const move = (element: HTMLElement, into: HTMLElement) => {
      const scrolled = [...element.querySelectorAll<HTMLElement>(".cm-scroller, .stack")].map((el) => [el, el.scrollTop, el.scrollLeft] as const);
      into.appendChild(element);
      for (const [el, top, left] of scrolled) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    };
    take(content);
    return {
      update: take,
      destroy() {
        if (current && parking && current.parentElement === slot) move(current, parking);
      },
    };
  }

  const TAB_TYPE = "application/x-holocron-tab";
  const PATHS_TYPE = "application/x-holocron-paths";
  /** How far in from an edge (as a share of the pane) a drop still counts as that edge. */
  const EDGE = 0.22;
  /** The least a pane may be squeezed to by a divider, in px. */
  const MIN_PANE = 160;

  // ---- Resizing ----

  /** Shares while a divider is being dragged (main's own arrive when the drag ends). */
  let dragShares = $state<number[] | null>(null);
  let resizing = false;
  const shares = $derived(node.kind === "split" ? (dragShares ?? node.ratios) : []);

  // Main's new shares have arrived: show those again.
  $effect(() => {
    if (node.kind === "split") void node.ratios;
    if (!untrack(() => resizing)) dragShares = null;
  });

  function startResize(event: PointerEvent, index: number) {
    if (node.kind !== "split") return;
    event.preventDefault();
    const split = node;
    const handle = event.currentTarget as HTMLElement;
    const rect = handle.parentElement!.getBoundingClientRect();
    const total = Math.max(1, split.direction === "row" ? rect.width : rect.height);
    const start = split.direction === "row" ? event.clientX : event.clientY;
    const initial = [...split.ratios];
    const minShare = Math.min(0.45, MIN_PANE / total);
    resizing = true;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const delta = ((split.direction === "row" ? e.clientX : e.clientY) - start) / total;
      const pair = initial[index] + initial[index + 1];
      const first = Math.min(pair - minShare, Math.max(minShare, initial[index] + delta));
      const next = [...initial];
      next[index] = first;
      next[index + 1] = pair - first;
      dragShares = next;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      resizing = false;
      if (dragShares) run("setPaneRatios", split.id, dragShares);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  // ---- Drops of tabs and file-tree rows (UI-40) ----

  type Zone = "left" | "right" | "top" | "bottom";
  let zone = $state<Zone | null>(null);

  function internalDrag(event: DragEvent) {
    const types = event.dataTransfer?.types ?? [];
    return types.includes(TAB_TYPE) || types.includes(PATHS_TYPE);
  }

  function zoneAt(event: DragEvent): Zone | null {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) / Math.max(1, rect.height);
    if (x < EDGE) return "left";
    if (x > 1 - EDGE) return "right";
    if (y < EDGE) return "top";
    if (y > 1 - EDGE) return "bottom";
    return null;
  }

  function onDragOver(event: DragEvent) {
    if (!internalDrag(event)) return;
    zone = zoneAt(event);
    if (!zone) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: DragEvent) {
    const into = event.relatedTarget;
    if (!(into instanceof Node) || !(event.currentTarget as HTMLElement).contains(into)) zone = null;
  }

  /** The note or canvas dragged: a tab's, or the first in a file-tree drag. */
  function droppedPath(event: DragEvent): string | null {
    const transfer = event.dataTransfer;
    if (!transfer) return null;
    const tabId = transfer.getData(TAB_TYPE);
    if (tabId) return app.vault?.tabs.find((tab) => tab.id === tabId)?.path ?? null;
    const paths = transfer.getData(PATHS_TYPE);
    if (!paths) return null;
    try {
      const list: unknown = JSON.parse(paths);
      return (Array.isArray(list) ? list : []).find((path): path is string => typeof path === "string" && (isNote(path) || isCanvas(path))) ?? null;
    } catch {
      return null;
    }
  }

  function onDrop(event: DragEvent, paneId: string) {
    const where = zone && internalDrag(event) ? zoneAt(event) : null;
    zone = null;
    if (!where) return;
    const path = droppedPath(event);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    run("splitPane", paneId, where === "left" || where === "right" ? "row" : "column", path, where === "left" || where === "top");
  }
</script>

{#if node.kind === "pane"}
  <div
    class="leaf"
    role="presentation"
    ondragovercapture={onDragOver}
    ondragleave={onDragLeave}
    ondropcapture={(event) => onDrop(event, node.id)}
    onfocusincapture={() => app.focusPane(node.id)}
    onpointerdowncapture={() => app.focusPane(node.id)}
  >
    {#if node.id === MAIN_PANE}
      <div class="main-slot" use:adopt={main}></div>
    {:else}
      <PaneView leaf={node} />
    {/if}
    {#if zone}
      <div class="drop-zone {zone}" aria-hidden="true"></div>
    {/if}
  </div>
{:else}
  <div class="split {node.direction}">
    {#each node.children as child, index (child.id)}
      {#if index > 0}
        <div class="divider" role="separator" aria-orientation={node.direction === "row" ? "vertical" : "horizontal"} onpointerdown={(event) => startResize(event, index - 1)}></div>
      {/if}
      <div class="child" style:flex="{shares[index] ?? 1} 1 0">
        <PaneTree node={child} {main} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .leaf {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .main-slot {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .split {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .split.row {
    flex-direction: row;
  }
  .split.column {
    flex-direction: column;
  }
  .child {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .divider {
    flex: none;
    position: relative;
    z-index: 5;
    background: var(--ui-border);
  }
  .row > .divider {
    width: 1px;
    cursor: col-resize;
  }
  .column > .divider {
    height: 1px;
    cursor: row-resize;
  }
  .divider::after {
    content: "";
    position: absolute;
    inset: 0;
  }
  .row > .divider::after {
    inset: 0 -3px;
  }
  .column > .divider::after {
    inset: -3px 0;
  }
  .divider:hover {
    background: rgba(var(--ui-accent-rgb), 0.5);
  }
  /* The edge a dragged tab or note will split off. */
  .drop-zone {
    position: absolute;
    z-index: 6;
    pointer-events: none;
    background: rgba(var(--ui-accent-rgb), 0.18);
    border: 2px solid rgba(var(--ui-accent-rgb), 0.6);
    border-radius: 8px;
  }
  .drop-zone.left {
    inset: 6px auto 6px 6px;
    width: calc(50% - 9px);
  }
  .drop-zone.right {
    inset: 6px 6px 6px auto;
    width: calc(50% - 9px);
  }
  .drop-zone.top {
    inset: 6px 6px auto 6px;
    height: calc(50% - 9px);
  }
  .drop-zone.bottom {
    inset: auto 6px 6px 6px;
    height: calc(50% - 9px);
  }
</style>
