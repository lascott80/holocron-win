<!-- Split view's right-hand pane (UI-40): a second editor beside the main
     one, with the note's title, Open in Tab and Close. Created the first time
     split view opens and kept (hidden) afterwards, like the main editor. -->
<script lang="ts">
  import { ExternalLink, X } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { call, run, type EditorApi } from "../../lib/host";
  import { editorVariables } from "../../lib/theme";
  import { zoomText } from "../../lib/commands";

  const split = $derived(app.vault?.split ?? null);
  let parent = $state<HTMLDivElement>();
  let api = $state<EditorApi | null>(null);
  let dragging = $state(false);

  $effect(() => {
    if (split && !api && parent) void create(parent);
  });

  async function create(element: HTMLDivElement) {
    await import("@editor/main.js");
    if (api || !window.holocronCreateEditor) return;
    api = window.holocronCreateEditor(element, "split");
    window.holocronSplit = api;
  }

  // Same appearance, mode and reveal setting as the main editor.
  $effect(() => {
    const vars = editorVariables(app.state.isDark, app.settings);
    api?.setAppearance(vars, app.state.isDark ? "dark" : "light");
  });
  $effect(() => {
    const mode = app.settings.editorMode === "livePreview" ? "live" : app.settings.editorMode;
    api?.setMode(mode);
  });
  $effect(() => {
    api?.setRevealMode(app.settings.revealMarkup);
  });

  // Closing split view while typing in it hands commands back to the main editor.
  $effect(() => {
    if (!split && app.pane === "split") app.focusPane("main");
  });

  function hasFiles(event: DragEvent) {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event) || app.readingView) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragging = true;
  }

  async function onDrop(event: DragEvent) {
    dragging = false;
    if (!hasFiles(event) || app.readingView) return;
    // Like the main editor: link vault files, copy outside ones in (CodeMirror would insert their contents).
    event.preventDefault();
    event.stopPropagation();
    const files = [...(event.dataTransfer?.files ?? [])].map((file) => window.holocronHost.pathForFile(file)).filter(Boolean);
    if (!files.length) return;
    const texts = await call<string[]>("importFiles", files);
    if (texts?.length) api?.insertAtPoint(event.clientX, event.clientY, texts.join("\n") + "\n");
  }

  // Not passive: Ctrl+wheel has to stop Chromium's own page zoom.
  $effect(() => {
    const element = parent;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  let wheelZoom = 0;
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey || (event.target as Element | null)?.closest?.(".hc-diagram-viewer")) return;
    event.preventDefault();
    wheelZoom += event.deltaY;
    while (Math.abs(wheelZoom) >= 50) {
      zoomText(wheelZoom > 0 ? -1 : 1);
      wheelZoom -= Math.sign(wheelZoom) * 50;
    }
  }
</script>

<section
  class="split"
  class:hidden={!split}
  class:active={app.pane === "split"}
  aria-label="Split view"
  onfocusin={() => app.focusPane("split")}
>
  <header class="split-header">
    <span class="title" title={split?.path}>
      {split?.title ?? ""}{#if split?.isDirty}<span class="dirty" aria-label="Unsaved changes"></span>{/if}
    </span>
    <button class="icon-button" title="Open in a Tab" aria-label="Open in a Tab" onclick={() => run("splitToTab")}>
      <ExternalLink size={14} />
    </button>
    <button class="icon-button" title="Close Split View" aria-label="Close Split View" onclick={() => run("closeSplit")}>
      <X size={15} />
    </button>
  </header>
  <div
    class="split-editor"
    class:dragging
    role="presentation"
    bind:this={parent}
    ondragovercapture={onDragOver}
    ondragleave={() => (dragging = false)}
    ondropcapture={onDrop}
  ></div>
</section>

<style>
  .split {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--ui-border);
    background: var(--hc-bg);
  }
  .split.hidden {
    display: none;
  }
  .split-header {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    flex: none;
    padding: 0 6px 0 16px;
    border-bottom: 1px solid var(--ui-border);
    color: var(--ui-text-3);
    font-size: 12px;
  }
  /* The pane being typed in has the accent under its title. */
  .split.active .split-header {
    box-shadow: inset 0 -2px 0 rgba(var(--ui-accent-rgb), 0.55);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-2);
    font-weight: 500;
  }
  .dirty {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--ui-text-3);
    vertical-align: middle;
  }
  .split-editor {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .split-editor.dragging::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 2px dashed rgba(var(--ui-accent-rgb), 0.6);
    border-radius: 10px;
    pointer-events: none;
  }
  .split-editor :global(.cm-editor) {
    height: 100%;
    user-select: text;
  }
</style>
