<!-- Workspaces (UI-49): Save Layout As… asks for a name (an existing one is
     replaced); Delete… lists the saved workspaces with a Delete button each. -->
<script lang="ts">
  import { LayoutPanelLeft, Trash2 } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  const mode = $derived(app.workspaceDialog ?? "save");
  const existing = $derived(app.vault?.workspaces ?? []);
  let name = $state(app.vault?.lastWorkspace ?? "");
  let field = $state<HTMLInputElement | null>(null);

  $effect(() => {
    field?.select();
  });

  const trimmed = $derived(name.trim());
  const replaces = $derived(existing.includes(trimmed));

  function close() {
    app.workspaceDialog = null;
  }

  function save() {
    if (trimmed === "") return;
    run("saveWorkspace", trimmed, app.workspaceUi());
    close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
  }
</script>

<Modal width={420} labelledby="workspace-title" onclose={close}>
  <div class="dialog">
    <div class="badge"><LayoutPanelLeft size={18} /></div>
    <div class="text">
      {#if mode === "save"}
        <h2 id="workspace-title">Save Layout As</h2>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field" type="text" spellcheck="false" autocomplete="off" placeholder="Workspace name" aria-label="Workspace name" list="workspace-names" bind:this={field} bind:value={name} onkeydown={onKeydown} data-autofocus />
        <datalist id="workspace-names">
          {#each existing as workspace (workspace)}<option value={workspace}></option>{/each}
        </datalist>
        <p class="hint">{replaces ? `Replaces the saved workspace “${trimmed}”.` : "Remembers the panes, the open tabs and the sidebar and inspector for this vault."}</p>
      {:else}
        <h2 id="workspace-title">Delete a Workspace</h2>
        {#if existing.length === 0}
          <p class="hint">No saved workspaces.</p>
        {:else}
          <ul class="list">
            {#each existing as workspace (workspace)}
              <li>
                <span class="name">{workspace}</span>
                <button class="icon-button" title="Delete “{workspace}”" aria-label="Delete {workspace}" onclick={() => run("deleteWorkspace", workspace)}>
                  <Trash2 size={14} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
  <div class="actions">
    {#if mode === "save"}
      <button class="button" onclick={close}>Cancel</button>
      <button class="button primary" disabled={trimmed === ""} onclick={save}>{replaces ? "Replace" : "Save"}</button>
    {:else}
      <button class="button primary" data-autofocus onclick={close}>Done</button>
    {/if}
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
    background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
    color: var(--ui-accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--ui-text-3);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .field {
    width: 100%;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-panel);
    color: var(--ui-text);
    font: inherit;
    font-size: 13px;
  }
  .field:focus {
    outline: none;
    border-color: var(--ui-accent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    font-size: 13px;
  }
  .list li + li {
    border-top: 1px solid var(--ui-border);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 22px;
    border-top: 1px solid var(--ui-border);
  }
</style>
