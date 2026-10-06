<!-- A Windows 11 style checkbox with its label. -->
<script lang="ts">
  import { Check } from "@lucide/svelte";

  let { checked, label, onchange }: {
    checked: boolean;
    label: string;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<label class="checkbox">
  <input type="checkbox" {checked} onchange={(event) => onchange(event.currentTarget.checked)} />
  <span class="box" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
  <span class="label">{label}</span>
</label>

<style>
  .checkbox {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--ui-text-2);
  }
  input {
    position: absolute;
    opacity: 0;
    width: 16px;
    height: 16px;
    margin: 0;
  }
  .box {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 4px;
    background: var(--ui-editor);
    color: transparent;
    transition: background 0.12s, border-color 0.12s;
  }
  .checkbox:hover .box {
    border-color: var(--ui-text-3);
  }
  input:checked + .box {
    background: var(--ui-fill);
    border-color: var(--ui-fill);
    color: #fff;
  }
  input:focus-visible + .box {
    outline: 2px solid rgba(var(--ui-accent-rgb), 0.7);
    outline-offset: 1px;
  }
  .label {
    line-height: 1.3;
  }
</style>
