<!-- The note composer's dialogs (FOP-14, FOP-15): a name for the note a
     selection is extracted to, and the confirmation before a merge. -->
<script lang="ts">
  import { FileOutput, Merge } from "@lucide/svelte";
  import { stem } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Checkbox from "./Checkbox.svelte";
  import Modal from "./Modal.svelte";

  const request = $derived(app.composer);
  let name = $state(app.composer?.kind === "extract" ? app.composer.defaultName : "");
  let embed = $state(false);
  let withHeading = $state(true);

  function close() {
    app.composer = null;
  }

  function confirm() {
    const current = request;
    if (!current) return;
    if (current.kind === "extract") {
      if (name.trim() === "") return;
      close();
      run("extractSelection", current.path, current.from, current.to, current.text, name, embed);
    } else {
      close();
      run("mergeNote", current.source, current.target, withHeading);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    confirm();
  }
</script>

{#if request?.kind === "extract"}
  <Modal width={460} labelledby="composer-title" onclose={close}>
    <div class="dialog">
      <div class="badge"><FileOutput size={18} /></div>
      <div class="text">
        <h2 id="composer-title">Extract selection to a new note</h2>
        <p>The note is created beside “{stem(request.path)}” and the selection becomes a link to it.</p>
        <input
          class="name-field"
          bind:value={name}
          data-autofocus
          placeholder="Note name"
          spellcheck="false"
          autocomplete="off"
          aria-label="Note name"
          onkeydown={onKeydown}
          onfocus={(event) => event.currentTarget.select()}
        />
        <Checkbox label="Embed the new note instead of linking to it" checked={embed} onchange={(on) => (embed = on)} />
      </div>
    </div>
    <div class="actions">
      <button class="button" onclick={close}>Cancel</button>
      <button class="button primary" disabled={name.trim() === ""} onclick={confirm}>Extract</button>
    </div>
  </Modal>
{:else if request?.kind === "merge"}
  <Modal width={460} role="alertdialog" labelledby="composer-title" describedby="composer-message" onclose={close}>
    <div class="dialog">
      <div class="badge"><Merge size={18} /></div>
      <div class="text">
        <h2 id="composer-title">Merge “{stem(request.source)}” into “{stem(request.target)}”?</h2>
        <p id="composer-message">
          Its text is added to the end of “{stem(request.target)}”, links to it point there instead, and the note goes to the Recycle Bin.
        </p>
        <Checkbox label={`Add a “${stem(request.source)}” heading above the merged text`} checked={withHeading} onchange={(on) => (withHeading = on)} />
      </div>
    </div>
    <div class="actions">
      <button class="button" onclick={close}>Cancel</button>
      <button class="button primary" data-autofocus onclick={confirm}>Merge</button>
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
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  .name-field {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-panel);
    color: var(--ui-text);
    font-size: 14px;
    outline: none;
  }
  .name-field:focus {
    border-color: var(--ui-accent);
  }
  .name-field::placeholder {
    color: var(--ui-faint);
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
