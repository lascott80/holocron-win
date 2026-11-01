<!-- Read-only viewer for JSON Canvas files (UI-45): groups as labelled
     boxes behind, text cards as rendered markdown, file cards with a note's
     first lines or its image, link cards with their URL, and edges as SVG
     curves with arrowheads and labels. Drawn with HTML and SVG (not a 2D
     canvas) so text stays crisp and selectable. Drag the background to pan,
     scroll to zoom about the pointer, Fit shows everything, Esc clears the
     selection. Reloads when the file changes on disk. -->
<script lang="ts">
  import { ExternalLink, FileText, Image as ImageIcon, LayoutDashboard, Maximize } from "@lucide/svelte";
  import type { CanvasTabView } from "@shared/ipc";
  import { canvasBounds, canvasCounts, colorOf, edgeGeometry, parseCanvas, type CanvasData, type CanvasEdge, type CanvasNode, type EdgeGeometry } from "@core/canvas";
  import { basename, extname, isImage, isNote } from "@core/paths";
  import CanvasMarkdown from "./CanvasMarkdown.svelte";
  import { app } from "../../lib/app.svelte";
  import { call, host, run } from "../../lib/host";

  /** `reportStats`: the status bar shows this canvas's counts (the active tab's; a pane's viewer keeps quiet, UI-40). */
  let { canvas, reportStats = true }: { canvas: CanvasTabView; reportStats?: boolean } = $props();

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 3;
  const FIT_MARGIN = 40;
  /** How much of a file card's note is shown. */
  const PREVIEW_LINES = 40;

  let data = $state<CanvasData | null>(null);
  let error = $state<string | null>(null);
  /** Screen = world × k + (x, y). */
  let view = $state({ k: 1, x: 0, y: 0 });
  let selected = $state<string | null>(null);
  let stage = $state<HTMLDivElement>();
  let size = $state({ width: 0, height: 0 });
  /** The canvas path fitted last; a new file is fitted once it has loaded and the stage has a size. */
  let fitted: string | null = null;
  let pendingFit = false;

  // ---------- Loading ----------

  $effect(() => {
    const { path, revision } = canvas;
    void revision; // reloads when the watcher reports a change
    let cancelled = false;
    void call<string | null>("readCanvas", path).then((text) => {
      if (cancelled) return;
      if (text === null) {
        data = null;
        error = "the file couldn’t be read";
      } else {
        const result = parseCanvas(text);
        if (result.ok) {
          data = result.canvas;
          error = null;
        } else {
          data = null;
          error = result.reason;
        }
      }
      if (reportStats) app.canvasStats = data ? canvasCounts(data) : null;
      if (data && !data.nodes.some((node) => node.id === selected)) selected = null;
      if (fitted !== path) {
        fitted = path;
        pendingFit = true;
        fit();
      }
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    return () => {
      if (reportStats) app.canvasStats = null;
    };
  });

  $effect(() => {
    const element = stage;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      size = { width: element.clientWidth, height: element.clientHeight };
      if (pendingFit) fit();
    });
    observer.observe(element);
    size = { width: element.clientWidth, height: element.clientHeight };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  });

  // ---------- Layout ----------

  const nodes = $derived(data?.nodes ?? []);
  const groups = $derived(nodes.filter((node) => node.type === "group"));
  const cards = $derived(nodes.filter((node) => node.type !== "group"));
  const byId = $derived(new Map(nodes.map((node) => [node.id, node])));
  const edges = $derived.by(() => {
    const laid: { edge: CanvasEdge; geometry: EdgeGeometry }[] = [];
    for (const edge of data?.edges ?? []) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (from && to) laid.push({ edge, geometry: edgeGeometry(edge, from, to) });
    }
    return laid;
  });
  const zoomLabel = $derived(`${Math.round(view.k * 100)}%`);

  /** Shows the whole drawing, no larger than life (10–100%). */
  function fit() {
    const bounds = canvasBounds(nodes);
    if (!size.width || !size.height) return;
    pendingFit = false;
    if (!bounds) {
      view = { k: 1, x: size.width / 2, y: size.height / 2 };
      return;
    }
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.max(MIN_ZOOM, Math.min(1, (size.width - FIT_MARGIN * 2) / width, (size.height - FIT_MARGIN * 2) / height));
    view = { k, x: size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k, y: size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
  }

  /** The colour a node or edge asks for, as an "r, g, b" triple usable in rgb()/rgba(); null for the default look. */
  function triple(color: string | undefined): string | null {
    const parsed = colorOf(color);
    if (!parsed) return null;
    if ("hex" in parsed) return [1, 3, 5].map((i) => parseInt(parsed.hex.slice(i, i + 2), 16)).join(", ");
    // Presets 1–6 follow the theme's callout colours (§16.5); orange and cyan are the viewer's own.
    return parsed.preset === "orange" || parsed.preset === "cyan" ? `var(--canvas-${parsed.preset})` : `var(--hc-callout-${parsed.preset})`;
  }

  function nodeStyle(node: CanvasNode): string {
    const rgb = triple(node.color);
    return `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;${rgb ? `--card-rgb:${rgb};` : ""}`;
  }

  function edgeColor(edge: CanvasEdge): string {
    const rgb = triple(edge.color);
    return rgb ? `rgb(${rgb})` : "var(--ui-text-3)";
  }

  /** The asset-scheme URL for an image file card (ARC-07); resolved like an embed from the canvas's folder. */
  function imageUrl(file: string): string {
    return `holocron-asset://relative/${encodeURIComponent(file)}?from=${encodeURIComponent(canvas.path)}`;
  }

  // Note previews for file cards, fetched once per file (and again when the canvas reloads).
  let previews = $state<Record<string, { path: string; text: string } | null>>({});
  $effect(() => {
    const wanted = new Set(cards.flatMap((node) => (node.type === "file" && isNote(node.file) ? [node.file] : [])));
    void canvas.revision;
    previews = {};
    for (const file of wanted) {
      void call<{ path: string; text: string } | null>("notePreview", file, PREVIEW_LINES).then((preview) => {
        previews = { ...previews, [file]: preview };
      });
    }
  });

  /** The header of a file card opens the note in a new tab; other files open as links do (LNK-06). */
  function openFile(node: CanvasNode & { type: "file" }) {
    const preview = previews[node.file];
    if (preview) run("open", preview.path, true);
    else if (isNote(node.file)) run("openLink", node.file, true);
    else run("openLink", node.file);
  }

  function openUrl(url: string) {
    host.postEditor({ type: "openURL", url });
  }

  // ---------- Pointer ----------

  let pan: { x: number; y: number; startX: number; startY: number; moved: boolean; pointerId: number } | null = null;
  /** A drag is under way (the cursor shows a closed hand). */
  let panning = $state(false);

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    const element = event.target as Element | null;
    // Buttons and text inside cards keep their own behaviour (text stays selectable).
    if (element?.closest(".card, button, a")) return;
    pan = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
    stage?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!pan) return;
    if (!pan.moved && Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) <= 3) return;
    pan.moved = true;
    panning = true;
    view = { ...view, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY };
  }

  function onPointerUp(event: PointerEvent) {
    if (!pan) return;
    const moved = pan.moved;
    if (stage?.hasPointerCapture(pan.pointerId)) stage.releasePointerCapture(pan.pointerId);
    pan = null;
    panning = false;
    // A click (not a drag) on a group selects it; on the background it clears the selection.
    if (!moved) selected = (event.target as Element | null)?.closest<HTMLElement>("[data-node]")?.dataset.node ?? null;
  }

  function onCardClick(event: MouseEvent, node: CanvasNode) {
    if ((event.target as Element | null)?.closest("button, a")) return;
    selected = node.id;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * Math.exp(-event.deltaY * 0.0015)));
    // Zoom about the pointer: the world point under it stays put.
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && selected !== null) {
      event.preventDefault();
      event.stopPropagation();
      selected = null;
    }
  }
