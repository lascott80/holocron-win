<!-- Shown above the editor when the open note was deleted or moved by another
     app while it had unsaved edits (SAV-09). "Restore" saves, re-creating the file. -->
<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";

  const path = $derived(app.doc?.path ?? null);
</script>

<div class="banner" role="alert">
  <span class="icon"><TriangleAlert size={15} /></span>
  <span class="message">This note was deleted or moved outside Holocron. Your unsaved edits are still here.</span>
  <div class="actions">
    <button class="button" onclick={() => path && run("discardMissing", path)}>Discard Edits</button>
    <button class="button primary" onclick={() => path && run("restoreMissing", path)}>Restore</button>
  </div>
</div>

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
  .actions {
    display: flex;
    flex: none;
    gap: 8px;
  }
  .button {
    height: 26px;
    padding: 0 12px;
    font-size: 12px;
  }
</style>
