<!-- Choose a template to insert (Ctrl+Alt+T) or to start a new note from
     (Ctrl+Shift+N); for a new note a second step asks for its name (UI-25). -->
<script lang="ts">
  import { tick } from "svelte";
  import { Files, FileText, FilePlus2 } from "@lucide/svelte";
  import { fuzzyMatch } from "@core/quickOpen";
  import { dirname, stem } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Highlighted from "./Highlighted.svelte";

  const mode = $derived(app.templatePicker ?? "insert");
  const templates = $derived(app.vault?.templates ?? []);
  const folderSetting = $derived(app.settings.templatesFolder.trim().replace(/^\/+|\/+$/g, ""));

  let query = $state("");
  let selected = $state(0);
  let chosen = $state<string | null>(null);
  let noteName = $state("");
  let list = $state<HTMLDivElement>();
  let nameField = $state<HTMLInputElement>();

  const matches = $derived.by(() => {
    const text = query.trim();
    if (!text) return templates.map((path) => ({ path, indices: [] as number[] }));
    return templates
      .map((path) => ({ path, match: fuzzyMatch(text, stem(path)) }))
      .filter((item) => item.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score)
      .map(({ path, match }) => ({ path, indices: match!.indices }));
  });

  $effect(() => {
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
  });

  /** The subfolder inside the templates folder ("" at its top level). */
  function subfolder(path: string) {
    const folder = dirname(path);
    const root = folderSetting;
    if (folder === root) return "";
    if (root && folder.startsWith(root + "/")) return folder.slice(root.length + 1);
    return folder;
  }

  function close() {
    app.templatePicker = null;
  }

  async function pick(path: string | undefined) {
    if (!path) return;
    if (mode === "insert") {
      close();
      run("insertTemplate", path);
      return;
    }
    chosen = path;
    noteName = "";
    await tick();
    nameField?.focus();
  }

  function create() {
    if (!chosen) return;
    const template = chosen;
    const name = noteName;
    close();
    run("createNoteFromTemplate", template, name);
  }

  function move(step: number) {
    if (matches.length === 0) return;
    selected = Math.max(0, Math.min(matches.length - 1, selected + step));
    void tick().then(() => {
      const row = list?.querySelector<HTMLElement>(`[data-row="${selected}"]`);
      if (!row || !list) return;
      const box = list.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      if (rect.top < box.top + 6) list.scrollTop -= box.top + 6 - rect.top;
      else if (rect.bottom > box.bottom - 6) list.scrollTop += rect.bottom - box.bottom + 6;
    });
  }

  function onSearchKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Enter":
        if (event.isComposing) return;
        void pick(matches[selected]?.path);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onNameKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    create();
  }
</script>

<Modal width={520} placement="top" closeOnBackdrop label={mode === "insert" ? "Insert template" : "New note from template"} onclose={close}>
  {#if chosen}
    <div class="name-step">
      <div class="step-title"><FilePlus2 size={14} />New note from “{stem(chosen)}”</div>
      <input
        class="name-field"
        bind:this={nameField}
        bind:value={noteName}
        data-autofocus
        placeholder="Note name"
        spellcheck="false"
        autocomplete="off"
        aria-label="Note name"
        onkeydown={onNameKeydown}
      />
      <div class="step-hint">↵ create · esc cancel</div>
    </div>
  {:else}
    <div class="search">
      <Files size={17} />
      <input
        bind:value={query}
        data-autofocus
        placeholder={mode === "insert" ? "Insert template" : "New note from template"}
        spellcheck="false"
        autocomplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="tp-list"
        aria-activedescendant={matches.length ? `tp-row-${selected}` : undefined}
        oninput={() => {
          selected = 0;
          if (list) list.scrollTop = 0;
        }}
        onkeydown={onSearchKeydown}
      />
      <span class="keycap">esc</span>
    </div>

    {#if templates.length === 0}
      <div class="no-templates">
        <div class="no-templates-title">No templates yet</div>
        <p>
          Add notes to the “{folderSetting || "Templates"}” folder and they’ll appear here. Templates can use {"{{title}}"}, {"{{date}}"}, {"{{time}}"} and
          {"{{cursor}}"}. Change the folder in Settings › Templates.
        </p>
      </div>
    {:else if matches.length === 0}
      <div class="empty">No matching templates</div>
    {:else}
      <div class="results" id="tp-list" role="listbox" aria-label="Templates" bind:this={list}>
        {#each matches as match, index (match.path)}
          {@const folder = subfolder(match.path)}
          <div
            class="row"
            class:selected={index === selected}
            role="option"
            tabindex="-1"
            aria-selected={index === selected}
            id="tp-row-{index}"
            data-row={index}
            onpointermove={() => (selected = index)}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => void pick(match.path)}
            onkeydown={() => {}}
          >
            <span class="icon"><FileText size={15} /></span>
            <span class="title"><Highlighted text={stem(match.path)} indices={match.indices} /></span>
            {#if folder}<span class="folder" title={folder}>{folder.split("/").join(" / ")}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</Modal>

<style>
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    padding: 0 16px;
    color: var(--ui-text-2);
  }
  .search input,
  .name-field {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font-size: 16px;
    outline: none;
  }
  .search input::placeholder,
  .name-field::placeholder {
    color: var(--ui-faint);
  }
  .search .keycap {
    color: var(--ui-text-3);
  }
  .results,
  .no-templates,
  .empty {
    border-top: 1px solid var(--ui-border);
  }
  .results {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    overscroll-behavior: contain;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 14px;
    color: var(--ui-text);
    --match-color: var(--ui-accent-text);
  }
  .row:not(.selected):hover {
    background: var(--ui-chip);
  }
  .row.selected {
    background: var(--ui-fill);
    color: #fff;
    --match-color: #fff;
  }
  .icon {
    flex: none;
    display: inline-flex;
    color: var(--ui-text-2);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    flex: 0 1 auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ui-text-3);
  }
  .row.selected .icon,
  .row.selected .folder {
    color: rgba(255, 255, 255, 0.8);
  }
  .no-templates {
    padding: 16px;
  }
  .no-templates-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .no-templates p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ui-text-2);
    user-select: text;
  }
  .empty {
    padding: 20px 0;
    text-align: center;
    color: var(--ui-text-3);
  }
  .name-step {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
  }
  .step-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name-field {
    height: 30px;
  }
  .step-hint {
    font-size: 11px;
    color: var(--ui-text-3);
  }
</style>
