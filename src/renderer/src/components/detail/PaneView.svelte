<!-- A pane other than the primary one (UI-40, UI-47): a header with the file's
     title (a dot while unsaved), a link toggle, the pane's view mode, Open in
     a Tab and Close, over an editor, the canvas viewer, the Base view or an empty placeholder.
     The focused pane's header has the accent underline. -->
<script lang="ts">
  import { ChevronDown, ExternalLink, Link2, Link2Off, X } from "@lucide/svelte";
  import type { PaneLeaf, PaneMode } from "@core/layout";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";
  import PaneEditor from "./PaneEditor.svelte";
  import CanvasView from "./CanvasView.svelte";
  import BaseView from "./BaseView.svelte";

  let { leaf }: { leaf: PaneLeaf } = $props();

  const info = $derived(app.vault?.panes[leaf.id] ?? null);
  const mode = $derived(app.paneMode(leaf.id));
  const active = $derived(app.pane === leaf.id);
  const linked = $derived(Boolean(leaf.linked));

  const modeTitles: Record<PaneMode, string> = { live: "Live Preview", source: "Source Mode", reading: "Reading View" };

  function openModeMenu(event: MouseEvent) {
    const entries: MenuEntry[] = (Object.keys(modeTitles) as PaneMode[]).map((candidate) => ({
      label: modeTitles[candidate],
      checked: mode === candidate,
      run: () => run("setPaneMode", leaf.id, candidate),
    }));
    entries.push("-", { label: "Follow the View Mode Setting", checked: !leaf.mode, run: () => run("setPaneMode", leaf.id, null) });
    menu.openBelow(event.currentTarget as Element, entries);
  }
</script>

<section class="pane" class:active aria-label={info?.title ?? "Pane"}>
  <header class="pane-header">
    <span class="title" title={info?.path ?? ""}>
      {info?.title ?? ""}{#if info?.isDirty}<span class="dirty" aria-label="Unsaved changes"></span>{/if}
    </span>
    <button
      class="icon-button"
      class:on={linked}
      title={linked ? "Linked to the main editor — click to unlink" : "Link to the main editor: show its note and scroll with it"}
      aria-label={linked ? "Unlink from the main editor" : "Link to the main editor"}
      aria-pressed={linked}
      onclick={() => run("setPaneLinked", leaf.id, !linked)}
    >
      {#if linked}<Link2 size={14} />{:else}<Link2Off size={14} />{/if}
    </button>
    {#if info?.kind === "note"}
      <button class="mode-button" title="This pane’s view mode" aria-haspopup="menu" data-menu-trigger onclick={openModeMenu}>
        {modeTitles[mode]}
        <ChevronDown size={11} strokeWidth={2.2} />
      </button>
    {/if}
    <button class="icon-button" title="Open in a Tab" aria-label="Open in a Tab" disabled={!info?.path} onclick={() => run("splitToTab", leaf.id)}>
      <ExternalLink size={14} />
    </button>
    <button class="icon-button" title="Close Pane" aria-label="Close Pane" onclick={() => run("closePane", leaf.id)}>
      <X size={15} />
    </button>
  </header>
  {#if info?.kind === "note"}
    <PaneEditor id={leaf.id} {mode} {linked} />
  {:else if info?.kind === "canvas" && info.path}
    <CanvasView canvas={{ path: info.path, title: info.title, revision: info.revision }} reportStats={false} />
  {:else if info?.kind === "base" && info.path}
    <BaseView base={{ path: info.path, title: info.title, revision: info.revision }} reportStats={false} />
  {:else}
    <div class="empty">Nothing open here yet. Drop a note on the pane, or link it to the main editor.</div>
  {/if}
</section>

<style>
  .pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--hc-bg);
  }
  .pane-header {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    flex: none;
    padding: 0 6px 0 16px;
    border-bottom: 1px solid var(--ui-border);
    color: var(--ui-text-3);
    font-size: 12px;
  }
  /* The pane being typed in has the accent under its title. */
  .pane.active .pane-header {
    box-shadow: inset 0 -2px 0 rgba(var(--ui-accent-rgb), 0.55);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-2);
    font-weight: 500;
  }
  .dirty {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--ui-text-3);
    vertical-align: middle;
  }
  .icon-button.on {
    color: var(--ui-accent);
  }
  .mode-button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-3);
    font: inherit;
    font-size: 11px;
    cursor: default;
  }
  .mode-button:hover {
    background: var(--ui-chip);
    color: var(--ui-text-2);
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    color: var(--ui-text-3);
    font-size: 13px;
  }
</style>
