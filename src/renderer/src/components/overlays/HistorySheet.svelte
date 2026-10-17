<!-- File › Version History… (HIS-02…HIS-03): the open note's saved versions on
     the left, and how the chosen one differs from the note now on the right,
     in the conflict sheet's two-column style. Restore puts it back (with Undo). -->
<script lang="ts">
  import { RotateCcw } from "@lucide/svelte";
  import { diff, lines } from "@core/merge";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  interface Version {
    id: string;
    date: number;
    size: number;
  }

  interface Block {
    context: string[];
    version: string[];
    current: string[];
  }

  const path = $derived(app.doc?.path ?? null);
  const title = $derived(app.doc?.title ?? "");

  let versions = $state<Version[]>([]);
  let loaded = $state(false);
  let selected = $state<string | null>(null);
  let versionText = $state<string | null>(null);
  let request = 0;

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  function ago(date: number): string {
    const seconds = Math.round((date - Date.now()) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    if (Math.abs(minutes) < 1) return "just now";
    if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
    if (Math.abs(hours) < 24) return relative.format(hours, "hour");
    return relative.format(days, "day");
  }

  function sizeText(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }

  /** Versions grouped by day, newest first. */
  const groups = $derived.by(() => {
    const out: { day: string; items: Version[] }[] = [];
    for (const version of versions) {
      const day = dayFormat.format(version.date);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(version);
      else out.push({ day, items: [version] });
    }
    return out;
  });

  $effect(() => {
    const current = path;
    void app.vault?.indexRevision;
    if (!current) return;
    const id = ++request;
    call<Version[] | undefined>("noteHistory", current)
      .then((result) => {
        if (id !== request) return;
        versions = result ?? [];
        loaded = true;
        if (selected === null || !versions.some((version) => version.id === selected)) selected = versions[0]?.id ?? null;
      })
      .catch((error: unknown) => console.error("[noteHistory]", error));
  });

  $effect(() => {
    const current = path;
    const id = selected;
    if (!current || !id) {
      versionText = null;
      return;
    }
    const token = ++textRequest;
    call<string | null | undefined>("historyText", current, id)
      .then((text) => {
        if (token === textRequest) versionText = text ?? null;
      })
      .catch((error: unknown) => console.error("[historyText]", error));
  });
  let textRequest = 0;

  const clean = (line: string) => line.replace(/\r?\n$/, "");
  const blocks = $derived.by((): Block[] => {
    if (versionText === null) return [];
    const version = lines(versionText);
    const current = lines(app.text);
    return diff(version, current)
      .slice(0, 60)
      .map((hunk) => ({
        context: version.slice(Math.max(0, hunk.baseStart - 1), hunk.baseStart).map(clean),
        version: version.slice(hunk.baseStart, hunk.baseEnd).map(clean),
        current: current.slice(hunk.otherStart, hunk.otherEnd).map(clean),
      }));
  });
  const identical = $derived(versionText !== null && versionText.replace(/\r\n/g, "\n") === app.text.replace(/\r\n/g, "\n"));
  const selectedVersion = $derived(versions.find((version) => version.id === selected) ?? null);

  function close() {
    app.historyOpen = false;
  }

  async function restore() {
    if (!path || !selected) return;
    const done = await call<boolean>("restoreVersion", path, selected);
    if (done) close();
  }

  function onListKeydown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = versions.findIndex((version) => version.id === selected);
    const next = versions[Math.max(0, Math.min(versions.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) selected = next.id;
  }
</script>

{#snippet column(heading: string, side: "version" | "current")}
  <div class="column {side}">
    <div class="column-title">{heading}</div>
    <div class="column-body">
      {#if identical}
        <div class="line placeholder">Same as the note now</div>
      {:else}
        {#each blocks as block, index (index)}
          <div class="block">
            {#each block.context as line, i (i)}
              <div class="line context">{line || " "}</div>
            {/each}
            {#if block[side].length === 0}
              <div class="line placeholder">{side === "version" ? "(not present)" : "(removed)"}</div>
            {/if}
            {#each block[side] as line, i (i)}
              <div class="line changed">{line || " "}</div>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/snippet}

<Modal width={820} labelledby="history-title" describedby="history-summary" onclose={close}>
  <div class="sheet">
    <div class="header">
      <div class="badge"><RotateCcw size={18} /></div>
      <div class="header-text">
        <h2 id="history-title">Versions of “{title}”</h2>
        <p id="history-summary">
          {#if !loaded}
            Looking for saved versions…
          {:else if versions.length === 0}
            No versions saved yet. Holocron keeps a copy each time it saves a note, at most one every 5 minutes, for 30 days.
          {:else}
            Holocron saved {versions.length === 1 ? "one version" : `${versions.length} versions`} of this note. Pick one to see what changed since, and restore it if you need to.
          {/if}
        </p>
      </div>
    </div>

    {#if versions.length > 0}
      <div class="body">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="versions" role="listbox" aria-label="Saved versions" tabindex="0" onkeydown={onListKeydown}>
          {#each groups as group (group.day)}
            <div class="day">{group.day}</div>
            {#each group.items as version (version.id)}
              <button
                class="version"
                class:selected={version.id === selected}
                role="option"
                aria-selected={version.id === selected}
                title={dateFormat.format(version.date)}
                onclick={() => (selected = version.id)}
              >
                <span class="time">{timeFormat.format(version.date)}</span>
                <span class="meta">{ago(version.date)} · {sizeText(version.size)}</span>
              </button>
            {/each}
          {/each}
        </div>
        <div class="comparison">
          {@render column(selectedVersion ? dateFormat.format(selectedVersion.date) : "Version", "version")}
          {@render column("Now", "current")}
        </div>
      </div>
    {/if}

    <div class="actions">
      <span class="hint">Versions live outside the vault, in Holocron’s app data folder.</span>
      <button class="button" onclick={close}>Close</button>
      <button class="button primary" disabled={!selected || identical || versionText === null} title="Replace the note’s text with this version (Undo in the toast)" onclick={restore}>
        Restore This Version
      </button>
    </div>
  </div>
</Modal>

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
    background: rgba(var(--ui-accent-rgb), 0.16);
    color: var(--ui-accent);
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
  .body {
    display: flex;
    gap: 10px;
    height: 360px;
    min-height: 160px;
  }
  .versions {
    flex: none;
    width: 200px;
    overflow-y: auto;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-editor);
    padding: 4px;
    outline: none;
  }
  .versions:focus-visible {
    box-shadow: 0 0 0 2px rgba(var(--ui-accent-rgb), 0.4);
  }
  .day {
    padding: 8px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ui-text-3);
  }
  .version {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text);
    text-align: left;
  }
  .version:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .version.selected {
    background: rgba(var(--ui-accent-rgb), 0.16);
  }
  .time {
    font-size: 13px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    font-size: 11px;
    color: var(--ui-text-3);
  }
  .comparison {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 10px;
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
    --tint: var(--ui-warning);
  }
  .column.current {
    --tint: var(--ui-accent);
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
    white-space: nowrap;
    overflow: hidden;
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
  .hint {
    flex: 1;
    font-size: 11.5px;
    color: var(--ui-text-3);
  }
</style>
