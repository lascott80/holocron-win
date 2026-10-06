<!-- The formatting bar above the editor (UI-06). Each button runs the same
     command as its menu item / shortcut; the tooltip shows the markdown it writes. -->
<script lang="ts">
  import {
    Bold,
    Braces,
    CircleQuestionMark,
    Code,
    Heading,
    Highlighter,
    Italic,
    Link,
    List,
    ListChecks,
    ListOrdered,
    MessageSquareWarning,
    Minus,
    Strikethrough,
    Table,
    TextQuote,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import Popover from "./Popover.svelte";
  import TableSizePicker from "./TableSizePicker.svelte";
  import CheatSheet from "./CheatSheet.svelte";
  import { commandById, runCommand } from "../../lib/commands";
  import { editor } from "../../lib/host";
  import { menu } from "../../lib/menu.svelte";

  interface Button {
    id: string;
    title: string;
    markdown: string;
    icon: Component<{ size?: number; strokeWidth?: number }>;
  }

  const inline: Button[] = [
    { id: "bold", title: "Bold", markdown: "**text**", icon: Bold },
    { id: "italic", title: "Italic", markdown: "*text*", icon: Italic },
    { id: "strikethrough", title: "Strikethrough", markdown: "~~text~~", icon: Strikethrough },
    { id: "highlight", title: "Highlight", markdown: "==text==", icon: Highlighter },
    { id: "code", title: "Inline Code", markdown: "`code`", icon: Code },
    { id: "link", title: "Link", markdown: "[text](url) — or type [[ for a note link", icon: Link },
  ];
  const lists: Button[] = [
    { id: "bulletList", title: "Bulleted List", markdown: "- item", icon: List },
    { id: "numberedList", title: "Numbered List", markdown: "1. item", icon: ListOrdered },
    { id: "task", title: "Checklist", markdown: "- [ ] task", icon: ListChecks },
    { id: "quote", title: "Quote", markdown: "> quote", icon: TextQuote },
  ];
  const codeBlock: Button = { id: "codeBlock", title: "Code Block", markdown: "```language … ```", icon: Braces };
  const blocks: Button[] = [
    { id: "callout", title: "Callout", markdown: "> [!note] Title", icon: MessageSquareWarning },
    { id: "divider", title: "Divider", markdown: "---", icon: Minus },
  ];

  function tooltip(button: Button) {
    const shortcut = commandById.get(button.id)?.shortcut;
    return `${button.title} — ${button.markdown}` + (shortcut ? ` (${shortcut})` : "");
  }

  const headingShortcut = (commandById.get("heading1")?.shortcut ?? "Ctrl+Alt+1").replace(/1$/, "1–3");

  let headingButton = $state<HTMLButtonElement>();
  let headingOpen = $state(false);
  let tableButton = $state<HTMLButtonElement>();
  let tableOpen = $state(false);
  let helpButton = $state<HTMLButtonElement>();
  let helpOpen = $state(false);

  function openHeadingMenu() {
    if (headingOpen) {
      menu.close();
      return;
    }
    if (!headingButton) return;
    headingOpen = true;
    const item = (id: string) => ({ label: commandById.get(id)?.title ?? id, shortcut: commandById.get(id)?.shortcut, run: () => runCommand(id) });
    menu.openBelow(headingButton, [item("heading1"), item("heading2"), item("heading3"), "-", item("heading0")], {
      onClose: () => (headingOpen = false),
    });
  }

  function insertTable(bodyRows: number, columns: number) {
    tableOpen = false;
    editor()?.insertTable(bodyRows, columns);
    editor()?.focus();
  }

  /** Toolbar buttons don't take focus from the editor. */
  const keepFocus = (event: MouseEvent) => event.preventDefault();
</script>

{#snippet format(button: Button)}
  <button class="format-button" title={tooltip(button)} aria-label={button.title} onmousedown={keepFocus} onclick={() => runCommand(button.id)}>
    <button.icon size={15} strokeWidth={1.9} />
  </button>
{/snippet}

<div class="formatting-bar" role="toolbar" aria-label="Formatting">
  <div class="group">
    {#each inline as button (button.id)}{@render format(button)}{/each}
  </div>
  <div class="separator"></div>
  <div class="group">
    <button
      class="format-button"
      class:open={headingOpen}
      title="Heading — # Heading, ## Heading… ({headingShortcut})"
      aria-label="Heading"
      aria-haspopup="menu"
      aria-expanded={headingOpen}
      data-menu-trigger
      bind:this={headingButton}
      onmousedown={keepFocus}
      onclick={openHeadingMenu}
    >
      <Heading size={15} strokeWidth={1.9} />
    </button>
    {#each lists as button (button.id)}{@render format(button)}{/each}
  </div>
  <div class="separator"></div>
  <div class="group">
    {@render format(codeBlock)}
    <button
      class="format-button"
      class:open={tableOpen}
      title="Table — pick a size, or type | a | b | and press Enter"
      aria-label="Table"
      aria-haspopup="dialog"
      aria-expanded={tableOpen}
      bind:this={tableButton}
      onclick={() => (tableOpen = !tableOpen)}
    >
      <Table size={15} strokeWidth={1.9} />
    </button>
    {#each blocks as button (button.id)}{@render format(button)}{/each}
  </div>
  <div class="spacer"></div>
  <button
    class="format-button"
    class:open={helpOpen}
    title="Markdown cheat sheet"
    aria-label="Markdown Help"
    aria-haspopup="dialog"
    aria-expanded={helpOpen}
    bind:this={helpButton}
    onclick={() => (helpOpen = !helpOpen)}
  >
    <CircleQuestionMark size={15} strokeWidth={1.9} />
  </button>
</div>

{#if tableOpen}
  <Popover anchor={tableButton} label="Insert table" onclose={() => (tableOpen = false)}>
    <TableSizePicker onpick={insertTable} />
  </Popover>
{/if}
{#if helpOpen}
  <Popover anchor={helpButton} align="end" label="Markdown cheat sheet" onclose={() => (helpOpen = false)}>
    <CheatSheet />
  </Popover>
{/if}

<style>
  .formatting-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 34px;
    flex: none;
    padding: 0 12px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-editor);
    overflow: hidden;
  }
  .group {
    display: flex;
    flex: none;
  }
  .separator {
    flex: none;
    width: 1px;
    height: 16px;
    margin: 0 6px;
    background: var(--ui-border);
  }
  .spacer {
    flex: 1;
    min-width: 8px;
  }
  .format-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ui-text-2);
  }
  .format-button:hover,
  .format-button.open {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .format-button:active {
    background: color-mix(in srgb, var(--ui-chip) 70%, var(--ui-strong-border));
  }
</style>
