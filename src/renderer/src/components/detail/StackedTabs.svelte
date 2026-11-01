<!-- Stacked tabs (UI-48): the primary pane's open tabs side by side as
     columns the editor line width wide (at least 360 px), each a live editor
     of its note (documents are shared, so edits show everywhere). Each column
     has a narrow rotated header that stays stuck at the left edge of the strip
     once scrolled past and at the right edge while still ahead, so every tab is
     always in reach; clicking a header (or into a column) makes that tab the
     active one. For the headers to stick at both edges, every column's box
     spans the whole strip (overlapping, offset by invisible spacers), with its
     header and editor at the column's own place along it. -->
<script lang="ts">
  import { tick } from "svelte";
  import { isCanvas } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import PaneEditor from "./PaneEditor.svelte";
  import CanvasView from "./CanvasView.svelte";

  /** The width of a column's header strip. */
  const HEADER = 34;

  const tabs = $derived((app.vault?.tabs ?? []).filter((tab) => tab.path !== null));
  const activeId = $derived(app.vault?.activeTabId ?? null);
  /** A column: its header plus an editor the line width wide (at least 360 px). */
  const width = $derived(Math.max(360, app.settings.editorLineWidth) + HEADER);
  const mode = $derived(app.paneMode("main"));
  let strip = $state<HTMLDivElement>();

  // Keep the active tab's column in view, clear of the headers stacked at either
  // edge (every column's box spans the strip, so scrollIntoView can't be used).
  $effect(() => {
    const index = tabs.findIndex((tab) => tab.id === activeId);
    const count = tabs.length;
    void tick().then(() => {
      if (!strip || index < 0) return;
      const most = index * (width - HEADER); // any further and the column slides under the left stack
      const least = (index + 1) * width + (count - 1 - index) * HEADER - strip.clientWidth; // any less and it's under the right stack
      const current = strip.scrollLeft;
      if (current >= least && current <= most) return;
      strip.scrollTo({ left: Math.max(0, current < least ? Math.min(least, most) : most), behavior: "smooth" });
    });
  });

  function activate(id: string) {
    if (id !== activeId) run("activateTab", id);
  }

  function focusColumn(id: string) {
    app.focusPane("tab:" + id);
    activate(id);
  }
</script>

<div class="stack" bind:this={strip} role="presentation">
  {#each tabs as tab, index (tab.id)}
    {@const isActive = tab.id === activeId}
    <div
      class="column"
      class:active={isActive}
      data-tab-id={tab.id}
      style:--column-index={index}
      style:--column-count={tabs.length}
      style:--column-width="{width}px"
      role="presentation"
      onfocusincapture={() => app.focusPane("tab:" + tab.id)}
      onpointerdowncapture={() => focusColumn(tab.id)}
    >
      <button class="header" style:left="{index * HEADER}px" style:right="{(tabs.length - 1 - index) * HEADER}px" title={tab.path} aria-pressed={isActive} onclick={() => activate(tab.id)}>
        <span class="label">{tab.title}</span>
        {#if tab.isDirty}<span class="dirty" aria-label="Unsaved changes"></span>{/if}
      </button>
      <div class="body">
        {#if tab.path && isCanvas(tab.path)}
          <CanvasView canvas={{ path: tab.path, title: tab.title, revision: app.vault?.canvas?.revision ?? 0 }} reportStats={isActive} />
        {:else}
          <PaneEditor id={"tab:" + tab.id} {mode} />
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .stack {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--hc-bg);
  }
  /* Every column's box is the whole strip wide; spacers put its header and editor at its own place. */
  .column {
    flex: none;
    display: flex;
    height: 100%;
    width: calc(var(--column-count) * var(--column-width));
    pointer-events: none;
  }
  .column + .column {
    margin-left: calc(-1 * var(--column-count) * var(--column-width));
  }
  .column::before {
    content: "";
    flex: none;
    width: calc(var(--column-index) * var(--column-width));
  }
  .column::after {
    content: "";
    flex: none;
    width: calc((var(--column-count) - 1 - var(--column-index)) * var(--column-width));
  }
  /* Sticks at its slot on the left once scrolled past, and on the right while still ahead;
     above every editor, whichever column it belongs to. */
  .header {
    position: sticky;
    z-index: 3;
    flex: none;
    width: 34px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding: 12px 0;
    border: 0;
    border-right: 1px solid var(--ui-border);
    background: var(--ui-panel);
    color: var(--ui-text-3);
    font: inherit;
    font-size: 12px;
    writing-mode: vertical-rl;
    cursor: default;
    overflow: hidden;
    pointer-events: auto;
  }
  .header:hover {
    color: var(--ui-text-2);
    background: var(--ui-chip);
  }
  .column.active .header {
    color: var(--ui-text);
    font-weight: 500;
    box-shadow: inset 2px 0 0 rgba(var(--ui-accent-rgb), 0.7);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ui-text-3);
  }
  .body {
    flex: none;
    width: calc(var(--column-width) - 34px);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--ui-border);
    background: var(--hc-bg);
    pointer-events: auto;
  }
</style>
