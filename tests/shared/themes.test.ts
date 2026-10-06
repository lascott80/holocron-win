// Colour themes (src/shared/themes.ts, REQUIREMENTS §16.10).

import { describe, expect, it } from "vitest";
import {
  accentColors,
  contrast,
  crystalIds,
  darkThemeIds,
  lightThemeIds,
  resolveTheme,
  themeById,
  themes,
  windowColors,
  type Palette,
  type Syntax,
} from "../../src/shared/themes";
import { defaultSettings, sanitizeSettings } from "../../src/shared/settings";

const paletteTokens: (keyof Palette)[] = [
  "editorBackground", "sidebarBackground", "titleBar", "panelBackground", "overlayBackground", "raised", "chip",
  "border", "strongBorder", "strongText", "text", "bodyText", "emphasizedSecondaryText", "secondaryText",
  "tertiaryText", "faintText", "codeBackground", "synced", "warning", "danger",
];
const syntaxTokens: (keyof Syntax)[] = [
  "keyword", "control", "string", "number", "comment", "function", "type", "variable", "property", "attribute",
  "tag", "punctuation", "regexp", "meta",
];
const HEX = /^#[0-9A-F]{6}$/;

describe("themes", () => {
  it("ships the agreed themes with unique ids, dark ones first", () => {
    expect(darkThemeIds).toEqual(["holocron-dark", "dark-plus", "one-dark", "dracula", "nord", "github-dark", "solarized-dark"]);
    expect(lightThemeIds).toEqual(["holocron-light", "light-plus", "github-light", "solarized-light"]);
    expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);
  });

  for (const theme of themes) {
    describe(theme.name, () => {
      it("defines every token as an upper-case #RRGGBB colour", () => {
        expect(Object.keys(theme.palette).sort()).toEqual([...paletteTokens].sort());
        expect(Object.keys(theme.syntax).sort()).toEqual([...syntaxTokens].sort());
        const colours = [
          ...Object.values(theme.palette),
          ...Object.values(theme.syntax),
          ...Object.values(theme.callouts).flat(),
          theme.accent.glyph, theme.accent.text, theme.accent.fill, theme.searchMatch,
          ...[theme.heading, theme.quote, theme.selection].filter((c): c is string => c !== undefined),
        ];
        for (const colour of colours) expect(colour, colour).toMatch(HEX);
        expect(Object.keys(theme.callouts).sort()).toEqual(["blue", "gray", "green", "purple", "red", "yellow"]);
        expect(theme.highlight).toMatch(/^rgba\(\d+, \d+, \d+, 0?\.\d+\)$/);
      });

      it("body text is readable (WCAG AA ≥ 4.5:1) on the editor, sidebar and overlays", () => {
        const p = theme.palette;
        expect(contrast(p.bodyText, p.editorBackground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.text, p.sidebarBackground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.text, p.overlayBackground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.quote ?? p.emphasizedSecondaryText, p.editorBackground)).toBeGreaterThanOrEqual(4.5);
      });

      it("muted text is at least 3:1 on the editor, sidebar and overlays", () => {
        const p = theme.palette;
        for (const bg of [p.editorBackground, p.sidebarBackground, p.overlayBackground]) {
          expect(contrast(p.tertiaryText, bg)).toBeGreaterThanOrEqual(3);
          expect(contrast(p.secondaryText, bg)).toBeGreaterThanOrEqual(3);
        }
      });

      it("headings, links and callout titles stand out (≥ 3:1, large or bold text)", () => {
        const p = theme.palette;
        expect(contrast(theme.heading ?? p.strongText, p.editorBackground)).toBeGreaterThanOrEqual(3);
        expect(contrast(theme.accent.glyph, p.editorBackground)).toBeGreaterThanOrEqual(3);
        expect(contrast(theme.accent.text, p.editorBackground)).toBeGreaterThanOrEqual(4.5);
        for (const [, title] of Object.values(theme.callouts)) expect(contrast(title, p.editorBackground)).toBeGreaterThanOrEqual(3);
      });

      it("white text on its accent fill is ≥ 4.5:1", () => {
        expect(contrast("#FFFFFF", theme.accent.fill)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("every crystal fill keeps white text readable", () => {
    for (const theme of themes) for (const crystal of crystalIds) expect(contrast("#FFFFFF", accentColors(theme, crystal).fill)).toBeGreaterThanOrEqual(4.5);
  });

  it("Holocron Dark and Light are the original palette, with Kyber Blue as their own accent", () => {
    const dark = themeById("holocron-dark")!;
    expect(dark.palette.editorBackground).toBe("#0F1115");
    expect(dark.palette.sidebarBackground).toBe("#15181E");
    expect(dark.accent).toEqual(accentColors(dark, "kyber"));
    const light = themeById("holocron-light")!;
    expect(light.palette.editorBackground).toBe("#FFFFFF");
    expect(light.accent).toEqual(accentColors(light, "kyber"));
  });

  it("Dark+ uses VS Code's colours", () => {
    const t = themeById("dark-plus")!;
    expect(t.palette).toMatchObject({ editorBackground: "#1E1E1E", sidebarBackground: "#252526", titleBar: "#3C3C3C", bodyText: "#D4D4D4" });
    expect(t.syntax).toMatchObject({ keyword: "#569CD6", control: "#C586C0", string: "#CE9178", function: "#DCDCAA", type: "#4EC9B0", variable: "#9CDCFE" });
    expect(accentColors(t, "theme")).toEqual({ glyph: "#3794FF", text: "#75BEFF", fill: "#007ACC" });
    expect(t.selection).toBe("#264F78");
  });

  it("resolves the theme for the effective appearance, falling back to Holocron's own", () => {
    const settings = { darkTheme: "dracula", lightTheme: "github-light" };
    expect(resolveTheme(true, settings).id).toBe("dracula");
    expect(resolveTheme(false, settings).id).toBe("github-light");
    expect(resolveTheme(true, { darkTheme: "nope", lightTheme: "nope" }).id).toBe("holocron-dark");
    // A light theme in the dark slot (hand-edited settings) isn't used.
    expect(resolveTheme(true, { darkTheme: "light-plus", lightTheme: "dark-plus" }).id).toBe("holocron-dark");
    expect(resolveTheme(false, { darkTheme: "light-plus", lightTheme: "dark-plus" }).id).toBe("holocron-light");
  });

  it("the window's title-bar overlay matches the title bar", () => {
    expect(windowColors(themeById("dark-plus")!)).toEqual({ background: "#252526", titleBarOverlay: { color: "#3C3C3C", symbolColor: "#CCCCCC" } });
    expect(windowColors(themeById("holocron-dark")!)).toEqual({ background: "#15181E", titleBarOverlay: { color: "#15181E", symbolColor: "#C9CDD4" } });
    expect(windowColors(themeById("holocron-light")!)).toEqual({ background: "#F4F5F7", titleBarOverlay: { color: "#F4F5F7", symbolColor: "#3A3F47" } });
  });
});

describe("theme settings", () => {
  it("default to Holocron's themes and Kyber Blue", () => {
    expect(defaultSettings).toMatchObject({ darkTheme: "holocron-dark", lightTheme: "holocron-light", accent: "kyber" });
  });

  it("keep known themes and the theme accent", () => {
    expect(sanitizeSettings({ darkTheme: "dark-plus", lightTheme: "light-plus", accent: "theme" })).toMatchObject({
      darkTheme: "dark-plus", lightTheme: "light-plus", accent: "theme",
    });
  });

  it("fall back for unknown or misplaced theme ids and accents", () => {
    expect(sanitizeSettings({ darkTheme: "monokai", lightTheme: 7, accent: "teal" })).toMatchObject({
      darkTheme: "holocron-dark", lightTheme: "holocron-light", accent: "kyber",
    });
    expect(sanitizeSettings({ darkTheme: "light-plus", lightTheme: "dracula" })).toMatchObject({ darkTheme: "holocron-dark", lightTheme: "holocron-light" });
  });
});
