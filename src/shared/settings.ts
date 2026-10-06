// User preferences (REQUIREMENTS §13), shared by the main process and the renderer.

import { crystalIds, darkThemeIds, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, lightThemeIds, type Crystal } from "./themes";

export type Appearance = "system" | "dark" | "light";
/** A crystal, or "theme": the active colour theme's own accent. */
export type Accent = Crystal | "theme";
export type EditorFont = "system" | "serif" | "mono";
export type EditorMode = "livePreview" | "source" | "reading";
export type InspectorTab = "outline" | "links" | "info";
export type SettingsTab = "general" | "appearance" | "editor" | "templates";
export type CaptureTarget = "daily" | "inbox";

export interface Settings {
  reopenLastVault: boolean;
  updateLinksOnMove: boolean;
  nameNotesFromFirstLine: boolean;
  autoMergeExternalChanges: boolean;
  appearance: Appearance;
  accent: Accent;
  /** Colour theme (themes.ts id) used when the effective appearance is dark. */
  darkTheme: string;
  /** Colour theme used when the effective appearance is light. */
  lightTheme: string;
  showFormattingBar: boolean;
  editorFont: EditorFont;
  editorFontSize: number;
  editorLineWidth: number;
  /** Cap the text column at `editorLineWidth`; off = notes fill the window. */
  readableLineLength: boolean;
  attachmentFolder: string;
  templatesFolder: string;
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  dailyNoteTemplate: string;
  openDailyNoteOnLaunch: boolean;
  /** Check GitHub for a newer Holocron at launch and every 6 hours. */
  checkForUpdates: boolean;
  /** Quick capture: a system-wide shortcut opens a small capture window (Windows). */
  quickCaptureEnabled: boolean;
  /** An Electron accelerator in canonical form ("Super+Alt+N" = Win+Alt+N); see `normalizeShortcut`. */
  quickCaptureShortcut: string;
  /** Where captures go unless changed in the capture window. */
  quickCaptureTarget: CaptureTarget;
  /** Vault path of the inbox note. */
  quickCaptureInbox: string;
  /** Closing the window hides Holocron in the notification area instead of quitting. */
  runInBackground: boolean;
  /** Start (hidden, in the notification area) when the user signs in to Windows. */
  launchAtLogin: boolean;
  editorMode: EditorMode;
  /** The mode reading view toggles back to. */
  lastEditingMode: EditorMode;
  // Remembered UI state
  showInspector: boolean;
  showSidebar: boolean;
  inspectorTab: InspectorTab;
  tagsExpanded: boolean;
  settingsTab: SettingsTab;
}

export const defaultSettings: Settings = {
  reopenLastVault: true,
  updateLinksOnMove: true,
  nameNotesFromFirstLine: true,
  autoMergeExternalChanges: true,
  appearance: "system",
  accent: "kyber",
  darkTheme: DEFAULT_DARK_THEME,
  lightTheme: DEFAULT_LIGHT_THEME,
  showFormattingBar: true,
  editorFont: "system",
  editorFontSize: 16,
  editorLineWidth: 720,
  readableLineLength: true,
  attachmentFolder: "Attachments",
  templatesFolder: "Templates",
  dailyNoteFolder: "Daily",
  dailyNoteFormat: "YYYY-MM-DD",
  dailyNoteTemplate: "",
  openDailyNoteOnLaunch: false,
  checkForUpdates: true,
  quickCaptureEnabled: true,
  // Win+Alt+N: not a Windows 11 shortcut, and no Holocron shortcut uses the
  // Windows key, so taking it system-wide never steals a key from the app or
  // from typing (AltGr = Ctrl+Alt on many layouts, so Ctrl+Alt combos can).
  quickCaptureShortcut: "Super+Alt+N",
  quickCaptureTarget: "daily",
  quickCaptureInbox: "Inbox.md",
  runInBackground: true,
  launchAtLogin: false,
  editorMode: "livePreview",
  lastEditingMode: "livePreview",
  showInspector: true,
  showSidebar: true,
  inspectorTab: "outline",
  tagsExpanded: true,
  settingsTab: "general",
};

