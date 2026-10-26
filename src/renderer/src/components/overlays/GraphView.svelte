<!-- Graph view (UI-42): notes as dots, links as lines, laid out by a force
     simulation on a canvas. Drag the background to pan, scroll to zoom, drag
     a dot to move it; hovering lights up a note's neighbours; clicking opens
     the note. "This note" shows only the notes within 1–2 links of the open one. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
  import { Waypoints, X } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Checkbox from "./Checkbox.svelte";
  import Segmented from "./Segmented.svelte";

  interface RawGraph {
    nodes: { id: string; title: string; tags: string[]; missing: boolean }[];
    edges: [string, string][];
  }
  interface Node extends SimulationNodeDatum {
    id: string;
    title: string;
    missing: boolean;
    degree: number;
  }
  type Link = SimulationLinkDatum<Node> & { source: Node; target: Node };

  let raw = $state<RawGraph | null>(null);
  let scope = $state<"vault" | "local">(app.graphScope);
  let depth = $state(app.graphDepth);
  let showOrphans = $state(true);
  let showMissing = $state(false);
  let query = $state("");
  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let counts = $state({ nodes: 0, links: 0 });

  const current = $derived(app.doc?.path ?? null);
  const close = () => (app.graphOpen = false);

  onMount(() => {
    void call<RawGraph>("graphData").then((graph) => (raw = graph));
  });

  // ---------- Building what's shown ----------

  let nodes: Node[] = [];
  let links: Link[] = [];
  let neighbours = new Map<string, Set<string>>();
  let simulation: Simulation<Node, Link> | null = null;

  function build(graph: RawGraph) {
    const keep = new Set<string>();
    const adjacency = new Map<string, Set<string>>();
    const touch = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)!.add(b);
    };
    for (const [a, b] of graph.edges) {
      touch(a, b);
      touch(b, a);
    }
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    if (scope === "local" && current && byId.has(current)) {
      // Breadth-first from the open note.
      let frontier = [current];
      keep.add(current);
      for (let step = 0; step < depth; step++) {
        const next: string[] = [];
        for (const id of frontier) for (const other of adjacency.get(id) ?? []) if (!keep.has(other)) (keep.add(other), next.push(other));
        frontier = next;
      }
    } else {
      for (const node of graph.nodes) keep.add(node.id);
    }
    for (const id of [...keep]) {
      const node = byId.get(id);
      if (!node || (node.missing && !showMissing) || (!showOrphans && !adjacency.get(id)?.size && id !== current)) keep.delete(id);
    }
    // Keep positions of notes already on screen, so toggling a filter doesn't scramble the layout.
    const previous = new Map(nodes.map((node) => [node.id, node]));
    nodes = [...keep].map((id) => {
      const node = byId.get(id)!;
      const old = previous.get(id);
      return { id, title: node.title, missing: node.missing, degree: 0, x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
    });
    const index = new Map(nodes.map((node) => [node.id, node]));
    links = graph.edges
      .filter(([a, b]) => index.has(a) && index.has(b))
      .map(([a, b]) => ({ source: index.get(a)!, target: index.get(b)! }));
    neighbours = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    for (const link of links) {
      link.source.degree++;
      link.target.degree++;
      neighbours.get(link.source.id)!.add(link.target.id);
      neighbours.get(link.target.id)!.add(link.source.id);
    }
    counts = { nodes: nodes.length, links: links.length };

    simulation?.stop();
    simulation = forceSimulation<Node, Link>(nodes)
      .force("link", forceLink<Node, Link>(links).id((node) => node.id).distance(46).strength(0.6))
      .force("charge", forceManyBody<Node>().strength(-90).distanceMax(420))
      .force("collide", forceCollide<Node>((node) => radius(node) + 3))
      .force("center", forceCenter(0, 0))
      // A gentle pull to the middle keeps unlinked notes from drifting away.
      .force("x", forceX<Node>(0).strength(0.04))
      .force("y", forceY<Node>(0).strength(0.04))
      .alpha(previous.size ? 0.5 : 1)
      .on("tick", () => {
        if (!userMoved) fit();
        draw();
      });
    userMoved = false;
  }

  /** Until you pan or zoom, the view keeps the whole graph in sight as it settles. */
  let userMoved = false;

  function fit() {
    if (!nodes.length || !size.width) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x ?? 0);
      maxX = Math.max(maxX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
      maxY = Math.max(maxY, node.y ?? 0);
    }
    const margin = 70;
    const k = Math.max(0.15, Math.min(2.2, (size.width - margin * 2) / Math.max(1, maxX - minX), (size.height - margin * 2) / Math.max(1, maxY - minY)));
    view = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
  }

  function refit() {
    userMoved = false;
    fit();
    draw();
  }

  $effect(() => {
    if (!raw) return;
    void [scope, depth, showOrphans, showMissing, current];
    build(raw);
    app.graphScope = scope;
    app.graphDepth = depth;
  });

  // ---------- Drawing ----------

  let view = { x: 0, y: 0, k: 1 };
  let hovered: Node | null = null;
  let dragged: Node | null = null;
  let size = { width: 0, height: 0 };

  const radius = (node: Node) => 3.5 + Math.min(9, Math.sqrt(node.degree) * 1.6);

  function colours() {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      node: get("--ui-text-3", "#888"),
      missing: get("--ui-faint", "#aaa"),
      link: get("--ui-strong-border", "#ccc"),
      accent: get("--ui-accent", "#3b82f6"),
      text: get("--ui-text", "#222"),
      label: get("--ui-text-2", "#555"),
      background: get("--ui-editor", "#fff"),
    };
  }
  let palette = colours();

  function toScreen(node: Node) {
    return { x: (node.x ?? 0) * view.k + view.x + size.width / 2, y: (node.y ?? 0) * view.k + view.y + size.height / 2 };
  }

  function draw() {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const focus = hovered ?? dragged;
    const lit = focus ? neighbours.get(focus.id) : null;
    const needle = query.trim().toLowerCase();
    const matches = (node: Node) => !needle || node.title.toLowerCase().includes(needle);
    const dimmed = (node: Node) => (focus ? node !== focus && !lit?.has(node.id) : !matches(node));

    context.lineWidth = 1;
    for (const link of links) {
      const a = toScreen(link.source);
      const b = toScreen(link.target);
      const active = focus && (link.source === focus || link.target === focus);
      context.globalAlpha = active ? 0.95 : focus || needle ? 0.12 : 0.55;
      context.strokeStyle = active ? palette.accent : palette.link;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
    for (const node of nodes) {
      const p = toScreen(node);
      const r = radius(node) * Math.max(0.6, Math.min(view.k, 1.6));
      context.globalAlpha = dimmed(node) ? 0.2 : 1;
      context.fillStyle = node.id === current || node === focus ? palette.accent : node.missing ? palette.background : palette.node;
      context.beginPath();
      context.arc(p.x, p.y, r, 0, Math.PI * 2);
      context.fill();
      if (node.missing) {
        context.strokeStyle = palette.missing;
        context.setLineDash([2, 2]);
        context.stroke();
        context.setLineDash([]);
      }
    }
    // Labels: the hovered note and its neighbours, search matches, the open note,
    // and everything once zoomed in enough to read.
    context.font = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "top";
    for (const node of nodes) {
      const show = node === focus || lit?.has(node.id) || node.id === current || (needle && matches(node)) || (!focus && view.k >= 1.25) || (!focus && !needle && node.degree >= 8 && view.k >= 0.8);
      if (!show) continue;
      const p = toScreen(node);
      context.globalAlpha = dimmed(node) ? 0.3 : 1;
      context.fillStyle = node === focus ? palette.text : palette.label;
      context.fillText(node.title.length > 40 ? node.title.slice(0, 39) + "…" : node.title, p.x, p.y + radius(node) * Math.min(view.k, 1.6) + 3);
    }
    context.globalAlpha = 1;
  }

  // Redraw when the search changes (the simulation may have settled).
  $effect(() => {
    void query;
    draw();
  });

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (!stage || !canvas) return;
      const ratio = window.devicePixelRatio || 1;
      size = { width: stage.clientWidth, height: stage.clientHeight };
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      palette = colours();
      draw();
    });
    if (stage) observer.observe(stage);
    return () => {
      observer.disconnect();
      simulation?.stop();
    };
  });

  // ---------- Pointer ----------

  function nodeAt(clientX: number, clientY: number): Node | null {
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let best: Node | null = null;
    let bestDistance = Infinity;
    for (const node of nodes) {
      const p = toScreen(node);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(8, radius(node) * view.k + 4) && d < bestDistance) {
        best = node;
        bestDistance = d;
      }
    }
    return best;
  }

  let pan: { x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  let pressed: { node: Node; x: number; y: number; moved: boolean } | null = null;

  function onPointerDown(event: PointerEvent) {
    canvas?.setPointerCapture(event.pointerId);
    const node = nodeAt(event.clientX, event.clientY);
    if (node) {
      pressed = { node, x: event.clientX, y: event.clientY, moved: false };
      dragged = node;
      node.fx = node.x;
      node.fy = node.y;
      simulation?.alphaTarget(0.25).restart();
    } else {
      pan = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY, moved: false };
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (pressed) {
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 3) pressed.moved = true;
      pressed.node.fx = (pressed.node.fx ?? 0) + event.movementX / view.k;
      pressed.node.fy = (pressed.node.fy ?? 0) + event.movementY / view.k;
      return;
    }
    if (pan) {
      pan.moved = true;
      userMoved = true;
      view = { ...view, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY };
      draw();
      return;
    }
    const node = nodeAt(event.clientX, event.clientY);
    if (node !== hovered) {
      hovered = node;
      if (canvas) canvas.style.cursor = node ? "pointer" : "grab";
      draw();
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (pressed) {
      const { node, moved } = pressed;
      node.fx = null;
      node.fy = null;
      simulation?.alphaTarget(0);
      dragged = null;
      pressed = null;
      if (!moved) openNode(node, event.ctrlKey || event.button === 1);
    }
    pan = null;
  }

  function openNode(node: Node, newTab: boolean) {
    if (node.missing) run("openLink", node.title, newTab);
    else run("open", node.id, newTab);
    close();
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const px = event.clientX - box.left - size.width / 2;
    const py = event.clientY - box.top - size.height / 2;
    userMoved = true;
    const k = Math.max(0.15, Math.min(4, view.k * Math.exp(-event.deltaY * 0.0015)));
    // Zoom about the pointer.
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
    draw();
  }

  $effect(() => {
    const element = canvas;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) query = "";
      else close();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" role="dialog" aria-modal="true" aria-label="Graph view" tabindex="-1" onkeydown={onKeydown}>
  <div class="panel">
    <header>
      <span class="title"><Waypoints size={16} /> Graph</span>
      <Segmented
        label="Show"
        options={[
          { value: "vault", label: "Whole vault" },
          { value: "local", label: "This note" },
        ]}
        value={scope}
        onchange={(value) => (scope = value)}
      />
      {#if scope === "local"}
        <Segmented
          label="Depth"
          options={[
            { value: "1", label: "1 link" },
            { value: "2", label: "2 links" },
          ]}
          value={String(depth) as "1" | "2"}
          onchange={(value) => (depth = Number(value))}
        />
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="text-field search" type="search" placeholder="Find a note" aria-label="Find a note" bind:value={query} autofocus />
      <Checkbox label="Unlinked notes" checked={showOrphans} onchange={(checked) => (showOrphans = checked)} />
      <Checkbox label="Notes not created yet" checked={showMissing} onchange={(checked) => (showMissing = checked)} />
      <span class="spacer"></span>
      <span class="counts">{counts.nodes} notes · {counts.links} links</span>
      <button class="button fit" title="Fit the graph in the window" onclick={refit}>Fit</button>
      <button class="icon-button" title="Close (Esc)" aria-label="Close graph" onclick={close}><X size={16} /></button>
    </header>
    <div class="stage" bind:this={stage}>
      <canvas
        bind:this={canvas}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointerleave={() => {
          if (!pressed && !pan && hovered) {
            hovered = null;
            draw();
          }
        }}
      ></canvas>
      {#if raw && counts.nodes === 0}
        <div class="empty">{scope === "local" && !current ? "Open a note to see its links." : "No notes to show."}</div>
      {/if}
      <div class="hint">Drag to move · Scroll to zoom · Click a note to open it · Ctrl+click for a new tab</div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    padding: 24px;
    background: rgba(0, 0, 0, 0.45);
    animation: fade-in 0.12s ease-out;
  }
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--ui-strong-border);
    border-radius: 12px;
    background: var(--ui-editor);
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-panel);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--ui-text);
  }
  header :global(.segmented) {
    width: auto;
  }
  .search {
    width: 180px;
    height: 28px;
  }
  .spacer {
    flex: 1;
  }
  .fit {
    height: 28px;
    padding: 0 12px;
  }
  .counts {
    color: var(--ui-text-3);
    font-size: 12px;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  canvas {
    display: block;
    cursor: grab;
    touch-action: none;
  }
  canvas:active {
    cursor: grabbing;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-text-3);
    pointer-events: none;
  }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    padding: 4px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--ui-panel) 85%, transparent);
    color: var(--ui-text-3);
    font-size: 11.5px;
    pointer-events: none;
    white-space: nowrap;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
