<!-- The status bar (UI-07): save status (SAV-06) on the left; word count
     (click for stats, UI-32), cursor position and the view-mode menu on the right. -->
<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import type { EditorMode } from "@shared/settings";
  import Popover from "./Popover.svelte";
  import { app } from "../../lib/app.svelte";
  import { menu } from "../../lib/menu.svelte";

  const modes: { mode: EditorMode; title: string }[] = [
    { mode: "livePreview", title: "Live Preview" },
    { mode: "source", title: "Source Mode" },
    { mode: "reading", title: "Reading View" },
  ];

  const doc = $derived(app.doc);
  const fmt = (n: number) => n.toLocaleString();

  const status = $derived.by((): { text: string; tone: "error" | "warning" | "neutral" | "synced" } => {
    if (!doc) return { text: "", tone: "neutral" };
    if (doc.saveError) return { text: `Couldn’t save: ${doc.saveError}`, tone: "error" };
    if (doc.hasConflict) return { text: "Changed on disk — choose a version", tone: "warning" };
    if (doc.isMissing) return { text: "Not on disk", tone: "warning" };
    if (doc.isDirty) return { text: "Editing…", tone: "neutral" };
    const sync = doc.lastSyncEvent;
    if (sync && sync.date >= (doc.lastSaved ?? 0)) {
      return { text: sync.kind === "merged" ? "Merged changes from disk" : "Updated from disk", tone: "synced" };
    }
    return { text: "Saved to disk", tone: "synced" };
  });

  const statusHelp = $derived.by(() => {
    if (!doc) return "";
    if (doc.saveError) return doc.saveError;
    if (doc.lastSaved === null) return "Not saved in this session yet";
    const saved = new Date(doc.lastSaved);
    const time = saved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const isToday = saved.toDateString() === new Date().toDateString();
    const date = saved.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    return `Last saved at ${isToday ? time : `${date}, ${time}`}`;
  });

  // Counts (UI-32)
  const words = $derived(app.text.split(/\s+/).filter(Boolean).length);
  const selectedWords = $derived(app.cursor.selectedWords);
  const selectedCharacters = $derived(app.cursor.selectedCharacters);
  const wordLabel = $derived(
    selectedWords > 0 ? `${fmt(selectedWords)} of ${fmt(words)} words` : words === 1 ? "1 word" : `${fmt(words)} words`,
  );
  let statsButton = $state<HTMLButtonElement>();
  let statsOpen = $state(false);
  $effect(() => {
    if (!doc) statsOpen = false;
  });
  const stats = $derived.by(() => {
    if (!statsOpen) return [];
    const text = app.text;
    const minutes = words / 230;
    const rows: [string, string][] = [
      ["Words", fmt(words)],
      ["Characters", fmt([...text].length)],
      ["Without spaces", fmt([...text.replace(/\s/g, "")].length)],
      ["Paragraphs", fmt(text.split(/\r?\n\s*\r?\n/).filter((block) => block.trim()).length)],
      ["Reading time", minutes < 1 ? "Under a minute" : `${Math.ceil(minutes)} min`],
    ];
    return rows;
  });

  // View mode menu
  const modeTitle = $derived(modes.find((m) => m.mode === app.settings.editorMode)?.title ?? "Live Preview");
  let modeButton = $state<HTMLButtonElement>();
  let modeOpen = $state(false);

  function openModeMenu() {
    if (modeOpen) {
      menu.close();
      return;
    }
    if (!modeButton) return;
    modeOpen = true;
    const rect = modeButton.getBoundingClientRect();
    // Opens upwards, right-aligned (3 rows + padding); PopupMenu keeps it on screen.
    menu.open(
      modes.map(({ mode, title }) => ({
        label: title,
        checked: app.settings.editorMode === mode,
        run: () => app.setSetting("editorMode", mode),
      })),
      rect.right - 220,
      rect.top - 4 - (modes.length * 28 + 10),
      { onClose: () => (modeOpen = false) },
    );
  }
</script>

<footer class="status-bar">
  {#if doc}
    <div class="save-status tone-{status.tone}" title={statusHelp}>
      <span class="dot"></span>
      <span class="status-text">{status.text}</span>
    </div>
    <div class="spacer"></div>
    <button
      class="status-button"
      class:open={statsOpen}
      title="Word count — click for characters and reading time"
      aria-haspopup="dialog"
      aria-expanded={statsOpen}
      bind:this={statsButton}
      onclick={() => (statsOpen = !statsOpen)}
    >
      {wordLabel}
    </button>
    <span class="position">Ln {fmt(app.cursor.line)}, Col {fmt(app.cursor.column)}</span>
  {:else}
    <div class="spacer"></div>
  {/if}
  <button
    class="status-button mode"
    class:open={modeOpen}
    title="Switch between live preview, source mode and reading view"
    aria-haspopup="menu"
    aria-expanded={modeOpen}
    data-menu-trigger
    bind:this={modeButton}
    onclick={openModeMenu}
  >
    {modeTitle}
    <ChevronDown size={11} strokeWidth={2.2} />
  </button>
</footer>

{#if statsOpen}
  <Popover anchor={statsButton} placement="above" align="end" label="Note statistics" onclose={() => (statsOpen = false)}>
    <dl class="stats">
      {#each stats as [label, value] (label)}
        <dt>{label}</dt>
        <dd>{value}</dd>
      {/each}
      {#if selectedWords > 0 || selectedCharacters > 0}
        <div class="divider"></div>
        <dt>Selected words</dt>
        <dd>{fmt(selectedWords)}</dd>
        <dt>Selected characters</dt>
        <dd>{fmt(selectedCharacters)}</dd>
      {/if}
    </dl>
  </Popover>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 28px;
    flex: none;
    padding: 0 10px 0 16px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-editor);
    color: var(--ui-text-3);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .save-status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ui-synced);
  }
  .tone-neutral .dot {
    background: var(--ui-text-3);
  }
  .tone-warning .dot {
    background: var(--ui-warning);
  }
  .tone-warning .status-text {
    color: var(--ui-warning);
  }
  .tone-error .dot {
    background: var(--ui-danger);
  }
  .tone-error .status-text {
    color: var(--ui-danger);
  }
  .spacer {
    flex: 1;
  }
  .status-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px;
    margin: 0 -6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: inherit;
    font-variant-numeric: tabular-nums;
  }
  .status-button:hover,
  .status-button.open {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .status-button.mode {
    margin-right: 0;
  }
  .position {
    font-variant-numeric: tabular-nums;
  }
  .stats {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 24px;
    row-gap: 6px;
    margin: 0;
    padding: 14px;
    font-size: 12px;
  }
  dt {
    color: var(--ui-text-2);
  }
  dd {
    margin: 0;
    color: var(--ui-text);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .divider {
    grid-column: 1 / -1;
    height: 1px;
    margin: 2px 0;
    background: var(--ui-border);
  }
</style>
