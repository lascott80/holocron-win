<!-- Confirms moving vault items to the Recycle Bin (FOP-10). -->
<script lang="ts">
  import { Trash2 } from "@lucide/svelte";
  import { basename, isNote, stem } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Checkbox from "./Checkbox.svelte";

  const items = $derived(app.vault?.pendingDeletion ?? []);
  const title = $derived(
    items.length === 1 ? `Move “${isNote(items[0]!) ? stem(items[0]!) : basename(items[0]!)}” to the Recycle Bin?` : `Move ${items.length} items to the Recycle Bin?`,
  );

  // Attachments only these notes use (FOP-10a); worked out just after the dialog opens.
  const attachments = $derived(app.vault?.pendingDeletionAttachments ?? []);
  let withAttachments = $state(true);
  const attachmentLabel = $derived(
    `Also move ${attachments.length === 1 ? "1 attachment" : `${attachments.length} attachments`} only ${items.length > 1 ? "these items use" : isNote(items[0] ?? "") ? "this note uses" : "notes in it use"} to the Recycle Bin`,
  );
  const shown = $derived(attachments.slice(0, 5).map(basename));
</script>

<Modal width={420} role="alertdialog" labelledby="delete-title" describedby="delete-message" onclose={() => run("cancelDeletion")}>
  <div class="dialog">
    <div class="badge"><Trash2 size={18} /></div>
    <div class="text">
      <h2 id="delete-title">{title}</h2>
      <p id="delete-message">You can restore it from the Recycle Bin. Unsaved changes in it will be lost.</p>
      {#if attachments.length}
        <div class="attachments">
          <Checkbox label={attachmentLabel} checked={withAttachments} onchange={(checked) => (withAttachments = checked)} />
          <p class="names">{shown.join(", ")}{attachments.length > shown.length ? ` and ${attachments.length - shown.length} more` : ""}</p>
        </div>
      {/if}
    </div>
  </div>
  <div class="actions">
    <button class="button" data-autofocus onclick={() => run("cancelDeletion")}>Cancel</button>
    <button class="button danger" onclick={() => run("confirmDeletion", withAttachments)}>Move to Recycle Bin</button>
  </div>
</Modal>

<style>
  .dialog {
    display: flex;
    gap: 14px;
    padding: 22px 22px 18px;
  }
  .badge {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ui-danger) 14%, transparent);
    color: var(--ui-danger);
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
  }
  .attachments {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }
  .names {
    padding-left: 24px;
    font-size: 12px;
    color: var(--ui-text-3);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 22px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-panel);
  }
  .actions .button {
    height: 32px;
    min-width: 92px;
  }
  .button.danger:hover {
    background: color-mix(in srgb, var(--ui-danger) 88%, #fff);
  }
</style>
