<!-- One row of the file tree: chevron, folder/note icon and name, or the inline
     rename field (UI-11). Drop handling lives in FileTree (event delegation on data-path). -->
<script lang="ts">
  import { ChevronRight, FileText, Folder, FolderOpen } from "@lucide/svelte";
  import type { TreeNode } from "@shared/ipc";

  let {
    node,
    depth,
    selected,
    expanded,
    dropTarget,
    contextActive,
    renaming,
    onclick,
    onauxclick,
    oncontextmenu,
    ondragstart,
    oncommit,
    oncancel,
  }: {
    node: TreeNode;
    depth: number;
    selected: boolean;
    expanded: boolean;
    dropTarget: boolean;
    contextActive: boolean;
    renaming: boolean;
    onclick: (event: MouseEvent) => void;
    onauxclick: (event: MouseEvent) => void;
    oncontextmenu: (event: MouseEvent) => void;
    ondragstart: (event: DragEvent) => void;
    oncommit: (name: string) => void;
    oncancel: () => void;
  } = $props();

  /** The rename has been committed or cancelled (blur after Enter/Esc is ignored). */
  let settled = false;

  function renameField(input: HTMLInputElement) {
    settled = false;
    input.value = node.name;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function commit(input: HTMLInputElement) {
    if (settled) return;
    settled = true;
    oncommit(input.value);
  }

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === "Enter") {
      event.preventDefault();
      commit(input);
    } else if (event.key === "Escape") {
      event.preventDefault();
      settled = true;
      oncancel();
    }
  }

  function onBlur(event: FocusEvent) {
    // Switching to another window isn't "clicking away".
    if (!document.hasFocus()) return;
    commit(event.currentTarget as HTMLInputElement);
  }
</script>

<!-- Keys and focus belong to the tree (FileTree), which tracks the selection. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
<div
  class="row"
  class:selected
  class:drop={dropTarget}
  class:context={contextActive}
  class:dir={node.isDir}
  role="treeitem"
  aria-selected={selected}
  aria-expanded={node.isDir ? expanded : undefined}
  aria-level={depth + 1}
  data-path={node.path}
  data-dir={node.isDir ? "true" : undefined}
  draggable={!renaming}
  style:padding-left="{6 + depth * 14}px"
  title={renaming ? undefined : node.path}
  {onclick}
  {onauxclick}
  {oncontextmenu}
  {ondragstart}
>
  <span class="chevron" class:open={expanded}>
    {#if node.isDir}<ChevronRight size={13} strokeWidth={2.25} />{/if}
  </span>
  <span class="icon">
    {#if node.isDir}
      {#if expanded}<FolderOpen size={15} />{:else}<Folder size={15} />{/if}
    {:else}
      <FileText size={15} />
    {/if}
  </span>
  {#if renaming}
    <input
      class="rename"
      type="text"
      placeholder="Name"
      spellcheck="false"
      aria-label="Name"
      use:renameField
      onkeydown={onKeydown}
      onblur={onBlur}
      onclick={(event) => event.stopPropagation()}
      ondblclick={(event) => event.stopPropagation()}
    />
  {:else}
    <span class="name">{node.name}</span>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    margin: 0 6px;
    padding-right: 8px;
    border-radius: 6px;
    color: var(--ui-text);
    font-size: 13px;
    white-space: nowrap;
    outline: none;
  }
  .row::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 6px;
    border: 1.5px solid rgba(var(--ui-accent-rgb), 0.7);
    background: rgba(var(--ui-accent-rgb), 0.18);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease-out;
  }
  .row.drop::after {
    opacity: 1;
  }
  .row:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .row.selected {
    background: rgba(var(--ui-accent-rgb), 0.16);
    color: var(--ui-strong);
  }
  .row.context:not(.drop) {
    box-shadow: inset 0 0 0 1.5px rgba(var(--ui-accent-rgb), 0.55);
  }
  :global(.tree:focus) .row.selected {
    background: rgba(var(--ui-accent-rgb), 0.24);
  }
  .chevron {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    color: var(--ui-text-3);
    transition: transform 0.12s ease-out;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .icon {
    flex: none;
    display: inline-flex;
    width: 18px;
    color: var(--ui-text-3);
  }
  .dir .icon {
    color: var(--ui-text-2);
  }
  .selected .icon {
    color: var(--ui-accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 22px;
    margin-left: -4px;
    padding: 0 5px;
    border: 1px solid var(--ui-accent);
    border-radius: 4px;
    background: var(--ui-editor);
    color: var(--ui-text);
    font-size: 13px;
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--ui-accent-rgb), 0.18);
  }
</style>
