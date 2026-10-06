<!-- Quick Open and the command palette (§9.1, UI-24): notes by title, alias,
     folder or #tag, "Create note", and commands (">" lists commands only). -->
<script lang="ts">
  import { untrack, tick } from "svelte";
  import { Check, ChevronsRight, FileText, Plus, Search } from "@lucide/svelte";
  import { fuzzyMatch, type QuickOpenHit } from "@core/quickOpen";
  import { dirname, stem, withoutExtension } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { commandById, commands, type Command } from "../../lib/commands";
  import { call, run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Highlighted from "./Highlighted.svelte";

  type Row =
    | { kind: "note"; key: string; hit: QuickOpenHit }
    | { kind: "create"; key: string; name: string }
    | { kind: "command"; key: string; command: Command; indices: number[] };

  let query = $state(app.quickOpen?.query ?? "");
  let selected = $state(0);
  let hits = $state<QuickOpenHit[]>([]);
  /** The query `hits` were fetched for. */
  let hitsQuery = $state<string | null>(null);
  let list = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();

  // Reopening while open (e.g. a tag clicked in the inspector) replaces the query.
  $effect(() => {
    const request = app.quickOpen;
    if (!request) return;
    untrack(() => {
      if (request.query !== query) {
        query = request.query;
        selected = 0;
      }
      input?.focus();
    });
  });

  const trimmed = $derived(query.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, ""));
  const commandMode = $derived(trimmed.startsWith(">"));
  const tagMode = $derived(trimmed.startsWith("#"));

  let request = 0;
  $effect(() => {
    if (commandMode || !app.vault) return;
    const text = trimmed;
    void app.vault.indexRevision;
    void app.vault.recentNotes;
    const id = ++request;
    call<QuickOpenHit[] | undefined>("quickOpen", text, 30)
      .then((result) => {
        if (id !== request) return;
        hits = result ?? [];
        hitsQuery = text;
      })
      .catch((error: unknown) => console.error("[quickOpen]", error));
  });

  // The palette order (§11.7): the built-in list first, then every other command.
  const preferred = [
    "newNote", "today", "insertTemplate", "showNoteInExplorer", "previousDaily", "nextDaily", "newNoteFromTemplate", "newTab",
    "toggleInspector", "searchVault", "find", "openVault", "showVaultInExplorer", "closeVault",
    "appearance:system", "appearance:dark", "appearance:light", "accent:kyber", "accent:sith", "accent:jedi", "accent:gold",
  ];
  const ordered: Command[] = [
    ...preferred.map((id) => commandById.get(id)).filter((command): command is Command => Boolean(command)),
    ...commands.filter((command) => !preferred.includes(command.id)),
  ].filter((command) => !command.hidden && command.id !== "quickOpen");

  function matchingCommands(text: string, limit: number): Row[] {
    const available = ordered.filter((command) => command.enabled?.() ?? true);
    if (text === "") return available.slice(0, limit).map((command) => ({ kind: "command", key: "command:" + command.id, command, indices: [] }));
    return available
      .map((command) => ({ command, match: fuzzyMatch(text, command.title) }))
      .filter((item) => item.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score)
      .slice(0, limit)
      .map(({ command, match }) => ({ kind: "command", key: "command:" + command.id, command, indices: match!.indices }));
  }

  const loaded = $derived(commandMode || hitsQuery === trimmed);

  const sections = $derived.by((): { notes: Row[]; commands: Row[] } => {
    if (commandMode) return { notes: [], commands: matchingCommands(trimmed.slice(1).trim(), 200) };
    const notes: Row[] = hits.map((hit) => ({ kind: "note", key: "note:" + hit.path, hit }));
    const plain = trimmed !== "" && !tagMode;
    if (plain) {
      const lower = trimmed.toLowerCase();
      const exact = hits.some((hit) => stem(hit.path).toLowerCase() === lower);
      if (!exact) notes.push({ kind: "create", key: "create", name: trimmed });
    }
    return { notes, commands: plain ? matchingCommands(trimmed, 4) : [] };
  });
  const rows = $derived([...sections.notes, ...sections.commands]);

  $effect(() => {
    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
  });

  function close() {
    app.quickOpen = null;
  }

  function onInput() {
    selected = 0;
    if (list) list.scrollTop = 0;
  }

  function move(step: number) {
    if (rows.length === 0) return;
    selected = Math.max(0, Math.min(rows.length - 1, selected + step));
    void tick().then(() => {
      const row = list?.querySelector<HTMLElement>(`[data-row="${selected}"]`);
      if (!row || !list) return;
      const box = list.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      // Show the section label above the first row too.
      if (rect.top < box.top + 6) list.scrollTop -= box.top + 6 - rect.top + (selected === 0 ? 40 : 0);
      else if (rect.bottom > box.bottom - 6) list.scrollTop += rect.bottom - box.bottom + 6;
    });
  }

  function createNote(newTab = false) {
    const name = trimmed;
    if (!name || name.startsWith("#") || name.startsWith(">")) return;
    close();
    run("createNoteNamed", name, newTab);
  }

  async function activate(row: Row | undefined, newTab = false) {
    if (!row) return;
    close();
    if (row.kind === "note") run("open", row.hit.path, newTab);
    else if (row.kind === "create") run("createNoteNamed", row.name, newTab);
    else {
      // Let the palette close (and focus return) before the command runs.
      await tick();
      if (row.command.enabled?.() ?? true) row.command.run();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "PageDown":
        move(8);
        break;
      case "PageUp":
        move(-8);
        break;
      case "Enter":
        if (event.isComposing) return;
        if (event.shiftKey) createNote(event.ctrlKey);
        else void activate(rows[selected], event.ctrlKey);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function folderOf(path: string) {
    return dirname(path);
  }
</script>

{#snippet noteRow(hit: QuickOpenHit, isSelected: boolean)}
  {@const title = stem(hit.path)}
  {@const folder = folderOf(hit.path)}
  <span class="icon"><FileText size={16} /></span>
  <span class="main">
    {#if hit.field.kind === "title"}
      <Highlighted text={title} indices={hit.indices} />
    {:else if hit.field.kind === "path"}
      <Highlighted text={title} indices={hit.indices} offset={folder ? Array.from(folder).length + 1 : 0} />
    {:else}
      {title}<span class="secondary">{" — alias “"}<Highlighted text={hit.field.alias} indices={hit.indices} />”</span>
    {/if}
  </span>
  {#if folder}
    <span class="folder" title={folder}><bdi dir="ltr">
      {#if hit.field.kind === "path" && !isSelected}
        {#each folder.split("/") as part, index (index)}
          {#if index > 0}<span class="sep">{" / "}</span>{/if}<Highlighted
            text={part}
            indices={hit.indices}
            offset={Array.from(folder.split("/").slice(0, index).join("/")).length + (index > 0 ? 1 : 0)}
          />
        {/each}
      {:else}
        {folder.split("/").join(" / ")}
      {/if}
    </bdi></span>
  {/if}
{/snippet}

{#snippet rowView(row: Row, index: number)}
  {@const isSelected = index === selected}
  <div
    class="row"
    class:selected={isSelected}
    role="option"
    tabindex="-1"
    aria-selected={isSelected}
    id="qo-row-{index}"
    data-row={index}
    onpointermove={() => (selected = index)}
    onpointerdown={(event) => event.preventDefault()}
    onclick={(event) => void activate(row, event.ctrlKey)}
    onkeydown={() => {}}
  >
    {#if row.kind === "note"}
      {@render noteRow(row.hit, isSelected)}
    {:else if row.kind === "create"}
      <span class="icon"><Plus size={16} /></span>
      <span class="main create">Create note “{row.name}”</span>
      <span class="hint">Shift+↵</span>
    {:else}
      <span class="icon">
        {#if row.command.checked?.()}<Check size={16} />{:else}<ChevronsRight size={16} />{/if}
      </span>
      <span class="main command"><Highlighted text={row.command.title} indices={row.indices} /></span>
      {#if row.command.shortcut}<span class="hint">{row.command.shortcut}</span>{/if}
    {/if}
  </div>
{/snippet}

<Modal width={600} placement="top" closeOnBackdrop label="Quick Open" panelClass="quick-open" onclose={close}>
  <div class="search">
    <Search size={18} />
    <input
      bind:this={input}
      bind:value={query}
      data-autofocus
      placeholder="Find a note, #tag, or > command"
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      aria-expanded="true"
      aria-controls="qo-list"
      aria-activedescendant={rows.length ? `qo-row-${selected}` : undefined}
      oninput={onInput}
      onkeydown={onKeydown}
    />
    <span class="keycap">esc</span>
  </div>

  <div class="results" id="qo-list" role="listbox" aria-label="Results" bind:this={list}>
    {#if sections.notes.length > 0}
      <div class="section-label label">{trimmed === "" ? "Recent" : "Notes"}</div>
      {#each sections.notes as row, index (row.key)}
        {@render rowView(row, index)}
      {/each}
    {/if}
    {#if sections.commands.length > 0}
      <div class="section-label label">Commands</div>
      {#each sections.commands as row, offset (row.key)}
        {@render rowView(row, sections.notes.length + offset)}
      {/each}
    {/if}
    {#if rows.length === 0 && loaded}
      <div class="empty">{tagMode ? "No notes with that tag" : "No matches"}</div>
    {/if}
  </div>

  <footer>
    <span><span class="key">↑↓</span> navigate</span>
    <span><span class="key">↵</span> open</span>
    <span><span class="key">Ctrl+↵</span> new tab</span>
    <span><span class="key">Shift+↵</span> create</span>
    <span class="spacer"></span>
    <span>#tag · &gt; commands</span>
  </footer>
</Modal>

<style>
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--ui-border);
    color: var(--ui-text-2);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font-size: 17px;
    outline: none;
  }
  .search input::placeholder {
    color: var(--ui-faint);
  }
  .search .keycap {
    color: var(--ui-text-3);
  }
  .results {
    max-height: 420px;
    overflow-y: auto;
    padding: 6px;
    overscroll-behavior: contain;
  }
  .label {
    padding: 8px 10px 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 14px;
    color: var(--ui-text);
    --match-color: var(--ui-accent-text);
  }
  .row:not(.selected):hover {
    background: var(--ui-chip);
  }
  .row.selected {
    background: var(--ui-fill);
    color: #fff;
    --match-color: #fff;
  }
  .icon {
    flex: none;
    display: inline-flex;
    width: 18px;
    justify-content: center;
    color: var(--ui-text-2);
  }
  .main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main.create,
  .main.command {
    color: var(--ui-body);
  }
  .secondary {
    color: var(--ui-text-2);
  }
  .folder {
    flex: 0 1 auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: right;
    font-size: 12px;
    color: var(--ui-text-2);
  }
  .sep {
    color: var(--ui-text-3);
  }
  .hint {
    flex: none;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .row.selected .icon,
  .row.selected .secondary,
  .row.selected .folder,
  .row.selected .hint {
    color: rgba(255, 255, 255, 0.8);
  }
  .row.selected .main {
    color: #fff;
  }
  .empty {
    padding: 24px 0;
    text-align: center;
    color: var(--ui-text-3);
  }
  footer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 9px 16px;
    border-top: 1px solid var(--ui-border);
    font-size: 11px;
    color: var(--ui-text-3);
    white-space: nowrap;
  }
  .key {
    color: var(--ui-text-2);
    font-weight: 600;
    margin-right: 2px;
  }
  .spacer {
    flex: 1;
  }
</style>
