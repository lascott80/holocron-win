<!-- The confirmation that slides up after moving, renaming, duplicating or
     deleting something (with Undo), or a warning (UI-31). Main replaces and
     auto-dismisses it; App's live region announces it. -->
<script lang="ts">
  import { CircleCheck, TriangleAlert, X } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";

  const toast = $derived(app.vault?.toast ?? null);
</script>

{#if toast}
  <div class="toast-layer">
    {#key toast.id}
      <div class="toast">
        <span class="icon" class:warning={toast.isWarning}>
          {#if toast.isWarning}<TriangleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
        </span>
        <span class="message">{toast.message}</span>
        {#if toast.actionTitle}
          <button class="action" onclick={() => run("runToastAction")}>{toast.actionTitle}</button>
        {/if}
        <button class="dismiss" aria-label="Dismiss" title="Dismiss" onclick={() => run("dismissToast")}>
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
    {/key}
  </div>
{/if}

<style>
  .toast-layer {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 44px;
    z-index: 50;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 520px;
    min-width: 0;
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 10px;
    background: var(--ui-panel);
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
    font-size: 13px;
    pointer-events: auto;
    animation: toast-in 0.3s cubic-bezier(0.34, 1.45, 0.64, 1);
  }
  .icon {
    display: inline-flex;
    flex: none;
    color: var(--ui-synced);
  }
  .icon.warning {
    color: var(--ui-warning);
  }
  .message {
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .action {
    flex: none;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-accent-text);
    font-weight: 600;
  }
  .action:hover {
    background: rgba(var(--ui-accent-rgb), 0.14);
  }
  .dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-3);
  }
  .dismiss:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.98);
    }
  }
</style>
