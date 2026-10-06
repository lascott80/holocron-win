<!-- The sidebar's Search mode (§9.2, UI-20…UI-23): full-text search across the
     vault, results grouped per note with highlighted snippets. -->
<script lang="ts">
  import { ChevronRight, CircleX, Search } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { MAX_LINES_PER_NOTE, snippet, type LineMatch, type SearchHit, type SearchOutcome } from "@core/vaultSearch";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import { searchState as s } from "./searchState.svelte";

  const help: [string, string][] = [
    ["kyber crystal", "notes with both words"],
    ['"red shift"', "an exact phrase"],
    ["-ilum", "leave out a word"],
    ["tag:lore", "notes with a tag"],
    ["path:Daily", "notes in a folder"],
    ["file:log", "notes by name"],
  ];

  let field = $state<HTMLInputElement>();
  let focused = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  let last: { text: string; matchCase: boolean; useRegex: boolean; revision: number; root: string } | null = null;

  const isEmpty = $derived(app.searchText.trim() === "");
  const revision = $derived(app.vault?.indexRevision ?? 0);
  const root = $derived(app.vault?.root ?? "");
  const outcome = $derived(s.outcome);

  const summary = $derived.by(() => {
    if (outcome.error) return outcome.error;
    if (isEmpty) return null;
    if (s.isSearching && outcome.hits.length === 0) return "Searching…";
    if (outcome.hits.length === 0) return "No results";
    const count = outcome.hits.length;
    const notes = count === 1 ? "1 note" : `${count.toLocaleString()}${outcome.truncated ? "+" : ""} notes`;
    const matches = outcome.totalMatches === 1 ? "1 match" : `${outcome.totalMatches.toLocaleString()} matches`;
    return `${matches} in ${notes}`;
  });

  // Typing waits 150 ms, toggles apply at once, note changes re-run after 250 ms (SRCH-04).
  $effect(() => {
    const next = { text: app.searchText, matchCase: s.matchCase, useRegex: s.useRegex, revision, root };
    untrack(() => {
      let delay = 0;
      if (last && last.root === next.root) {
        if (next.text !== last.text) delay = 150;
        else if (next.matchCase !== last.matchCase || next.useRegex !== last.useRegex) delay = 0;
        else if (next.revision !== last.revision) delay = 250;
      }
      last = next;
      schedule(delay);
    });
  });

  $effect(() => () => clearTimeout(timer));

  // Focused when shown and on every Ctrl+Shift+F (UI-20).
  $effect(() => {
    void app.searchFocusRequest;
    untrack(() => {
      field?.focus();
      field?.select();
    });
  });

  function schedule(delay: number) {
    clearTimeout(timer);
    const query = app.searchText;
    if (query.trim() === "") {
      request++;
      s.isSearching = false;
      s.outcome = { hits: [], totalMatches: 0, truncated: false };
      return;
    }
    s.isSearching = true;
    timer = setTimeout(() => void runSearch(query), delay);
  }

  async function runSearch(query: string) {
    const id = ++request;
    try {
      const result = await call<SearchOutcome | undefined>("search", query, s.matchCase, s.useRegex);
      if (id !== request) return;
      s.outcome = result ?? { hits: [], totalMatches: 0, truncated: false };
    } catch (error) {
      if (id !== request) return;
      s.outcome = { hits: [], totalMatches: 0, truncated: false, error: error instanceof Error ? error.message : String(error) };
    }
    s.isSearching = false;
  }

  function reveal(hit: SearchHit, line: LineMatch | undefined) {
    if (!line) {
      run("open", hit.path, false);
      return;
    }
    const range = line.ranges[0];
    const from = range?.location ?? 0;
    run("reveal", hit.path, line.line, from, from + (range?.length ?? 0));
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = outcome.hits[0];
      if (hit) reveal(hit, hit.lines[0]);
    } else if (event.key === "Escape" && app.searchText) {
      event.preventDefault();
      app.searchText = "";
    }
  }

  function clear() {
    app.searchText = "";
    field?.focus();
  }

  function toggle(hit: SearchHit) {
    if (s.collapsed.has(hit.path)) s.collapsed.delete(hit.path);
    else s.collapsed.add(hit.path);
  }

  function toggleAll() {
    if (s.collapsed.size === 0) for (const hit of outcome.hits) s.collapsed.add(hit.path);
    else s.collapsed.clear();
  }

  function segments(line: LineMatch) {
    const { text, ranges } = snippet(line.text, line.ranges);
    const parts: { text: string; match: boolean }[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.location > cursor) parts.push({ text: text.slice(cursor, range.location), match: false });
      parts.push({ text: text.slice(range.location, range.location + range.length), match: true });
      cursor = range.location + range.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
    return parts;
  }
</script>

