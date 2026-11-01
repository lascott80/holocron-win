<!-- Settings (§13): General / Appearance / Editor / Hotkeys / Templates; the last tab is remembered.
     Toggles apply at once; text fields save shortly after typing stops and are trimmed on blur. -->
<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { Files, Keyboard, Palette, RotateCcw, Settings2, Type, X } from "@lucide/svelte";
  import { hotkeyConflicts, recordHotkey } from "@shared/hotkeys";
  import { dailyNotePath } from "@core/dailyNotes";
  import {
    defaultSettings,
    FONT_SIZE_RANGE,
    LINE_WIDTH_RANGE,
    LINE_HEIGHT_RANGE,
    MAX_SPELL_CHECK_LANGUAGES,
    normalizeShortcut,
    shortcutLabel,
    type Accent,
    type Appearance,
    type AttachmentLayout,
    type CaptureTarget,
    type DarkImages,
    type ParagraphSpacing,
    type ReadingFont,
    type RevealMarkup,
    type EditorFont,
    type Settings,
    type SettingsTab,
  } from "@shared/settings";
  import { app } from "../../lib/app.svelte";
  import { boundHotkeys, commandById, defaultHotkeys, hotkeyGroups, hotkeyMap } from "../../lib/commands";
  import { call, run } from "../../lib/host";
  import { accents, activeTheme, darkThemes, editorFonts, lightThemes } from "../../lib/theme";
  import { accentColors } from "@shared/themes";
  import ThemePicker from "./ThemePicker.svelte";
  import Modal from "./Modal.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Segmented from "./Segmented.svelte";
  import Switch from "./Switch.svelte";

  const tabs: { value: SettingsTab; label: string; icon: typeof Settings2 }[] = [
    { value: "general", label: "General", icon: Settings2 },
    { value: "appearance", label: "Appearance", icon: Palette },
    { value: "editor", label: "Editor", icon: Type },
    { value: "hotkeys", label: "Hotkeys", icon: Keyboard },
    { value: "templates", label: "Templates", icon: Files },
  ];
  const tab = $derived(app.settings.settingsTab);
  const s = $derived(app.settings);

  // ---- Text fields ----
  type TextKey = "attachmentFolder" | "templatesFolder" | "dailyNoteFolder" | "dailyNoteFormat" | "dailyNoteTemplate" | "quickCaptureInbox" | "editorFontFamily" | "readingFontFamily" | "uiFontFamily";
  const textKeys: TextKey[] = ["attachmentFolder", "templatesFolder", "dailyNoteFolder", "dailyNoteFormat", "dailyNoteTemplate", "quickCaptureInbox", "editorFontFamily", "readingFontFamily", "uiFontFamily"];
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
  const attachmentLayouts: { value: AttachmentLayout; label: string }[] = [
    { value: "perNote", label: "A folder for each note" },
    { value: "single", label: "One folder" },
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
    // Holocron's own shortcuts, as customised in the Hotkeys tab, are refused.
    const clash = boundHotkeys().find((binding) => normalizeShortcut(binding.key) === shortcut);
    if (clash) {
      shortcutProblem = `Holocron already uses ${shortcutLabel(shortcut)} for “${commandById.get(clash.id)?.title ?? clash.id}”.`;
      return;
    }
    setShortcut(shortcut);
  }

  // ---- Hotkeys (HK-01) ----
  // Every rebindable command with the shortcut in force; click one (or press
  // Enter on it) and press the keys. Esc keeps the current one, Backspace
  // clears it. Only overrides are stored, so Reset just forgets one.
  let hotkeyFilter = $state("");
  let recordingHotkey = $state<string | null>(null);
  let hotkeyProblem = $state<string | null>(null);
  const hotkeyGroupList = hotkeyGroups();
  const effectiveHotkeyMap = $derived(hotkeyMap());
  const overrideCount = $derived(Object.keys(s.hotkeys).length);
  const filteredHotkeyGroups = $derived.by(() => {
    const query = hotkeyFilter.trim().toLowerCase();
    return hotkeyGroupList
      .map((group) => ({
        title: group.title,
        commands: group.commands.filter((command) => !query || command.title.toLowerCase().includes(query) || (command.shortcut ?? "").toLowerCase().includes(query)),
      }))
      .filter((group) => group.commands.length > 0);
  });
  /** The other commands sharing this command's key (shown in amber; the one bound last wins). */
  function conflictNames(id: string): string[] {
    return hotkeyConflicts(effectiveHotkeyMap, id).map((other) => commandById.get(other)?.title ?? other);
  }
  const isOverridden = (id: string) => id in s.hotkeys;
  /** Stores an override (null = unbound); a value equal to the default removes the override. */
  function setHotkey(id: string, value: string | null) {
    const next = { ...s.hotkeys };
    delete next[id]; // re-added last, so the newest binding wins a conflict
    if (value !== (defaultHotkeys[id] ?? null)) next[id] = value;
    app.setSetting("hotkeys", next);
  }
  function resetHotkey(id: string) {
    if (!isOverridden(id)) return;
    const next = { ...s.hotkeys };
    delete next[id];
    app.setSetting("hotkeys", next);
  }
  function startHotkeyRecording(id: string) {
    recordingHotkey = id;
    hotkeyProblem = null;
  }
  function stopHotkeyRecording() {
    recordingHotkey = null;
  }
  function onHotkeyKeydown(event: KeyboardEvent, id: string) {
    if (recordingHotkey !== id) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        startHotkeyRecording(id);
      }
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      stopHotkeyRecording();
      return; // let focus move on
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopHotkeyRecording();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      setHotkey(id, null);
      stopHotkeyRecording();
      return;
    }
    const hotkey = recordHotkey(event);
    if (hotkey === null) return; // a modifier on its own: wait for the key
    if (hotkey === "") {
      hotkeyProblem = "That key is used for typing. Add Ctrl or Alt, or use a function key.";
      return;
    }
    setHotkey(id, hotkey);
    stopHotkeyRecording();
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
  // Each font's name, drawn in that font, so the choice previews itself.
  const fontOptions: { value: EditorFont; label: string; font?: string }[] = (["system", "serif", "mono", "custom"] as const).map((value) => ({
    value,
    label: editorFonts[value].title,
    // "Custom…" is drawn in the UI font: it stands for whatever is typed below.
    font: value === "custom" ? undefined : editorFonts[value].css,
  }));
  const readingFontOptions: { value: ReadingFont; label: string; font?: string }[] = [{ value: "same", label: "Same" }, ...fontOptions];

  // ---- Installed fonts (§16.11) ----
  // Listed once per dialog, from the registry; an empty list leaves plain text fields.
  let fonts = $state<string[]>([]);
  let fontsRequested = false;
  $effect(() => {
    if (fontsRequested || (tab !== "editor" && tab !== "appearance")) return;
    fontsRequested = true;
    call<string[]>("listFonts")
      .then((names) => (fonts = Array.isArray(names) ? names : []))
      .catch(() => (fonts = []));
  });
  const fontListId = $derived(fonts.length ? "installed-fonts" : undefined);

  // ---- CSS snippets (§16.11) ----
  const snippets = $derived(app.state.snippets);
  const revealOptions: { value: RevealMarkup; label: string }[] = [
    { value: "line", label: "Whole line" },
    { value: "span", label: "Under cursor" },
  ];
  const spacingOptions: { value: ParagraphSpacing; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "normal", label: "Normal" },
    { value: "relaxed", label: "Relaxed" },
  ];
  const darkImageOptions: { value: DarkImages; label: string }[] = [
    { value: "normal", label: "As they are" },
    { value: "dim", label: "Dimmed" },
    { value: "invertLight", label: "Invert light ones" },
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
        | "updateHeadingLinks"
        | "nameNotesFromFirstLine"
        | "autoMergeExternalChanges"
        | "showFormattingBar"
        | "openDailyNoteOnLaunch"
        | "readableLineLength"
        | "backlinksInNote"
        | "checkForUpdates"
        | "quickCaptureEnabled"
        | "runInBackground"
        | "launchAtLogin"
        | "codeLineNumbers"
        | "showHeadingTrail"
        | "fetchLinkTitles"
        | "spellCheck"
        | "keepHistory"
      ),
  ) {
    return (checked: boolean) => app.setSetting(key, checked);
  }

  // ---- Version history ----
  let historySize = $state<number | null>(null);
  $effect(() => {
    if (!app.vault || tab !== "general") return;
    void app.vault.indexRevision;
    call<number | undefined>("historySize")
      .then((size) => (historySize = size ?? 0))
      .catch(() => (historySize = null));
  });
  function sizeText(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  async function clearHistory() {
    await call("clearHistory");
    historySize = 0;
  }

  // ---- Spelling ----
  const languageNames = new Intl.DisplayNames(undefined, { type: "language" });
  /** "English (United Kingdom)" for "en-GB"; the tag itself if unknown. */
  function languageName(tag: string): string {
    try {
      return languageNames.of(tag) ?? tag;
    } catch {
      return tag;
    }
  }
  const spelling = $derived(app.state.spelling);
  /** The dictionaries shown ticked: the chosen ones, or (when none chosen) the ones in use. */
  const tickedLanguages = $derived(new Set((s.spellCheckLanguages.length ? s.spellCheckLanguages : spelling.active).map((tag) => tag.toLowerCase())));
  const languageRows = $derived(spelling.available.map((tag) => ({ tag, name: languageName(tag) })).sort((a, b) => a.name.localeCompare(b.name)));
  const languageLimitReached = $derived(s.spellCheckLanguages.length >= MAX_SPELL_CHECK_LANGUAGES);
  function toggleLanguage(tag: string, on: boolean) {
    // Ticking starts from what's in use, so the automatic choice becomes explicit.
    const current = s.spellCheckLanguages.length ? s.spellCheckLanguages : spelling.active;
    const next = on ? [...current.filter((t) => t.toLowerCase() !== tag.toLowerCase()), tag] : current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    app.setSetting("spellCheckLanguages", next);
  }
  const spellingHelp = $derived.by(() => {
    if (!s.spellCheck) return "Misspelled words aren’t underlined.";
    if (spelling.active.length === 0) return "No dictionary is available for your Windows language.";
    const names = spelling.active.map(languageName).join(", ");
    return s.spellCheckLanguages.length ? `Checking ${names}.` : `Following your Windows display language: ${names}.`;
  });

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

{#snippet textField(key: TextKey, placeholder: string, label: string, list?: string)}
  <input
    id="setting-{key}"
    class="text-field"
    {placeholder}
    {list}
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

{#snippet slider(key: "editorFontSize" | "editorLineWidth" | "editorLineHeight", range: readonly [number, number], step: number, label: string, unit = " pt")}
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
    <span class="slider-value">{key === "editorLineHeight" ? s[key].toFixed(2) : s[key]}{unit}</span>
  </div>
{/snippet}

<Modal width={720} labelledby="settings-title" onclose={close} panelClass="settings" focusPanel>
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
        <h3 class="section-label">Spelling</h3>
        <div class="group">
          {@render switchRow("Check spelling as you type", s.spellCheck, toggle("spellCheck"), spellingHelp)}
          {#if s.spellCheck && languageRows.length > 0}
            <div class="row stacked">
              <div class="row-text">
                <span class="row-label" id="spelling-languages-label">Dictionaries</span>
                <span class="row-help">
                  Tick up to {MAX_SPELL_CHECK_LANGUAGES}. Untick them all to follow your Windows display language again.
                  {#if languageLimitReached}That’s the most that can be checked at once.{/if}
                </span>
              </div>
              <div class="languages" role="group" aria-labelledby="spelling-languages-label">
                {#each languageRows as { tag, name } (tag)}
                  {@const ticked = tickedLanguages.has(tag.toLowerCase())}
                  <div class="language" class:dimmed={!ticked && languageLimitReached}>
                    <Checkbox label={name} checked={ticked} onchange={(on) => toggleLanguage(tag, on)} />
                    <span class="language-tag">{tag}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <h3 class="section-label">Files</h3>
        <div class="group">
          {@render switchRow("Update links when renaming or moving notes", s.updateLinksOnMove, toggle("updateLinksOnMove"))}
          {@render switchRow(
            "Offer to update links when a heading is renamed",
            s.updateHeadingLinks,
            toggle("updateHeadingLinks"),
            "After you change a heading’s text, a message offers to point [[Note#Heading]] links in your other notes at the new name.",
          )}
          {@render switchRow("Name new notes from their first line", s.nameNotesFromFirstLine, toggle("nameNotesFromFirstLine"))}
          {@render switchRow(
            "Keep a history of note versions",
            s.keepHistory,
            toggle("keepHistory"),
            "A copy of each note as Holocron saves it, at most one every 5 minutes, kept for 30 days in Holocron’s app data folder (not in the vault). File › Version History… shows and restores them.",
          )}
          {#if app.vault}
            {#snippet historyControl()}
              <button class="button" disabled={historySize === 0} onclick={clearHistory}>Clear History</button>
            {/snippet}
            {@render row("Saved versions of this vault", historyControl, historySize === null ? "" : historySize === 0 ? "None yet." : `${sizeText(historySize)} on disk.`)}
          {/if}
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
        <div class="group">
          {#snippet uiFont()}{@render textField("uiFontFamily", "Segoe UI Variable", "Interface font", fontListId)}{/snippet}
          {@render row("Interface font", uiFont, "The font of the sidebar, tabs, menus and dialogs. Leave it empty for Segoe UI Variable.", "setting-uiFontFamily", true)}
        </div>
        <h3 class="section-label">CSS snippets</h3>
        <div class="group">
          <div class="row stacked">
            <div class="row-text">
              <span class="row-label" id="snippets-label">Snippets</span>
              <span class="row-help">
                {#if !app.vault}
                  Open a vault to use snippets.
                {:else if snippets.length === 0}
                  Put .css files in the vault’s .holocron\snippets folder, then Reload. Each one can be turned on and off here.
                {:else}
                  Stylesheets from the vault’s .holocron\snippets folder, applied in file-name order after the theme. Edits to a file apply when it’s saved.
                {/if}
              </span>
            </div>
            {#if snippets.length}
              <div class="snippets" role="group" aria-labelledby="snippets-label">
                {#each snippets as snippet (snippet.name)}
                  <div class="snippet">
                    <span class="snippet-name" title="{snippet.name}.css">{snippet.name}</span>
                    <Switch label={`Snippet ${snippet.name}`} checked={snippet.enabled} onchange={(on) => run("setSnippetEnabled", snippet.name, on)} />
                  </div>
                {/each}
              </div>
            {/if}
            <div class="snippet-actions">
              <button class="button" disabled={!app.vault} onclick={() => run("openSnippetsFolder")}>Open snippets folder</button>
              <button class="button" disabled={!app.vault} onclick={() => run("reloadSnippets")}>Reload</button>
            </div>
          </div>
        </div>
      {:else if tab === "editor"}
        <div class="group">
          {@render switchRow("Show the formatting bar above notes", s.showFormattingBar, toggle("showFormattingBar"))}
          {#snippet font()}
            <div class="font-picker"><Segmented label="Font" options={fontOptions} value={s.editorFont} onchange={(value) => app.setSetting("editorFont", value)} /></div>
          {/snippet}
          {@render row("Font", font)}
          {#if s.editorFont === "custom"}
            {#snippet fontFamily()}{@render textField("editorFontFamily", "Font name", "Editor font name", fontListId)}{/snippet}
            {@render row("Font name", fontFamily, fonts.length ? "Pick an installed font, or type its name. Several names separated by commas are tried in order." : "Type the name of an installed font. Several names separated by commas are tried in order.", "setting-editorFontFamily", true)}
          {/if}
          {#snippet size()}{@render slider("editorFontSize", FONT_SIZE_RANGE, 1, "Text size")}{/snippet}
          {@render row("Text size", size)}
          {@render switchRow("Readable line length — limit the text width instead of filling the window", s.readableLineLength, toggle("readableLineLength"))}
          {#if s.readableLineLength}
            {#snippet width()}{@render slider("editorLineWidth", LINE_WIDTH_RANGE, 20, "Line width")}{/snippet}
            {@render row("Line width", width)}
          {/if}
          {#snippet lineHeight()}{@render slider("editorLineHeight", LINE_HEIGHT_RANGE, 0.05, "Line spacing", "×")}{/snippet}
          {@render row("Line spacing", lineHeight)}
          {#snippet spacing()}
            <Segmented label="Paragraph spacing" options={spacingOptions} value={s.paragraphSpacing} onchange={(value) => app.setSetting("paragraphSpacing", value)} />
          {/snippet}
          {@render row("Paragraph spacing", spacing, "How tall the blank lines between paragraphs are. Your notes don’t change.")}
          {#snippet readingFont()}
            <div class="font-picker"><Segmented label="Reading view font" options={readingFontOptions} value={s.readingFont} onchange={(value) => app.setSetting("readingFont", value)} /></div>
          {/snippet}
          {@render row("Reading view font", readingFont)}
          {#if s.readingFont === "custom"}
            {#snippet readingFamily()}{@render textField("readingFontFamily", "Font name", "Reading view font name", fontListId)}{/snippet}
            {@render row("Reading view font name", readingFamily, undefined, "setting-readingFontFamily")}
          {/if}
          {#snippet reveal()}
            <Segmented label="Show markdown" options={revealOptions} value={s.revealMarkup} onchange={(value) => app.setSetting("revealMarkup", value)} />
          {/snippet}
          {@render row("Show markdown", reveal, "Live Preview shows the markdown behind the line you’re on. Under cursor shows only the link or formatting the cursor is in, so the rest of the line doesn’t shift.")}
        </div>
        <div class="group">
          {#snippet darkImages()}
            <Segmented label="Images in dark themes" options={darkImageOptions} value={s.darkImages} onchange={(value) => app.setSetting("darkImages", value)} />
          {/snippet}
          {@render row("Images in dark themes", darkImages, "Dimmed tones images down; Invert light ones flips mostly-white screenshots and diagrams so they don’t glare. Hover an image to see it as it is.")}
          {@render switchRow("Show line numbers in code blocks (a block can also ask with “linenos”)", s.codeLineNumbers, toggle("codeLineNumbers"))}
          {@render switchRow("Show the headings you’re in above the note while scrolling", s.showHeadingTrail, toggle("showHeadingTrail"))}
          {@render switchRow("Show backlinks at the end of each note", s.backlinksInNote, toggle("backlinksInNote"), "Linked and unlinked mentions appear below the note’s text, like the inspector’s Links tab. Also View › Show Backlinks in Note.")}
          {@render switchRow("Use the page’s title when you paste a link", s.fetchLinkTitles, toggle("fetchLinkTitles"), "Pasting a lone link on its own makes it [Page title](link). Holocron fetches the page to read its title; the link stays as it is if that fails.")}
        </div>
        <div class="group">
          {@render textRow(
            "attachmentFolder",
            "Attachment folder",
            "Vault root",
            "Pasted images and files dropped in from outside the vault are saved here, relative to the vault. Leave it empty to use the vault root.",
          )}
          {#snippet layout()}
            <Segmented label="Attachment layout" options={attachmentLayouts} value={s.attachmentLayout} onchange={(value) => app.setSetting("attachmentLayout", value)} />
          {/snippet}
          {@render row(
            "Organise attachments",
            layout,
            "Each note’s files go in a subfolder that moves with the note. File › Organise Attachments… sorts existing files.",
          )}
        </div>
      {:else if tab === "hotkeys"}
        <div class="hotkeys-toolbar">
          <input
            class="text-field hotkeys-filter"
            type="search"
            placeholder="Filter commands"
            aria-label="Filter commands"
            spellcheck="false"
            autocomplete="off"
            bind:value={hotkeyFilter}
          />
          <button class="button" disabled={overrideCount === 0} onclick={() => app.setSetting("hotkeys", {})}>Restore all defaults</button>
        </div>
        <p class="hotkeys-help" class:error={hotkeyProblem !== null} role={hotkeyProblem ? "alert" : undefined}>
          {hotkeyProblem ??
            (recordingHotkey ? "Press the new shortcut. Esc keeps the current one; Backspace removes it." : "Click a shortcut and press the keys you want. Changes apply at once.")}
        </p>
        {#each filteredHotkeyGroups as group (group.title)}
          <h3 class="section-label">{group.title}</h3>
          <div class="group">
            {#each group.commands as command (command.id)}
              {@const key = effectiveHotkeyMap[command.id]}
              {@const conflicts = conflictNames(command.id)}
              {@const overridden = isOverridden(command.id)}
              <div class="row hotkey-row">
                <div class="row-text">
                  <span class="row-label" id="hotkey-{command.id}">{command.title}</span>
                  {#if conflicts.length > 0}
                    <span class="row-help conflict">Also used by {conflicts.join(", ")} — the one set last wins.</span>
                  {/if}
                </div>
                <div class="row-control shortcut">
                  <button
                    class="text-field recorder hotkey"
                    class:recording={recordingHotkey === command.id}
                    class:unbound={!key}
                    class:overridden
                    data-shortcut-recorder
                    aria-labelledby="hotkey-{command.id}"
                    title="Click, then press the new shortcut"
                    onclick={() => startHotkeyRecording(command.id)}
                    onkeydown={(event) => onHotkeyKeydown(event, command.id)}
                    onblur={() => recordingHotkey === command.id && stopHotkeyRecording()}
                  >
                    {recordingHotkey === command.id ? "Press keys…" : command.shortcut ?? "None"}
                  </button>
                  <button class="icon-button small" aria-label="Remove shortcut" title="Remove shortcut" disabled={!key} onclick={() => setHotkey(command.id, null)}>
                    <X size={14} />
                  </button>
                  <button class="icon-button small" aria-label="Reset to default" title="Reset to default" disabled={!overridden} onclick={() => resetHotkey(command.id)}>
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="hotkeys-help">No commands match.</p>
        {/each}
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
  {#if fonts.length}
    <!-- The installed font families, offered by every font-name field (§16.11). -->
    <datalist id="installed-fonts">
      {#each fonts as name (name)}
        <option value={name}></option>
      {/each}
    </datalist>
  {/if}
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
  /* Font names are drawn in their fonts, and JetBrains Mono runs wide: size to the labels. */
  .row-control .font-picker :global(.segmented) {
    width: auto;
    min-width: 264px;
  }
  .text-field {
    width: 220px;
    max-width: 100%;
  }
  .row-help.error {
    color: var(--ui-danger);
  }
  /* CSS snippets (§16.11): one row per file with a switch. */
  .snippets {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
    padding: 4px 8px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-bg);
  }
  .snippet {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 3px 2px;
  }
  .snippet-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
  }
  .snippet-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .languages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 2px 16px;
    max-height: 220px;
    overflow-y: auto;
    padding: 6px 8px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-bg);
  }
  .language {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 3px 2px;
  }
  .language.dimmed {
    opacity: 0.6;
  }
  .language-tag {
    flex: none;
    font-size: 11px;
    color: var(--ui-text-3);
    font-variant-numeric: tabular-nums;
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

  /* Hotkeys tab (HK-01) */
  .hotkeys-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hotkeys-filter {
    flex: 1;
    width: auto;
  }
  .hotkeys-help {
    margin: 0 2px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ui-text-2);
  }
  .hotkeys-help.error {
    color: var(--ui-danger);
  }
  .hotkey-row {
    min-height: 42px;
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .row-help.conflict {
    color: var(--ui-warning, #d6951b);
  }
  .recorder.hotkey {
    width: auto;
    min-width: 132px;
    padding-top: 4px;
    padding-bottom: 4px;
    font-size: 12px;
  }
  .recorder.hotkey.unbound:not(.recording) {
    color: var(--ui-text-3);
    font-weight: 400;
  }
  .recorder.hotkey.overridden:not(.recording) {
    border-color: var(--ui-strong-border);
    color: var(--ui-accent-text);
  }
  .icon-button.small {
    width: 26px;
    height: 26px;
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
