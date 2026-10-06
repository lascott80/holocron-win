<!-- A Windows 11 style on/off switch. -->
<script lang="ts">
  let { checked, label, onchange }: {
    checked: boolean;
    /** Accessible name (the visible label sits beside it). */
    label: string;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<button class="switch" class:on={checked} role="switch" aria-checked={checked} aria-label={label} onclick={() => onchange(!checked)}>
  <span class="thumb"></span>
</button>

<style>
  .switch {
    flex: none;
    position: relative;
    width: 40px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--ui-text-3);
    border-radius: 10px;
    background: transparent;
    transition: background 0.15s, border-color 0.15s;
  }
  .switch:hover {
    background: var(--ui-chip);
  }
  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ui-text-2);
    transition: transform 0.15s cubic-bezier(0.3, 0.7, 0.4, 1), background 0.15s;
  }
  .switch.on {
    border-color: var(--ui-fill);
    background: var(--ui-fill);
  }
  .switch.on:hover {
    background: color-mix(in srgb, var(--ui-fill) 88%, #fff);
  }
  .switch.on .thumb {
    background: #fff;
    transform: translateX(20px);
  }
</style>