</script>

<div class="canvas-view">
  <header class="toolbar">
    <span class="kind"><LayoutDashboard size={14} /> Canvas</span>
    <span class="badge" title="Canvases open as they are; edit them in Obsidian or another canvas editor">Read-only</span>
    <span class="spacer"></span>
    <span class="zoom" aria-label="Zoom">{zoomLabel}</span>
    <button class="button fit" title="Fit the canvas in the window" onclick={fit}><Maximize size={13} /> Fit</button>
  </header>

  {#if error !== null}
    <div class="problem">
      <div class="hero">
        <h1>Couldn’t read this canvas: {error}</h1>
        <p>Fix the file and it will reload here.</p>
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="stage"
      class:panning
      role="group"
      aria-label="Canvas"
      tabindex="0"
      bind:this={stage}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onKeydown}
    >
      <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.k})">
        {#each groups as node (node.id)}
          <div class="group" class:selected={selected === node.id} data-node={node.id} style={nodeStyle(node)}>
            {#if node.type === "group" && node.label}<span class="group-label">{node.label}</span>{/if}
          </div>
        {/each}

        <svg class="edges" width="1" height="1" aria-hidden="true">
          {#each edges as { edge, geometry } (edge.id)}
            <g class="edge" style:--edge-color={edgeColor(edge)}>
              <path d={geometry.path} />
              {#if geometry.fromArrow}<polygon points={geometry.fromArrow} />{/if}
              {#if geometry.toArrow}<polygon points={geometry.toArrow} />{/if}
            </g>
          {/each}
        </svg>

        {#each cards as node (node.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="card {node.type}"
            class:colored={colorOf(node.color) !== null}
            class:selected={selected === node.id}
            data-node={node.id}
            style={nodeStyle(node)}
            onclick={(event) => onCardClick(event, node)}
          >
            {#if node.type === "text"}
              <div class="body"><CanvasMarkdown markdown={node.text} /></div>
            {:else if node.type === "file"}
              <button class="card-header" title={node.file} onclick={() => openFile(node)}>
                {#if isImage(node.file)}<ImageIcon size={13} />{:else}<FileText size={13} />{/if}
                <span class="file-name">{isNote(node.file) ? basename(node.file).replace(/\.(md|markdown)$/i, "") : basename(node.file)}</span>
                {#if node.subpath}<span class="subpath">{node.subpath}</span>{/if}
              </button>
              {#if isImage(node.file)}
                <div class="body picture"><img src={imageUrl(node.file)} alt={basename(node.file)} draggable="false" /></div>
              {:else if isNote(node.file)}
                {@const preview = previews[node.file]}
                <div class="body">
                  {#if preview}
                    <CanvasMarkdown markdown={preview.text} />
                  {:else if preview === null}
                    <span class="missing">Note not found</span>
                  {/if}
                </div>
              {:else}
                <div class="body other-file"><span class="extension">{extname(node.file).toUpperCase() || "FILE"}</span></div>
              {/if}
            {:else if node.type === "link"}
              <button class="card-header link-header" title={node.url} onclick={() => openUrl(node.url)}>
                <ExternalLink size={13} />
                <span class="file-name">{node.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") || node.url}</span>
              </button>
              <div class="body url">{node.url}</div>
            {/if}
          </div>
        {/each}

        {#each edges as { edge, geometry } (edge.id)}
          {#if edge.label}
            <div class="edge-label" style:left="{geometry.mid.x}px" style:top="{geometry.mid.y}px" style:--edge-color={edgeColor(edge)}>{edge.label}</div>
          {/if}
        {/each}
      </div>

      {#if data && !nodes.length}
        <div class="empty">This canvas is empty.</div>
      {/if}
      <div class="hint">Drag to move · Scroll to zoom · Click a card to select it · Esc clears the selection</div>
    </div>
  {/if}
</div>

<style>
  .canvas-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ui-editor);
    /* Preset colours the theme's callouts don't have (§16.5 has red, yellow, green and purple). */
    --canvas-orange: 255, 165, 90;
    --canvas-cyan: 90, 205, 230;
  }
  :global(.hc-light) .canvas-view {
    --canvas-orange: 214, 112, 24;
    --canvas-cyan: 18, 140, 160;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    flex: none;
    padding: 0 16px 0 24px;
    border-bottom: 1px solid var(--ui-border);
    color: var(--ui-text-3);
    font-size: 12px;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ui-text-2);
    font-weight: 500;
  }
  .badge {
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
    background: var(--ui-chip);
    color: var(--ui-text-2);
    font-size: 11px;
  }
  .spacer {
    flex: 1;
  }
  .zoom {
    font-variant-numeric: tabular-nums;
  }
  .fit {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px;
  }
  .problem {
    flex: 1;
    display: flex;
    overflow: auto;
  }
  .hero {
    margin: auto;
    padding: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 520px;
    text-align: center;
  }
  .hero h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--ui-strong);
    overflow-wrap: anywhere;
  }
  .hero p {
    margin: 0;
    color: var(--ui-text-2);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    outline: none;
    /* A faint dot grid, like a drawing board. */
    background-image: radial-gradient(color-mix(in srgb, var(--ui-text-3) 28%, transparent) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .stage.panning {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .group,
  .card {
    position: absolute;
    box-sizing: border-box;
    border-radius: 8px;
    /* Uncoloured cards and groups are grey; a `color` in the file sets --card-rgb (nodeStyle). */
    --card-rgb: var(--hc-callout-gray, 154, 161, 173);
  }
  .group {
    border: 2px solid rgba(var(--card-rgb), 0.35);
    background: rgba(var(--card-rgb), 0.06);
  }
  .group-label {
    position: absolute;
    left: 0;
    bottom: 100%;
    margin-bottom: 6px;
    padding: 3px 10px;
    border-radius: 6px;
    background: rgba(var(--card-rgb), 0.18);
    color: var(--ui-text);
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }
  .card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 2px solid var(--ui-strong-border);
    background: var(--ui-panel);
    color: var(--ui-text);
    cursor: default;
  }
  .card.colored {
    border-color: rgba(var(--card-rgb), 0.65);
    background: color-mix(in srgb, rgb(var(--card-rgb)) 8%, var(--ui-panel));
  }
  .group.selected,
  .card.selected {
    outline: 2px solid var(--ui-accent);
    outline-offset: 2px;
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: 10px 12px;
    overflow: hidden;
  }
  .card-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border: 0;
    border-bottom: 1px solid rgba(var(--card-rgb), 0.25);
    border-radius: 0;
    background: rgba(var(--card-rgb), 0.08);
    color: var(--ui-text);
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .card-header:hover {
    background: rgba(var(--card-rgb), 0.18);
  }
  .file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subpath {
    flex: none;
    color: var(--ui-text-3);
    font-weight: 400;
  }
  .picture {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .picture img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .other-file {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .extension {
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--ui-chip);
    color: var(--ui-text-2);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .missing {
    color: var(--ui-text-3);
    font-size: 13px;
  }
  .url {
    color: var(--ui-text-2);
    font-size: 12.5px;
    overflow-wrap: anywhere;
    user-select: text;
    cursor: text;
  }
  .edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .edge path {
    fill: none;
    stroke: var(--edge-color);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .edge polygon {
    fill: var(--edge-color);
  }
  .edge-label {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 240px;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid var(--edge-color);
    background: var(--ui-editor);
    color: var(--ui-text);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
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
</style>
