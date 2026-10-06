// Holocron's colours (REQUIREMENTS §16). The window chrome and the editor
// share one document, so every token is a CSS variable on <html>: the
// --hc-* set the editor reads (§16.7) plus --ui-* for the chrome. The colour
// themes themselves are data in @shared/themes (the main process uses them too).

import type { EditorFont, Settings } from "@shared/settings";
import { accentColors, crystals, resolveTheme, rgbTriple, type CalloutFamily, type Theme } from "@shared/themes";

export { themes, darkThemes, lightThemes, themeById, type Theme } from "@shared/themes";

/** The crystals (§16.2), keyed by setting value; "theme" isn't one of them. */
export const accents = crystals;

export const UI_FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

export const editorFonts: Record<EditorFont, { title: string; css: string }> = {
  system: { title: "System", css: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  serif: { title: "Serif", css: "Cambria, 'Iowan Old Style', Georgia, ui-serif, serif" },
  mono: { title: "Monospaced", css: "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace" },
};

type ThemeSettings = Pick<Settings, "darkTheme" | "lightTheme">;

/** The colour theme in use for the effective appearance. */
export function activeTheme(isDark: boolean, settings: ThemeSettings): Theme {
  return resolveTheme(isDark, settings);
}

const calloutFamilies: CalloutFamily[] = ["blue", "green", "purple", "yellow", "red", "gray"];

/** The --hc-* variables the editor reads (REQUIREMENTS §16.7). */
export function editorVariables(isDark: boolean, settings: Settings): Record<string, string> {
  const theme = activeTheme(isDark, settings);
  const p = theme.palette;
  const a = accentColors(theme, settings.accent);
  const vars: Record<string, string> = {
    // Not a colour: lets the editor tell themes apart (Mermaid redraws on change).
    "--hc-theme": theme.id,
    "--hc-bg": p.editorBackground,
    "--hc-text": p.bodyText,
    "--hc-strong": p.strongText,
    "--hc-heading": theme.heading ?? p.strongText,
    "--hc-muted": p.tertiaryText,
    "--hc-faint": p.faintText,
    "--hc-quote": theme.quote ?? p.emphasizedSecondaryText,
    "--hc-callout-body": p.emphasizedSecondaryText,
    "--hc-border": p.border,
    "--hc-strong-border": p.strongBorder,
    "--hc-raised": p.codeBackground,
    "--hc-chip": p.chip,
    "--hc-panel": p.overlayBackground,
    "--hc-accent": a.glyph,
    "--hc-accent-rgb": rgbTriple(a.glyph),
    "--hc-accent-text": a.text,
    "--hc-accent-fill": a.fill,
    "--hc-selection": theme.selection ?? `rgba(${rgbTriple(a.glyph)}, 0.28)`,
    "--hc-highlight": theme.highlight,
    "--hc-search-match-rgb": rgbTriple(theme.searchMatch),
    "--hc-synced": p.synced,
    "--hc-warning": p.warning,
    "--hc-danger": p.danger,
    "--hc-font": editorFonts[settings.editorFont].css,
    "--hc-font-size": `${settings.editorFontSize}px`,
    // Off: the column grows with the window (the editor adds its 32 px side padding).
    "--hc-line-width": settings.readableLineLength ? `${settings.editorLineWidth}px` : "100vw",
  };
  for (const [token, colour] of Object.entries(theme.syntax)) vars[`--hc-syn-${token}`] = colour;
  for (const family of calloutFamilies) {
    const [tint, title] = theme.callouts[family];
    vars[`--hc-callout-${family}`] = rgbTriple(tint);
    vars[`--hc-callout-${family}-text`] = rgbTriple(title);
  }
  return vars;
}

/** Variables for the window chrome. */
export function chromeVariables(isDark: boolean, settings: Settings): Record<string, string> {
  const theme = activeTheme(isDark, settings);
  const p = theme.palette;
  const a = accentColors(theme, settings.accent);
  const dark = theme.kind === "dark";
  return {
    "--ui-editor": p.editorBackground,
    "--ui-sidebar": p.sidebarBackground,
    "--ui-titlebar": p.titleBar,
    // Hovers on a title bar that's its own colour (Dark+'s grey) can't use the chip colour.
    "--ui-titlebar-hover": p.titleBar === p.sidebarBackground ? p.chip : dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.07)",
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
    "--ui-accent": a.glyph,
    "--ui-accent-rgb": rgbTriple(a.glyph),
    "--ui-accent-text": a.text,
    "--ui-fill": a.fill,
    "--ui-selection": theme.selection ?? `rgba(${rgbTriple(a.glyph)}, 0.28)`,
    "--ui-font": UI_FONT,
    "--ui-shadow": dark ? "0 12px 40px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4)" : "0 12px 40px rgba(17,19,24,.16), 0 2px 8px rgba(17,19,24,.08)",
    "--ui-backdrop": dark ? "rgba(5,6,8,.55)" : "rgba(17,19,24,.22)",
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
