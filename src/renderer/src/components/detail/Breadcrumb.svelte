<!-- The note's place in the vault (UI-05): the vault, its folders separated by
     "/", then the note's title (".md" is implied; other extensions show). -->
<script lang="ts">
  import { isNote, title } from "@core/paths";
  import { app } from "../../lib/app.svelte";

  const path = $derived(app.doc?.path ?? "");
  const parts = $derived(path.split("/").filter(Boolean));
  const folders = $derived(parts.slice(0, -1));
  const fileName = $derived(isNote(path) ? title(path) : (parts.at(-1) ?? ""));
</script>

<nav class="breadcrumb" aria-label="Note location" title={app.doc?.path}>
  {#if app.vault}
    <span class="folder vault">{app.vault.name}</span>
    <span class="slash" aria-hidden="true">/</span>
  {/if}
  {#each folders as folder, index (index)}
    <span class="folder">{folder}</span>
    <span class="slash" aria-hidden="true">/</span>
  {/each}
  <span class="file" aria-current="page">{fileName}</span>
</nav>

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    flex: none;
    padding: 0 24px;
    overflow: hidden;
    color: var(--ui-text-3);
    font-size: 12px;
    white-space: nowrap;
  }
  .folder {
    flex: 0 1 auto;
    min-width: 24px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vault {
    color: var(--ui-text-3);
  }
  .slash {
    flex: none;
    color: var(--ui-faint);
  }
  .file {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ui-text-2);
    font-weight: 500;
  }
</style>
