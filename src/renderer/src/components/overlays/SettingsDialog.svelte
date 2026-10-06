<!-- Settings (§13): General / Appearance / Editor / Templates; the last tab is remembered.
     Toggles apply at once; text fields save shortly after typing stops and are trimmed on blur. -->
<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { Files, Palette, Settings2, Type, X } from "@lucide/svelte";
  import { dailyNotePath } from "@core/dailyNotes";
  import {
    defaultSettings,
    FONT_SIZE_RANGE,
    LINE_WIDTH_RANGE,
    normalizeShortcut,
    shortcutLabel,
    type Accent,
    type Appearance,
    type CaptureTarget,
    type EditorFont,
    type Settings,
    type SettingsTab,
  } from "@shared/settings";
  import { app } from "../../lib/app.svelte";
  import { commands } from "../../lib/commands";
  import { run } from "../../lib/host";
  import { accents, activeTheme, darkThemes, lightThemes } from "../../lib/theme";
  import { accentColors } from "@shared/themes";
  import ThemePicker from "./ThemePicker.svelte";
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
  type TextKey = "attachmentFolder" | "templatesFolder" | "dailyNoteFolder" | "dailyNoteFormat" | "dailyNoteTemplate" | "quickCaptureInbox";
  const textKeys: TextKey[] = ["attachmentFolder", "templatesFolder", "dailyNoteFolder", "dailyNoteFormat", "dailyNoteTemplate", "quickCaptureInbox"];
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
    stopRecording();
  });

  // ---- Quick capture shortcut recorder ----
  // Focus the field and press the keys; Esc cancels. While recording, the current
  // global shortcut is released so it can be pressed (and recorded) again.
  let recording = $state(false);
  let shortcutProblem = $state<string | null>(null);
  const captureTargets: { value: CaptureTarget; label: string }[] = [
    { value: "daily", label: "Today’s note" },
    { value: "inbox", label: "Inbox note" },
  ];

  const CODE_KEYS: Record<string, string> = {
    Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Enter", NumpadEnter: "Enter",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
    NumpadDecimal: "numdec", NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv",
  };

  /** The key part of an accelerator, from the physical key (so AltGr layouts and Shift don't change it). */
  function keyFromCode(code: string): string | null {
    let match: RegExpMatchArray | null;
    if ((match = code.match(/^Key([A-Z])$/))) return match[1]!;
    if ((match = code.match(/^Digit([0-9])$/))) return match[1]!;
    if ((match = code.match(/^Numpad([0-9])$/))) return `num${match[1]}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return CODE_KEYS[code] ?? null;
  }

  function startRecording() {
    if (recording) return;
    recording = true;
    shortcutProblem = null;
    run("suspendCaptureShortcut", true);
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    run("suspendCaptureShortcut", false);
  }

  function setShortcut(shortcut: string) {
    shortcutProblem = null;
    // Saved while still suspended; un-suspending then registers the new one.
    if (shortcut !== app.settings.quickCaptureShortcut) app.setSetting("quickCaptureShortcut", shortcut);
    if (recording) stopRecording();
    else {
      run("suspendCaptureShortcut", true);
      run("suspendCaptureShortcut", false);
    }
  }

  function onRecorderKeydown(event: KeyboardEvent) {
    if (!recording) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        startRecording();
      }
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      stopRecording();
      return; // let focus move on
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    if (["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"].includes(event.key)) return; // wait for the key
    const key = keyFromCode(event.code);
    const parts = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super", key].filter(Boolean);
    const shortcut = key ? normalizeShortcut(parts.join("+")) : null;
    if (!shortcut) {
      shortcutProblem = "Use Ctrl, Alt or the Windows key together with another key.";
      return;
    }
    const clash = commands.find((command) => !command.globalShortcut && [command.shortcut, ...(command.alsoKeys ?? [])].some((s) => s && normalizeShortcut(s) === shortcut));
    if (clash) {
      shortcutProblem = `Holocron already uses ${shortcutLabel(shortcut)} for “${clash.title}”.`;
      return;
    }
    setShortcut(shortcut);
  }

  const captureError = $derived(shortcutProblem ?? (s.quickCaptureEnabled && !recording ? app.state.quickCapture.error : null));

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
  const accentKeys = ["theme", ...Object.keys(accents)] as Accent[];
  /** The theme on screen: its accent is what "Theme default" shows. */
  const shownTheme = $derived(activeTheme(app.state.isDark, s));
  const accentTitle = (accent: Accent) => (accent === "theme" ? "Theme default" : accents[accent].title);

  function toggle(
    key: keyof Settings &
      (
        | "reopenLastVault"
        | "updateLinksOnMove"
        | "nameNotesFromFirstLine"
        | "autoMergeExternalChanges"
        | "showFormattingBar"
        | "openDailyNoteOnLaunch"
        | "readableLineLength"
        | "checkForUpdates"
        | "quickCaptureEnabled"
        | "runInBackground"
        | "launchAtLogin"
      ),
  ) {
    return (checked: boolean) => app.setSetting(key, checked);
  }

  const percent = (value: number, [lo, hi]: readonly [number, number]) => ((value - lo) / (hi - lo)) * 100;

  // ---- Updates ----
  const update = $derived(app.state.update);
  const updateStatus = $derived.by(() => {
    const checked = update.lastChecked ? `Last checked ${new Date(update.lastChecked).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.` : "";
    switch (update.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Version ${update.version} is available.`;
      case "downloading":
        return `Downloading version ${update.version}… ${Math.round(update.percent ?? 0)}%`;
      case "downloaded":
        return `Version ${update.version} is ready to install.`;
      case "not-available":
        return `Holocron is up to date. ${checked}`.trim();
      case "error":
        return `${update.error ?? "Couldn’t check for updates."} ${checked}`.trim();
      default:
        return checked || "Not checked yet.";
    }
  });
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
          {@render switchRow(
            "Keep Holocron running in the background when the window is closed",
            s.runInBackground,
            toggle("runInBackground"),
            "Closing the window hides Holocron in the notification area, so quick capture keeps working. Quit from the tray icon or File › Exit Holocron.",
          )}
          {@render switchRow(
            "Start Holocron when you sign in to Windows",
            s.launchAtLogin,
            toggle("launchAtLogin"),
            s.runInBackground ? "It starts in the background, ready for quick capture." : "It opens its window when you sign in.",
          )}
        </div>
        <h3 class="section-label">Quick capture</h3>
        <div class="group">
          {@render switchRow(
            "Open quick capture with a keyboard shortcut from any app",
            s.quickCaptureEnabled,
            toggle("quickCaptureEnabled"),
            "A small window for jotting something down without switching to Holocron. Ctrl+Enter saves it; Esc cancels.",
          )}
          <div class="row">
            <div class="row-text">
              <span class="row-label" id="capture-shortcut-label">Shortcut</span>
              {#if captureError}
                <span class="row-help error" role="alert">{captureError}</span>
              {:else}
                <span class="row-help">{recording ? "Press the new shortcut, or Esc to keep the current one." : "Click the field, then press the keys you want."}</span>
              {/if}
            </div>
            <div class="row-control shortcut">
              <button
                class="text-field recorder"
                class:recording
                data-shortcut-recorder
                aria-labelledby="capture-shortcut-label"
                disabled={!s.quickCaptureEnabled}
                onclick={startRecording}
                onkeydown={onRecorderKeydown}
                onblur={stopRecording}
              >
                {recording ? "Press keys…" : shortcutLabel(s.quickCaptureShortcut)}
              </button>
              <button
                class="button"
                disabled={!s.quickCaptureEnabled || (s.quickCaptureShortcut === defaultSettings.quickCaptureShortcut && !app.state.quickCapture.error)}
                onclick={() => setShortcut(defaultSettings.quickCaptureShortcut)}
              >
                Reset
              </button>
            </div>
          </div>
          {#snippet captureTarget()}
            <Segmented label="Save captures to" options={captureTargets} value={s.quickCaptureTarget} onchange={(value) => app.setSetting("quickCaptureTarget", value)} />
          {/snippet}
          {@render row("Save captures to", captureTarget, "Each capture is added at the end as a bullet with the time, e.g. “- 14:32 Call Ahsoka”. You can switch for one capture in its window.")}
          {@render textRow("quickCaptureInbox", "Inbox note", "Inbox.md", "A note in the vault, e.g. Inbox.md or Notes/Inbox. It’s created if it doesn’t exist.")}
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
        <h3 class="section-label">Updates</h3>
        <div class="group">
          {@render switchRow(
            "Check for updates automatically",
            s.checkForUpdates,
            toggle("checkForUpdates"),
            "Holocron asks before downloading or installing anything.",
          )}
          {#snippet updateControl()}
            {#if update.status === "downloaded"}
              <button class="button primary" onclick={() => run("installUpdate")}>Restart to Update</button>
            {:else}
              <button class="button" disabled={update.status === "checking" || update.status === "downloading"} onclick={() => run("checkForUpdates")}>Check for Updates</button>
            {/if}
          {/snippet}
          {@render row(`Holocron ${update.currentVersion || app.state.version}`, updateControl, updateStatus)}
        </div>
      {:else if tab === "appearance"}
        <div class="group">
          {#snippet appearance()}
            <Segmented label="Appearance" options={appearanceOptions} value={s.appearance} onchange={(value) => app.setSetting("appearance", value)} />
          {/snippet}
          {@render row("Appearance", appearance)}
          <div class="row stacked">
            <span class="row-label">Dark theme{#if app.state.isDark}<span class="in-use">In use</span>{/if}</span>
            <ThemePicker label="Dark theme" themes={darkThemes} value={s.darkTheme} accent={s.accent} onchange={(id) => app.setSetting("darkTheme", id)} />
          </div>
          <div class="row stacked">
            <span class="row-label">Light theme{#if !app.state.isDark}<span class="in-use">In use</span>{/if}</span>
            <ThemePicker label="Light theme" themes={lightThemes} value={s.lightTheme} accent={s.accent} onchange={(id) => app.setSetting("lightTheme", id)} />
          </div>
          <div class="row stacked">
            <span class="row-label">Crystal</span>
            <div class="swatches" role="radiogroup" aria-label="Crystal">
              {#each accentKeys as accent (accent)}
                {@const selected = s.accent === accent}
                <button class="swatch" class:selected role="radio" aria-checked={selected} title={accent === "theme" ? `${shownTheme.name}’s own accent` : undefined} onclick={() => app.setSetting("accent", accent)}>
                  <span class="dot" style:--swatch={accentColors(shownTheme, accent).glyph}></span>
                  <span class="swatch-label">{accentTitle(accent)}</span>
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
          {@render switchRow("Readable line length — limit the text width instead of filling the window", s.readableLineLength, toggle("readableLineLength"))}
          {#if s.readableLineLength}
            {#snippet width()}{@render slider("editorLineWidth", LINE_WIDTH_RANGE, 20, "Line width")}{/snippet}
            {@render row("Line width", width)}
          {/if}
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
  .row-help.error {
    color: var(--ui-danger);
  }
  .shortcut {
    gap: 8px;
  }
  .recorder {
    min-width: 150px;
    text-align: center;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .recorder.recording {
    border-color: var(--ui-accent);
    box-shadow: 0 0 0 3px rgba(var(--ui-accent-rgb), 0.18);
    color: var(--ui-accent-text);
  }
  .recorder:disabled {
    opacity: 0.45;
    cursor: default;
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
  .in-use {
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: 9px;
    background: rgba(var(--ui-accent-rgb), 0.14);
    color: var(--ui-accent-text);
    font-size: 11px;
    font-weight: 600;
  }
  .swatch {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 4px 10px;
    white-space: nowrap;
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
