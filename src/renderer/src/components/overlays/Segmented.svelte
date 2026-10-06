<!-- A segmented control (inspector tabs, appearance picker). ←/→ move between segments. -->
<script lang="ts" generics="T extends string">
  let { options, value, label, onchange }: {
    options: { value: T; label: string }[];
    value: T;
    label: string;
    onchange: (value: T) => void;
  } = $props();

  let buttons = $state<HTMLButtonElement[]>([]);

  function onKeydown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onchange(options[next]!.value);
    buttons[next]?.focus();
  }
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option, index (option.value)}
    <button
      class:selected={option.value === value}
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      bind:this={buttons[index]}
      onclick={() => onchange(option.value)}
      onkeydown={(event) => onKeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--ui-border);
    border-radius: 7px;
    background: var(--ui-chip);
  }
  button {
    /* Share spare space, but never squeeze a label below its own width ("Match System"). */
    flex: 1 0 auto;
    height: 24px;
    padding: 0 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.12s, color 0.12s;
  }
  button:hover:not(.selected) {
    color: var(--ui-text);
  }
  button.selected {
    background: var(--ui-raised);
    color: var(--ui-text);
    box-shadow: 0 0 0 1px var(--ui-border), 0 1px 2px rgba(0, 0, 0, 0.12);
  }
</style>