<div class="search-panel">
  <div class="field" class:focused>
    <Search size={14} />
    <input
      bind:this={field}
      bind:value={app.searchText}
      type="text"
      placeholder="Search vault"
      aria-label="Search vault"
      spellcheck="false"
      onkeydown={onKeydown}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
    />
    {#if app.searchText}
      <button class="clear" title="Clear search" aria-label="Clear search" onclick={clear}>
        <CircleX size={14} />
      </button>
    {/if}
    <button class="option" class:on={s.matchCase} title="Match case" aria-label="Match case" aria-pressed={s.matchCase} onclick={() => (s.matchCase = !s.matchCase)}>Aa</button>
    <button class="option" class:on={s.useRegex} title="Regular expression" aria-label="Regular expression" aria-pressed={s.useRegex} onclick={() => (s.useRegex = !s.useRegex)}>.*</button>
  </div>

  {#if summary}
    <div class="summary">
      <span class:error={Boolean(outcome.error)}>{summary}</span>
      {#if outcome.hits.length && !isEmpty}
        <button class="link" onclick={toggleAll}>{s.collapsed.size === 0 ? "Collapse All" : "Expand All"}</button>
      {/if}
    </div>
  {/if}

  {#if isEmpty}
    <dl class="help">
      {#each help as [example, meaning] (example)}
        <dt>{example}</dt>
        <dd>{meaning}</dd>
      {/each}
    </dl>
  {:else}
    <div class="results" class:stale={s.isSearching}>
      {#each outcome.hits as hit (hit.path)}
        {@const open = !s.collapsed.has(hit.path)}
        <div class="hit">
          <div class="hit-header">
            <button class="disclosure" class:open aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onclick={() => toggle(hit)}>
              <ChevronRight size={13} strokeWidth={2.25} />
            </button>
            <button class="hit-title" title={hit.path} onclick={() => reveal(hit, hit.lines[0])}>
              <span class="title">{hit.title}</span>
              {#if hit.matchCount > 0}<span class="count-chip">{hit.matchCount.toLocaleString()}</span>{/if}
            </button>
          </div>
          {#if open}
            {#each hit.lines as line (line.line)}
              <button class="line" title="Line {line.line}" onclick={() => reveal(hit, line)}>
                <span class="snippet">{#each segments(line) as part, i (i)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
              </button>
            {/each}
            {#if hit.lines.length < hit.matchCount && hit.lines.length >= MAX_LINES_PER_NOTE}
              <div class="more">More matches in this note</div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 0 10px 6px;
    padding: 0 4px 0 9px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: var(--ui-chip);
    color: var(--ui-text-3);
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .field.focused {
    border-color: rgba(var(--ui-accent-rgb), 0.6);
    box-shadow: 0 0 0 3px rgba(var(--ui-accent-rgb), 0.14);
  }
  .field :global(svg) {
    flex: none;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    outline: none;
  }
  input::placeholder {
    color: var(--ui-text-3);
  }
  .clear {
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-3);
  }
  .clear:hover {
    color: var(--ui-text);
  }
  .option {
    flex: none;
    width: 24px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-2);
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
  }
  .option:hover:not(.on) {
    background: color-mix(in srgb, var(--ui-strong-border) 55%, transparent);
    color: var(--ui-text);
  }
  .option.on {
    background: var(--ui-fill);
    color: #fff;
  }
  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 20px;
    padding: 0 14px 4px;
    font-size: 11px;
    color: var(--ui-text-3);
  }
  .summary .error {
    color: var(--ui-warning);
  }
  .link {
    flex: none;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-accent-text);
    font-size: 11px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .help {
    display: grid;
    grid-template-columns: 104px 1fr;
    gap: 6px 8px;
    margin: 0;
    padding: 8px 16px 0;
    font-size: 11px;
  }
  .help dt {
    color: var(--ui-accent-text);
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    white-space: nowrap;
  }
  .help dd {
    margin: 0;
    color: var(--ui-text-3);
  }
  .results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0 8px;
    transition: opacity 0.15s;
  }
  .results.stale {
    opacity: 0.75;
  }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 2px;
  }
  .hit-header {
    display: flex;
    align-items: center;
    height: 26px;
    margin: 0 6px;
    border-radius: 6px;
  }
  .hit-header:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .disclosure {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 26px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text-3);
  }
  .disclosure :global(svg) {
    transition: transform 0.12s ease-out;
  }
  .disclosure.open :global(svg) {
    transform: rotate(90deg);
  }
  .hit-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 8px 0 0;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text);
    font-size: 13px;
    font-weight: 500;
  }
  .count-chip {
    flex: none;
  }
  .line {
    display: block;
    margin: 0 6px;
    padding: 3px 8px 3px 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12px;
    line-height: 1.45;
    text-align: left;
    width: calc(100% - 12px);
  }
  .line:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
    color: var(--ui-text);
  }
  .snippet {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  mark {
    padding: 0 1px;
    border-radius: 3px;
    background: rgba(var(--ui-accent-rgb), 0.28);
    color: var(--ui-text);
    font-weight: 600;
  }
  .more {
    padding: 2px 14px 4px 34px;
    font-size: 11px;
    color: var(--ui-text-3);
  }
</style>
