<!-- A note changed on disk while it had unsaved edits (§14.5, "Disk" origin).
     Nothing is saved until a version is picked; clicking outside doesn't dismiss it. -->
<script lang="ts">
  import { RefreshCw } from "@lucide/svelte";
  import { diff, lines } from "@core/merge";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Checkbox from "./Checkbox.svelte";

  const conflict = $derived(app.vault?.conflict ?? null);

  interface Block {
    context: string[];
    mine: string[];
    disk: string[];
  }

  const clean = (line: string) => line.replace(/\r?\n$/, "");

  const blocks = $derived.by((): Block[] => {
    if (!conflict) return [];
    const mine = lines(conflict.mine);
    const disk = lines(conflict.theirs);
    return diff(mine, disk)
      .slice(0, 30)
      .map((hunk) => ({
        context: mine.slice(Math.max(0, hunk.baseStart - 1), hunk.baseStart).map(clean),
        mine: mine.slice(hunk.baseStart, hunk.baseEnd).map(clean),
        disk: disk.slice(hunk.otherStart, hunk.otherEnd).map(clean),
      }));
  });

  const sections = $derived(blocks.length === 1 ? "One section differs" : `${blocks.length} sections differ`);
  const overlap = $derived(conflict && !conflict.canMerge ? ", and some of your edits overlap the outside change" : "");

  function resolve(choice: "mine" | "disk" | "merge" | "both") {
    run("resolveConflict", choice);
  }

  function onKeydown(event: KeyboardEvent) {
    // Return picks the default ("Keep My Edits") unless a button has focus.
    if (event.key !== "Enter" || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;
    event.preventDefault();
    event.stopPropagation();
    resolve("mine");
  }
</script>

{#snippet column(title: string, side: "mine" | "disk")}
  <div class="column {side}">
    <div class="column-title">{title}</div>
    <div class="column-body">
      {#each blocks as block, index (index)}
        <div class="block">
          {#each block.context as line, i (i)}
            <div class="line context">{line || " "}</div>
          {/each}
          {#if block[side].length === 0}
            <div class="line placeholder">{side === "mine" ? "(removed)" : "(not present)"}</div>
          {/if}
          {#each block[side] as line, i (i)}
            <div class="line changed">{line || " "}</div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#if conflict}
  <Modal width={740} role="alertdialog" labelledby="conflict-title" describedby="conflict-summary" onkeydown={onKeydown}>
    <div class="sheet">
      <div class="header">
        <div class="badge"><RefreshCw size={18} /></div>
        <div class="header-text">
          <h2 id="conflict-title">“{conflict.fileName}” changed on disk</h2>
          <p id="conflict-summary">Another app or device changed this note while you had unsaved edits. {sections}{overlap}.</p>
        </div>
      </div>

      <div class="comparison">
        {@render column("Your edits · unsaved", "mine")}
        {@render column("On disk", "disk")}
      </div>

      <Checkbox
        label="Merge automatically when changes don’t overlap"
        checked={app.settings.autoMergeExternalChanges}
        onchange={(checked) => app.setSetting("autoMergeExternalChanges", checked)}
      />

      <div class="actions">
        <button class="button" title="Save your version as a separate “conflicted copy” note and show the disk version here" onclick={() => resolve("both")}>
          Keep Both as Copies
        </button>
        <span class="spacer"></span>
        <button class="button" title="Discard your unsaved edits" onclick={() => resolve("disk")}>Use Disk Version</button>
        <button
          class="button"
          disabled={!conflict.canMerge}
          title={conflict.canMerge ? "Combine both sets of changes" : "Your edits and the outside change touch the same lines"}
          onclick={() => resolve("merge")}
        >
          Merge Both
        </button>
        <button class="button primary" data-autofocus title="Overwrite the disk version with yours" onclick={() => resolve("mine")}>Keep My Edits</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    padding: 22px 24px 20px;
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
    background: color-mix(in srgb, var(--ui-warning) 16%, transparent);
    color: var(--ui-warning);
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
    color: var(--ui-text);
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
  }
  .comparison {
    display: flex;
    gap: 10px;
    height: 320px;
    min-height: 120px;
    flex-shrink: 1;
  }
  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-editor);
    overflow: hidden;
    --tint: var(--ui-accent);
  }
  .column.disk {
    --tint: var(--ui-warning);
  }
  .column-title {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ui-strong-border);
    background: var(--ui-sidebar);
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-body);
  }
  .column-title::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tint);
  }
  .column-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    user-select: text;
    cursor: text;
  }
  .line {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding: 1px 12px;
    font-family: "Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .line.context {
    color: var(--ui-text-2);
  }
  .line.changed {
    color: var(--ui-text);
    background: color-mix(in srgb, var(--tint) 16%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--tint) 70%, transparent);
  }
  .line.placeholder {
    color: var(--ui-text-3);
    font-style: italic;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions .button {
    height: 32px;
  }
  .spacer {
    flex: 1;
  }
</style>
