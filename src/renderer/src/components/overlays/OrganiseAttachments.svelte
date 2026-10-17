<!-- Organise Attachments… (VLT-21): previews moving each attachment into its
     note's folder (or Shared) before doing it. Links are updated; Undo is offered. -->
<script lang="ts">
  import { ArrowRight, FolderTree } from "@lucide/svelte";
  import { basename, dirname } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  const plan = $derived(app.vault?.attachmentOrganise ?? null);
  const moves = $derived(plan?.moves ?? []);
  const files = $derived(moves.length === 1 ? "1 attachment" : `${moves.length} attachments`);
  const notes = $derived(plan?.notesChanged === 1 ? "1 note" : `${plan?.notesChanged ?? 0} notes`);
</script>

<Modal width={620} labelledby="organise-title" describedby="organise-summary" onclose={() => run("cancelAttachmentOrganise")}>
  <div class="sheet">
    <div class="header">
      <div class="badge"><FolderTree size={18} /></div>
      <div class="header-text">
        <h2 id="organise-title">Organise Attachments</h2>
        <p id="organise-summary">
          Move {files} into a folder for the note that uses each one; files used by several notes go in Shared. Links in {notes} will be updated.
          Unused files stay where they are.
        </p>
      </div>
    </div>

    <ul class="list">
      {#each moves as move (move.from)}
        <li title="{move.from} → {move.to}">
          <span class="file">
            {basename(move.from)}{#if basename(move.to) !== basename(move.from)}<span class="renamed"> → {basename(move.to)}</span>{/if}
          </span>
          <span class="folders">
            <span class="folder">{dirname(move.from) || "Vault root"}</span>
            <ArrowRight size={12} />
            <span class="folder to">{dirname(move.to) || "Vault root"}</span>
          </span>
        </li>
      {/each}
    </ul>
  </div>
  <div class="actions">
    <button class="button" onclick={() => run("cancelAttachmentOrganise")}>Cancel</button>
    <button class="button primary" data-autofocus onclick={() => run("confirmAttachmentOrganise")}>Organise {files}</button>
  </div>
</Modal>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    padding: 22px 22px 14px;
  }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
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
  .header-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-editor);
    font-size: 12px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 12px;
  }
  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text);
  }
  .renamed {
    color: var(--ui-text-2);
  }
  .folders {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    color: var(--ui-text-3);
  }
  .folder {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder.to {
    color: var(--ui-text-2);
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
</style>
