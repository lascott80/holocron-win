<!-- The sidebar's collapsible "Bookmarks" section (UI-14a): notes and folders the
     user pinned to the top of the Files view. Clicking opens; dragging reorders;
     right-click removes. Hidden while there are none. -->
<script lang="ts">
  import { Bookmark, ChevronRight, FileText, Folder } from "@lucide/svelte";
  import { isNote, stem, basename } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";

  const BOOKMARK_TYPE = "application/x-holocron-bookmark";

  const bookmarks = $derived(app.vault?.bookmarks ?? []);
  const expanded = $derived(app.settings.bookmarksExpanded);
  const current = $derived(app.doc?.path ?? null);

  let dragging = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);

  const title = (path: string) => (isNote(path) ? stem(path) : basename(path));

  function open(event: MouseEvent, path: string) {
    if (isNote(path)) run("open", path, event.ctrlKey);
    else run("select", path);
  }

  function onAuxClick(event: MouseEvent, path: string) {
    if (event.button === 1 && isNote(path)) {
      event.preventDefault();
      run("open", path, true);
    }
  }

  function onContextMenu(event: MouseEvent, path: string) {
    const entries: MenuEntry[] = [];
    if (isNote(path)) entries.push({ label: "Open in New Tab", run: () => run("open", path, true) }, { label: "Open to the Right", run: () => run("openInSplit", path) }, "-");
    entries.push({ label: "Remove Bookmark", run: () => run("toggleBookmark", path) }, "-", { label: "Show in File Explorer", run: () => run("showInFolder", path) });
    menu.openAt(event, entries);
  }

  function onDragStart(event: DragEvent, path: string) {
    if (!event.dataTransfer) return;
    dragging = path;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BOOKMARK_TYPE, path);
  }

  function onDragOver(event: DragEvent, path: string) {
    if (!event.dataTransfer?.types.includes(BOOKMARK_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dropTarget = dragging === path ? null : path;
  }

  function onDrop(event: DragEvent, path: string) {
    const moved = event.dataTransfer?.getData(BOOKMARK_TYPE);
    if (!moved) return;
    event.preventDefault();
    if (moved !== path) run("moveBookmark", moved, path);
    endDrag();
  }

  function endDrag() {
    dragging = null;
    dropTarget = null;
  }
</script>

{#if bookmarks.length}
  <section class="bookmarks">
    <button class="header" aria-expanded={expanded} onclick={() => app.setSetting("bookmarksExpanded", !expanded)}>
      <span class="section-label">Bookmarks</span>
      <span class="chevron" class:open={expanded}><ChevronRight size={13} strokeWidth={2.25} /></span>
    </button>
    {#if expanded}
      <div class="list">
        {#each bookmarks as path (path)}
          <button
            class="row"
            class:current={path === current}
            class:dragging={dragging === path}
            class:drop={dropTarget === path}
            title={path}
            draggable="true"
            onclick={(event) => open(event, path)}
            onauxclick={(event) => onAuxClick(event, path)}
            oncontextmenu={(event) => onContextMenu(event, path)}
            ondragstart={(event) => onDragStart(event, path)}
            ondragover={(event) => onDragOver(event, path)}
            ondragleave={() => dropTarget === path && (dropTarget = null)}
            ondrop={(event) => onDrop(event, path)}
            ondragend={endDrag}
          >
            {#if isNote(path)}<FileText size={14} />{:else}<Folder size={14} />{/if}
            <span class="name">{title(path)}</span>
            <span class="mark"><Bookmark size={11} strokeWidth={2.2} /></span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .bookmarks {
    display: flex;
    flex-direction: column;
    padding: 2px 0 4px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin: 2px 6px 2px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
  }
  .header:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .chevron {
    display: inline-flex;
    color: var(--ui-text-3);
    opacity: 0;
    transition:
      transform 0.12s ease-out,
      opacity 0.12s;
  }
  .header:hover .chevron,
  .header:focus-visible .chevron,
  .chevron:not(.open) {
    opacity: 1;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    margin: 0 6px;
    padding: 0 10px 0 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    text-align: left;
  }
  .row :global(svg) {
    flex: none;
    color: var(--ui-text-3);
  }
  .row:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .row:hover :global(svg) {
    color: var(--ui-accent);
  }
  .row.current {
    color: var(--ui-strong);
  }
  .row.current :global(svg) {
    color: var(--ui-accent);
  }
  .row.dragging {
    opacity: 0.5;
  }
  .row.drop::before {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: -1px;
    height: 2px;
    border-radius: 1px;
    background: var(--ui-accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark {
    display: inline-flex;
    opacity: 0.6;
  }
</style>
