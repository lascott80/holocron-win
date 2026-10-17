<!-- Organise Attachments… (VLT-21): previews moving each attachment into its
     note's folder (or Shared); rows can be unticked. Files a note mentions in a
     way Holocron can't update are listed as skipped. Links are updated; the
     change is checked, logged and can be undone. -->
<script lang="ts">
  import { ArrowRight, FolderTree, TriangleAlert } from "@lucide/svelte";
  import { basename, dirname, stem } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Checkbox from "./Checkbox.svelte";

  const plan = $derived(app.vault?.attachmentOrganise ?? null);
  const moves = $derived(plan?.moves ?? []);
  const skipped = $derived(plan?.skipped ?? []);
  let unticked = $state(new Set<string>());
  const chosen = $derived(moves.filter((move) => !unticked.has(move.from)));

  function toggle(path: string, checked: boolean) {
    const next = new Set(unticked);
    if (checked) next.delete(path);
    else next.add(path);
    unticked = next;
  }

  const files = (n: number) => (n === 1 ? "1 attachment" : `${n} attachments`);
  const notesChanged = $derived(plan?.notesChanged === 1 ? "1 note" : `${plan?.notesChanged ?? 0} notes`);
  const title = $derived(plan?.scope ? `Organise “${stem(plan.scope)}”’s Attachments` : "Organise Attachments");
  const notes = (paths: string[]) => paths.slice(0, 2).map((path) => `“${stem(path)}”`).join(", ") + (paths.length > 2 ? ` and ${paths.length - 2} more` : "");
</script>

<Modal width={620} labelledby="organise-title" describedby="organise-summary" onclose={() => run("cancelAttachmentOrganise")}>
  <div class="sheet">
    <div class="header">
      <div class="badge"><FolderTree size={18} /></div>
      <div class="header-text">
        <h2 id="organise-title">{title}</h2>
        <p id="organise-summary">
          {#if moves.length}
            Move {files(moves.length)} into a folder for the note that uses each one; files used by several notes go in Shared. Links in
            {notesChanged} will be updated, and the move is checked before and after, so a link that would break stops it. Undo Last Attachment
            Change puts everything back later.
          {:else}
            Nothing can be moved safely right now.
          {/if}
        </p>
      </div>
    </div>

    {#if moves.length}
      <ul class="list">
        {#each moves as move (move.from)}
          <li class:off={unticked.has(move.from)} title="{move.from} → {move.to}">
            <Checkbox label="" ariaLabel={move.from} checked={!unticked.has(move.from)} onchange={(checked) => toggle(move.from, checked)} />
            <div class="move">
              <span class="file">
                {basename(move.from)}{#if basename(move.to) !== basename(move.from)}<span class="renamed"> → {basename(move.to)}</span>{/if}
              </span>
              <span class="folders">
                <span class="folder">{dirname(move.from) || "Vault root"}</span>
                <ArrowRight size={12} />
                <span class="folder to">{dirname(move.to) || "Vault root"}</span>
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if skipped.length}
      <div class="skipped">
        <div class="skipped-title"><TriangleAlert size={13} /> {files(skipped.length)} left where {skipped.length === 1 ? "it is" : "they are"}</div>
        <p>A note mentions {skipped.length === 1 ? "it" : "them"} in a way Holocron can’t update (in code, or HTML it doesn’t read), so moving would break that reference.</p>
        <ul>
          {#each skipped.slice(0, 6) as item (item.path)}
            <li><span class="file">{basename(item.path)}</span> <span class="folder">in {notes(item.notes)}</span></li>
          {/each}
          {#if skipped.length > 6}<li class="folder">and {skipped.length - 6} more</li>{/if}
        </ul>
      </div>
    {/if}
  </div>
  <div class="actions">
    <button class="button" onclick={() => run("cancelAttachmentOrganise")}>{moves.length ? "Cancel" : "Close"}</button>
    {#if moves.length}
      <button class="button primary" data-autofocus disabled={chosen.length === 0} onclick={() => run("confirmAttachmentOrganise", chosen.map((move) => move.from))}>
        Organise {files(chosen.length)}
      </button>
    {/if}
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
    max-height: 300px;
    overflow: auto;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-editor);
    font-size: 12px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px;
  }
  .list li.off {
    opacity: 0.55;
  }
  .move {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
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
    color: var(--ui-text-3);
  }
  .folder.to {
    color: var(--ui-text-2);
  }
  .skipped {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ui-warning) 10%, transparent);
    font-size: 12px;
  }
  .skipped-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .skipped-title :global(svg) {
    color: var(--ui-warning);
  }
  .skipped ul {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
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
