<!-- The window: title bar, then sidebar | detail | inspector (REQUIREMENTS §11.1).
     The detail column (and with it the editor) is always mounted so the one
     CodeMirror instance survives vault switches; the welcome view covers it
     when no vault is open. -->
<script lang="ts">
  import { app } from "./lib/app.svelte";
  import { handleKeydown } from "./lib/commands";
  import { applyTheme } from "./lib/theme";
  import TitleBar from "./components/TitleBar.svelte";
  import PopupMenu from "./components/PopupMenu.svelte";
  import EditorHost from "./components/EditorHost.svelte";
  import Sidebar from "./components/sidebar/Sidebar.svelte";
  import Inspector from "./components/inspector/Inspector.svelte";
  import TabBar from "./components/detail/TabBar.svelte";
  import FormattingBar from "./components/detail/FormattingBar.svelte";
  import Breadcrumb from "./components/detail/Breadcrumb.svelte";
  import MissingBanner from "./components/detail/MissingBanner.svelte";
  import StatusBar from "./components/detail/StatusBar.svelte";
  import EmptyEditor from "./components/detail/EmptyEditor.svelte";
  import QuickOpen from "./components/overlays/QuickOpen.svelte";
  import TemplatePicker from "./components/overlays/TemplatePicker.svelte";
  import Welcome from "./components/overlays/Welcome.svelte";
  import SettingsDialog from "./components/overlays/SettingsDialog.svelte";
  import ConflictSheet from "./components/overlays/ConflictSheet.svelte";
  import DeleteConfirm from "./components/overlays/DeleteConfirm.svelte";
  import AlertDialog from "./components/overlays/AlertDialog.svelte";
  import Toast from "./components/overlays/Toast.svelte";

  const vault = $derived(app.vault);
  const showChrome = $derived(!app.focusMode);
  const showSidebar = $derived(Boolean(vault) && showChrome && app.settings.showSidebar);
  const showInspector = $derived(Boolean(vault) && showChrome && app.settings.showInspector);
  const hasNote = $derived(Boolean(app.doc));

  $effect(() => applyTheme(app.state.isDark, app.settings));

  // Panel widths (UI-02): sidebar 200–400 (260), inspector 240–420 (290).
  function storedWidth(key: string, fallback: number) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  }
  let sidebarWidth = $state(storedWidth("sidebarWidth", 260));
  let inspectorWidth = $state(storedWidth("inspectorWidth", 290));

  function startResize(event: PointerEvent, which: "sidebar" | "inspector") {
    event.preventDefault();
    const startX = event.clientX;
    const start = which === "sidebar" ? sidebarWidth : inspectorWidth;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      if (which === "sidebar") sidebarWidth = Math.min(400, Math.max(200, start + delta));
      else inspectorWidth = Math.min(420, Math.max(240, start - delta));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(which === "sidebar" ? "sidebarWidth" : "inspectorWidth", String(which === "sidebar" ? sidebarWidth : inspectorWidth));
      } catch {
        // Not important.
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  // Mouse back/forward buttons navigate the active tab.
  function onMouseUp(event: MouseEvent) {
    if (!vault) return;
    if (event.button === 3) window.holocronHost.call("goBack");
    if (event.button === 4) window.holocronHost.call("goForward");
  }
</script>

<svelte:window onkeydowncapture={handleKeydown} onmouseup={onMouseUp} />

<div class="window">
  <TitleBar />
  <div class="body">
    {#if showSidebar}
      <aside class="sidebar" style:width="{sidebarWidth}px">
        <Sidebar />
      </aside>
      <div class="resize-handle" role="separator" aria-orientation="vertical" onpointerdown={(e) => startResize(e, "sidebar")}></div>
    {/if}

    <main class="detail">
      {#if vault && showChrome}
        <TabBar />
        {#if app.settings.showFormattingBar && !app.readingView && hasNote}
          <FormattingBar />
        {/if}
        {#if hasNote}
          <Breadcrumb />
        {/if}
      {/if}
      {#if vault && app.doc?.isMissing}
        <MissingBanner />
      {/if}
      <EditorHost visible={Boolean(vault) && hasNote} />
      {#if vault && !hasNote}
        <EmptyEditor />
      {/if}
      {#if vault && showChrome}
        <StatusBar />
      {/if}
      <Toast />
    </main>

    {#if showInspector}
      <div class="resize-handle" role="separator" aria-orientation="vertical" onpointerdown={(e) => startResize(e, "inspector")}></div>
      <aside class="inspector" style:width="{inspectorWidth}px">
        <Inspector />
      </aside>
    {/if}

    {#if app.loaded && !vault}
      <Welcome />
    {/if}
  </div>
</div>

{#if app.quickOpen}<QuickOpen />{/if}
{#if app.templatePicker}<TemplatePicker />{/if}
{#if app.settingsOpen}<SettingsDialog />{/if}
{#if vault?.conflict}<ConflictSheet />{/if}
{#if vault?.pendingDeletion}<DeleteConfirm />{/if}
{#if app.state.errorMessage}<AlertDialog />{/if}
<PopupMenu />
<div class="sr-only" aria-live="polite">{vault?.toast?.message ?? ""}</div>

<style>
  .window {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .sidebar {
    flex: none;
    min-width: 0;
    background: var(--ui-sidebar);
    display: flex;
    flex-direction: column;
  }
  .inspector {
    flex: none;
    min-width: 0;
    background: var(--ui-panel);
    display: flex;
    flex-direction: column;
  }
  .detail {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--ui-editor);
  }
  .resize-handle {
    flex: none;
    width: 1px;
    background: var(--ui-border);
    position: relative;
    z-index: 5;
    cursor: col-resize;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    inset: 0 -3px;
  }
  .resize-handle:hover {
    background: rgba(var(--ui-accent-rgb), 0.5);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
