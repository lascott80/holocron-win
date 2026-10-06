<!-- The sidebar's collapsible "Tags" section (UI-14): up to 100 tags with counts;
     clicking one opens Quick Open on "#tag". -->
<script lang="ts">
  import { ChevronRight, Hash } from "@lucide/svelte";
  import type { TagCount } from "@shared/ipc";
  import { app } from "../../lib/app.svelte";
  import { call } from "../../lib/host";

  let tags = $state<TagCount[]>([]);
  let request = 0;

  const revision = $derived(app.vault?.indexRevision ?? -1);
  const expanded = $derived(app.settings.tagsExpanded);

  $effect(() => {
    void revision;
    const id = ++request;
    call<TagCount[] | undefined>("allTags")
      .then((result) => {
        if (id === request) tags = (result ?? []).slice(0, 100);
      })
      .catch((error: unknown) => console.error("[allTags]", error));
  });
</script>

{#if tags.length}
  <section class="tags">
    <button class="header" aria-expanded={expanded} onclick={() => app.setSetting("tagsExpanded", !expanded)}>
      <span class="section-label">Tags</span>
      <span class="chevron" class:open={expanded}><ChevronRight size={13} strokeWidth={2.25} /></span>
    </button>
    {#if expanded}
      <div class="list">
        {#each tags as tag (tag.tag)}
          <button class="row" title="#{tag.tag}" onclick={() => app.showQuickOpen("#" + tag.tag)}>
            <Hash size={14} />
            <span class="name">{tag.tag}</span>
            <span class="count">{tag.count.toLocaleString()}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .tags {
    display: flex;
    flex-direction: column;
    padding: 4px 0 8px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin: 0 6px 2px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
  }
  .header:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .chevron {
    display: inline-flex;
    color: var(--ui-text-3);
    opacity: 0;
    transition:
      transform 0.12s ease-out,
      opacity 0.12s;
  }
  .header:hover .chevron,
  .header:focus-visible .chevron,
  .chevron:not(.open) {
    opacity: 1;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    margin: 0 6px;
    padding: 0 10px 0 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    text-align: left;
  }
  .row :global(svg) {
    flex: none;
    color: var(--ui-text-3);
  }
  .row:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .row:hover :global(svg) {
    color: var(--ui-accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-size: 11px;
    color: var(--ui-text-3);
    font-variant-numeric: tabular-nums;
  }
</style>
