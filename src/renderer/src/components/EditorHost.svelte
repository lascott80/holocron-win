<!-- Hosts the CodeMirror editor (src/editor). It's created once and never
     unmounted, then reused for every note (REQUIREMENTS ARC-03). Keeps its
     appearance, mode and focus mode in sync, and handles files dropped from
     File Explorer (linked if in the vault, else copied in — VLT-10). -->
<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/app.svelte";
  import { call, editor } from "../lib/host";
  import { editorVariables } from "../lib/theme";

  let { visible }: { visible: boolean } = $props();
  let dragging = $state(false);

  onMount(() => {
    // The editor module looks up #editor and announces "ready" when it loads.
    void import("@editor/main.js");
  });

  $effect(() => {
    const vars = editorVariables(app.state.isDark, app.settings);
    const mode = app.state.isDark ? "dark" : "light";
    if (app.editorReady) editor()?.setAppearance(vars, mode);
  });

  $effect(() => {
    const mode = app.settings.editorMode === "livePreview" ? "live" : app.settings.editorMode;
    if (app.editorReady) editor()?.setMode(mode);
  });

  $effect(() => {
    const on = app.focusMode;
    if (app.editorReady) editor()?.setFocusMode(on);
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
    // Handle file drops ourselves: CodeMirror would insert file contents.
    event.preventDefault();
    event.stopPropagation();
    const files = [...(event.dataTransfer?.files ?? [])].map((file) => window.holocronHost.pathForFile(file)).filter(Boolean);
    if (!files.length) return;
    const texts = await call<string[]>("importFiles", files);
    if (texts?.length) editor()?.insertAtPoint(event.clientX, event.clientY, texts.join("\n") + "\n");
  }
</script>

<div
  class="editor-host"
  class:hidden={!visible}
  class:dragging
  role="presentation"
  ondragovercapture={onDragOver}
  ondragleave={() => (dragging = false)}
  ondropcapture={onDrop}
>
  <div id="editor"></div>
</div>

<style>
  .editor-host {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--hc-bg);
  }
  .editor-host.hidden {
    display: none;
  }
  .editor-host.dragging::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 2px dashed rgba(var(--ui-accent-rgb), 0.6);
    border-radius: 10px;
    pointer-events: none;
  }
  .editor-host :global(.cm-editor) {
    height: 100%;
    user-select: text;
  }
</style>
