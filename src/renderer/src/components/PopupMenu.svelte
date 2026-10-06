<!-- The one open popup menu (lib/menu.svelte.ts): context menus, dropdowns, menu-bar menus.
     Keyboard: ↑/↓ move, → opens a submenu (or the next menu-bar menu), ← goes back, ↵ runs, Esc closes. -->
<script lang="ts">
  import { Check, ChevronRight } from "@lucide/svelte";
  import { menu, type MenuEntry, type MenuItem } from "../lib/menu.svelte";
  import { tick } from "svelte";

  let root = $state<HTMLDivElement>();
  let position = $state({ x: 0, y: 0 });
  let highlighted = $state(-1);
  let submenu = $state<{ index: number; x: number; y: number } | null>(null);
  let subHighlighted = $state(-1);
  let subElement = $state<HTMLDivElement>();

  const current = $derived(menu.current);
  const entries = $derived(current?.entries ?? []);
  const subEntries = $derived(submenu ? ((entries[submenu.index] as MenuItem).items ?? []) : []);

  $effect(() => {
    if (!current) return;
    highlighted = -1;
    submenu = null;
    position = { x: current.x, y: current.y };
    void tick().then(() => {
      // Keep the menu inside the window.
      if (!root) return;
      const rect = root.getBoundingClientRect();
      position = {
        x: Math.max(4, Math.min(current.x, window.innerWidth - rect.width - 4)),
        y: Math.max(4, Math.min(current.y, window.innerHeight - rect.height - 4)),
      };
      root.focus();
    });
  });

  function isEnabled(entry: MenuEntry): entry is MenuItem {
    return entry !== "-" && !entry.disabled;
  }

  function activate(item: MenuItem) {
    if (item.items) return;
    menu.close();
    item.run?.();
  }

  function openSubmenu(index: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    submenu = { index, x: rect.right + 2, y: rect.top - 4 };
    subHighlighted = -1;
    void tick().then(() => {
      if (!subElement || !submenu) return;
      const sub = subElement.getBoundingClientRect();
      submenu = {
        ...submenu,
        x: sub.right > window.innerWidth - 4 ? rect.left - sub.width - 2 : submenu.x,
        y: Math.max(4, Math.min(submenu.y, window.innerHeight - sub.height - 4)),
      };
    });
  }

  function step(list: MenuEntry[], from: number, direction: 1 | -1): number {
    for (let i = 1; i <= list.length; i++) {
      const index = (from + direction * i + list.length * 2) % list.length;
      if (isEnabled(list[index])) return index;
    }
    return from;
  }

  function onKeydown(event: KeyboardEvent) {
    const inSub = submenu !== null && subHighlighted >= 0;
    const list = inSub ? subEntries : entries;
    const index = inSub ? subHighlighted : highlighted;
    const set = (value: number) => (inSub ? (subHighlighted = value) : (highlighted = value));
    switch (event.key) {
      case "ArrowDown":
        set(step(list, index < 0 ? -1 : index, 1));
        break;
      case "ArrowUp":
        set(step(list, index < 0 ? list.length : index, -1));
        break;
      case "ArrowRight": {
        const item = !inSub ? entries[highlighted] : null;
        if (item && item !== "-" && item.items) {
          const element = root?.querySelectorAll<HTMLElement>("[data-index]")[highlighted];
          if (element) openSubmenu(highlighted, element);
          subHighlighted = step(item.items, -1, 1);
        } else current?.onNavigate?.(1);
        break;
      }
      case "ArrowLeft":
        if (inSub) {
          submenu = null;
          subHighlighted = -1;
        } else current?.onNavigate?.(-1);
        break;
      case "Enter":
      case " ": {
        const item = list[index];
        if (item && isEnabled(item)) activate(item);
        break;
      }
      case "Escape":
      case "Alt":
        menu.close();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (!current) return;
    const target = event.target as Node;
    if (root?.contains(target) || subElement?.contains(target)) return;
    if ((target as Element).closest?.("[data-menu-trigger]")) return; // the trigger toggles itself
    menu.close();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onblur={() => menu.close()} onresize={() => menu.close()} />

{#snippet row(item: MenuEntry, index: number, isSub: boolean)}
  {#if item === "-"}
    <div class="menu-separator" role="separator"></div>
  {:else}
    <button
      class="menu-item"
      class:destructive={item.destructive}
      class:highlighted={isSub ? subHighlighted === index : highlighted === index || submenu?.index === index}
      disabled={item.disabled}
      role="menuitem"
      tabindex="-1"
      data-index={index}
      onpointerenter={(event) => {
        if (isSub) {
          subHighlighted = index;
          return;
        }
        highlighted = index;
        if (item.items && !item.disabled) openSubmenu(index, event.currentTarget);
        else submenu = null;
      }}
      onclick={() => activate(item)}
    >
      <span class="menu-check">{#if item.checked}<Check size={14} />{/if}</span>
      <span class="menu-label">{item.label}</span>
      {#if item.items}
        <ChevronRight size={14} />
      {:else if item.shortcut}
        <span class="menu-shortcut">{item.shortcut}</span>
      {/if}
    </button>
  {/if}
{/snippet}

{#if current}
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    bind:this={root}
    style:left="{position.x}px"
    style:top="{position.y}px"
    onkeydown={onKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each entries as item, index (index)}
      {@render row(item, index, false)}
    {/each}
  </div>
  {#if submenu}
    <div class="menu" role="menu" tabindex="-1" bind:this={subElement} style:left="{submenu.x}px" style:top="{submenu.y}px">
      {#each subEntries as item, index (index)}
        {@render row(item, index, true)}
      {/each}
    </div>
  {/if}
{/if}

<style>
  .menu:focus {
    outline: none;
  }
</style>
