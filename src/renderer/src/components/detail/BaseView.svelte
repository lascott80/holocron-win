<!-- The Base view (UI-46): a `.base` file's views over the notes its filter
     matches — a table with sortable, reorderable columns and cells edited
     in place, or a grid of cards. Mounted like CanvasView for a `.base` tab
     (`base`), or inside a ```base block of a note (`source`), where it's
     read-only: nothing is saved and cells can't be edited. Follows the index
     (300 ms after typing pauses) and reloads when the file changes on disk. -->
<script lang="ts">
  import { Check, LayoutGrid, Plus, Search, Table2 } from "@lucide/svelte";
  import type { BaseRowsResult, BaseTabView } from "@shared/ipc";
  import {
    BUILTIN_COLUMNS, cellText, cellValue, columnKind, columnLabel, DEFAULT_COLUMNS, isBuiltinColumn, isEmptyCell, parseBase, searchRows,
    serializeBase, sortRows, type BaseFile, type BaseRow, type BaseSort, type BaseViewSpec, type ColumnKind,
  } from "@core/base";
  import { lineEnding, parseDateValue, type PropertyValue } from "@core/properties";
  import { app } from "../../lib/app.svelte";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";
  import { call, run } from "../../lib/host";

  let { base = null, source = null }: { base?: BaseTabView | null; source?: string | null } = $props();
  /** A ```base block inside a note: read-only, nothing is saved (§9.5). */
  const inline = $derived(base === null);

  const ROW_LIMIT = 2000;

  // ---------- The file ----------

  let parsed = $state<BaseFile | null>(null);
  let problem = $state<{ message: string; obsidian: boolean } | null>(null);
  let warnings = $state<string[]>([]);
  let eol: "\n" | "\r\n" = "\n";
  /** The text this view wrote last, so the watcher's echo of its own save doesn't reset it. */
  let lastWritten: string | null = null;
  let activeView = $state(0);
  let filterDraft = $state("");

  function adopt(text: string) {
    eol = lineEnding(text);
    const result = parseBase(text);
    if (result.ok) {
      parsed = result.base;
      problem = null;
      warnings = result.warnings.map((warning) => (warning.line ? `Line ${warning.line}: ${warning.message}` : warning.message));
      if (activeView >= result.base.views.length) activeView = 0;
      filterDraft = result.base.filters;
    } else {
      parsed = null;
      problem = { message: result.reason + (result.line ? ` (line ${result.line})` : ""), obsidian: result.obsidian ?? false };
      warnings = [];
    }
  }

  $effect(() => {
    if (base) {
      const { path, revision } = base;
      void revision; // reloads when the watcher reports a change
      let cancelled = false;
      void call<string | null>("readBase", path).then((text) => {
        if (cancelled) return;
        if (text === null) {
          parsed = null;
          problem = { message: "The file couldn’t be read", obsidian: false };
        } else if (text !== lastWritten) {
          adopt(text);
        }
        lastWritten = null;
      });
      return () => {
        cancelled = true;
      };
    }
    adopt(source ?? "");
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Writes the file after an edit to its views (debounced, atomic, keeping its line endings); nothing for a ```base block. */
  function save() {
    if (!parsed || !base) return;
    const text = serializeBase(parsed, eol);
    const path = base.path;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      lastWritten = text;
      run("writeBase", path, text);
    }, 400);
  }

  $effect(() => () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      if (parsed && base) run("writeBase", base.path, serializeBase(parsed, eol));
    }
  });

  // ---------- Rows ----------

  let rows = $state<BaseRow[]>([]);
  let rowsError = $state<string | null>(null);
  let loaded = $state(false);
  let search = $state("");

  const view = $derived<BaseViewSpec | null>(parsed?.views[activeView] ?? null);
  const columns = $derived(view?.columns ?? []);
  /** The costly fields the active view needs main to gather. */
  const needs = $derived.by(() => {
    const wanted: string[] = [];
    const used = new Set([...columns, ...(view?.sort.map((sort) => sort.column) ?? [])]);
    if (used.has("file.mtime") || used.has("file.ctime")) wanted.push("times");
    if (used.has("file.backlinks")) wanted.push("backlinks");
    if (view?.type === "cards") wanted.push("preview");
    return wanted;
  });

  let fetchTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchSerial = 0;
  $effect(() => {
    const filters = parsed?.filters ?? null;
    const needed = needs.join(",");
    const revision = app.vault?.indexRevision;
    void revision; // new matching notes appear ~300 ms after typing pauses (IDX-05)
    if (filters === null) return;
    const serial = ++fetchSerial;
    const fetch = () => {
      fetchTimer = null;
      void call<BaseRowsResult>("baseRows", filters, needed ? needed.split(",") : []).then((result) => {
        if (serial !== fetchSerial) return;
        rows = result.rows;
        rowsError = result.error;
        loaded = true;
      });
    };
    if (fetchTimer) clearTimeout(fetchTimer);
    if (!loaded) fetch();
    else fetchTimer = setTimeout(fetch, 300);
    return () => {
      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = null;
    };
  });

  /** The vault's inferred type for a property key (IDX-07). */
  const summaryKinds = $derived(new Map((app.vault?.properties ?? []).map((property) => [property.key.toLowerCase(), property.type as ColumnKind])));
  const kinds = $derived.by(() => {
    const map = new Map<string, ColumnKind>();
    for (const column of [...columns, ...(view?.sort.map((sort) => sort.column) ?? [])]) {
      map.set(column, columnKind(column, rows, (key) => summaryKinds.get(key.toLowerCase())));
    }
    return map;
  });
  const kindOf = (column: string): ColumnKind => kinds.get(column) ?? columnKind(column, rows, (key) => summaryKinds.get(key.toLowerCase()));

  const shown = $derived.by(() => {
    if (!view) return [];
    const matching = searchRows(rows, columns, search, kindOf);
    const sorted = sortRows(matching, view.sort, kindOf);
    return view.limit ? sorted.slice(0, view.limit) : sorted;
  });

  $effect(() => {
    if (inline) return;
    app.baseStats = { rows: shown.length };
    return () => {
      app.baseStats = null;
    };
  });

  // ---------- Views ----------

  let renamingView = $state<number | null>(null);

  function addView(type: "table" | "cards" = "table") {
    if (!parsed) return;
    const names = new Set(parsed.views.map((candidate) => candidate.name));
    let name = type === "cards" ? "Cards" : "Table";
    for (let n = 2; names.has(name); n++) name = `${type === "cards" ? "Cards" : "Table"} ${n}`;
    parsed.views.push({ type, name, columns: type === "cards" ? ["file.name", "file.tags"] : [...DEFAULT_COLUMNS], sort: [] });
    activeView = parsed.views.length - 1;
    save();
  }

  function viewMenu(event: MouseEvent, index: number) {
    if (!parsed || inline) return;
    const current = parsed.views[index]!;
    const entries: MenuEntry[] = [
      { label: "Rename", run: () => (renamingView = index) },
      { label: "Show as Table", checked: current.type === "table", run: () => ((current.type = "table"), save()) },
      { label: "Show as Cards", checked: current.type === "cards", run: () => ((current.type = "cards"), save()) },
      "-",
      { label: "Duplicate View", run: () => {
        parsed!.views.splice(index + 1, 0, { ...current, name: `${current.name} copy`, columns: [...current.columns], sort: current.sort.map((sort) => ({ ...sort })) });
        activeView = index + 1;
        save();
      } },
      { label: "Delete View", destructive: true, disabled: parsed.views.length <= 1, run: () => {
        parsed!.views.splice(index, 1);
        activeView = Math.min(activeView, parsed!.views.length - 1);
        save();
      } },
    ];
    menu.openAt(event, entries);
  }

  function commitRename(index: number, value: string) {
    renamingView = null;
    if (!parsed) return;
    const name = value.trim();
    if (name && name !== parsed.views[index]!.name) {
      parsed.views[index]!.name = name;
      save();
    }
  }

  function applyFilter() {
    if (!parsed || inline) return;
    const next = filterDraft.trim();
    if (next === parsed.filters) return;
    parsed.filters = next;
    loaded = false;
    save();
  }

  // ---------- Columns ----------

  function sortFor(column: string): BaseSort | undefined {
    return view?.sort.find((sort) => sort.column === column);
  }

  /** Header click: ascending → descending → unsorted (one sort at a time). */
  function cycleSort(column: string) {
    if (!view || inline) return;
    const current = sortFor(column);
    view.sort = !current ? [{ column, direction: "asc" }] : current.direction === "asc" ? [{ column, direction: "desc" }] : [];
    save();
  }

  function setSort(column: string, direction: "asc" | "desc") {
    if (!view) return;
    view.sort = [{ column, direction }];
    save();
  }

  /** Columns that could be added: the built-ins and every property key the vault uses (IDX-07), minus those shown. */
  const addable = $derived.by(() => {
    const shownSet = new Set(columns);
    const builtins = BUILTIN_COLUMNS.map((column) => column.id).filter((id) => !shownSet.has(id));
    const keys = (app.vault?.properties ?? []).map((property) => property.key).filter((key) => !shownSet.has(key) && !shownSet.has(key.toLowerCase()));
    return { builtins, keys };
  });

  function addColumn(column: string, after: number | null = null) {
    if (!view) return;
    if (view.columns.includes(column)) return;
    if (after === null) view.columns.push(column);
    else view.columns.splice(after + 1, 0, column);
    save();
  }

  function addColumnEntries(after: number | null): MenuEntry[] {
    const entries: MenuEntry[] = addable.builtins.map((id) => ({ label: columnLabel(id), run: () => addColumn(id, after) }));
    if (addable.keys.length) {
      if (entries.length) entries.push("-");
      for (const key of addable.keys) entries.push({ label: key, run: () => addColumn(key, after) });
    }
    return entries.length ? entries : [{ label: "Every column is shown", disabled: true }];
  }

  function headerMenu(event: MouseEvent, index: number) {
    if (!view || inline) return;
    const column = view.columns[index]!;
    const current = sortFor(column);
    menu.openAt(event, [
      { label: "Sort Ascending", checked: current?.direction === "asc", run: () => setSort(column, "asc") },
      { label: "Sort Descending", checked: current?.direction === "desc", run: () => setSort(column, "desc") },
      { label: "Clear Sort", disabled: !current, run: () => ((view!.sort = []), save()) },
      "-",
      { label: "Add Column…", items: addColumnEntries(index) },
      { label: "Hide Column", disabled: view.columns.length <= 1, run: () => {
        view!.columns.splice(index, 1);
        view!.sort = view!.sort.filter((sort) => sort.column !== column);
        save();
      } },
    ]);
  }

  let dragColumn = $state<number | null>(null);
  let dropAt = $state<number | null>(null);

  function onHeaderDragStart(event: DragEvent, index: number) {
    if (inline) return event.preventDefault();
    dragColumn = index;
    event.dataTransfer?.setData("text/plain", columns[index] ?? "");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onHeaderDragOver(event: DragEvent, index: number) {
    if (dragColumn === null) return;
    event.preventDefault();
    dropAt = index;
  }

  function onHeaderDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (!view || dragColumn === null || dragColumn === index) return (dragColumn = dropAt = null);
    const [moved] = view.columns.splice(dragColumn, 1);
    view.columns.splice(index, 0, moved!);
    dragColumn = dropAt = null;
    save();
  }

  // ---------- Cells ----------

  const dateFormat: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
  const timeFormat: Intl.DateTimeFormatOptions = { ...dateFormat, hour: "numeric", minute: "2-digit" };

  /** How a cell reads: dates and times in the user's locale, numbers as written, text as is. */
  function displayText(value: PropertyValue | number, kind: ColumnKind): string {
    if (isEmptyCell(value)) return "";
    if (typeof value === "number") return kind === "datetime" || kind === "date" ? new Date(value).toLocaleString(undefined, timeFormat) : String(value);
    if (kind === "date" || kind === "datetime") {
      const when = typeof value === "string" ? parseDateValue(value) : null;
      if (when) return when.toLocaleString(undefined, kind === "datetime" || /[ T]\d{2}:\d{2}$/.test(String(value)) ? timeFormat : dateFormat);
    }
    return cellText(value, kind);
  }

  const asList = (value: PropertyValue | number): string[] => (Array.isArray(value) ? value : isEmptyCell(value) ? [] : [String(value)]);

  function openNote(event: MouseEvent, path: string) {
    event.preventDefault();
    run("open", path, event.ctrlKey || event.metaKey || event.button === 1);
  }

  let editing = $state<{ path: string; column: string } | null>(null);
  let editValue = $state("");

  function canEdit(column: string): boolean {
    return !inline && !isBuiltinColumn(column);
  }

  function startEditing(row: BaseRow, column: string) {
    if (!canEdit(column)) return;
    const kind = kindOf(column);
    const value = cellValue(row, column);
    if (kind === "checkbox") return commit(row, column, !(value === true));
    editing = { path: row.path, column };
    const text = isEmptyCell(value) ? "" : Array.isArray(value) ? value.join(", ") : String(value);
    editValue = kind === "datetime" ? text.replace(" ", "T") : text;
  }

  /** Writes one property through main (`setProperty`): the note's document when open, else an atomic rewrite. */
  function commit(row: BaseRow, column: string, value: PropertyValue) {
    const existing = Object.keys(row.properties).find((key) => key.toLowerCase() === column.toLowerCase()) ?? column;
    run("setProperty", row.path, existing, value);
    // Show the change at once; the index's answer replaces it ~300 ms later.
    row.properties[existing] = value;
  }

  function finishEditing(save: boolean) {
    const current = editing;
    editing = null;
    if (!save || !current) return;
    const row = rows.find((candidate) => candidate.path === current.path);
    if (!row) return;
    const kind = kindOf(current.column);
    const before = cellValue(row, current.column);
    const text = editValue.trim();
    let next: PropertyValue;
    if (kind === "list") next = text.split(",").map((item) => item.trim()).filter(Boolean);
    else if (kind === "datetime") next = text.replace("T", String(before ?? "").includes(" ") ? " " : "T");
    else next = text;
    if (JSON.stringify(next) !== JSON.stringify(isEmptyCell(before) ? (kind === "list" ? [] : "") : before)) commit(row, current.column, next);
  }

  function onEditKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEditing(false);
    }
  }

  function focusInput(node: HTMLInputElement) {
    node.focus();
    if (node.type === "text" || node.type === "number") node.select();
  }

  function inputType(kind: ColumnKind): string {
    return kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : kind === "number" ? "number" : "text";
  }

  function newNote() {
    if (!base || !parsed) return;
    run("createNoteForBase", base.path, parsed.filters);
  }

  const countLabel = $derived(`${shown.length.toLocaleString()} ${shown.length === 1 ? "note" : "notes"}${rows.length > shown.length ? ` of ${rows.length.toLocaleString()}` : ""}`);
</script>

<div class="base-view" class:inline>
  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="Views">
      {#each parsed?.views ?? [] as spec, index (index)}
        {#if renamingView === index}
          <input
            class="rename"
            value={spec.name}
            aria-label="View name"
            use:focusInput
            onkeydown={(e) => {
              if (e.key === "Enter") commitRename(index, e.currentTarget.value);
              else if (e.key === "Escape") renamingView = null;
            }}
            onblur={(e) => commitRename(index, e.currentTarget.value)}
          />
        {:else}
          <button
            class="tab"
            class:active={index === activeView}
            role="tab"
            aria-selected={index === activeView}
            title={inline ? spec.name : `${spec.name} — right-click to rename or delete`}
            onclick={() => (activeView = index)}
            ondblclick={() => !inline && (renamingView = index)}
            oncontextmenu={(e) => viewMenu(e, index)}
          >
            {#if spec.type === "cards"}<LayoutGrid size={13} />{:else}<Table2 size={13} />{/if}
            {spec.name}
          </button>
        {/if}
      {/each}
      {#if !inline && parsed}
        <button class="icon-button" title="Add a view" aria-label="Add a view" onclick={(e) => menu.openBelow(e.currentTarget, [{ label: "Table", run: () => addView("table") }, { label: "Cards", run: () => addView("cards") }])}>
          <Plus size={14} />
        </button>
      {/if}
    </div>
    <div class="spacer"></div>
    {#if inline}
      <span class="readonly" title="Views inside a note can’t be changed here; open a .base file to edit them">Read-only</span>
      <button class="button" disabled title="This base lives inside a note, not in a file">Open as base</button>
    {:else}
      <button class="button" onclick={newNote} disabled={!parsed} title="A new note beside this base, with the properties and tags the filter asks for">New note</button>
    {/if}
  </div>

  {#if parsed}
    <div class="filter-row">
      <label class="filter">
        <span class="label">Filter</span>
        <input
          class="filter-input"
          class:invalid={rowsError !== null}
          bind:value={filterDraft}
          placeholder="A search query, e.g. [status:active] tag:project — empty shows every note"
          readonly={inline}
          spellcheck="false"
          onkeydown={(e) => e.key === "Enter" && applyFilter()}
          onblur={applyFilter}
        />
      </label>
      <label class="search">
        <Search size={13} />
        <input class="search-input" bind:value={search} placeholder="Search in view" aria-label="Search within the view" spellcheck="false" />
      </label>
      <span class="count" title="Notes shown">{countLabel}</span>
    </div>
    {#if rowsError}
      <div class="message error">{rowsError}</div>
    {/if}
    {#if warnings.length}
      <div class="message">{warnings.join(" · ")}</div>
    {/if}
  {/if}

  {#if problem}
    <div class="empty">
      <p class="title">{problem.obsidian ? "Not a Holocron base" : "Couldn’t read this base"}</p>
      <p>{problem.message}{problem.obsidian ? "." : ""}</p>
      {#if problem.obsidian}
        <p class="hint">Holocron bases use its search syntax as the filter: <code>filters: "[status:active] tag:project"</code>.</p>
      {/if}
    </div>
  {:else if view && view.type === "table"}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            {#each columns as column, index (column)}
              {@const sort = sortFor(column)}
              {@const kind = kindOf(column)}
              <th
                class:numeric={kind === "number"}
                class:drop-before={dropAt === index && dragColumn !== null && dragColumn > index}
                class:drop-after={dropAt === index && dragColumn !== null && dragColumn < index}
                draggable={!inline}
                aria-sort={sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                ondragstart={(e) => onHeaderDragStart(e, index)}
                ondragover={(e) => onHeaderDragOver(e, index)}
                ondragleave={() => dropAt === index && (dropAt = null)}
                ondrop={(e) => onHeaderDrop(e, index)}
                ondragend={() => (dragColumn = dropAt = null)}
                oncontextmenu={(e) => headerMenu(e, index)}
              >
                <button class="header" onclick={() => cycleSort(column)} title={inline ? columnLabel(column) : `Sort by ${columnLabel(column)} — right-click for more`}>
                  <span class="header-label">{columnLabel(column)}</span>
                  {#if sort}<span class="sort-mark">{sort.direction === "asc" ? "▲" : "▼"}</span>{/if}
                </button>
              </th>
            {/each}
            {#if !inline}
              <th class="add">
                <button class="icon-button" title="Add a column" aria-label="Add a column" onclick={(e) => menu.openBelow(e.currentTarget, addColumnEntries(null))}><Plus size={13} /></button>
              </th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each shown as row (row.path)}
            <tr>
              {#each columns as column (column)}
                {@const kind = kindOf(column)}
                {@const value = cellValue(row, column)}
                {@const isEditing = editing?.path === row.path && editing.column === column}
                <td class:numeric={kind === "number"} class:nowrap={kind === "number" || kind === "date" || kind === "datetime"} class:editable={canEdit(column)} class:editing={isEditing} ondblclick={() => startEditing(row, column)} onclick={(e) => {
                  if (kind !== "checkbox" && canEdit(column) && !(e.target as Element).closest("a, input")) startEditing(row, column);
                }}>
                  {#if isEditing}
                    <input class="cell-input" type={inputType(kind)} step={kind === "number" ? "any" : undefined} bind:value={editValue} use:focusInput onkeydown={onEditKey} onblur={() => finishEditing(true)} aria-label={columnLabel(column)} />
                  {:else if column === "file.name"}
                    <a class="link" href="#{row.path}" title={row.path} onclick={(e) => openNote(e, row.path)} onauxclick={(e) => e.button === 1 && openNote(e, row.path)}>{row.title}</a>
                  {:else if kind === "checkbox"}
                    <button class="checkbox" class:checked={value === true} role="checkbox" aria-checked={value === true} aria-label={columnLabel(column)} disabled={!canEdit(column)} onclick={(e) => {
                      e.stopPropagation();
                      commit(row, column, !(value === true));
                    }}>{#if value === true}<Check size={12} strokeWidth={3} />{/if}</button>
                  {:else if kind === "list" || column === "file.tags"}
                    <span class="pills">
                      {#each asList(value) as item (item)}
                        <span class="pill" class:tag={column === "file.tags" || column.toLowerCase() === "tags"}>{column === "file.tags" || column.toLowerCase() === "tags" ? `#${item.replace(/^#/, "")}` : item}</span>
                      {/each}
                    </span>
                  {:else if typeof value === "string" && /^https?:\/\//i.test(value)}
                    <a class="link" href={value} title={value} onclick={(e) => {
                      e.preventDefault();
                      run("openImage", value);
                    }}>{value}</a>
                  {:else if typeof value === "string" && /^\[\[[^\]]+\]\]$/.test(value)}
                    <a class="link" href="#{value}" onclick={(e) => {
                      e.preventDefault();
                      run("openLink", value.slice(2, -2).split("|")[0], e.ctrlKey);
                    }}>{value.slice(2, -2).split("|").pop()}</a>
                  {:else}
                    <span class="text" title={column === "file.path" ? row.path : undefined}>{displayText(value, kind)}</span>
                  {/if}
                </td>
              {/each}
              {#if !inline}<td class="add"></td>{/if}
            </tr>
          {:else}
            <tr><td class="none" colspan={columns.length + (inline ? 0 : 1)}>{loaded ? (search ? "No notes match the search." : "No notes match the filter.") : "Loading…"}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if view}
    <div class="cards">
      {#each shown as row (row.path)}
        <article class="card">
          <a class="card-title link" href="#{row.path}" title={row.path} onclick={(e) => openNote(e, row.path)} onauxclick={(e) => e.button === 1 && openNote(e, row.path)}>{row.title}</a>
          {#if row.preview}<p class="card-preview">{row.preview}</p>{/if}
          {#if columns.some((column) => column !== "file.name")}
            <dl class="card-props">
              {#each columns.filter((column) => column !== "file.name") as column (column)}
                {@const kind = kindOf(column)}
                {@const value = cellValue(row, column)}
                <dt>{columnLabel(column)}</dt>
                <dd class:numeric={kind === "number"}>
                  {#if kind === "checkbox"}
                    <span class="checkbox static" class:checked={value === true}>{#if value === true}<Check size={12} strokeWidth={3} />{/if}</span>
                  {:else if kind === "list" || column === "file.tags"}
                    <span class="pills">{#each asList(value) as item (item)}<span class="pill" class:tag={column === "file.tags" || column.toLowerCase() === "tags"}>{column === "file.tags" || column.toLowerCase() === "tags" ? `#${item.replace(/^#/, "")}` : item}</span>{/each}</span>
                  {:else}
                    {displayText(value, kind) || "—"}
                  {/if}
                </dd>
              {/each}
            </dl>
          {/if}
        </article>
      {:else}
        <div class="none">{loaded ? (search ? "No notes match the search." : "No notes match the filter.") : "Loading…"}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .base-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--ui-editor);
    color: var(--ui-text);
    font-size: 13px;
  }
  .base-view.inline {
    min-height: 120px;
    font-size: 12.5px;
  }
  .toolbar,
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 6px 16px 6px 24px;
    border-bottom: 1px solid var(--ui-border);
    min-height: 36px;
  }
  .inline .toolbar,
  .inline .filter-row {
    padding-left: 12px;
    padding-right: 12px;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover {
    background: var(--ui-chip);
  }
  .tab.active {
    background: var(--ui-chip);
    color: var(--ui-text);
    font-weight: 600;
  }
  .rename,
  .filter-input,
  .search-input,
  .cell-input {
    font: inherit;
    color: var(--ui-text);
    background: var(--ui-raised);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    padding: 3px 8px;
    min-width: 0;
  }
  .rename {
    width: 140px;
  }
  .filter-input:focus,
  .search-input:focus,
  .cell-input:focus,
  .rename:focus {
    outline: 2px solid rgba(var(--ui-accent-rgb), 0.5);
    outline-offset: -1px;
  }
  .filter-input.invalid {
    border-color: var(--ui-danger);
  }
  .spacer {
    flex: 1;
  }
  .button,
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font: inherit;
    color: var(--ui-text-2);
    background: var(--ui-chip);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .icon-button {
    padding: 3px 5px;
    background: transparent;
    border-color: transparent;
  }
  .button:hover,
  .icon-button:hover {
    color: var(--ui-text);
    background: var(--ui-fill);
  }
  .button:disabled,
  .icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .readonly {
    color: var(--ui-text-3);
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
  }
  .filter {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .filter .label {
    color: var(--ui-text-3);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .filter-input {
    flex: 1;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ui-text-3);
  }
  .search-input {
    width: 150px;
  }
  .count {
    color: var(--ui-text-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .message {
    flex: none;
    padding: 4px 24px;
    color: var(--ui-text-3);
    font-size: 12px;
    border-bottom: 1px solid var(--ui-border);
  }
  .message.error {
    color: var(--ui-danger);
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--ui-text-2);
    padding: 24px;
    gap: 6px;
  }
  .empty .title {
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .empty .hint {
    color: var(--ui-text-3);
    font-size: 12px;
  }
  .empty code {
    font-family: ui-monospace, Consolas, monospace;
    background: var(--ui-chip);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .empty p {
    margin: 0;
  }

  /* Table */
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .table {
    border-collapse: separate;
    border-spacing: 0;
    min-width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0;
    border-bottom: 1px solid var(--ui-border);
    border-right: 1px solid var(--ui-border);
    vertical-align: top;
    max-width: 360px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--ui-raised);
    color: var(--ui-text-2);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
    user-select: none;
  }
  th.drop-before {
    box-shadow: inset 2px 0 0 var(--ui-accent);
  }
  th.drop-after {
    box-shadow: inset -2px 0 0 var(--ui-accent);
  }
  th .header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  th .header:hover {
    color: var(--ui-text);
  }
  .sort-mark {
    font-size: 9px;
    color: var(--ui-accent);
  }
  th.add,
  td.add {
    width: 32px;
    border-right: 0;
  }
  td {
    padding: 5px 12px;
    line-height: 1.5;
  }
  td:first-child,
  th:first-child {
    padding-left: 24px;
  }
  .inline td:first-child,
  .inline th:first-child {
    padding-left: 12px;
  }
  td.numeric,
  dd.numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td.editable {
    cursor: text;
  }
  td.editable:hover {
    background: rgba(var(--ui-accent-rgb), 0.06);
  }
  td.editing {
    padding: 2px 6px;
  }
  .cell-input {
    width: 100%;
    padding: 2px 6px;
  }
  td.none,
  .cards .none {
    color: var(--ui-text-3);
    padding: 24px;
    text-align: center;
  }
  .text {
    overflow-wrap: break-word;
  }
  td.nowrap {
    white-space: nowrap;
  }
  .link {
    color: var(--ui-accent);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .link:hover {
    text-decoration: underline;
  }
  .pills {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pill {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--ui-chip);
    border: 1px solid var(--ui-border);
    font-size: 12px;
    white-space: nowrap;
  }
  .pill.tag {
    color: var(--ui-accent);
    background: rgba(var(--ui-accent-rgb), 0.12);
    border-color: transparent;
  }
  .checkbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1.5px solid var(--ui-strong-border);
    border-radius: 4px;
    background: var(--ui-raised);
    color: var(--ui-accent-text);
    cursor: pointer;
    vertical-align: middle;
  }
  .checkbox.checked {
    background: var(--ui-accent);
    border-color: var(--ui-accent);
  }
  .checkbox:disabled,
  .checkbox.static {
    cursor: default;
  }

  /* Cards */
  .cards {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    padding: 16px 24px;
    align-content: start;
  }
  .inline .cards {
    padding: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-raised);
    min-width: 0;
  }
  .card-title {
    font-weight: 600;
    font-size: 14px;
  }
  .card-preview {
    margin: 0;
    color: var(--ui-text-2);
    font-size: 12.5px;
    line-height: 1.45;
    white-space: pre-line;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-props {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    padding-top: 6px;
    border-top: 1px solid var(--ui-border);
    font-size: 12px;
  }
  .card-props dt {
    color: var(--ui-text-3);
    white-space: nowrap;
  }
  .card-props dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
