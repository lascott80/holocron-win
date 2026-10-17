<!-- Confirms Empty Unused Attachments… and Undo Last Attachment Change…
     (VLT-20, VLT-23); main supplies the wording. -->
<script lang="ts">
  import { ArchiveX, Undo2 } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  const view = $derived(app.vault?.attachmentConfirm ?? null);
</script>

{#if view}
  <Modal width={440} role="alertdialog" labelledby="attachment-confirm-title" describedby="attachment-confirm-message" onclose={() => run("cancelAttachmentAction")}>
    <div class="dialog">
      <div class="badge" class:danger={view.danger}>
        {#if view.danger}<ArchiveX size={18} />{:else}<Undo2 size={18} />{/if}
      </div>
      <div class="text">
        <h2 id="attachment-confirm-title">{view.title}</h2>
        <p id="attachment-confirm-message">{view.message}</p>
      </div>
    </div>
    <div class="actions">
      <button class="button" data-autofocus onclick={() => run("cancelAttachmentAction")}>Cancel</button>
      <button class="button" class:danger={view.danger} class:primary={!view.danger} onclick={() => run("confirmAttachmentAction")}>{view.confirmLabel}</button>
    </div>
  </Modal>
{/if}

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
    background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
    color: var(--ui-accent);
  }
  .badge.danger {
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
