<!-- Settings (§13): General / Appearance / Editor / Templates; the last tab is remembered.
     Toggles apply at once; text fields save shortly after typing stops and are trimmed on blur. -->
<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { Files, Palette, Settings2, Type, X } from "@lucide/svelte";
  import { dailyNotePath } from "@core/dailyNotes";
  import { FONT_SIZE_RANGE, LINE_WIDTH_RANGE, type Accent, type Appearance, type EditorFont, type Settings, type SettingsTab } from "@shared/settings";
  import { app } from "../../lib/app.svelte";
  import { accents } from "../../lib/theme";
  import Modal from "./Modal.svelte";
  import Segmented from "./Segmented.svelte";
  import Switch from "./Switch.svelte";

  const tabs: { value: SettingsTab; label: string; icon: typeof Settings2 }[] = [
    { value: "general", label: "General", icon: Settings2 },
    { value: "appearance", label: "Appearance", icon: Palette },
    { value: "editor", label: "Editor", icon: Type },
    { value: "templates", label: "Templates", icon: Files },
  ];
  const tab = $derived(app.settings.settingsTab);
  const s = $derived(app.settings);

  // ---- Text fields ----
  type TextKey = "attachmentFolder" | "templatesFolder" | "dailyNoteFolder" | "dailyNoteFormat" | "dailyNoteTemplate";
  const textKeys: TextKey[] = ["attachmentFolder", "templatesFolder", "dailyNoteFolder", "dailyNoteFormat", "dailyNoteTemplate"];
  let drafts = $state(Object.fromEntries(textKeys.map((key) => [key, app.settings[key]])) as Record<TextKey, string>);
  let editing = $state<TextKey | null>(null);
  const timers = new Map<TextKey, ReturnType<typeof setTimeout>>();

  // Follow changes made elsewhere, except in the field being edited.
  $effect(() => {
    for (const key of textKeys) {
      const value = app.settings[key];
      if (editing !== key) drafts[key] = value;
    }
  });

  function commit(key: TextKey, trim: boolean) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    let value = drafts[key];
    if (trim) {
      value = value.trim();
      drafts[key] = value;
    }
    if (value !== app.settings[key]) app.setSetting(key, value);
  }

  function onTextInput(key: TextKey) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => commit(key, false), 400));
  }

  function onTextBlur(key: TextKey) {
    editing = null;
    commit(key, true);
  }

  onDestroy(() => {
    for (const key of textKeys) if (timers.has(key) || editing === key) commit(key, true);
  });

  const todayExample = $derived(dailyNotePath(new Date(), drafts.dailyNoteFolder.trim(), drafts.dailyNoteFormat.trim()));

  function close() {
    app.settingsOpen = false;
  }

  const appearanceOptions: { value: Appearance; label: string }[] = [
    { value: "system", label: "Match System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];
  const fontOptions: { value: EditorFont; label: string }[] = [
    { value: "system", label: "System" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Monospaced" },
  ];
  const accentKeys = Object.keys(accents) as Accent[];

  function toggle(key: keyof Settings & ("reopenLastVault" | "updateLinksOnMove" | "nameNotesFromFirstLine" | "autoMergeExternalChanges" | "showFormattingBar" | "openDailyNoteOnLaunch")) {
    return (checked: boolean) => app.setSetting(key, checked);
  }

  const percent = (value: number, [lo, hi]: readonly [number, number]) => ((value - lo) / (hi - lo)) * 100;
</script>

{#snippet row(label: string, control: Snippet, help?: string, id?: string, stacked = false)}
  <div class="row" class:stacked>
    <div class="row-text">
      {#if id}<label class="row-label" for={id}>{label}</label>{:else}<span class="row-label">{label}</span>{/if}
      {#if help}<span class="row-help">{help}</span>{/if}
    </div>
    <div class="row-control">{@render control()}</div>
  </div>
{/snippet}

{#snippet switchRow(label: string, checked: boolean, onchange: (checked: boolean) => void, help?: string)}
  {#snippet control()}<Switch {label} {checked} {onchange} />{/snippet}
  {@render row(label, control, help)}
{/snippet}

{#snippet textField(key: TextKey, placeholder: string, label: string)}
  <input
    id="setting-{key}"
    class="text-field"
    {placeholder}
    aria-label={label}
    spellcheck="false"
    autocomplete="off"
    bind:value={drafts[key]}
    onfocus={() => (editing = key)}
    oninput={() => onTextInput(key)}
    onblur={() => onTextBlur(key)}
    onkeydown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }}
  />
{/snippet}

{#snippet textRow(key: TextKey, label: string, placeholder: string, help?: string)}
  {#snippet control()}{@render textField(key, placeholder, label)}{/snippet}
  {@render row(label, control, help, `setting-${key}`, Boolean(help))}
{/snippet}

{#snippet slider(key: "editorFontSize" | "editorLineWidth", range: readonly [number, number], step: number, label: string)}
  <div class="slider">
    <input
      type="range"
      min={range[0]}
      max={range[1]}
      {step}
      value={s[key]}
      aria-label={label}
      style:--pct="{percent(s[key], range)}%"
      oninput={(event) => app.setSetting(key, Number(event.currentTarget.value))}
    />
    <span class="slider-value">{s[key]} pt</span>
  </div>
{/snippet}

<Modal width={720} labelledby="settings-title" onclose={close} panelClass="settings">
  <header>
    <h2 id="settings-title">Settings</h2>
    <button class="icon-button" aria-label="Close" title="Close (Esc)" onclick={close}><X size={16} /></button>
  </header>

  <div class="body">
    <nav aria-label="Settings sections">
      {#each tabs as item (item.value)}
        <button class="nav-item" class:selected={tab === item.value} aria-current={tab === item.value ? "page" : undefined} onclick={() => app.setSetting("settingsTab", item.value)}>
          <item.icon size={16} />
          {item.label}
        </button>
      {/each}
    </nav>

    <div class="content">
      {#if tab === "general"}
        <div class="group">
          {@render switchRow("Reopen the last vault when Holocron starts", s.reopenLastVault, toggle("reopenLastVault"))}
        </div>
        <h3 class="section-label">Files</h3>
        <div class="group">
          {@render switchRow("Update links when renaming or moving notes", s.updateLinksOnMove, toggle("updateLinksOnMove"))}
          {@render switchRow("Name new notes from their first line", s.nameNotesFromFirstLine, toggle("nameNotesFromFirstLine"))}
        </div>
        <h3 class="section-label">Sync</h3>
        <div class="group">
          {@render switchRow(
            "Merge outside changes automatically when they don’t overlap",
            s.autoMergeExternalChanges,
            toggle("autoMergeExternalChanges"),
            "When another app or device changes a note you’re editing, Holocron combines both sets of changes if they touch different lines. Overlapping changes always ask first.",
          )}
        </div>
      {:else if tab === "appearance"}
        <div class="group">
          {#snippet appearance()}
            <Segmented label="Appearance" options={appearanceOptions} value={s.appearance} onchange={(value) => app.setSetting("appearance", value)} />
          {/snippet}
          {@render row("Appearance", appearance)}
          <div class="row stacked">
            <span class="row-label">Crystal</span>
            <div class="swatches" role="radiogroup" aria-label="Crystal">
              {#each accentKeys as accent (accent)}
                {@const selected = s.accent === accent}
                <button class="swatch" class:selected role="radio" aria-checked={selected} onclick={() => app.setSetting("accent", accent)}>
                  <span class="dot" style:--swatch={app.state.isDark ? accents[accent].dark : accents[accent].light}></span>
                  <span class="swatch-label">{accents[accent].title}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {:else if tab === "editor"}
        <div class="group">
          {@render switchRow("Show the formatting bar above notes", s.showFormattingBar, toggle("showFormattingBar"))}
          {#snippet font()}
            <Segmented label="Font" options={fontOptions} value={s.editorFont} onchange={(value) => app.setSetting("editorFont", value)} />
          {/snippet}
          {@render row("Font", font)}
          {#snippet size()}{@render slider("editorFontSize", FONT_SIZE_RANGE, 1, "Text size")}{/snippet}
          {@render row("Text size", size)}
          {#snippet width()}{@render slider("editorLineWidth", LINE_WIDTH_RANGE, 20, "Line width")}{/snippet}
          {@render row("Line width", width)}
        </div>
        <div class="group">
          {@render textRow(
            "attachmentFolder",
            "Attachment folder",
            "Vault root",
            "Pasted images and files dropped in from outside the vault are saved here, relative to the vault. Leave it empty to use the vault root.",
          )}
        </div>
      {:else}
        <h3 class="section-label first">Templates</h3>
        <div class="group">
          {@render textRow(
            "templatesFolder",
            "Templates folder",
            "Templates",
            "Notes in this folder are offered by Insert Template… (Ctrl+Alt+T) and New Note from Template… (Ctrl+Shift+N). They can use {{title}}, {{date}}, {{date:dddd, MMMM D}}, {{time}} and {{cursor}} — where the cursor goes. A template’s properties are merged into the note’s.",
          )}
        </div>
        <h3 class="section-label">Daily notes</h3>
        <div class="group">
          {@render textRow("dailyNoteFolder", "Folder", "Vault root")}
          {@render textRow(
            "dailyNoteFormat",
            "Date format",
            "YYYY-MM-DD",
            "Uses Obsidian’s date format: YYYY year, MM month, DD day, dddd weekday. A “/” makes subfolders, e.g. YYYY/MM/YYYY-MM-DD.",
          )}
          {#snippet example()}<span class="example" title={todayExample}>{todayExample}</span>{/snippet}
          {@render row("Today’s note", example)}
          {@render textRow(
            "dailyNoteTemplate",
            "Daily note template",
            "None",
            "A note to copy into each new daily note, e.g. Templates/Daily. It can use {{date}}, {{date:dddd, MMMM D}}, {{time}}, {{title}}, {{yesterday}} and {{tomorrow}}.",
          )}
          {@render switchRow("Open today’s note when Holocron starts", s.openDailyNoteOnLaunch, toggle("openDailyNoteOnLaunch"))}
        </div>
      {/if}
    </div>
  </div>
</Modal>

<style>
  :global(.panel.settings) {
    height: min(600px, calc(100vh - 48px));
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 10px 0 20px;
    border-bottom: 1px solid var(--ui-border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  nav {
    flex: none;
    width: 168px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid var(--ui-border);
    background: var(--ui-panel);
  }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 13px;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .nav-item:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .nav-item.selected {
    background: var(--ui-chip);
    color: var(--ui-text);
    font-weight: 500;
  }
  .nav-item.selected::before {
    content: "";
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 2px;
    background: var(--ui-accent);
  }
  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 18px 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    margin: 12px 0 0;
    padding: 0 2px;
  }
  h3.first {
    margin-top: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-raised);
  }
  .group + .group {
    margin-top: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 52px;
    padding: 10px 14px;
  }
  .row + .row {
    border-top: 1px solid var(--ui-border);
  }
  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .row.stacked .row-control {
    max-width: none;
  }
  .row.stacked .text-field {
    width: 100%;
    max-width: 360px;
  }
  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row-label {
    font-size: 13px;
    color: var(--ui-text);
  }
  .row-help {
    font-size: 12px;
    line-height: 1.45;
    color: var(--ui-text-2);
    user-select: text;
  }
  .row-control {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    max-width: 62%;
  }
  .row-control :global(.segmented) {
    width: 264px;
    max-width: 100%;
  }
  .text-field {
    width: 220px;
    max-width: 100%;
  }
  .example {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    font-size: 12px;
    color: var(--ui-text-2);
    user-select: text;
  }

  .swatches {
    display: flex;
    gap: 8px;
  }
  .swatch {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 6px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12px;
    transition: background 0.12s, border-color 0.12s;
  }
  .swatch:hover {
    background: var(--ui-chip);
  }
  .swatch.selected {
    border-color: var(--ui-strong-border);
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 2px var(--ui-raised), 0 0 0 4px transparent;
    transition: box-shadow 0.15s;
  }
  .swatch.selected .dot {
    box-shadow: 0 0 0 2px var(--ui-chip), 0 0 0 4px var(--swatch), 0 0 12px color-mix(in srgb, var(--swatch) 50%, transparent);
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 264px;
    max-width: 100%;
  }
  .slider input {
    flex: 1;
    min-width: 80px;
    height: 20px;
    margin: 0;
    background: transparent;
    appearance: none;
  }
  .slider input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--ui-accent) var(--pct), var(--ui-strong-border) var(--pct));
  }
  .slider input::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    margin-top: -7px;
    border: 4px solid var(--ui-accent);
    border-radius: 50%;
    background: var(--ui-raised);
    box-shadow: 0 0 0 1px var(--ui-strong-border);
    transition: border-width 0.1s;
  }
  .slider input:hover::-webkit-slider-thumb {
    border-width: 3px;
  }
  .slider input:active::-webkit-slider-thumb {
    border-width: 5px;
  }
  .slider-value {
    flex: none;
    width: 52px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ui-text-2);
  }
</style>
