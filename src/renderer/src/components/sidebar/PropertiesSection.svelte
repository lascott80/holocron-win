<!-- The sidebar's collapsible "Properties" section (UI-14b): every frontmatter key in the
     vault with its type and note count; a row expands to its commonest values. Clicking a
     key searches the vault for [key], clicking a value for [key:value]. -->
<script lang="ts">
  import { Calendar, ChevronRight, Clock, Hash, List, SquareCheck, Type } from "@lucide/svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { PropertySummary } from "@shared/ipc";
  import { app } from "../../lib/app.svelte";

  const icons = { text: Type, list: List, number: Hash, checkbox: SquareCheck, date: Calendar, datetime: Clock } as const;
  const typeNames = { text: "Text", list: "List", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date & time" } as const;

  const properties = $derived<PropertySummary[]>(app.vault?.properties ?? []);
  const expanded = $derived(app.settings.propertiesExpanded);
  /** Keys whose values are showing. */
  const open = new SvelteSet<string>();

  function toggle(event: MouseEvent, key: string) {
    event.stopPropagation();
    if (open.has(key)) open.delete(key);
    else open.add(key);
  }
</script>

{#if properties.length}
  <section class="properties">
    <button class="header" aria-expanded={expanded} onclick={() => app.setSetting("propertiesExpanded", !expanded)}>
      <span class="section-label">Properties</span>
      <span class="count">{properties.length.toLocaleString()}</span>
      <span class="chevron" class:open={expanded}><ChevronRight size={13} strokeWidth={2.25} /></span>
    </button>
    {#if expanded}
      <div class="list">
        {#each properties as property (property.key)}
          {@const Icon = icons[property.type]}
          {@const isOpen = open.has(property.key)}
          <div class="row" class:is-open={isOpen}>
            <button
              class="disclosure"
              aria-label={isOpen ? `Hide values of ${property.key}` : `Show values of ${property.key}`}
              aria-expanded={isOpen}
              disabled={!property.values.length}
              onclick={(event) => toggle(event, property.key)}
            >
              <ChevronRight size={12} strokeWidth={2.25} />
            </button>
            <button class="key" title="Search for notes with “{property.key}”" onclick={() => app.showSearch(`[${property.key}]`)}>
              <span class="icon" title={typeNames[property.type]}><Icon size={14} /></span>
              <span class="name">{property.key}</span>
              <span class="count">{property.count.toLocaleString()}</span>
            </button>
          </div>
          {#if isOpen}
            {#each property.values as [value, count] (value)}
              <button class="value" title="Search for “{property.key}: {value}”" onclick={() => app.showSearch(`[${property.key}:${value}]`)}>
                <span class="name">{value === "" ? "(empty)" : value}</span>
                <span class="count">{count.toLocaleString()}</span>
              </button>
            {/each}
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .properties {
    display: flex;
    flex-direction: column;
    padding: 4px 0 8px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    margin: 0 6px 2px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
  }
  .header .section-label {
    flex: 1;
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
    height: 26px;
    margin: 0 6px;
    border-radius: 6px;
  }
  .row:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .disclosure {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 26px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text-3);
    opacity: 0;
    transition:
      transform 0.12s ease-out,
      opacity 0.12s;
  }
  .disclosure:disabled {
    visibility: hidden;
  }
  .row:hover .disclosure,
  .disclosure:focus-visible,
  .row.is-open .disclosure {
    opacity: 1;
  }
  .row.is-open .disclosure {
    transform: rotate(90deg);
  }
  .key,
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 10px 0 2px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    text-align: left;
  }
  .icon {
    display: inline-flex;
    flex: none;
    color: var(--ui-text-3);
  }
  .key:hover .icon {
    color: var(--ui-accent);
  }
  .value {
    margin: 0 6px;
    padding-left: 44px;
    color: var(--ui-text-2);
    font-size: 12.5px;
  }
  .value:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
    color: var(--ui-text);
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
