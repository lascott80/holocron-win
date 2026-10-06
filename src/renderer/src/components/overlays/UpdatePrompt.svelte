<!-- The update card, bottom-right of the window (src/main/updater.ts): a newer
     version is available (Download / Skip This Version / Later), downloading,
     or ready (Restart Now / Later). Non-blocking; Esc or Later hides it until
     the next check. Main owns its state (AppState.update). -->
<script lang="ts">
  import { CircleCheck, Download, RefreshCw, TriangleAlert, X } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";

  const update = $derived(app.state.update);
  const visible = $derived(update.showPrompt);
  const percent = $derived(Math.round(update.percent ?? 0));

  /** The first few lines of the release notes. */
  const excerpt = $derived.by(() => {
    const lines = (update.releaseNotes ?? "").split("\n").filter((line) => line.trim() !== "");
    const shown = lines.slice(0, 3);
    return { text: shown.join("\n"), more: lines.length > shown.length };
  });

  const title = $derived.by(() => {
    if (update.message && update.status !== "available" && update.status !== "downloading" && update.status !== "downloaded") return null;
    switch (update.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Holocron ${update.version} is available`;
      case "downloading":
        return `Downloading update… ${percent}%`;
      case "downloaded":
        return "Update ready — restart to install";
      case "error":
        return "Update problem";
      default:
        return null;
    }
  });

  function later() {
    run("dismissUpdate");
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      later();
    }
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section class="update-card" aria-label="Holocron update" aria-live="polite" onkeydown={onKeydown}>
    <div class="head">
      <span class="icon" class:warning={update.status === "error"} class:ok={update.status === "not-available" || update.status === "downloaded"}>
        {#if update.status === "error"}
          <TriangleAlert size={16} />
        {:else if update.status === "downloaded" || update.status === "not-available"}
          <CircleCheck size={16} />
        {:else if update.status === "checking"}
          <RefreshCw size={16} class="spin" />
        {:else}
          <Download size={16} />
        {/if}
      </span>
      <div class="text">
        {#if title}<h2 class="title">{title}</h2>{/if}
        {#if update.status === "error" && update.error}
          <p class="detail">{update.error}</p>
        {:else if update.message}
          <p class="detail" class:lead={!title}>{update.message}</p>
        {/if}
      </div>
      <button class="close" aria-label="Close" title="Close (Esc)" onclick={later}><X size={14} strokeWidth={2.2} /></button>
    </div>

    {#if update.status === "available"}
      {#if excerpt.text}
        <p class="notes">{excerpt.text}{excerpt.more ? "\n…" : ""}</p>
      {/if}
      <button class="link" onclick={() => run("openReleasePage", update.version)}>What’s new</button>
      <div class="actions">
        <button class="button" onclick={() => update.version && run("skipUpdate", update.version)}>Skip This Version</button>
        <span class="spacer"></span>
        <button class="button" onclick={later}>Later</button>
        <button class="button primary" onclick={() => run("downloadUpdate")}>Download</button>
      </div>
    {:else if update.status === "downloading"}
      <div class="progress" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div class="bar" style:width="{percent}%"></div>
      </div>
      <div class="actions">
        <span class="hint">You can keep working.</span>
        <span class="spacer"></span>
        <button class="button" onclick={later}>Hide</button>
      </div>
    {:else if update.status === "downloaded"}
      <p class="detail body">
        Holocron {update.version} is downloaded. Restarting saves your notes first. If you choose Later, it installs when you quit Holocron.
      </p>
      <div class="actions">
        <span class="spacer"></span>
        <button class="button" onclick={later}>Later</button>
        <button class="button primary" onclick={() => run("installUpdate")}>Restart Now</button>
      </div>
    {:else if update.status === "error"}
      <div class="actions">
        <span class="spacer"></span>
        <button class="button" onclick={later}>Close</button>
        <button class="button primary" onclick={() => run("checkForUpdates")}>Try Again</button>
      </div>
    {:else if update.status !== "checking"}
      <div class="actions">
        <span class="spacer"></span>
        <button class="button" onclick={later}>OK</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .update-card {
    position: fixed;
    right: 16px;
    bottom: 40px;
    /* Above the window chrome and toasts, below modals (900) and menus. */
    z-index: 800;
    width: 360px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 12px 14px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 10px;
    background: var(--ui-panel);
    box-shadow: var(--ui-shadow);
    color: var(--ui-text);
    font-size: 13px;
    animation: card-in 0.25s cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .icon {
    flex: none;
    display: inline-flex;
    margin-top: 1px;
    color: var(--ui-accent-text);
  }
  .icon.ok {
    color: var(--ui-synced);
  }
  .icon.warning {
    color: var(--ui-warning);
  }
  .icon :global(.spin) {
    animation: spin 1s linear infinite;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
  }
  .detail {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .detail.lead {
    color: var(--ui-text);
  }
  .detail.body {
    padding-left: 26px;
  }
  .close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: -2px -2px 0 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-3);
  }
  .close:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .notes {
    margin: 0 0 0 26px;
    max-height: 4.5em;
    overflow: hidden;
    color: var(--ui-text-2);
    line-height: 1.45;
    white-space: pre-line;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .link {
    align-self: flex-start;
    margin-left: 26px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-accent-text);
    font-weight: 500;
  }
  .link:hover {
    text-decoration: underline;
  }
  .progress {
    margin-left: 26px;
    height: 4px;
    border-radius: 2px;
    background: var(--ui-strong-border);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--ui-accent);
    transition: width 0.2s;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
  .actions .button {
    height: 28px;
    padding: 0 12px;
  }
  .spacer {
    flex: 1;
  }
  .hint {
    padding-left: 26px;
    color: var(--ui-text-3);
    font-size: 12px;
  }
  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.98);
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
