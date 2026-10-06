<!-- The table size picker (UI-33): hover picks columns × rows (header row
     included); click or Enter inserts. Arrow keys adjust the size. -->
<script lang="ts">
  let { onpick }: { onpick: (bodyRows: number, columns: number) => void } = $props();

  const MAX = 8;
  const cells = Array.from({ length: MAX }, (_, i) => i + 1);

  let rows = $state(3);
  let columns = $state(3);

  const pick = () => onpick(Math.max(1, rows - 1), columns);

  function onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowRight":
        columns = Math.min(MAX, columns + 1);
        break;
      case "ArrowLeft":
        columns = Math.max(1, columns - 1);
        break;
      case "ArrowDown":
        rows = Math.min(MAX, rows + 1);
        break;
      case "ArrowUp":
        rows = Math.max(2, rows - 1);
        break;
      case "Enter":
      case " ":
        pick();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<div class="picker">
  <div
    class="grid"
    role="slider"
    tabindex="0"
    aria-label="Table size"
    aria-valuemin={1}
    aria-valuemax={MAX}
    aria-valuenow={columns}
    aria-valuetext="{columns} columns, {rows} rows"
    data-autofocus
    onkeydown={onKeydown}
  >
    {#each cells as row (row)}
      {#each cells as column (column)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="cell"
          class:on={row <= rows && column <= columns}
          class:header={row === 1}
          onpointerenter={() => {
            rows = row;
            columns = column;
          }}
          onclick={pick}
        ></div>
      {/each}
    {/each}
  </div>
  <div class="caption">{columns} × {rows} table</div>
</div>

<style>
  .picker {
    padding: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 18px);
    gap: 3px;
    border-radius: 4px;
  }
  .grid:focus {
    outline: none;
  }
  .grid:focus-visible {
    outline: 2px solid rgba(var(--ui-accent-rgb), 0.7);
    outline-offset: 4px;
  }
  .cell {
    width: 18px;
    height: 18px;
    border: 1px solid var(--ui-border);
    border-radius: 3px;
    background: var(--ui-chip);
    transition: background-color 0.05s, border-color 0.05s;
  }
  .cell.on {
    border-color: rgba(var(--ui-accent-rgb), 0.8);
    background: rgba(var(--ui-accent-rgb), 0.3);
  }
  .cell.on.header {
    background: rgba(var(--ui-accent-rgb), 0.55);
  }
  .caption {
    margin-top: 8px;
    color: var(--ui-text-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
</style>
