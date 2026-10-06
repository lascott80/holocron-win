<!-- Settings › Appearance: a grid of colour-theme cards (§16.10), each a
     miniature of the app in that theme — title bar, sidebar, a heading, body
     text, a code chip in three syntax colours and the accent. Arrow keys move
     between cards; choosing one applies it at once. -->
<script lang="ts">
  import { Check } from "@lucide/svelte";
  import type { Accent } from "@shared/settings";
  import { accentColors, type Theme } from "@shared/themes";

  let { themes, value, accent, label, onchange }: {
    themes: readonly Theme[];
    value: string;
    accent: Accent;
    label: string;
    onchange: (id: string) => void;
  } = $props();

  let cards = $state<HTMLButtonElement[]>([]);

  function onKeydown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + themes.length) % themes.length;
    onchange(themes[next]!.id);
    cards[next]?.focus();
  }
</script>

<div class="themes" role="radiogroup" aria-label={label}>
  {#each themes as theme, index (theme.id)}
    {@const p = theme.palette}
    {@const a = accentColors(theme, accent)}
    {@const selected = theme.id === value}
    <button
      class="card"
      class:selected
      role="radio"
      aria-checked={selected}
      tabindex={selected ? 0 : -1}
      title={theme.source}
      bind:this={cards[index]}
      onclick={() => onchange(theme.id)}
      onkeydown={(event) => onKeydown(event, index)}
    >
      <span class="preview" aria-hidden="true" style:background={p.editorBackground} style:border-color={p.border}>
        <span class="titlebar" style:background={p.titleBar} style:border-color={p.border}>
          <span class="dot" style:background={a.glyph}></span>
          <span class="bar" style:width="22%" style:background={p.secondaryText}></span>
        </span>
        <span class="body">
          <span class="sidebar" style:background={p.sidebarBackground} style:border-color={p.border}>
            <span class="row" style:background={p.chip}><span class="bar" style:width="70%" style:background={p.text}></span></span>
            <span class="row"><span class="bar" style:width="55%" style:background={p.tertiaryText}></span></span>
            <span class="row"><span class="bar" style:width="80%" style:background={p.tertiaryText}></span></span>
            <span class="row"><span class="bar" style:width="45%" style:background={p.tertiaryText}></span></span>
          </span>
          <span class="editor">
            <span class="heading" style:background={theme.heading ?? p.strongText}></span>
            <span class="line">
              <span class="bar" style:width="58%" style:background={p.bodyText}></span>
              <span class="bar" style:width="22%" style:background={a.glyph}></span>
            </span>
            <span class="line"><span class="bar" style:width="84%" style:background={p.bodyText}></span></span>
            <span class="code" style:background={p.codeBackground} style:border-color={p.border}>
              <span class="bar" style:width="18%" style:background={theme.syntax.keyword}></span>
              <span class="bar" style:width="30%" style:background={theme.syntax.function}></span>
              <span class="bar" style:width="26%" style:background={theme.syntax.string}></span>
            </span>
            <span class="line">
              <span class="tag" style:background={`color-mix(in srgb, ${a.glyph} 18%, transparent)`}>
                <span class="bar" style:background={a.text}></span>
              </span>
              <span class="bar" style:width="40%" style:background={p.tertiaryText}></span>
            </span>
          </span>
        </span>
      </span>
      <span class="name">
        <span class="name-text">{theme.name}</span>
        {#if selected}<span class="check"><Check size={13} strokeWidth={2.5} /></span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 5px 5px 6px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .card:hover {
    background: var(--ui-chip);
  }
  .card:focus-visible {
    outline: 2px solid rgba(var(--ui-accent-rgb), 0.7);
    outline-offset: 1px;
  }
  .card.selected {
    border-color: var(--ui-accent);
    background: rgba(var(--ui-accent-rgb), 0.1);
  }
  .card.selected .preview {
    box-shadow: 0 0 0 1px var(--ui-accent);
  }
  .preview {
    display: flex;
    flex-direction: column;
    height: 78px;
    border: 1px solid;
    border-radius: 6px;
    overflow: hidden;
  }
  .titlebar {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 11px;
    flex: none;
    padding: 0 6px;
    border-bottom: 1px solid;
  }
  .titlebar .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .titlebar .bar {
    opacity: 0.6;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 30%;
    flex: none;
    padding: 5px 4px;
    border-right: 1px solid;
  }
  .sidebar .row {
    display: flex;
    align-items: center;
    height: 7px;
    padding: 0 3px;
    border-radius: 2px;
  }
  .sidebar .bar {
    opacity: 0.75;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
  }
  .heading {
    width: 55%;
    height: 5px;
    border-radius: 2px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .bar {
    display: block;
    height: 3px;
    border-radius: 2px;
  }
  .line > .bar {
    opacity: 0.85;
  }
  .code {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 11px;
    padding: 0 4px;
    border: 1px solid;
    border-radius: 3px;
  }
  .tag {
    display: flex;
    align-items: center;
    width: 26%;
    height: 7px;
    padding: 0 3px;
    border-radius: 4px;
  }
  .tag .bar {
    width: 100%;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px;
    font-size: 12px;
    color: var(--ui-text-2);
  }
  .selected .name {
    color: var(--ui-text);
    font-weight: 600;
  }
  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    display: inline-flex;
    margin-left: auto;
    color: var(--ui-accent);
  }
</style>
