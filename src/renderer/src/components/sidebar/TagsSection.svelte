<!-- The sidebar's collapsible "Tags" section (UI-14): a tree where
     "project/alpha" nests under "project", each node with its own count and,
     for parents, the subtree's total; up to 1000 nodes. Clicking a tag opens
     Quick Open on "#tag"; right-click searches, renames (FOP-13) or copies it.
     Expanded tags are remembered per vault (main's store, `tagTree:<root>`). -->
<script lang="ts">
  import { untrack } from "svelte";
  import { ArrowUpDown, ChevronRight, Hash } from "@lucide/svelte";
  import { visibleTagRows, type TagNode } from "@core/tagTree";
  import type { TagSort } from "@shared/settings";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";

  const TAG_SORTS: { value: TagSort; label: string }[] = [
    { value: "count", label: "Most Used" },
    { value: "name", label: "Name" },
  ];

  let tree = $state<TagNode[]>([]);
  let expanded = $state<Set<string>>(new Set());
  /** The row keyboard navigation is on (its lowercased tag), or null. */
  let focused = $state<string | null>(null);
  let list = $state<HTMLElement | null>(null);
  let request = 0;

  const revision = $derived(app.vault?.indexRevision ?? -1);
  const vaultRoot = $derived(app.vault?.root ?? "");
  const sectionOpen = $derived(app.settings.tagsExpanded);
  const sort = $derived(app.settings.tagSort);
  const rows = $derived(visibleTagRows(tree, expanded));

  // Each vault remembers which tags are open.
  $effect(() => {
    if (!vaultRoot) return;
    const root = vaultRoot;
    void call<string[] | undefined>("expandedTags")
      .then((paths) => {
        if (root === app.vault?.root) untrack(() => (expanded = new Set((paths ?? []).map((path) => path.toLowerCase()))));
      })
      .catch((error: unknown) => console.error("[expandedTags]", error));
  });

  $effect(() => {
    void revision;
    const id = ++request;
    call<TagNode[] | undefined>("tagTree", sort)
      .then((result) => {
        if (id === request) tree = result ?? [];
      })
      .catch((error: unknown) => console.error("[tagTree]", error));
  });

  const key = (node: TagNode) => node.tag.toLowerCase();

  function setExpanded(node: TagNode, open: boolean) {
    if (expanded.has(key(node)) === open) return;
    const next = new Set(expanded);
    if (open) next.add(key(node));
    else next.delete(key(node));
    expanded = next;
    run("setExpandedTags", [...next]);
  }

  function openSortMenu(event: MouseEvent) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    menu.open(
      TAG_SORTS.map(({ value, label }) => ({ label, checked: sort === value, run: () => app.setSetting("tagSort", value) })),
      rect.left,
      rect.bottom + 2,
    );
  }

  function onContextMenu(event: MouseEvent, node: TagNode) {
    focused = key(node);
    const entries: MenuEntry[] = [
      { label: "Search Notes with Tag", run: () => app.showSearch(`tag:${node.tag}`) },
      { label: "Rename Tag…", run: () => (app.renamingTag = node.tag) },
      "-",
      { label: "Copy Tag", run: () => void navigator.clipboard.writeText(`#${node.tag}`) },
    ];
    menu.openAt(event, entries);
  }

  function rowElement(tag: string): HTMLElement | null {
    return list?.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag)}"]`) ?? null;
  }

  function focusRow(index: number) {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!row) return;
    focused = key(row.node);
    rowElement(focused)?.scrollIntoView({ block: "nearest" });
  }

  function onKeydown(event: KeyboardEvent) {
    if (!rows.length) return;
    const index = focused === null ? -1 : rows.findIndex((row) => key(row.node) === focused);
    const current = index >= 0 ? rows[index] : null;
    switch (event.key) {
      case "ArrowDown":
        focusRow(index < 0 ? 0 : index + 1);
        break;
      case "ArrowUp":
        focusRow(index < 0 ? rows.length - 1 : index - 1);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (current?.node.children.length) {
          if (!expanded.has(key(current.node))) setExpanded(current.node, true);
          else focusRow(index + 1);
        }
        break;
      case "ArrowLeft":
        if (current?.node.children.length && expanded.has(key(current.node))) setExpanded(current.node, false);
        else if (current?.parent) {
          focused = current.parent.toLowerCase();
          rowElement(focused)?.scrollIntoView({ block: "nearest" });
        }
        break;
      case "Enter":
      case " ":
        if (current) app.showQuickOpen("#" + current.node.tag);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
</script>

{#if tree.length}
  <section class="tags">
    <div class="header">
      <button class="title" aria-expanded={sectionOpen} onclick={() => app.setSetting("tagsExpanded", !sectionOpen)}>
        <span class="section-label">Tags</span>
        <span class="chevron" class:open={sectionOpen}><ChevronRight size={13} strokeWidth={2.25} /></span>
      </button>
      {#if sectionOpen}
        <button class="sort" class:on={sort !== "count"} title="Sort tags" aria-label="Sort tags" aria-haspopup="menu" onclick={openSortMenu}>
          <ArrowUpDown size={13} strokeWidth={2} />
        </button>
      {/if}
    </div>
    {#if sectionOpen}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="list" role="tree" aria-label="Tags" tabindex="0" bind:this={list} onkeydown={onKeydown} onblur={() => (focused = null)}>
        {#each rows as row (row.node.tag)}
          {@const node = row.node}
          {@const isParent = node.children.length > 0}
          {@const open = isParent && expanded.has(key(node))}
          <!-- Keys are handled on the tree (roving focus), as in the file tree. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="row"
            class:focused={focused === key(node)}
            role="treeitem"
            tabindex="-1"
            aria-level={row.depth + 1}
            aria-expanded={isParent ? open : undefined}
            aria-selected={focused === key(node)}
            data-tag={key(node)}
            title="#{node.tag}"
            style:padding-left="{10 + row.depth * 14}px"
            onclick={() => app.showQuickOpen("#" + node.tag)}
            oncontextmenu={(event) => onContextMenu(event, node)}
          >
            {#if isParent}
              <button
                class="twisty"
                class:open
                tabindex="-1"
                aria-label={open ? "Collapse" : "Expand"}
                onclick={(event) => {
                  event.stopPropagation();
                  setExpanded(node, !open);
                }}
              >
                <ChevronRight size={12} strokeWidth={2.25} />
              </button>
            {:else}
              <span class="twisty"></span>
            {/if}
            <Hash size={14} />
            <span class="name">{node.name}</span>
            <span class="count" class:muted={node.count === 0}>{node.count.toLocaleString()}</span>
            {#if isParent}<span class="total" title="{node.total.toLocaleString()} including nested tags">{node.total.toLocaleString()}</span>{/if}
          </div>
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
    height: 26px;
    margin: 0 6px 2px;
    padding: 0 6px 0 0;
    border-radius: 6px;
  }
  .header:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .title {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
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
  .title:focus-visible .chevron,
  .chevron:not(.open) {
    opacity: 1;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-3);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .header:hover .sort,
  .sort:focus-visible,
  .sort.on {
    opacity: 1;
  }
  .sort:hover {
    background: color-mix(in srgb, var(--ui-strong-border) 55%, transparent);
    color: var(--ui-text);
  }
  .sort.on {
    color: var(--ui-accent);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    margin: 0 6px;
    padding-right: 10px;
    border-radius: 6px;
    color: var(--ui-text);
    font-size: 13px;
    text-align: left;
    cursor: default;
    user-select: none;
  }
  .row :global(svg) {
    flex: none;
    color: var(--ui-text-3);
  }
  .row:hover,
  .row.focused {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .list:focus-visible .row.focused {
    box-shadow: inset 0 0 0 1.5px var(--ui-accent);
  }
  .row:hover > :global(svg) {
    color: var(--ui-accent);
  }
  .twisty {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-3);
  }
  button.twisty:hover {
    background: color-mix(in srgb, var(--ui-strong-border) 55%, transparent);
    color: var(--ui-text);
  }
  .twisty :global(svg) {
    transition: transform 0.12s ease-out;
  }
  .twisty.open :global(svg) {
    transform: rotate(90deg);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count,
  .total {
    flex: none;
    font-size: 11px;
    color: var(--ui-text-3);
    font-variant-numeric: tabular-nums;
  }
  .count.muted {
    opacity: 0.55;
  }
  .total {
    opacity: 0.6;
  }
  .total::before {
    content: "· ";
  }
</style>
