// User preferences (REQUIREMENTS §13), shared by the main process and the renderer.

export type Appearance = "system" | "dark" | "light";
export type Accent = "kyber" | "sith" | "jedi" | "gold";
export type EditorFont = "system" | "serif" | "mono";
export type EditorMode = "livePreview" | "source" | "reading";
export type InspectorTab = "outline" | "links" | "info";
export type SettingsTab = "general" | "appearance" | "editor" | "templates";

export interface Settings {
  reopenLastVault: boolean;
  updateLinksOnMove: boolean;
  nameNotesFromFirstLine: boolean;
  autoMergeExternalChanges: boolean;
  appearance: Appearance;
  accent: Accent;
  showFormattingBar: boolean;
  editorFont: EditorFont;
  editorFontSize: number;
  editorLineWidth: number;
  attachmentFolder: string;
  templatesFolder: string;
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  dailyNoteTemplate: string;
  openDailyNoteOnLaunch: boolean;
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
  showFormattingBar: true,
  editorFont: "system",
  editorFontSize: 16,
  editorLineWidth: 720,
  attachmentFolder: "Attachments",
  templatesFolder: "Templates",
  dailyNoteFolder: "Daily",
  dailyNoteFormat: "YYYY-MM-DD",
  dailyNoteTemplate: "",
  openDailyNoteOnLaunch: false,
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
  result.accent = oneOf(result.accent, ["kyber", "sith", "jedi", "gold"], "kyber");
  result.editorFont = oneOf(result.editorFont, ["system", "serif", "mono"], "system");
  result.editorMode = oneOf(result.editorMode, ["livePreview", "source", "reading"], "livePreview");
  result.lastEditingMode = oneOf(result.lastEditingMode, ["livePreview", "source"], "livePreview");
  result.inspectorTab = oneOf(result.inspectorTab, ["outline", "links", "info"], "outline");
  result.settingsTab = oneOf(result.settingsTab, ["general", "appearance", "editor", "templates"], "general");
  return result;
}
