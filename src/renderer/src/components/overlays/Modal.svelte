<!-- Shared modal chrome: dimmed backdrop, a panel on the overlay colour,
     focus trapped inside while open and restored on close, Esc to close.
     `placement="top"` is the palette position (80 px from the top). -->
<script module lang="ts">
  /** Open modals, innermost last: only the top one traps focus. */
  const stack: symbol[] = [];
</script>

<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";

  let {
    width = 440,
    placement = "center",
    closeOnBackdrop = false,
    label,
    labelledby,
    describedby,
    role = "dialog",
    panelClass = "",
    onclose,
    onkeydown,
    children,
  }: {
    width?: number;
    placement?: "center" | "top";
    closeOnBackdrop?: boolean;
    label?: string;
    labelledby?: string;
    describedby?: string;
    role?: "dialog" | "alertdialog";
    panelClass?: string;
    /** Esc (and a backdrop click when allowed). Omit to make Esc do nothing. */
    onclose?: () => void;
    onkeydown?: (event: KeyboardEvent) => void;
    children: Snippet;
  } = $props();

  const id = Symbol("modal");
  let panel = $state<HTMLDivElement>();

  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null || element === document.activeElement);
  }

  function isTop() {
    return stack[stack.length - 1] === id;
  }

  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    stack.push(id);
    void tick().then(() => {
      if (!panel || panel.contains(document.activeElement)) return;
      const target = panel.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? panel;
      target.focus();
    });

    const onFocusIn = (event: FocusEvent) => {
      if (!panel || !isTop()) return;
      const target = event.target as Node | null;
      // Popup menus live outside; let them take focus.
      if (target && (panel.contains(target) || (target as Element).closest?.(".menu"))) return;
      (focusables()[0] ?? panel).focus();
    };
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      // Give focus back unless something else (e.g. the editor) already took it.
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || panel?.contains(active))) {
        previous.focus({ preventScroll: true });
      }
    };
  });

  function handleKeydown(event: KeyboardEvent) {
    onkeydown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onclose?.();
    } else if (event.key === "Tab") {
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function onBackdropPointerDown(event: PointerEvent) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (closeOnBackdrop) onclose?.();
  }
</script>

<div class="backdrop" class:top={placement === "top"} role="presentation" onpointerdown={onBackdropPointerDown}>
  <div
    class="panel {panelClass}"
    style:width="{width}px"
    {role}
    aria-modal="true"
    aria-label={label}
    aria-labelledby={labelledby}
    aria-describedby={describedby}
    tabindex="-1"
    bind:this={panel}
    onkeydown={handleKeydown}
  >
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--ui-backdrop);
    animation: fade-in 0.15s ease-out;
  }
  .backdrop.top {
    align-items: flex-start;
    padding-top: 80px;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    border: 1px solid var(--ui-strong-border);
    border-radius: 12px;
    background: var(--ui-overlay);
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
    overflow: hidden;
    animation: panel-in 0.15s cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  .top .panel {
    max-height: calc(100vh - 120px);
  }
  .panel:focus {
    outline: none;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.985);
    }
  }
</style>