export const FONT_SIZE_RANGE = [13, 24] as const;
export const LINE_WIDTH_RANGE = [560, 1100] as const;

/** Fills in defaults and clamps values read from disk (or anywhere untrusted). */
export function sanitizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const result = { ...defaultSettings };
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const value = raw[key];
    if (value !== undefined && typeof value === typeof defaultSettings[key]) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(n)));
  result.editorFontSize = clamp(result.editorFontSize, FONT_SIZE_RANGE);
  result.editorLineWidth = clamp(result.editorLineWidth, LINE_WIDTH_RANGE);
  const oneOf = <T extends string>(value: T, allowed: readonly T[], fallback: T) => (allowed.includes(value) ? value : fallback);
  result.appearance = oneOf(result.appearance, ["system", "dark", "light"], "system");
  result.accent = oneOf<Accent>(result.accent, ["theme", ...crystalIds], "kyber");
  result.darkTheme = oneOf(result.darkTheme, darkThemeIds, DEFAULT_DARK_THEME);
  result.lightTheme = oneOf(result.lightTheme, lightThemeIds, DEFAULT_LIGHT_THEME);
  result.editorFont = oneOf(result.editorFont, ["system", "serif", "mono"], "system");
  result.editorMode = oneOf(result.editorMode, ["livePreview", "source", "reading"], "livePreview");
  result.lastEditingMode = oneOf(result.lastEditingMode, ["livePreview", "source"], "livePreview");
  result.inspectorTab = oneOf(result.inspectorTab, ["outline", "links", "info"], "outline");
  result.settingsTab = oneOf(result.settingsTab, ["general", "appearance", "editor", "templates"], "general");
  result.quickCaptureTarget = oneOf(result.quickCaptureTarget, ["daily", "inbox"], "daily");
  result.quickCaptureShortcut = normalizeShortcut(result.quickCaptureShortcut) ?? defaultSettings.quickCaptureShortcut;
  return result;
}

// MARK: Global shortcuts (Electron accelerators)

const MODIFIER_NAMES: Record<string, "Ctrl" | "Alt" | "Shift" | "Super"> = {
  ctrl: "Ctrl", control: "Ctrl", cmdorctrl: "Ctrl", commandorcontrol: "Ctrl",
  alt: "Alt", option: "Alt",
  shift: "Shift",
  super: "Super", meta: "Super", win: "Super", windows: "Super", cmd: "Super", command: "Super",
};

const NAMED_KEYS = [
  "Space", "Tab", "Backspace", "Delete", "Insert", "Enter", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  "Plus", "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9", "numdec", "numadd", "numsub", "nummult", "numdiv",
];
const KEY_ALIASES: Record<string, string> = { return: "Enter", esc: "Escape", del: "Delete", ins: "Insert", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right" };
const PUNCTUATION = new Set([..."`-=[]\\;',./"]);

/** "Space", "N", "F5", "/"… in Electron's spelling, or null for a key a global shortcut can't use. */
function shortcutKey(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (PUNCTUATION.has(raw)) return raw;
  return NAMED_KEYS.find((name) => name.toLowerCase() === lower) ?? null;
}

/**
 * A system-wide shortcut in canonical form — modifiers in the order Super
 * (the Windows key), Ctrl, Alt, Shift, then one key ("Super+Alt+N",
 * "Ctrl+Alt+Space") — or null if it isn't
 * valid Electron accelerator syntax or is unsafe to take system-wide: it
 * needs Ctrl, Alt or the Windows key (Super), so plain typing and Shift+letter
 * are never stolen from other apps. Escape is never allowed.
 */
export function normalizeShortcut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("+").map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => part === "")) return null;
  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null; // one key only
    key = shortcutKey(part);
    if (key === null) return null;
  }
  if (key === null || key === "Escape") return null;
  if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !modifiers.has("Super")) return null;
  return [...(["Super", "Ctrl", "Alt", "Shift"] as const).filter((m) => modifiers.has(m)), key].join("+");
}

/** How a shortcut reads in menus and Settings: the Windows key is "Win". */
export function shortcutLabel(shortcut: string): string {
  return shortcut.replace(/\bSuper\b/g, "Win");
}
