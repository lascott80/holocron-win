// Holocron's colours (REQUIREMENTS §16). The window chrome and the editor
// share one document, so every token is a CSS variable on <html>: the
// --hc-* set the editor reads (§16.7) plus --ui-* for the chrome.

import type { Accent, EditorFont, Settings } from "@shared/settings";

interface Palette {
  editorBackground: string;
  sidebarBackground: string;
  panelBackground: string;
  overlayBackground: string;
  raised: string;
  chip: string;
  border: string;
  strongBorder: string;
  strongText: string;
  text: string;
  bodyText: string;
  emphasizedSecondaryText: string;
  secondaryText: string;
  tertiaryText: string;
  faintText: string;
  codeBackground: string;
  synced: string;
  warning: string;
  danger: string;
}

const dark: Palette = {
  editorBackground: "#0F1115", sidebarBackground: "#15181E", panelBackground: "#13161B",
  overlayBackground: "#1A1D23", raised: "#181B21", chip: "#1E222A",
  border: "#23272F", strongBorder: "#343A45",
  strongText: "#F2F4F7", text: "#E6E8EC", bodyText: "#D8DBE0", emphasizedSecondaryText: "#C9CDD4",
  secondaryText: "#9AA1AD", tertiaryText: "#8A919D", faintText: "#6B7280",
  codeBackground: "#161A20", synced: "#3DD68C", warning: "#E8C15A", danger: "#FF6B70",
};

const light: Palette = {
  editorBackground: "#FFFFFF", sidebarBackground: "#F4F5F7", panelBackground: "#F7F8FA",
  overlayBackground: "#FFFFFF", raised: "#FFFFFF", chip: "#EBEDF0",
  border: "#E3E5E9", strongBorder: "#CDD1D7",
  strongText: "#111318", text: "#1C1F24", bodyText: "#2A2E35", emphasizedSecondaryText: "#3A3F47",
  secondaryText: "#5F6672", tertiaryText: "#6B7280", faintText: "#9AA1AD",
  codeBackground: "#F4F5F7", synced: "#1F9D5C", warning: "#9A6B00", danger: "#C42F35",
};

interface AccentPalette {
  dark: string;
  light: string;
  darkText: string;
  lightText: string;
  /** Primary buttons and selected rows under white text (≥ 4.5:1). */
  fill: string;
}

export const accents: Record<Accent, AccentPalette & { title: string }> = {
  kyber: { title: "Kyber Blue", dark: "#5AB4FF", light: "#1F6FBF", darkText: "#9CCFFF", lightText: "#1A5FA6", fill: "#2A72BD" },
  sith: { title: "Sith Red", dark: "#FF6B70", light: "#C42F35", darkText: "#FFA3A6", lightText: "#A8262B", fill: "#C03A40" },
  jedi: { title: "Jedi Green", dark: "#7CD992", light: "#2A7A3B", darkText: "#A8E8B6", lightText: "#236A32", fill: "#2E7D40" },
  gold: { title: "Temple Gold", dark: "#E8C15A", light: "#8F6B00", darkText: "#F1D58C", lightText: "#7A5B00", fill: "#86650F" },
};

export const UI_FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

export const editorFonts: Record<EditorFont, { title: string; css: string }> = {
  system: { title: "System", css: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  serif: { title: "Serif", css: "Cambria, 'Iowan Old Style', Georgia, ui-serif, serif" },
  mono: { title: "Monospaced", css: "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace" },
};

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

/** The --hc-* variables the editor reads (REQUIREMENTS §16.7), plus warning (fixes §19 #6). */
export function editorVariables(isDark: boolean, settings: Settings): Record<string, string> {
  const p = isDark ? dark : light;
  const a = accents[settings.accent];
  const accent = isDark ? a.dark : a.light;
  return {
    "--hc-bg": p.editorBackground,
    "--hc-text": p.bodyText,
    "--hc-strong": p.strongText,
    "--hc-muted": p.tertiaryText,
    "--hc-faint": p.faintText,
    "--hc-quote": p.emphasizedSecondaryText,
    "--hc-border": p.border,
    "--hc-strong-border": p.strongBorder,
    "--hc-raised": p.codeBackground,
    "--hc-chip": p.chip,
    "--hc-panel": p.overlayBackground,
    "--hc-accent": accent,
    "--hc-accent-rgb": rgb(accent),
    "--hc-accent-text": isDark ? a.darkText : a.lightText,
    "--hc-warning": p.warning,
    "--hc-font": editorFonts[settings.editorFont].css,
    "--hc-font-size": `${settings.editorFontSize}px`,
    // Off: the column grows with the window (the editor adds its 32 px side padding).
    "--hc-line-width": settings.readableLineLength ? `${settings.editorLineWidth}px` : "100vw",
  };
}

/** Variables for the window chrome. */
export function chromeVariables(isDark: boolean, settings: Settings): Record<string, string> {
  const p = isDark ? dark : light;
  const a = accents[settings.accent];
  const accent = isDark ? a.dark : a.light;
  return {
    "--ui-editor": p.editorBackground,
    "--ui-sidebar": p.sidebarBackground,
    "--ui-panel": p.panelBackground,
    "--ui-overlay": p.overlayBackground,
    "--ui-raised": p.raised,
    "--ui-chip": p.chip,
    "--ui-border": p.border,
    "--ui-strong-border": p.strongBorder,
    "--ui-strong": p.strongText,
    "--ui-text": p.text,
    "--ui-body": p.bodyText,
    "--ui-text-2": p.secondaryText,
    "--ui-text-3": p.tertiaryText,
    "--ui-faint": p.faintText,
    "--ui-code": p.codeBackground,
    "--ui-synced": p.synced,
    "--ui-warning": p.warning,
    "--ui-danger": p.danger,
    "--ui-accent": accent,
    "--ui-accent-rgb": rgb(accent),
    "--ui-accent-text": isDark ? a.darkText : a.lightText,
    "--ui-fill": a.fill,
    "--ui-font": UI_FONT,
    "--ui-shadow": isDark ? "0 12px 40px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4)" : "0 12px 40px rgba(17,19,24,.16), 0 2px 8px rgba(17,19,24,.08)",
    "--ui-backdrop": isDark ? "rgba(5,6,8,.55)" : "rgba(17,19,24,.22)",
  };
}

/** Applies every variable to <html> and switches the light/dark classes. */
export function applyTheme(isDark: boolean, settings: Settings) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries({ ...chromeVariables(isDark, settings), ...editorVariables(isDark, settings) })) {
    root.style.setProperty(name, value);
  }
  root.classList.toggle("hc-dark", isDark);
  root.classList.toggle("hc-light", !isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}
