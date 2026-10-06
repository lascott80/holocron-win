<!-- The right-hand panel (UI-16..UI-19): the open note's outline, its links and file info. -->
<script lang="ts">
  import { FileText, FolderOpen, Link2, CornerDownRight } from "@lucide/svelte";
  import type { NoteDetails } from "@shared/ipc";
  import type { InspectorTab } from "@shared/settings";
  import { dirname } from "@core/paths";
  import { plainText } from "@core/noteParser";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Segmented from "../overlays/Segmented.svelte";

  const tabs: { value: InspectorTab; label: string }[] = [
    { value: "outline", label: "Outline" },
    { value: "links", label: "Links" },
    { value: "info", label: "Info" },
  ];

  const tab = $derived(app.settings.inspectorTab);
  const path = $derived(app.doc?.path ?? null);

  let details = $state<NoteDetails | null>(null);
  /** The path `details` belongs to, so a stale note's data never shows. */
  let detailsPath = $state<string | null>(null);
  let request = 0;

  $effect(() => {
    const current = path;
    void app.vault?.indexRevision;
    if (!current) {
      details = null;
      detailsPath = null;
      return;
    }
    const id = ++request;
    call<NoteDetails | undefined>("details", current)
      .then((result) => {
        if (id !== request) return;
        details = result ?? null;
        detailsPath = current;
      })
      .catch((error: unknown) => console.error("[details]", error));
  });

  const shown = $derived(details && detailsPath === path ? details : null);
  const headings = $derived(shown?.headings ?? []);
  const minLevel = $derived(headings.length ? Math.min(...headings.map((h) => h.level)) : 1);
  const currentHeading = $derived.by(() => {
    let found = -1;
    headings.forEach((heading, index) => {
      if (heading.line <= app.cursor.line) found = index;
    });
    return found;
  });

  const properties = $derived((shown?.properties ?? []).filter((p) => !["tags", "tag", "aliases", "alias"].includes(p.key.toLowerCase())));

  const numberFormat = new Intl.NumberFormat();
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const words = $derived(app.text.match(/\S+/g)?.length ?? 0);
  const characters = $derived(Array.from(app.text).length);
  const folder = $derived(path ? dirname(path) : "");

  let scroller = $state<HTMLElement>();
  $effect(() => {
    // Keep the current heading in view as the cursor moves (without scrolling the window).
    const index = currentHeading;
    if (index < 0 || !scroller || tab !== "outline") return;
    const row = scroller.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!row) return;
    const box = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top + 8;
    else if (rect.bottom > box.bottom) scroller.scrollTop += rect.bottom - box.bottom + 8;
  });
</script>

