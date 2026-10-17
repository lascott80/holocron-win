<!-- The sidebar's Tasks mode (TSK-02): every open checklist item in the vault,
     grouped by note. Ticking a box toggles it in the note; clicking the text
     reveals the line. A filter box narrows by text or, with "#tag", by tag. -->
<script lang="ts">
  import { ChevronRight, CircleX, ListChecks } from "@lucide/svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { NoteTasks } from "@core/vaultIndex";
  import { plainText } from "@core/noteParser";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";

  let notes = $state<NoteTasks[]>([]);
  let request = 0;
  let filter = $state("");
  let includeDone = $state(false);
  let field = $state<HTMLInputElement>();
  const collapsed = new SvelteSet<string>();

  const revision = $derived(app.vault?.indexRevision ?? -1);
  const root = $derived(app.vault?.root ?? "");

  /** "#tag words" → tag filter plus words; the tag goes to main, the words filter here. */
  const parsed = $derived.by(() => {
    const words: string[] = [];
    let tag: string | null = null;
    for (const token of filter.trim().split(/\s+/).filter(Boolean)) {
      if (token.startsWith("#") && token.length > 1 && tag === null) tag = token.slice(1);
      else words.push(token.toLowerCase());
    }
    return { tag, words };
  });

  $effect(() => {
    void revision;
    void root;
    const tag = parsed.tag;
    const done = includeDone;
    const id = ++request;
    call<NoteTasks[] | undefined>("allTasks", done, tag)
      .then((result) => {
        if (id === request) notes = result ?? [];
      })
      .catch((error: unknown) => console.error("[allTasks]", error));
  });

  const shown = $derived.by(() => {
    const words = parsed.words;
    if (words.length === 0) return notes;
    return notes
      .map((note) => {
        const noteMatches = words.every((word) => note.title.toLowerCase().includes(word));
        const tasks = noteMatches ? note.tasks : note.tasks.filter((task) => words.every((word) => task.text.toLowerCase().includes(word)));
        return { ...note, tasks };
      })
      .filter((note) => note.tasks.length > 0);
  });

  const openCount = $derived(shown.reduce((sum, note) => sum + note.tasks.filter((task) => !task.done).length, 0));
  const summary = $derived.by(() => {
    if (!app.vault) return "";
    if (shown.length === 0) return filter.trim() ? "No matching tasks" : includeDone ? "No tasks in this vault" : "Nothing left to do";
    const tasks = openCount === 1 ? "1 open task" : `${openCount.toLocaleString()} open tasks`;
    return `${tasks} in ${shown.length === 1 ? "1 note" : `${shown.length.toLocaleString()} notes`}`;
  });

  function toggle(note: NoteTasks, line: number) {
    run("toggleTask", note.path, line);
  }

  function reveal(note: NoteTasks, line: number) {
    run("reveal", note.path, line, 0, 0);
  }

  function toggleNote(path: string) {
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && filter) {
      event.preventDefault();
      filter = "";
    }
  }
</script>

<div class="tasks-panel">
  <div class="field">
    <ListChecks size={14} />
    <input bind:this={field} bind:value={filter} type="text" placeholder="Filter tasks (#tag for a tag)" aria-label="Filter tasks" spellcheck="false" onkeydown={onKeydown} />
    {#if filter}
      <button class="clear" title="Clear filter" aria-label="Clear filter" onclick={() => ((filter = ""), field?.focus())}>
        <CircleX size={14} />
      </button>
    {/if}
    <button class="option" class:on={includeDone} title="Show completed tasks" aria-label="Show completed tasks" aria-pressed={includeDone} onclick={() => (includeDone = !includeDone)}>✓</button>
  </div>

  <div class="summary">{summary}</div>

  <div class="list">
    {#each shown as note (note.path)}
      {@const open = !collapsed.has(note.path)}
      <div class="note">
        <div class="note-header">
          <button class="disclosure" class:open aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onclick={() => toggleNote(note.path)}>
            <ChevronRight size={13} strokeWidth={2.25} />
          </button>
          <button class="note-title" title={note.path} onclick={() => run("open", note.path, false)}>
            <span class="title">{note.title}</span>
            <span class="count-chip">{note.open}{note.total !== note.open ? `/${note.total}` : ""}</span>
          </button>
        </div>
        {#if open}
          {#each note.tasks as task (task.line)}
            <div class="task" class:done={task.done} style:padding-left="{30 + Math.min(task.indent, 12) * 6}px">
              <button
                class="box"
                class:custom={!task.done && task.status !== " "}
                role="checkbox"
                aria-checked={task.done}
                aria-label={task.done ? "Mark as not done" : "Mark as done"}
                title={task.status !== " " && !task.done ? `Status [${task.status}] — click to complete` : task.done ? "Done — click to reopen" : "Click to complete"}
                onclick={() => toggle(note, task.line)}
              >
                {#if task.done}✓{:else if task.status !== " "}{task.status}{/if}
              </button>
              <button class="text" title="Line {task.line}" onclick={() => reveal(note, task.line)}>{plainText(task.text) || "(empty)"}</button>
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tasks-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 0 10px 6px;
    padding: 0 4px 0 9px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: var(--ui-chip);
    color: var(--ui-text-3);
  }
  .field:focus-within {
    border-color: rgba(var(--ui-accent-rgb), 0.6);
    box-shadow: 0 0 0 3px rgba(var(--ui-accent-rgb), 0.14);
  }
  .field :global(svg) {
    flex: none;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    outline: none;
  }
  input::placeholder {
    color: var(--ui-text-3);
  }
  .clear {
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-3);
  }
  .clear:hover {
    color: var(--ui-text);
  }
  .option {
    flex: none;
    width: 24px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12px;
    font-weight: 700;
  }
  .option:hover:not(.on) {
    background: color-mix(in srgb, var(--ui-strong-border) 55%, transparent);
    color: var(--ui-text);
  }
  .option.on {
    background: var(--ui-fill);
    color: #fff;
  }
  .summary {
    flex: none;
    padding: 0 14px 6px;
    font-size: 11.5px;
    color: var(--ui-text-3);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 8px;
  }
  .note + .note {
    margin-top: 4px;
  }
  .note-header {
    display: flex;
    align-items: center;
    height: 26px;
    margin: 0 6px;
    border-radius: 6px;
  }
  .note-header:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .disclosure {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text-3);
  }
  .disclosure :global(svg) {
    transition: transform 0.12s ease-out;
  }
  .disclosure.open :global(svg) {
    transform: rotate(90deg);
  }
  .note-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 8px 0 0;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text);
    font-size: 13px;
    font-weight: 500;
  }
  .count-chip {
    flex: none;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--ui-chip);
    color: var(--ui-text-2);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 6px;
    padding: 3px 8px 3px 30px;
    border-radius: 6px;
  }
  .task:hover {
    background: color-mix(in srgb, var(--ui-chip) 75%, transparent);
  }
  .box {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    padding: 0;
    border: 1px solid var(--ui-strong-border);
    border-radius: 4px;
    background: var(--ui-editor);
    color: var(--ui-text-2);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .box:hover {
    border-color: var(--ui-accent);
  }
  .box.custom {
    color: var(--ui-warning);
  }
  .done .box {
    background: var(--ui-fill);
    border-color: transparent;
    color: #fff;
  }
  .text {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font-size: 12.5px;
    line-height: 1.45;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .done .text {
    color: var(--ui-text-3);
    text-decoration: line-through;
  }
</style>
