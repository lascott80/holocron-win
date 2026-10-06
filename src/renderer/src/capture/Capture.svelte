<!-- Quick capture (REQUIREMENTS §22): a small window over whatever the user is doing.
     Ctrl+Enter saves (appends to today's note or the inbox and closes), Esc discards,
     clicking elsewhere hides it and keeps the draft. Enter is a new line. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { CaptureInfo, CaptureResult, UiRequest } from "@shared/ipc";
  import type { CaptureTarget } from "@shared/settings";
  import { call, host, run } from "../lib/host";
  import { applyTheme } from "../lib/theme";
  import Logo from "../components/Logo.svelte";
  import Segmented from "../components/overlays/Segmented.svelte";

  let info = $state<CaptureInfo | null>(null);
  let text = $state("");
  let target = $state<CaptureTarget>("daily");
  let error = $state<string | null>(null);
  let saving = $state(false);
  let textarea = $state<HTMLTextAreaElement | null>(null);

  const targets: { value: CaptureTarget; label: string }[] = [
    { value: "daily", label: "Today’s note" },
    { value: "inbox", label: "Inbox" },
  ];
  const targetPath = $derived(info ? (target === "daily" ? info.dailyPath : info.inboxPath) : null);

  function apply(next: CaptureInfo, reset: boolean) {
    info = next;
    applyTheme(next.isDark, next.settings);
    if (reset) {
      text = "";
      error = null;
    }
    // A fresh capture starts at the default target; a kept draft keeps its choice.
    if (reset || text.trim() === "") target = next.target;
  }

  async function focusText() {
    await tick();
    textarea?.focus();
  }

  onMount(() => {
    const stop = host.onUi((request: UiRequest) => {
      if (request.type !== "capture") return;
      apply(request.info, Boolean(request.reset));
      if (!request.reset) void focusText();
    });
    void call<CaptureInfo>("captureInfo").then((initial) => {
      if (!info) apply(initial, false);
      void focusText();
    });
    return stop;
  });

  async function save() {
    if (!info?.vaultName || saving) return;
    if (!text.trim()) {
      error = "Type something to capture.";
      return;
    }
    saving = true;
    error = null;
    try {
      const result = await call<CaptureResult>("captureSave", text, target);
      // On success main clears the draft and hides the window.
      if (!result.ok) error = result.error;
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      saving = false;
    }
  }

  function cancel() {
    text = "";
    error = null;
    run("captureHide", true);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void save();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="capture" aria-labelledby="capture-title">
  <header>
    <Logo size={16} />
    <h1 id="capture-title">Quick capture{#if info?.vaultName}&nbsp;<span class="arrow" aria-hidden="true">→</span>{/if}</h1>
    {#if info?.vaultName}
      <div class="targets">
        <Segmented label="Save to" options={targets} value={target} onchange={(value) => (target = value)} />
      </div>
      <span class="vault" title={targetPath ?? ""}>{info.vaultName}</span>
    {/if}
  </header>

  {#if info && !info.vaultName}
    <div class="empty">
      <p>Open a vault in Holocron first.</p>
      <button class="button primary" onclick={() => run("showMainWindow")}>Open Holocron</button>
    </div>
  {:else}
    <textarea
      bind:this={textarea}
      bind:value={text}
      spellcheck="true"
      aria-label="Capture text"
      placeholder={targetPath ? `Jot something down — it’s added to ${targetPath}` : "Jot something down"}
      oninput={() => (error = null)}
    ></textarea>
  {/if}

  <footer>
    {#if error}
      <span class="error" role="alert">{error}</span>
    {:else if info && !info.vaultName}
      <span class="hint"><span class="keycap">Esc</span> to close</span>
    {:else}
      <span class="hint"><span class="keycap">Ctrl+Enter</span> to save · <span class="keycap">Esc</span> to cancel</span>
    {/if}
    <div class="buttons">
      <button class="button" onclick={cancel}>Cancel</button>
      <button class="button primary" disabled={!info?.vaultName || saving} onclick={() => void save()}>Save</button>
    </div>
  </footer>
</main>

<style>
  :global(body) {
    background: var(--ui-overlay);
  }
  .capture {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--ui-strong-border);
    background: var(--ui-overlay);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 12px 0 14px;
    /* The header moves the window. */
    -webkit-app-region: drag;
  }
  h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    white-space: nowrap;
  }
  .arrow {
    color: var(--ui-text-3);
    font-weight: 400;
  }
  .targets {
    width: 190px;
    -webkit-app-region: no-drag;
  }
  .vault {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  textarea {
    flex: 1;
    min-height: 0;
    margin: 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--ui-strong-border);
    border-radius: 6px;
    background: var(--ui-editor);
    color: var(--ui-body);
    font-size: 14px;
    line-height: 1.45;
    resize: none;
    outline: none;
  }
  textarea:focus {
    border-color: var(--ui-accent);
    box-shadow: 0 0 0 3px rgba(var(--ui-accent-rgb), 0.18);
  }
  textarea::placeholder {
    color: var(--ui-faint);
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: 0 12px;
    border: 1px dashed var(--ui-strong-border);
    border-radius: 6px;
  }
  .empty p {
    margin: 0;
    font-size: 13px;
    color: var(--ui-text-2);
  }
  footer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 50px;
    padding: 0 12px 0 14px;
  }
  .hint,
  .error {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .hint {
    color: var(--ui-text-3);
  }
  .error {
    color: var(--ui-danger);
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .buttons .button {
    min-width: 76px;
  }
</style>
