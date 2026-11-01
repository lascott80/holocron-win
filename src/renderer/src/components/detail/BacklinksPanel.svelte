<!-- Backlinks at the end of the note (UI-44): "Linked mentions" and "Unlinked
     mentions" below the main editor's last line, inside its scroll area, so
     it reads like the end of the note. Rendered here, then moved into the
     editor's scroller (CodeMirror owns that DOM, but leaves other children
     alone). Off by default (setting `backlinksInNote`); hidden in focus mode;
     split view's pane never shows it. -->
<script lang="ts">
  import { app } from "../../lib/app.svelte";
  import { noteDetails } from "../../lib/noteDetails.svelte";
  import LinkCards from "../inspector/LinkCards.svelte";

  const path = $derived(app.doc?.path ?? null);
  const active = $derived(app.settings.backlinksInNote && !app.focusMode);
  const details = noteDetails(
    () => path,
    () => active,
  );

  let root = $state<HTMLElement>();

  $effect(() => {
    if (!app.editorReady || !root) return;
    const scroller = document.querySelector<HTMLElement>("#editor .cm-scroller");
    if (scroller && root.parentElement !== scroller) scroller.appendChild(root);
    return () => root?.remove();
  });
</script>

<div class="hc-backlinks" class:shown={active && path !== null && details.current !== null} bind:this={root}>
  {#if active && path && details.current}
    <LinkCards {path} details={details.current} inNote />
  {/if}
</div>

<style>
  .hc-backlinks {
    /* A new row of the scroller's flex layout (EditorHost lets it wrap), the width of the text column. */
    display: none;
    flex: 0 0 100%;
    flex-direction: column;
    gap: 18px;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(var(--hc-line-width, 720px) + 64px);
    margin: 40px auto 0;
    padding: 20px 32px 0;
    border-top: 1px solid var(--ui-border);
    font-family: var(--ui-font, "Segoe UI", system-ui, sans-serif);
    font-size: 13px;
    line-height: 1.4;
    color: var(--ui-text);
    user-select: none;
  }
  .hc-backlinks.shown {
    display: flex;
  }
</style>
