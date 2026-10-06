<!-- The custom title bar: logo, menu bar (REQUIREMENTS §12), back/forward,
     the note title with the vault as subtitle, and the toolbar buttons (UI-03).
     The system's minimize/maximize/close buttons are drawn over the right edge
     (titleBarOverlay), so the bar leaves room for them. -->
<script lang="ts">
  import { ArrowLeft, ArrowRight, CalendarDays, FilePlus2, PanelRight, Search } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { app } from "../lib/app.svelte";
  import { menuEntries, menus, runCommand } from "../lib/commands";
  import { menu } from "../lib/menu.svelte";

  let openIndex = $state<number | null>(null);
  let titles = $state<HTMLButtonElement[]>([]);
  /** Alt was pressed alone: the next Alt release opens the menu bar. */
  let altArmed = false;

  const vault = $derived(app.vault);
  const title = $derived(app.doc?.title ?? (vault ? vault.name : "Holocron"));
  const subtitle = $derived(app.doc && vault ? vault.name : "");

  function openMenu(index: number) {
    const element = titles[index];
    if (!element) return;
    openIndex = index;
    menu.openBelow(element, menuEntries(menus[index].items), {
      onNavigate: (direction) => openMenu((index + direction + menus.length) % menus.length),
      onClose: () => {
        if (openIndex === index) openIndex = null;
      },
    });
  }

  function onTitleClick(index: number) {
    if (openIndex === index) menu.close();
    else openMenu(index);
  }

  function onKeydown(event: KeyboardEvent) {
    altArmed = event.key === "Alt" && !event.ctrlKey && !event.shiftKey && !event.repeat;
  }

  function onKeyup(event: KeyboardEvent) {
    // Windows convention: tapping Alt opens the menu bar.
    if (event.key === "Alt" && altArmed && !menu.current) {
      event.preventDefault();
      openMenu(0);
    }
    altArmed = false;
  }
</script>

<svelte:window onkeydowncapture={onKeydown} onkeyup={onKeyup} onpointerdown={() => (altArmed = false)} />

<header class="titlebar" class:focus-hidden={app.focusMode}>
  <div class="brand"><Logo size={18} /></div>
  <nav class="menubar" aria-label="Menu bar">
    {#each menus as item, index (item.title)}
      <button
        class="menu-title"
        class:open={openIndex === index}
        data-menu-trigger
        bind:this={titles[index]}
        onpointerdown={(event) => {
          event.preventDefault();
          onTitleClick(index);
        }}
        onpointerenter={() => openIndex !== null && openIndex !== index && openMenu(index)}
      >
        {item.title}
      </button>
    {/each}
  </nav>

  {#if vault}
    <div class="nav-buttons">
      <button class="icon-button" title="Back (Alt+Left)" aria-label="Back" disabled={!vault.canGoBack} onclick={() => runCommand("back")}>
        <ArrowLeft size={16} />
      </button>
      <button class="icon-button" title="Forward (Alt+Right)" aria-label="Forward" disabled={!vault.canGoForward} onclick={() => runCommand("forward")}>
        <ArrowRight size={16} />
      </button>
    </div>
  {/if}

  <div class="title" title={app.doc?.path}>
    <span class="title-main">{title}</span>
    {#if subtitle}<span class="title-sub">{subtitle}</span>{/if}
  </div>

  {#if vault}
    <div class="tools">
      <button class="icon-button" title="Today’s Note (Ctrl+Shift+D)" aria-label="Today’s Note" onclick={() => runCommand("today")}>
        <CalendarDays size={16} />
      </button>
      <button class="icon-button" title="Quick Open (Ctrl+O)" aria-label="Quick Open" onclick={() => runCommand("quickOpen")}>
        <Search size={16} />
      </button>
      <button class="icon-button" title="New Note (Ctrl+N)" aria-label="New Note" onclick={() => runCommand("newNote")}>
        <FilePlus2 size={16} />
      </button>
      <button
        class="icon-button"
        class:active={app.settings.showInspector}
        title="Show or hide the inspector (Ctrl+Alt+I)"
        aria-label="Inspector"
        onclick={() => runCommand("toggleInspector")}
      >
        <PanelRight size={16} />
      </button>
    </div>
  {/if}
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 40px;
    flex: none;
    /* Room for the system window controls drawn over the right edge. */
    padding: 0 calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) + 8px) 0 10px;
    background: var(--ui-sidebar);
    border-bottom: 1px solid var(--ui-border);
    -webkit-app-region: drag;
  }
  .titlebar > :global(*:not(.title)) {
    -webkit-app-region: no-drag;
  }
  .brand {
    display: flex;
    padding: 0 6px 0 2px;
  }
  .menubar {
    display: flex;
    gap: 1px;
  }
  .menu-title {
    height: 28px;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12.5px;
  }
  .menu-title:hover,
  .menu-title.open {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .nav-buttons {
    display: flex;
    gap: 2px;
    margin-left: 8px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 8px;
    overflow: hidden;
  }
  .title-main {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .title-sub {
    flex: none;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .focus-hidden .menubar,
  .focus-hidden .nav-buttons,
  .focus-hidden .tools {
    visibility: hidden;
  }
</style>
