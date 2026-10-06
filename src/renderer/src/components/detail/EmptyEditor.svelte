<!-- Shown in the detail pane when no note is open (UI-26): quick ways in,
     recent notes and a few shortcuts worth knowing. -->
<script lang="ts">
  import { BookOpen, CalendarDays, FileText, Search, SquarePen } from "@lucide/svelte";
  import type { Component } from "svelte";
  import Logo from "../Logo.svelte";
  import { app } from "../../lib/app.svelte";
  import { commandById, runCommand } from "../../lib/commands";
  import { run } from "../../lib/host";

  interface Tile {
    title: string;
    command: string;
    shortcut?: string;
    icon: Component<{ size?: number; strokeWidth?: number }>;
  }

  const vault = $derived(app.vault);
  const isEmpty = $derived(vault?.noteCount === 0);
  const activeTab = $derived(vault?.tabs.find((tab) => tab.id === vault.activeTabId) ?? null);
  const heading = $derived(isEmpty ? "This vault is empty" : activeTab && !activeTab.path ? "New tab" : "No note open");

  const shortcut = (id: string) => commandById.get(id)?.shortcut;
  const tiles = $derived<Tile[]>([
    { title: "New Note", command: "newNote", shortcut: shortcut("newNote"), icon: SquarePen },
    { title: "Today’s Note", command: "today", shortcut: shortcut("today"), icon: CalendarDays },
    isEmpty
      ? { title: "Start Here Guide", command: "starterGuide", icon: BookOpen }
      : { title: "Quick Open", command: "quickOpen", shortcut: shortcut("quickOpen"), icon: Search },
  ]);

  const recent = $derived((vault?.recentNotes ?? []).slice(0, 6));
  const title = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  const folder = (path: string) => path.split("/").slice(0, -1).join(" / ");

  const hints: [string, string][] = [
    [shortcut("commandPalette") ?? "Ctrl+Shift+P", "Commands"],
    [shortcut("searchVault") ?? "Ctrl+Shift+F", "Search"],
    [shortcut("focusMode") ?? "Ctrl+Alt+F", "Focus"],
  ];
</script>

<div class="empty-editor">
  <div class="content">
    <div class="hero">
      <Logo size={48} glowing />
      <h1>{heading}</h1>
      {#if isEmpty}
        <p>Create a note, add .md files to the folder in File Explorer, or add a short guide to get started.</p>
      {/if}
    </div>

    <div class="tiles">
      {#each tiles as tile (tile.command)}
        <button class="tile" aria-label={tile.shortcut ? `${tile.title}, ${tile.shortcut}` : tile.title} onclick={() => runCommand(tile.command)}>
          <span class="tile-icon"><tile.icon size={20} strokeWidth={1.75} /></span>
          <span class="tile-title">{tile.title}</span>
          <span class="tile-shortcut">{tile.shortcut ?? " "}</span>
        </button>
      {/each}
    </div>

    {#if recent.length > 0}
      <section class="recent" aria-label="Recent notes">
        <h2 class="section-label">Recent</h2>
        {#each recent as path (path)}
          <button class="recent-row" title={path} onclick={() => run("open", path)}>
            <FileText size={14} />
            <span class="recent-title">{title(path)}</span>
            <span class="recent-folder"><bdi dir="ltr">{folder(path)}</bdi></span>
          </button>
        {/each}
      </section>
    {/if}

    <div class="hints">
      {#each hints as [keys, label] (label)}
        <span class="hint"><span class="keycap">{keys}</span>{label}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .empty-editor {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: auto;
    background: var(--ui-editor);
  }
  .content {
    margin: auto;
    padding: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--ui-strong);
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
  }
  .tiles {
    display: flex;
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 120px;
    height: 84px;
    padding: 0 6px;
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    background: var(--ui-raised);
    transition: background-color 0.1s, border-color 0.1s;
  }
  .tile:hover {
    background: var(--ui-chip);
    border-color: var(--ui-strong-border);
  }
  .tile:active {
    background: color-mix(in srgb, var(--ui-chip) 75%, var(--ui-strong-border));
  }
  .tile-icon {
    display: inline-flex;
    color: var(--ui-accent-text);
  }
  .tile-title {
    color: var(--ui-text);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .tile-shortcut {
    color: var(--ui-text-3);
    font-size: 11px;
  }
  .recent {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 380px;
    max-width: 100%;
  }
  .recent h2 {
    margin: 0 0 4px;
    padding: 0 10px;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-3);
    text-align: left;
  }
  .recent-row:hover {
    background: var(--ui-chip);
  }
  .recent-title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text);
  }
  .recent-folder {
    flex: 1 1 0;
    min-width: 0;
    margin-left: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: right;
    font-size: 12px;
  }
  .hints {
    display: flex;
    gap: 18px;
    color: var(--ui-text-3);
    font-size: 11px;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
