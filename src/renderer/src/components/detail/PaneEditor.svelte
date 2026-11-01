<!-- The editor of a pane other than the primary one (UI-40) or of a stacked
     tab's column (UI-48): made when the pane appears and torn down when it
     closes. Follows the appearance, reveal and hotkey settings like the main
     editor, with the pane's own view mode; accepts dropped files and
     Ctrl+wheel zoom. A linked pane's editor scrolls with the main one (UI-47). -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { PaneMode } from "@core/layout";
  import { app } from "../../lib/app.svelte";
  import { call, createPaneEditor, destroyPaneEditor, editorFor, type EditorApi } from "../../lib/host";
  import { editorVariables } from "../../lib/theme";
  import { editorHotkeys, zoomText } from "../../lib/commands";
  import { linkScroll } from "../../lib/linkedScroll";

  let { id, mode, linked = false }: { id: string; mode: PaneMode; linked?: boolean } = $props();
  let parent = $state<HTMLDivElement>();
  let api = $state<EditorApi | null>(null);
  let dragging = $state(false);

  onMount(() => {
    let cancelled = false;
    void import("@editor/main.js").then(() => {
      if (!cancelled && parent) api = createPaneEditor(parent, id);
    });
    return () => {
      cancelled = true;
      destroyPaneEditor(id);
    };
  });

  $effect(() => {
    const vars = editorVariables(app.state.isDark, app.settings);
    api?.setAppearance(vars, app.state.isDark ? "dark" : "light");
  });
  $effect(() => {
    api?.setMode(mode);
  });
  $effect(() => {
    api?.setRevealMode(app.settings.revealMarkup);
  });
  $effect(() => {
    const entries = editorHotkeys();
    api?.setHotkeys(entries);
  });

  // Linked scrolling with the main editor, both ways (UI-47).
  $effect(() => {
    const main = app.editorReady ? editorFor("main") : null;
    if (!linked || !api || !main) return;
    return linkScroll(main, api);
  });

  function hasFiles(event: DragEvent) {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event) || mode === "reading") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragging = true;
  }

  async function onDrop(event: DragEvent) {
    dragging = false;
    if (!hasFiles(event) || mode === "reading") return;
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

<div
  class="pane-editor"
  class:dragging
  role="presentation"
  bind:this={parent}
  ondragovercapture={onDragOver}
  ondragleave={() => (dragging = false)}
  ondropcapture={onDrop}
></div>

<style>
  .pane-editor {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    background: var(--hc-bg);
    /* So the room under the last line can be sized by the pane (cqh), not the window. */
    container-type: size;
  }
  /* The theme leaves 35vh under the last line, which is more than a short pane
     holds (padding can't be squeezed, so the scroller would overflow the pane). */
  .pane-editor :global(.cm-scroller) {
    padding-bottom: 35cqh;
  }
  .pane-editor.dragging::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 2px dashed rgba(var(--ui-accent-rgb), 0.6);
    border-radius: 10px;
    pointer-events: none;
  }
  .pane-editor :global(.cm-editor) {
    height: 100%;
    user-select: text;
  }
</style>
