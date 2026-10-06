<!-- The vault card at the top of the sidebar (UI-08): logo, name and path; its
     menu switches to a recent vault, opens or creates one, or closes this one. -->
<script lang="ts">
  import { ChevronsUpDown } from "@lucide/svelte";
  import Logo from "../Logo.svelte";
  import { app } from "../../lib/app.svelte";
  import { runCommand } from "../../lib/commands";
  import { run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";

  let button = $state<HTMLButtonElement>();
  let open = $state(false);

  const vault = $derived(app.vault);

  function entries(): MenuEntry[] {
    const current = vault?.root.toLowerCase();
    const others = app.state.recentVaults.filter((recent) => recent.path.toLowerCase() !== current);
    return [
      ...others.map((recent): MenuEntry => ({ label: recent.name, run: () => run("openVault", recent.path) })),
      ...(others.length ? ["-" as const] : []),
      { label: "Open Folder as Vault…", shortcut: "Ctrl+Shift+O", run: () => runCommand("openVault") },
      { label: "Create New Vault…", run: () => runCommand("createVault") },
      "-",
      { label: "Show Vault in File Explorer", run: () => runCommand("showVaultInExplorer") },
      { label: "Close Vault", shortcut: "Ctrl+Shift+W", run: () => runCommand("closeVault") },
    ];
  }

  function toggle() {
    if (open) {
      menu.close();
      return;
    }
    if (!button) return;
    open = true;
    menu.openBelow(button, entries(), { onClose: () => (open = false) });
  }
</script>

{#if vault}
  <button
    class="switcher"
    class:open
    bind:this={button}
    data-menu-trigger
    aria-label="Vault: {vault.name}"
    aria-haspopup="menu"
    title={vault.root}
    onclick={toggle}
  >
    <Logo size={22} />
    <span class="text">
      <span class="name">{vault.name}</span>
      <span class="path">&lrm;{vault.displayPath}&lrm;</span>
    </span>
    <ChevronsUpDown size={14} />
  </button>
{/if}

<style>
  .switcher {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-raised);
    text-align: left;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .switcher:hover,
  .switcher.open {
    background: color-mix(in srgb, var(--ui-raised) 70%, var(--ui-chip));
    border-color: color-mix(in srgb, var(--ui-strong-border) 70%, var(--ui-text-3));
  }
  .switcher > :global(svg:first-child) {
    flex: none;
  }
  .switcher > :global(svg:last-child) {
    flex: none;
    color: var(--ui-text-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Long paths lose their start, keeping the vault's own folder visible. */
    direction: rtl;
    text-align: left;
    color: var(--ui-text-3);
    font-size: 11px;
    line-height: 1.25;
  }
</style>
