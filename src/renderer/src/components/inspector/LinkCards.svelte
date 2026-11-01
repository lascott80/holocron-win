<!-- A note's backlinks and unlinked mentions as cards (UI-18, LNK-15), shared by
     the inspector's Links tab and the panel under the note (UI-44). A card's
     title opens the note, a context line reveals it there; unlinked mentions
     have a Link button, and their header a Link all. -->
<script lang="ts">
  import { ChevronRight, FileText } from "@lucide/svelte";
  import type { NoteDetails } from "@shared/ipc";
  import { plainLine } from "@core/noteParser";
  import { run } from "../../lib/host";

  let {
    path,
    details,
    inNote = false,
  }: {
    /** The note the details belong to. */
    path: string;
    details: NoteDetails;
    /** The panel under the note: collapsible "Linked mentions" / "Unlinked mentions" headers. */
    inNote?: boolean;
  } = $props();

  const numberFormat = new Intl.NumberFormat();
  let linkedOpen = $state(true);
  let unlinkedOpen = $state(false);

  function link(sources: string[] | null) {
    run("linkMentions", path, sources);
  }
</script>

{#snippet header(title: string, count: number, open: boolean, toggle: () => void, all: boolean)}
  <div class="section-header" class:collapsible={inNote}>
    {#if inNote}
      <button class="disclosure" aria-expanded={open} onclick={toggle}>
        <span class="chevron" class:open><ChevronRight size={14} /></span>
        <span class="panel-label">{title}</span>
        <span class="count-chip">{numberFormat.format(count)}</span>
      </button>
    {:else}
      <span class="section-label">{title}</span>
      <span class="count-chip">{numberFormat.format(count)}</span>
    {/if}
    {#if all}
      <button class="link-button all" title="Link every mention listed here" onclick={() => link(null)}>Link all</button>
    {/if}
  </div>
{/snippet}

{#snippet card(source: string, title: string, contexts: string[], lines: number[], mention: boolean)}
  <div class="card">
    <div class="card-head">
      <button class="card-title" title={source} onclick={() => run("open", source)}>
        <FileText size={13} />
        <span class="ellipsis">{title}</span>
      </button>
      {#if mention}
        <button class="link-button" title="Turn this mention into a link" onclick={() => link([source])}>Link</button>
      {/if}
    </div>
    {#each contexts.slice(0, 3) as context, index (index)}
      <button class="card-context" title="Show this line" onclick={() => run("reveal", source, lines[index] ?? 1, 0, 0)}>
        {plainLine(context.trim())}
      </button>
    {/each}
  </div>
{/snippet}

<section>
  {@render header(inNote ? "Linked mentions" : "Backlinks", details.backlinks.length, linkedOpen, () => (linkedOpen = !linkedOpen), false)}
  {#if !inNote || linkedOpen}
    {#if details.backlinks.length === 0}
      <p class="empty">No other notes link here yet.</p>
    {:else}
      <div class="cards">
        {#each details.backlinks as backlink (backlink.source)}
          {@render card(backlink.source, backlink.title, backlink.contexts, backlink.lines, false)}
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if details.mentions.length > 0 || inNote}
  <section>
    {@render header("Unlinked mentions", details.mentions.length, unlinkedOpen, () => (unlinkedOpen = !unlinkedOpen), details.mentions.length > 1)}
    {#if !inNote || unlinkedOpen}
      {#if details.mentions.length === 0}
        <p class="empty">No other notes mention this one.</p>
      {:else}
        <div class="cards">
          {#each details.mentions as mention (mention.source)}
            {@render card(mention.source, mention.title, [mention.context], [mention.line], true)}
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 4px;
  }
  .section-header.collapsible {
    justify-content: flex-start;
  }
  .disclosure {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 2px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-2);
  }
  .disclosure:hover {
    background: var(--ui-chip);
  }
  .chevron {
    display: inline-flex;
    color: var(--ui-text-3);
    transition: transform 0.12s;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .panel-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .empty {
    margin: 0;
    padding: 0 8px;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-raised);
    text-align: left;
    transition: border-color 0.12s, background 0.12s;
  }
  .card:hover {
    border-color: var(--ui-strong-border);
    background: color-mix(in srgb, var(--ui-raised) 80%, var(--ui-chip));
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .card-title {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    text-align: left;
  }
  .card-title:hover {
    color: var(--ui-accent-text);
  }
  .card-title :global(svg) {
    flex: none;
    color: var(--ui-text-3);
  }
  .ellipsis {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .card-context {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ui-text-2);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .card-context:hover {
    color: var(--ui-text);
  }
  .link-button {
    flex: none;
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 11px;
    background: var(--ui-raised);
    color: var(--ui-accent-text);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  .link-button:hover {
    background: rgba(var(--ui-accent-rgb), 0.14);
  }
  .link-button.all {
    margin-left: auto;
  }
</style>
