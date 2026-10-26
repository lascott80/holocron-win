<!-- Shown above the editor when the open note, or the note it's a copy of,
     has a sync tool's conflict copy beside it (UI-41). "Review" opens the sheet. -->
<script lang="ts">
  import { GitCompare } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";

  const path = $derived(app.doc?.path ?? null);
  const conflict = $derived(path ? (app.vault?.syncConflicts.find((c) => c.original === path || c.copy === path) ?? null) : null);
  const from = $derived(conflict ? `${conflict.service}${conflict.device ? `, from ${conflict.device}` : ""}` : "");
</script>

{#if conflict}
  <div class="banner" role="status">
    <span class="icon"><GitCompare size={15} /></span>
    <span class="message">
      {#if conflict.copy === path}
        This is a sync conflict copy of “{conflict.original.replace(/\.md$/i, "")}” ({from}).
      {:else}
        A sync conflict copy of this note exists ({from}).
      {/if}
    </span>
    <button class="button primary" onclick={() => (app.syncReview = conflict.copy)}>Review…</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    padding: 8px 16px;
    background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-editor));
    border-bottom: 1px solid color-mix(in srgb, var(--ui-warning) 30%, transparent);
    font-size: 12px;
  }
  .icon {
    display: inline-flex;
    flex: none;
    color: var(--ui-warning);
  }
  .message {
    flex: 1;
    min-width: 0;
    color: var(--ui-text);
  }
  .button {
    height: 26px;
    padding: 0 12px;
    font-size: 12px;
  }
</style>
