<!-- The strip of open tabs above the editor (UI-04). Tabs share the width
     (120–240 px each) and scroll horizontally; middle-click closes, drag
     reorders, right-click offers the close/show commands. -->
<script lang="ts">
  import { Plus, SquareDashedPlus, TriangleAlert, X } from "@lucide/svelte";
  import { tick } from "svelte";
  import type { TabView } from "@shared/ipc";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";

  const TAB_TYPE = "application/x-holocron-tab";

  const tabs = $derived(app.vault?.tabs ?? []);
  const activeId = $derived(app.vault?.activeTabId ?? null);

  let strip = $state<HTMLDivElement>();
  let available = $state(0);
  const tabWidth = $derived(Math.min(240, Math.max(120, (available - 12) / Math.max(tabs.length, 1) - 2)));

  let hovered = $state<string | null>(null);
  let dragging = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);

  const indexOf = (id: string | null) => tabs.findIndex((tab) => tab.id === id);
  /** moveTab lands the tab where the target was: after it when moving right, before it when moving left. */
  const dropAfter = $derived(dragging !== null && dropTarget !== null && indexOf(dragging) < indexOf(dropTarget));

  // Keep the active tab in view.
  $effect(() => {
    const id = activeId;
    void tabs.length;
    void tick().then(() => {
      const element = strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id ?? "")}"]`);
      element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  });

  function onWheel(event: WheelEvent) {
    if (!strip || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    strip.scrollLeft += event.deltaY;
  }

  function onAuxClick(event: MouseEvent, tab: TabView) {
    if (event.button !== 1) return;
    event.preventDefault();
    run("closeTab", tab.id);
  }

  function onContextMenu(event: MouseEvent, tab: TabView) {
    const index = indexOf(tab.id);
    const entries: MenuEntry[] = [
      { label: "Close Tab", shortcut: tab.id === activeId ? "Ctrl+W" : undefined, run: () => run("closeTab", tab.id) },
      { label: "Close Other Tabs", disabled: tabs.length < 2, run: () => run("closeOtherTabs", tab.id) },
      { label: "Close Tabs to the Right", disabled: index === tabs.length - 1, run: () => run("closeTabsToTheRight", tab.id) },
    ];
    const path = tab.path;
    if (path) entries.push("-", { label: "Show in File Explorer", run: () => run("showInFolder", path) });
    menu.openAt(event, entries);
  }

  function onDragStart(event: DragEvent, tab: TabView) {
    if (!event.dataTransfer) return;
    dragging = tab.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_TYPE, tab.id);
  }

  function onDragOver(event: DragEvent, tab: TabView) {
    if (!event.dataTransfer?.types.includes(TAB_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dropTarget = dragging === tab.id ? null : tab.id;
  }

  function onDrop(event: DragEvent, tab: TabView) {
    const id = event.dataTransfer?.getData(TAB_TYPE);
    if (!id) return;
    event.preventDefault();
    if (id !== tab.id) run("moveTab", id, tab.id);
    endDrag();
  }

  function endDrag() {
    dragging = null;
    dropTarget = null;
  }
</script>

<div class="tab-bar">
  <div class="strip" role="tablist" aria-label="Open tabs" bind:this={strip} bind:clientWidth={available} onwheel={onWheel}>
    {#each tabs as tab (tab.id)}
      {@const isActive = tab.id === activeId}
      {@const isHovered = hovered === tab.id}
      <div
        class="tab"
        class:active={isActive}
        class:dragging={dragging === tab.id}
        class:drop-before={dropTarget === tab.id && !dropAfter}
        class:drop-after={dropTarget === tab.id && dropAfter}
        style:width="{tabWidth}px"
        role="tab"
        tabindex={isActive ? 0 : -1}
        aria-selected={isActive}
        title={tab.path ?? undefined}
        data-tab-id={tab.id}
        draggable="true"
        onclick={() => run("activateTab", tab.id)}
        onkeydown={(event) => (event.key === "Enter" || event.key === " ") && run("activateTab", tab.id)}
        onmousedown={(event) => event.button === 1 && event.preventDefault()}
        onauxclick={(event) => onAuxClick(event, tab)}
        oncontextmenu={(event) => onContextMenu(event, tab)}
        onpointerenter={() => (hovered = tab.id)}
        onpointerleave={() => hovered === tab.id && (hovered = null)}
        ondragstart={(event) => onDragStart(event, tab)}
        ondragover={(event) => onDragOver(event, tab)}
        ondragleave={() => dropTarget === tab.id && (dropTarget = null)}
        ondrop={(event) => onDrop(event, tab)}
        ondragend={endDrag}
      >
        {#if !tab.path}
          <span class="new-icon"><SquareDashedPlus size={13} /></span>
        {/if}
        <span class="title">{tab.title || "New Tab"}</span>
        <span class="trailing">
          {#if isHovered || isActive}
            <button
              class="close"
              tabindex="-1"
              aria-label="Close {tab.title}"
              title="Close (Ctrl+W)"
              draggable="false"
              onclick={(event) => {
                event.stopPropagation();
                run("closeTab", tab.id);
              }}
            >
              <X size={12} strokeWidth={2.4} />
            </button>
          {:else if tab.hasWarning}
            <span class="warning" aria-label="Needs attention"><TriangleAlert size={12} strokeWidth={2.2} /></span>
          {:else if tab.isDirty}
            <span class="dot" aria-label="Unsaved changes"></span>
          {/if}
        </span>
      </div>
    {/each}
  </div>
  <button class="icon-button new-tab" title="New Tab (Ctrl+T)" aria-label="New Tab" onclick={() => run("newTab")}>
    <Plus size={15} />
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    height: 36px;
    flex: none;
    background: var(--ui-sidebar);
    /* The bottom line sits under the tabs, so the active tab covers it. */
    box-shadow: inset 0 -1px 0 var(--ui-border);
  }
  .strip {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 0 6px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tab {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 4px 0 10px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 7px 7px 0 0;
    color: var(--ui-text-2);
    font-size: 12px;
    transition: background-color 0.1s;
  }
  .tab:hover:not(.active) {
    background: var(--ui-chip);
  }
  .tab.active {
    background: var(--ui-editor);
    border-color: var(--ui-border);
    color: var(--ui-text);
    font-weight: 500;
  }
  .tab:focus-visible {
    outline-offset: -2px;
  }
  .tab.dragging {
    opacity: 0.55;
  }
  .tab.drop-before::before,
  .tab.drop-after::before {
    content: "";
    position: absolute;
    top: 3px;
    bottom: 3px;
    width: 2px;
    border-radius: 1px;
    background: var(--ui-accent);
  }
  .tab.drop-before::before {
    left: -2px;
  }
  .tab.drop-after::before {
    right: -2px;
  }
  .new-icon {
    display: inline-flex;
    flex: none;
    color: var(--ui-text-3);
  }
  .active .new-icon {
    color: var(--ui-text-2);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trailing {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-2);
  }
  .close:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .tab:not(.active) .close:hover {
    background: color-mix(in srgb, var(--ui-chip) 60%, var(--ui-strong-border));
  }
  .warning {
    display: inline-flex;
    color: var(--ui-warning);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ui-accent);
  }
  .new-tab {
    flex: none;
    align-self: center;
    width: 28px;
    height: 26px;
    margin: 2px 8px 0 2px;
  }
</style>