{#snippet sectionHeader(title: string, count: number)}
  <div class="section-header">
    <span class="section-label">{title}</span>
    <span class="count-chip">{numberFormat.format(count)}</span>
  </div>
{/snippet}

{#snippet infoRow(label: string, value: string)}
  <div class="info-row">
    <span class="info-label" title={label}>{label}</span>
    <span class="info-value">{value}</span>
  </div>
{/snippet}

<div class="inspector">
  <div class="tabs">
    <Segmented label="Inspector" options={tabs} value={tab} onchange={(value) => app.setSetting("inspectorTab", value)} />
  </div>

  {#if !path}
    <div class="no-note">No note open</div>
  {:else}
    <div class="content" bind:this={scroller}>
      {#if tab === "outline"}
        {#if shown && headings.length === 0}
          <p class="empty">Headings in this note appear here.</p>
        {:else}
          <ul class="outline">
            {#each headings as heading, index (index)}
              <li>
                <button
                  class="heading"
                  class:top-level={heading.level === minLevel}
                  class:current={index === currentHeading}
                  style:padding-left="{(heading.level - minLevel) * 12 + 8}px"
                  data-index={index}
                  title={plainText(heading.text)}
                  onclick={() => run("scrollToLine", heading.line)}
                >
                  {plainText(heading.text)}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if tab === "links"}
        {#if shown}
          <section>
            {@render sectionHeader("Backlinks", shown.backlinks.length)}
            {#if shown.backlinks.length === 0}
              <p class="empty">No other notes link here yet.</p>
            {:else}
              <div class="cards">
                {#each shown.backlinks as backlink (backlink.source)}
                  <button class="card" title={backlink.source} onclick={() => run("open", backlink.source)}>
                    <span class="card-title"><FileText size={13} />{backlink.title}</span>
                    {#each backlink.contexts.slice(0, 3) as context, index (index)}
                      <span class="card-context">{plainText(context.trim())}</span>
                    {/each}
                  </button>
                {/each}
              </div>
            {/if}
          </section>

          {#if shown.mentions.length > 0}
            <section>
              {@render sectionHeader("Unlinked mentions", shown.mentions.length)}
              <div class="rows">
                {#each shown.mentions as mention (mention.source)}
                  <button class="link-row" title={mention.source} onclick={() => run("open", mention.source)}>
                    <span class="link-title">{mention.title}</span>
                    <span class="link-detail">{plainText(mention.context.trim())}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}

          {#if shown.outgoing.length > 0}
            <section>
              {@render sectionHeader("Links from this note", shown.outgoing.length)}
              <div class="rows">
                {#each shown.outgoing as link (link.target)}
                  <button
                    class="link-row outgoing"
                    class:dimmed={!link.resolved}
                    title={link.resolved ?? `Create “${link.target}”`}
                    onclick={() => run("openLink", link.target, false)}
                  >
                    <span class="link-title">
                      {#if link.resolved}<Link2 size={13} />{:else}<CornerDownRight size={13} />{/if}
                      <span class="ellipsis">{link.target}</span>
                    </span>
                    {#if !link.resolved}<span class="link-detail indent">Not created yet</span>{/if}
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        {/if}
      {:else}
        <section class="info">
          {@render infoRow("Location", folder || "Vault root")}
          {@render infoRow("Words", numberFormat.format(words))}
          {@render infoRow("Characters", numberFormat.format(characters))}
          {#if app.doc?.created}{@render infoRow("Created", dateFormat.format(app.doc.created))}{/if}
          {#if app.doc?.modified}{@render infoRow("Modified", dateFormat.format(app.doc.modified))}{/if}
          {#if shown && shown.aliases.length > 0}{@render infoRow("Aliases", shown.aliases.join(", "))}{/if}
        </section>

        {#if properties.length > 0}
          <section>
            {@render sectionHeader("Properties", properties.length)}
            <div class="info">
              {#each properties as property, index (index)}
                {@render infoRow(property.key, property.values.length ? property.values.map(plainText).join(", ") : "—")}
              {/each}
            </div>
          </section>
        {/if}

        {#if shown && shown.tags.length > 0}
          <section>
            {@render sectionHeader("Tags", shown.tags.length)}
            <div class="tags">
              {#each shown.tags as tag (tag)}
                <button class="tag-pill" title="Notes tagged #{tag}" onclick={() => app.showQuickOpen("#" + tag)}>#{tag}</button>
              {/each}
            </div>
          </section>
        {/if}

        <div>
          <button class="button show-in-folder" onclick={() => path && run("showInFolder", path)}>
            <FolderOpen size={14} />
            Show in File Explorer
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .tabs {
    flex: none;
    padding: 10px 14px;
  }
  .no-note {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-text-3);
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
  }
  .empty {
    margin: 0;
    padding: 0 8px;
    font-size: 12px;
    color: var(--ui-text-3);
  }

  /* Outline */
  .outline {
    list-style: none;
    margin: 0 -6px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .heading {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 13px;
    line-height: 1.35;
    text-align: left;
    overflow-wrap: anywhere;
    transition: background 0.1s;
  }
  .heading.top-level {
    color: var(--ui-body);
    font-weight: 500;
  }
  .heading:hover {
    background: var(--ui-chip);
  }
  .heading.current {
    background: rgba(var(--ui-accent-rgb), 0.14);
    color: var(--ui-accent-text);
  }

  /* Links */
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
  .card-title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-title :global(svg) {
    flex: none;
    color: var(--ui-text-3);
  }
  .card-context {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ui-text-2);
    overflow-wrap: anywhere;
  }
  .rows {
    display: flex;
    flex-direction: column;
    margin: 0 -6px;
  }
  .link-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    text-align: left;
  }
  .link-row:hover {
    background: var(--ui-chip);
  }
  .link-title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 13px;
    color: var(--ui-accent-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .link-title :global(svg) {
    flex: none;
    opacity: 0.8;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .link-row.dimmed .link-title {
    color: var(--ui-text-3);
  }
  .link-detail {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 11px;
    color: var(--ui-text-3);
    overflow-wrap: anywhere;
  }
  .link-detail.indent {
    padding-left: 19px;
  }

  /* Info */
  .info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .info-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
  }
  .info-label {
    flex: none;
    width: 80px;
    color: var(--ui-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-value {
    flex: 1;
    min-width: 0;
    color: var(--ui-body);
    overflow-wrap: anywhere;
    user-select: text;
    cursor: text;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .show-in-folder {
    margin-top: 2px;
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
  }
</style>
