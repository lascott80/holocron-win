<!-- The window: title bar, then sidebar | detail | inspector (REQUIREMENTS §11.1).
     The detail column (and with it the editor) is always mounted so the one
     CodeMirror instance survives vault switches; the welcome view covers it
     when no vault is open. -->
<script lang="ts">
  import { singlePane } from "@core/layout";
  import { app, rememberWidth } from "./lib/app.svelte";
  import { handleKeydown } from "./lib/commands";
  import { applyTheme, applySnippets } from "./lib/theme";
  import TitleBar from "./components/TitleBar.svelte";
  import PopupMenu from "./components/PopupMenu.svelte";
  import EditorHost from "./components/EditorHost.svelte";
  import Sidebar from "./components/sidebar/Sidebar.svelte";
  import Inspector from "./components/inspector/Inspector.svelte";
  import TabBar from "./components/detail/TabBar.svelte";
  import FormattingBar from "./components/detail/FormattingBar.svelte";
  import Breadcrumb from "./components/detail/Breadcrumb.svelte";
  import PaneTree from "./components/detail/PaneTree.svelte";
  import StackedTabs from "./components/detail/StackedTabs.svelte";
  import CanvasView from "./components/detail/CanvasView.svelte";
  import BaseView from "./components/detail/BaseView.svelte";
  import SyncConflictBanner from "./components/detail/SyncConflictBanner.svelte";
  import SyncConflictSheet from "./components/overlays/SyncConflictSheet.svelte";
  import GraphView from "./components/overlays/GraphView.svelte";
  import MissingBanner from "./components/detail/MissingBanner.svelte";
  import StatusBar from "./components/detail/StatusBar.svelte";
  import EmptyEditor from "./components/detail/EmptyEditor.svelte";
  import QuickOpen from "./components/overlays/QuickOpen.svelte";
  import NoteComposer from "./components/overlays/NoteComposer.svelte";
  import TemplatePicker from "./components/overlays/TemplatePicker.svelte";
  import Welcome from "./components/overlays/Welcome.svelte";
  import SettingsDialog from "./components/overlays/SettingsDialog.svelte";
  import AboutDialog from "./components/overlays/AboutDialog.svelte";
  import ConflictSheet from "./components/overlays/ConflictSheet.svelte";
  import HistorySheet from "./components/overlays/HistorySheet.svelte";
  import DeleteConfirm from "./components/overlays/DeleteConfirm.svelte";
  import AttachmentCleanup from "./components/overlays/AttachmentCleanup.svelte";
  import OrganiseAttachments from "./components/overlays/OrganiseAttachments.svelte";
  import AttachmentConfirm from "./components/overlays/AttachmentConfirm.svelte";
  import AlertDialog from "./components/overlays/AlertDialog.svelte";
  import RenameTagDialog from "./components/overlays/RenameTagDialog.svelte";
  import WorkspaceDialog from "./components/overlays/WorkspaceDialog.svelte";
  import Toast from "./components/overlays/Toast.svelte";
  import UpdatePrompt from "./components/overlays/UpdatePrompt.svelte";

  const vault = $derived(app.vault);
  const showChrome = $derived(!app.focusMode);
  const showSidebar = $derived(Boolean(vault) && showChrome && app.settings.showSidebar);
  const showInspector = $derived(Boolean(vault) && showChrome && app.settings.showInspector);
  const hasNote = $derived(Boolean(app.doc));
  /** The active tab shows a JSON Canvas file in the read-only viewer (UI-45). */
  const canvas = $derived(vault?.canvas ?? null);
  /** The active tab shows a `.base` file in the Base view (UI-46). */
  const base = $derived(vault?.base ?? null);
  /** Stacked tabs (UI-48): the primary pane shows every tab as a column instead of the one editor. */
  const stacked = $derived(Boolean(vault?.stackTabs) && (vault?.tabs.some((tab) => tab.path !== null) ?? false));
  /** The pane tree (UI-40); the primary pane alone until a vault is open. */
  const layoutRoot = $derived(vault?.layout.root ?? singlePane().root);
  /** The primary pane's content, which the tree adopts. */
  let mainContent = $state<HTMLDivElement>();

  $effect(() => applyTheme(app.state.isDark, app.settings));
  // CSS snippets (§16.11) go in after every stylesheet, so they win on equal specificity.
  $effect(() => applySnippets(app.state.snippets));

  // Panel widths (UI-02): sidebar 200–400 (260), inspector 240–420 (290); kept in the app store so workspaces can save them (UI-49).
  function startResize(event: PointerEvent, which: "sidebar" | "inspector") {
    event.preventDefault();
    const startX = event.clientX;
    const start = which === "sidebar" ? app.sidebarWidth : app.inspectorWidth;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      if (which === "sidebar") app.sidebarWidth = Math.min(400, Math.max(200, start + delta));
      else app.inspectorWidth = Math.min(420, Math.max(240, start - delta));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      rememberWidth(which === "sidebar" ? "sidebarWidth" : "inspectorWidth", which === "sidebar" ? app.sidebarWidth : app.inspectorWidth);
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
      <aside class="sidebar" style:width="{app.sidebarWidth}px">
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
        {#if hasNote || canvas || base}
          <Breadcrumb />
        {/if}
      {/if}
      {#if vault && app.doc?.isMissing}
        <MissingBanner />
      {/if}
      {#if vault?.syncConflicts.length}
        <SyncConflictBanner />
      {/if}
      <!-- The primary pane's content is made once, here, and moved into whichever leaf of the
           pane tree is the primary pane (PaneTree adopts it), so the editor is never re-created
           when the tree changes. It stays mounted, hidden, when a canvas, a base or stacked tabs show instead. -->
      <div class="main-content" bind:this={mainContent}>
        <EditorHost visible={Boolean(vault) && hasNote && !stacked} />
        {#if vault && stacked}
          <StackedTabs />
        {:else if vault && canvas}
          <CanvasView {canvas} />
        {:else if vault && base}
          <BaseView {base} />
        {:else if vault && !hasNote}
          <EmptyEditor />
        {/if}
      </div>
      <div class="panes">
        <PaneTree node={layoutRoot} main={mainContent} />
      </div>
      {#if vault && showChrome}
        <StatusBar />
      {/if}
      <Toast />
    </main>

    {#if showInspector}
      <div class="resize-handle" role="separator" aria-orientation="vertical" onpointerdown={(e) => startResize(e, "inspector")}></div>
      <aside class="inspector" style:width="{app.inspectorWidth}px">
        <Inspector />
      </aside>
    {/if}

    {#if app.loaded && !vault}
      <Welcome />
    {/if}
  </div>
</div>

{#if app.quickOpen}<QuickOpen />{/if}
{#if app.composer}<NoteComposer />{/if}
{#if app.templatePicker}<TemplatePicker />{/if}
{#if app.settingsOpen}<SettingsDialog />{/if}
{#if app.aboutOpen}<AboutDialog />{/if}
{#if app.historyOpen && app.doc}<HistorySheet />{/if}
{#if vault?.conflict}<ConflictSheet />{/if}
{#if app.syncReview}<SyncConflictSheet />{/if}
{#if app.graphOpen && vault}<GraphView />{/if}
{#if vault?.pendingDeletion}<DeleteConfirm />{/if}
{#if app.renamingTag !== null && vault}<RenameTagDialog />{/if}
{#if app.workspaceDialog && vault}<WorkspaceDialog />{/if}
{#if vault?.attachmentCleanup}<AttachmentCleanup />{/if}
{#if vault?.attachmentOrganise}<OrganiseAttachments />{/if}
{#if vault?.attachmentConfirm}<AttachmentConfirm />{/if}
{#if app.state.errorMessage}<AlertDialog />{/if}
<UpdatePrompt />
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
  /* The pane tree (UI-40): the primary pane and any panes split off it. */
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  /* Parked here between adoptions; shown once a leaf of the tree holds it. */
  .detail > .main-content {
    display: none;
  }
  :global(.main-slot > .main-content) {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
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
