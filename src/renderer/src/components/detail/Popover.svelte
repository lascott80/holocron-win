<!-- A small popover anchored to a trigger (table picker, cheat sheet, note stats).
     Opens below or above the anchor, flips when there's no room, stays inside
     the window, and closes on an outside click, Escape, blur or resize. The
     anchor toggles it itself, so clicks on the anchor are ignored here. -->
<script lang="ts">
  import { tick, type Snippet } from "svelte";

  let {
    anchor,
    placement = "below",
    align = "start",
    label,
    onclose,
    children,
  }: {
    anchor: HTMLElement | undefined;
    placement?: "below" | "above";
    align?: "start" | "center" | "end";
    label: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  const GAP = 6;
  const MARGIN = 8;

  let root = $state<HTMLDivElement>();
  let position = $state<{ x: number; y: number } | null>(null);

  function place() {
    if (!root || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = root.getBoundingClientRect();
    let x = align === "start" ? a.left : align === "end" ? a.right - width : a.left + a.width / 2 - width / 2;
    x = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const below = a.bottom + GAP;
    const above = a.top - GAP - height;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const fitsAbove = above >= MARGIN;
    let y = placement === "below" ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    y = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
    position = { x, y };
  }

  $effect(() => {
    void tick().then(() => {
      place();
      const target = root?.querySelector<HTMLElement>("[data-autofocus]") ?? root;
      target?.focus({ preventScroll: true });
    });
  });

  function close(restoreFocus: boolean) {
    onclose();
    if (restoreFocus) anchor?.focus({ preventScroll: true });
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target as Node;
    if (root?.contains(target) || anchor?.contains(target)) return;
    close(false);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }
</script>

<svelte:window onpointerdowncapture={onPointerDown} onkeydown={onKeydown} onblur={() => close(false)} onresize={() => close(false)} />

<div
  class="popover"
  role="dialog"
  aria-label={label}
  tabindex="-1"
  bind:this={root}
  style:left="{position?.x ?? 0}px"
  style:top="{position?.y ?? 0}px"
  style:visibility={position ? "visible" : "hidden"}
>
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 900;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow: auto;
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    background: var(--ui-overlay);
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
    font-size: 12px;
    animation: popover-in 0.12s ease-out;
  }
  .popover:focus {
    outline: none;
  }
  @keyframes popover-in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
</style>
