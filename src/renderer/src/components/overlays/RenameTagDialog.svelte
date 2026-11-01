<!-- Rename Tag… (FOP-13): a name field pre-filled with the tag, checked as
     you type; renaming onto an existing tag asks to merge first. -->
<script lang="ts">
  import { Hash } from "@lucide/svelte";
  import { isValidTagName } from "@core/tagTree";
  import type { TagCount } from "@shared/ipc";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  const from = $derived(app.renamingTag ?? "");
  let name = $state(app.renamingTag ?? "");
  let existing = $state<Set<string>>(new Set());
  /** The merge question is showing. */
  let merging = $state(false);
  let field = $state<HTMLInputElement | null>(null);

  $effect(() => {
    void call<TagCount[] | undefined>("allTags")
      .then((tags) => (existing = new Set((tags ?? []).map((tag) => tag.tag.toLowerCase()))))
      .catch((error: unknown) => console.error("[allTags]", error));
  });

  $effect(() => {
    field?.select();
  });

  const trimmed = $derived(name.trim().replace(/^#+/, ""));
  const error = $derived(trimmed === "" ? null : isValidTagName(trimmed) ? null : "Tags can use letters, digits, “-”, “_” and “/”, and can’t start with a digit.");
  const unchanged = $derived(trimmed === from);
  const canRename = $derived(trimmed !== "" && error === null && !unchanged);
  /** Another tag already has this name (not just a different case of the same one). */
  const exists = $derived(trimmed.toLowerCase() !== from.toLowerCase() && existing.has(trimmed.toLowerCase()));

  function close() {
    app.renamingTag = null;
  }

  function submit() {
    if (!canRename) return;
    if (exists && !merging) {
      merging = true;
      return;
    }
    run("renameTag", from, trimmed);
    close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }
</script>

<Modal width={420} labelledby="rename-tag-title" onclose={close}>
  <div class="dialog">
    <div class="badge"><Hash size={18} /></div>
    <div class="text">
      <h2 id="rename-tag-title">Rename #{from}</h2>
      {#if merging}
        <p>#{trimmed} already exists — merge?</p>
        <p class="hint">Every note tagged #{from} will be tagged #{trimmed} instead.</p>
      {:else}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="field"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="Tag"
          aria-label="New tag name"
          aria-invalid={error !== null}
          bind:this={field}
          bind:value={name}
          onkeydown={onKeydown}
          data-autofocus
        />
        <p class="hint" class:error={error !== null}>
          {error ?? "Renames the tag and every tag nested under it in every note."}
        </p>
      {/if}
    </div>
  </div>
  <div class="actions">
    <button class="button" onclick={close}>Cancel</button>
    {#if merging}
      <button class="button primary" data-autofocus onclick={submit}>Merge</button>
    {:else}
      <button class="button primary" disabled={!canRename} onclick={submit}>Rename</button>
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
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .hint {
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .hint.error {
    color: var(--ui-danger);
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
