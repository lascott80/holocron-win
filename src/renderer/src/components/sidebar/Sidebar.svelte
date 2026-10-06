<!-- The sidebar (REQUIREMENTS §11.2): vault switcher, Files/Search switch, then the
     file tree and tags or the search panel, and the New Note / New Folder bar. -->
<script lang="ts">
  import { FolderPlus, FolderTree, Plus, Search } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { runCommand } from "../../lib/commands";
  import VaultSwitcher from "./VaultSwitcher.svelte";
  import FileTree from "./FileTree.svelte";
  import TagsSection from "./TagsSection.svelte";
  import SearchPanel from "./SearchPanel.svelte";

  const modes = [
    { mode: "files", label: "Files", icon: FolderTree },
    { mode: "search", label: "Search", icon: Search },
  ] as const;

  function newFolder() {
    app.sidebarMode = "files";
    runCommand("newFolder");
  }
</script>

<div class="sidebar">
  <div class="top">
    <VaultSwitcher />
    <div class="segmented" role="radiogroup" aria-label="Sidebar">
      {#each modes as { mode, label, icon: Icon } (mode)}
        <button
          class="segment"
          class:active={app.sidebarMode === mode}
          role="radio"
          aria-checked={app.sidebarMode === mode}
          onclick={() => (app.sidebarMode = mode)}
        >
          <Icon size={14} />
          {label}
        </button>
      {/each}
    </div>
  </div>

  {#if app.sidebarMode === "files"}
    <div class="scroll">
      <FileTree />
      <TagsSection />
    </div>
  {:else}
    <SearchPanel />
  {/if}

  <div class="bottom">
    <button class="new-note" onclick={() => runCommand("newNote")}>
      <Plus size={15} />
      New Note
    </button>
    <button class="icon-button" title="New Folder (Ctrl+Alt+N)" aria-label="New Folder" onclick={newFolder}>
      <FolderPlus size={16} />
    </button>
  </div>
</div>

<style>
  .sidebar {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ui-sidebar);
  }
  .top {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 10px 8px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--ui-chip);
  }
  .segment {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12.5px;
    font-weight: 500;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .segment:hover:not(.active) {
    color: var(--ui-text);
  }
  .segment.active {
    background: var(--ui-raised);
    border-color: var(--ui-border);
    color: var(--ui-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .segment.active :global(svg) {
    color: var(--ui-accent);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .bottom {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 44px;
    padding: 0 8px;
    border-top: 1px solid var(--ui-border);
  }
  .new-note {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 13px;
    text-align: left;
  }
  .new-note:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
</style>
