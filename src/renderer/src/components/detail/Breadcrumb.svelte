<!-- The note's place in the vault (UI-05): folders separated by "/", then the file name. -->
<script lang="ts">
  import { app } from "../../lib/app.svelte";

  const parts = $derived((app.doc?.path ?? "").split("/").filter(Boolean));
  const folders = $derived(parts.slice(0, -1));
  const fileName = $derived(parts.at(-1) ?? "");
</script>

<nav class="breadcrumb" aria-label="Note location" title={app.doc?.path}>
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
