<!-- Shown when no vault is open (UI-28): open or create a vault, or pick a recent one. -->
<script lang="ts">
  import { FolderOpen, FolderPlus } from "@lucide/svelte";
  import type { RecentVault } from "@shared/ipc";
  import { app } from "../../lib/app.svelte";
  import { runCommand } from "../../lib/commands";
  import { run } from "../../lib/host";
  import { menu } from "../../lib/menu.svelte";
  import Logo from "../Logo.svelte";
  import Checkbox from "./Checkbox.svelte";

  function showMenu(event: MouseEvent, vault: RecentVault) {
    menu.openAt(event, [
      { label: "Show in File Explorer", run: () => run("showInFolder", vault.path) },
      { label: "Remove from Recents", run: () => run("forgetVault", vault.path) },
    ]);
  }
</script>

<div class="welcome">
  <div class="brand">
    <div class="logo"><Logo size={96} glowing strokeWidth={1.25} /></div>
    <h1>Holocron</h1>
    {#if app.state.version}<div class="version">Version {app.state.version}</div>{/if}
    <p>Your notes stay plain .md files in folders you choose. No database, no lock-in.</p>
  </div>

  <div class="actions">
    <div class="buttons">
      <button class="action primary" onclick={() => runCommand("openVault")}>
        <FolderOpen size={22} strokeWidth={1.75} />
        <span class="action-text">
          <span class="action-title">Open Folder as Vault…</span>
          <span class="action-subtitle">Dropbox, OneDrive, Syncthing, a Git repo — anywhere</span>
        </span>
        <span class="action-shortcut">Ctrl+Shift+O</span>
      </button>
      <button class="action" onclick={() => runCommand("createVault")}>
        <FolderPlus size={22} strokeWidth={1.75} />
        <span class="action-text">
          <span class="action-title">Create New Vault…</span>
          <span class="action-subtitle">Start an empty folder</span>
        </span>
      </button>
    </div>

    {#if app.state.recentVaults.length > 0}
      <section class="recents">
        <h2 class="section-label">Recent vaults</h2>
        <div class="recent-list">
          {#each app.state.recentVaults as vault (vault.path)}
            <button class="recent" title={vault.path} onclick={() => run("openVault", vault.path)} oncontextmenu={(event) => showMenu(event, vault)}>
              <span class="recent-logo"><Logo size={20} color="currentColor" /></span>
              <span class="recent-text">
                <span class="recent-name">{vault.name}</span>
                <span class="recent-path"><bdi dir="ltr">{vault.displayPath}</bdi></span>
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <div class="spacer"></div>

    <Checkbox
      label="Reopen last vault on launch"
      checked={app.settings.reopenLastVault}
      onchange={(checked) => app.setSetting("reopenLastVault", checked)}
    />
  </div>
</div>

<style>
  .welcome {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    background: var(--ui-editor);
    animation: fade 0.2s ease-out;
  }
  .brand {
    flex: none;
    width: 380px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 40px;
    background: var(--ui-panel);
    border-right: 1px solid var(--ui-border);
    text-align: center;
  }
  .logo {
    display: flex;
    margin-bottom: 8px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 5.6px;
    text-transform: uppercase;
    color: var(--ui-text);
    /* Balance the trailing letter-spacing so the word stays centred. */
    padding-left: 5.6px;
  }
  .version {
    color: var(--ui-text-2);
  }
  .brand p {
    max-width: 260px;
    margin: 8px 0 0;
    color: var(--ui-text-2);
    line-height: 1.5;
  }
  .actions {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 40px 36px 28px;
    overflow-y: auto;
  }
  .buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 560px;
  }
  .action {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 16px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 10px;
    background: var(--ui-raised);
    color: var(--ui-text);
    text-align: left;
    transition: background 0.12s, border-color 0.12s, transform 0.08s;
  }
  .action > :global(svg) {
    flex: none;
    color: var(--ui-text-2);
  }
  .action:hover {
    background: var(--ui-chip);
  }
  .action:active {
    transform: scale(0.995);
  }
  .action.primary {
    border-color: transparent;
    background: var(--ui-fill);
    color: #fff;
  }
  .action.primary > :global(svg) {
    color: #fff;
  }
  .action.primary:hover {
    background: color-mix(in srgb, var(--ui-fill) 88%, #fff);
  }
  .action-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .action-title {
    font-size: 14px;
    font-weight: 600;
  }
  .action-subtitle {
    font-size: 12px;
    color: var(--ui-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-shortcut {
    flex: none;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .primary .action-subtitle,
  .primary .action-shortcut {
    color: rgba(255, 255, 255, 0.78);
  }
  .recents {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 560px;
  }
  h2 {
    margin: 0;
    padding: 0 4px 4px;
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recent {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    color: var(--ui-text-2);
    transition: background 0.12s, color 0.12s;
  }
  .recent:hover {
    background: rgba(var(--ui-accent-rgb), 0.12);
    color: var(--ui-accent);
  }
  .recent-logo {
    flex: none;
    display: flex;
  }
  .recent-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recent-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-path {
    font-size: 12px;
    color: var(--ui-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Ellipsis at the start, so the vault's own folder stays visible. */
    direction: rtl;
    text-align: left;
  }
  .spacer {
    flex: 1;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (max-width: 900px) {
    .brand {
      width: 300px;
    }
  }
  @media (max-width: 720px) {
    .brand {
      width: 220px;
      padding: 24px;
    }
    .actions {
      padding: 28px 20px 20px;
    }
  }
</style>
