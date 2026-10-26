<!-- Review a sync tool's conflict copy (UI-41): the note and the copy side by
     side, then keep one, combine them, compare them in split view or keep both.
     Several conflicts are stepped through with ‹ ›. -->
<script lang="ts">
  import { ChevronLeft, ChevronRight, GitCompare } from "@lucide/svelte";
  import { diff, lines } from "@core/merge";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  const conflicts = $derived(app.vault?.syncConflicts ?? []);
  const index = $derived(conflicts.findIndex((c) => c.copy === app.syncReview));
  const conflict = $derived(index >= 0 ? conflicts[index]! : null);
  let texts = $state<{ original: string; copy: string } | null>(null);
  let busy = $state(false);

  // The reviewed conflict was settled (or vanished): move to the next one, or close.
  $effect(() => {
    if (app.syncReview && index < 0) app.syncReview = conflicts[0]?.copy ?? null;
  });

  $effect(() => {
    const copy = conflict?.copy;
    texts = null;
    if (copy) void call<{ original: string; copy: string } | null>("syncConflictTexts", copy).then((result) => {
      if (conflict?.copy === copy) texts = result;
    });
  });

  interface Block {
    context: string[];
    note: string[];
    copy: string[];
  }

  const clean = (line: string) => line.replace(/\r?\n$/, "");
  const title = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

  const blocks = $derived.by((): Block[] => {
    if (!texts) return [];
    const note = lines(texts.original);
    const copy = lines(texts.copy);
    return diff(note, copy)
      .slice(0, 40)
      .map((hunk) => ({
        context: note.slice(Math.max(0, hunk.baseStart - 1), hunk.baseStart).map(clean),
        note: note.slice(hunk.baseStart, hunk.baseEnd).map(clean),
        copy: copy.slice(hunk.otherStart, hunk.otherEnd).map(clean),
      }));
  });

  const summary = $derived(
    !texts ? "Loading…" : blocks.length === 0 ? "The two versions are the same." : blocks.length === 1 ? "One section differs." : `${blocks.length} sections differ.`,
  );

  async function resolve(choice: "original" | "copy" | "combine" | "keepBoth") {
    if (!conflict || busy) return;
    busy = true;
    try {
      await call("resolveSyncConflict", conflict.copy, choice);
    } finally {
      busy = false;
    }
  }

  function compare() {
    if (!conflict) return;
    run("open", conflict.original);
    run("openInSplit", conflict.copy);
    app.syncReview = null;
  }

  function step(by: number) {
    const next = conflicts[(index + by + conflicts.length) % conflicts.length];
    if (next) app.syncReview = next.copy;
  }
</script>

{#snippet column(heading: string, side: "note" | "copy")}
  <div class="column {side}">
    <div class="column-title">{heading}</div>
    <div class="column-body">
      {#each blocks as block, i (i)}
        <div class="block">
          {#each block.context as line, j (j)}
            <div class="line context">{line || " "}</div>
          {/each}
          {#if block[side].length === 0}
            <div class="line placeholder">(not in this version)</div>
          {/if}
          {#each block[side] as line, j (j)}
            <div class="line changed">{line || " "}</div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#if conflict}
  <Modal width={760} labelledby="sync-title" describedby="sync-summary" onclose={() => (app.syncReview = null)}>
    <div class="sheet">
      <div class="header">
        <div class="badge"><GitCompare size={18} /></div>
        <div class="header-text">
          <h2 id="sync-title">Sync conflict in “{title(conflict.original)}”</h2>
          <p id="sync-summary">
            {conflict.service} kept both versions of this note{conflict.device ? ` (the copy is from ${conflict.device})` : ""}. {summary}
          </p>
        </div>
        {#if conflicts.length > 1}
          <div class="stepper">
            <button class="icon-button" aria-label="Previous conflict" onclick={() => step(-1)}><ChevronLeft size={16} /></button>
            <span>{index + 1} of {conflicts.length}</span>
            <button class="icon-button" aria-label="Next conflict" onclick={() => step(1)}><ChevronRight size={16} /></button>
          </div>
        {/if}
      </div>

      <div class="comparison">
        {@render column(`This note · ${title(conflict.original)}`, "note")}
        {@render column(`Conflicted copy · ${title(conflict.copy)}`, "copy")}
      </div>

      <div class="actions">
        <button class="button" disabled={busy} title="Keep both as separate notes and stop asking about this copy" onclick={() => resolve("keepBoth")}>Keep Both</button>
        <button class="button" title="Open the note and the copy side by side to copy things across yourself" onclick={compare}>Compare in Split View</button>
        <span class="spacer"></span>
        <button class="button" disabled={busy || !texts} title="Replace the note with the copy's text; the copy goes to the Recycle Bin" onclick={() => resolve("copy")}>Use Copy</button>
        <button
          class="button"
          disabled={busy || !texts || blocks.length === 0}
          title="Put both versions of every difference in the note (nothing is lost); the copy goes to the Recycle Bin"
          onclick={() => resolve("combine")}
        >
          Combine Both
        </button>
        <button class="button primary" data-autofocus disabled={busy} title="Keep the note as it is; the copy goes to the Recycle Bin" onclick={() => resolve("original")}>
          Keep This Note
        </button>
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
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stepper {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ui-text-2);
    font-size: 12px;
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
    height: 340px;
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
  .column.copy {
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
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .column-title::before {
    content: "";
    flex: none;
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
    padding: 1px 12px;
    font-family: "JetBrains Mono Variable", "Cascadia Mono", Consolas, ui-monospace, monospace;
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
