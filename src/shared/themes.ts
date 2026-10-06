// Colour themes (REQUIREMENTS §16.10): pure data plus helpers, shared by the
// renderer (which turns a theme into CSS variables, lib/theme.ts) and the main
// process (window background and title-bar overlay). No DOM or Node imports.

export type ThemeKind = "dark" | "light";
export type Crystal = "kyber" | "sith" | "jedi" | "gold";
export type CalloutFamily = "blue" | "green" | "purple" | "yellow" | "red" | "gray";

/** The §16.1 tokens, plus the title bar (the strip the window buttons sit on). */
export interface Palette {
  editorBackground: string;
  sidebarBackground: string;
  /** Title bar and the system window buttons' overlay. */
  titleBar: string;
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

/** Code token colours (--hc-syn-*). */
export interface Syntax {
  keyword: string;
  /** Control flow and import/export keywords. */
  control: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  type: string;
  variable: string;
  property: string;
  attribute: string;
  tag: string;
  punctuation: string;
  regexp: string;
  /** Decorators, annotations, `self`. */
  meta: string;
}

export interface AccentColors {
  /** Links, caret, icons, checkboxes. */
  glyph: string;
  /** Tags, current outline item, accent text. */
  text: string;
  /** Primary buttons and selected rows under white text (≥ 4.5:1). */
  fill: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: ThemeKind;
  /** Where the colours come from. */
  source: string;
  palette: Palette;
  syntax: Syntax;
  /** Editor heading colour; defaults to strongText. */
  heading?: string;
  /** Blockquote text; defaults to emphasizedSecondaryText. */
  quote?: string;
  /** Text selection; defaults to the accent at 28%. */
  selection?: string;
  /** ==Highlight== background (any CSS colour). */
  highlight: string;
  /** Find-in-note matches, drawn at 25% (current match 55%). */
  searchMatch: string;
  /** Callout box tint and title colour per family. */
  callouts: Record<CalloutFamily, readonly [tint: string, title: string]>;
  /** The "Theme default" crystal. */
  accent: AccentColors;
}

// MARK: Crystals (§16.2)

export const crystals: Record<Crystal, { title: string; dark: string; light: string; darkText: string; lightText: string; fill: string }> = {
  kyber: { title: "Kyber Blue", dark: "#5AB4FF", light: "#1F6FBF", darkText: "#9CCFFF", lightText: "#1A5FA6", fill: "#2A72BD" },
  sith: { title: "Sith Red", dark: "#FF6B70", light: "#C42F35", darkText: "#FFA3A6", lightText: "#A8262B", fill: "#C03A40" },
  jedi: { title: "Jedi Green", dark: "#7CD992", light: "#2A7A3B", darkText: "#A8E8B6", lightText: "#236A32", fill: "#2E7D40" },
  gold: { title: "Temple Gold", dark: "#E8C15A", light: "#8F6B00", darkText: "#F1D58C", lightText: "#7A5B00", fill: "#86650F" },
};

export const crystalIds = Object.keys(crystals) as Crystal[];

const kyberAccent = (kind: ThemeKind): AccentColors => {
  const k = crystals.kyber;
  return kind === "dark" ? { glyph: k.dark, text: k.darkText, fill: k.fill } : { glyph: k.light, text: k.lightText, fill: k.fill };
};

// MARK: Themes

const holocronDark: Theme = {
  id: "holocron-dark",
  name: "Holocron Dark",
  kind: "dark",
  source: "Holocron (§16.1)",
  palette: {
    editorBackground: "#0F1115", sidebarBackground: "#15181E", titleBar: "#15181E", panelBackground: "#13161B",
    overlayBackground: "#1A1D23", raised: "#181B21", chip: "#1E222A",
    border: "#23272F", strongBorder: "#343A45",
    strongText: "#F2F4F7", text: "#E6E8EC", bodyText: "#D8DBE0", emphasizedSecondaryText: "#C9CDD4",
    secondaryText: "#9AA1AD", tertiaryText: "#8A919D", faintText: "#6B7280",
    codeBackground: "#161A20", synced: "#3DD68C", warning: "#E8C15A", danger: "#FF6B70",
  },
  syntax: {
    keyword: "#C792EA", control: "#C792EA", string: "#A5D6A7", number: "#F78C6C", comment: "#6B7280",
    function: "#82AAFF", type: "#FFCB6B", variable: "#D8DBE0", property: "#89DDFF", attribute: "#89DDFF",
    tag: "#F07178", punctuation: "#9AA1AD", regexp: "#A5D6A7", meta: "#C3A6FF",
  },
  highlight: "rgba(232, 193, 90, 0.32)",
  searchMatch: "#E8C15A",
  callouts: {
    blue: ["#5AB4FF", "#8CCBFF"], green: ["#3DD68C", "#78E2AC"], purple: ["#B094FF", "#C4B0FF"],
    yellow: ["#E8C15A", "#F0D282"], red: ["#FF6B6B", "#FF9696"], gray: ["#9AA1AD", "#BEC4CD"],
  },
  accent: kyberAccent("dark"),
};

const holocronLight: Theme = {
  id: "holocron-light",
  name: "Holocron Light",
  kind: "light",
  source: "Holocron (§16.1)",
  palette: {
    editorBackground: "#FFFFFF", sidebarBackground: "#F4F5F7", titleBar: "#F4F5F7", panelBackground: "#F7F8FA",
    overlayBackground: "#FFFFFF", raised: "#FFFFFF", chip: "#EBEDF0",
    border: "#E3E5E9", strongBorder: "#CDD1D7",
    strongText: "#111318", text: "#1C1F24", bodyText: "#2A2E35", emphasizedSecondaryText: "#3A3F47",
    secondaryText: "#5F6672", tertiaryText: "#6B7280", faintText: "#9AA1AD",
    codeBackground: "#F4F5F7", synced: "#1F9D5C", warning: "#9A6B00", danger: "#C42F35",
  },
  syntax: {
    keyword: "#8A3FBF", control: "#8A3FBF", string: "#2E7D32", number: "#B8501E", comment: "#8A919D",
    function: "#1F5FBF", type: "#8F6B00", variable: "#2A2E35", property: "#0B7285", attribute: "#0B7285",
    tag: "#C42F35", punctuation: "#5F6672", regexp: "#2E7D32", meta: "#6A4FC2",
  },
  highlight: "rgba(255, 214, 0, 0.42)",
  searchMatch: "#E8C15A",
  callouts: {
    blue: ["#1F6FBF", "#1A5FA6"], green: ["#1F9D5C", "#1A7340"], purple: ["#7654D6", "#6242BA"],
    yellow: ["#C49200", "#805C00"], red: ["#C42F35", "#A8262B"], gray: ["#6B7280", "#4B515C"],
  },
  accent: kyberAccent("light"),
};

// VS Code "Default Dark+" (dark_vs.json + dark_plus.json, and the workbench defaults).
const darkPlus: Theme = {
  id: "dark-plus",
  name: "Dark+",
  kind: "dark",
  source: "VS Code Default Dark+",
  palette: {
    editorBackground: "#1E1E1E", sidebarBackground: "#252526", titleBar: "#3C3C3C", panelBackground: "#252526",
    overlayBackground: "#252526", raised: "#2D2D2D", chip: "#3C3C3C",
    border: "#333333", strongBorder: "#454545",
    strongText: "#E7E7E7", text: "#CCCCCC", bodyText: "#D4D4D4", emphasizedSecondaryText: "#CCCCCC",
    secondaryText: "#9D9D9D", tertiaryText: "#858585", faintText: "#6E6E6E",
    codeBackground: "#252526", synced: "#89D185", warning: "#CCA700", danger: "#F48771",
  },
  syntax: {
    keyword: "#569CD6", control: "#C586C0", string: "#CE9178", number: "#B5CEA8", comment: "#6A9955",
    function: "#DCDCAA", type: "#4EC9B0", variable: "#9CDCFE", property: "#9CDCFE", attribute: "#9CDCFE",
    tag: "#569CD6", punctuation: "#D4D4D4", regexp: "#D16969", meta: "#C586C0",
  },
  heading: "#569CD6",
  quote: "#6A9955",
  selection: "#264F78",
  highlight: "rgba(234, 92, 0, 0.33)",
  searchMatch: "#EA5C00",
  callouts: {
    blue: ["#3794FF", "#75BEFF"], green: ["#89D185", "#89D185"], purple: ["#C586C0", "#D7A6D3"],
    yellow: ["#CCA700", "#E2C08D"], red: ["#F14C4C", "#F48771"], gray: ["#858585", "#CCCCCC"],
  },
  accent: { glyph: "#3794FF", text: "#75BEFF", fill: "#007ACC" },
};

// Atom's One Dark (as in the "One Dark Pro" VS Code port).
const oneDark: Theme = {
  id: "one-dark",
  name: "One Dark",
  kind: "dark",
  source: "Atom One Dark / One Dark Pro",
  palette: {
    editorBackground: "#282C34", sidebarBackground: "#21252B", titleBar: "#21252B", panelBackground: "#21252B",
    overlayBackground: "#21252B", raised: "#2C313A", chip: "#2C313A",
    border: "#181A1F", strongBorder: "#3E4452",
    strongText: "#E6E6E6", text: "#D7DAE0", bodyText: "#ABB2BF", emphasizedSecondaryText: "#9DA5B4",
    secondaryText: "#9DA5B4", tertiaryText: "#7F848E", faintText: "#5C6370",
    codeBackground: "#21252B", synced: "#98C379", warning: "#E5C07B", danger: "#E06C75",
  },
  syntax: {
    keyword: "#C678DD", control: "#C678DD", string: "#98C379", number: "#D19A66", comment: "#7F848E",
    function: "#61AFEF", type: "#E5C07B", variable: "#E06C75", property: "#E06C75", attribute: "#D19A66",
    tag: "#E06C75", punctuation: "#ABB2BF", regexp: "#56B6C2", meta: "#56B6C2",
  },
  heading: "#E06C75",
  selection: "#3E4451",
  highlight: "rgba(229, 192, 123, 0.3)",
  searchMatch: "#E5C07B",
  callouts: {
    blue: ["#61AFEF", "#61AFEF"], green: ["#98C379", "#98C379"], purple: ["#C678DD", "#C678DD"],
    yellow: ["#E5C07B", "#E5C07B"], red: ["#E06C75", "#E06C75"], gray: ["#7F848E", "#ABB2BF"],
  },
  accent: { glyph: "#61AFEF", text: "#61AFEF", fill: "#3E6FCB" },
};

// draculatheme.com/spec, and the VS Code port's workbench colours.
const dracula: Theme = {
  id: "dracula",
  name: "Dracula",
  kind: "dark",
  source: "Dracula (draculatheme.com/spec)",
  palette: {
    editorBackground: "#282A36", sidebarBackground: "#21222C", titleBar: "#21222C", panelBackground: "#21222C",
    overlayBackground: "#21222C", raised: "#343746", chip: "#44475A",
    border: "#191A21", strongBorder: "#44475A",
    strongText: "#FFFFFF", text: "#F8F8F2", bodyText: "#F8F8F2", emphasizedSecondaryText: "#E9E9F4",
    secondaryText: "#B6B9D0", tertiaryText: "#8A93C2", faintText: "#6272A4",
    codeBackground: "#21222C", synced: "#50FA7B", warning: "#FFB86C", danger: "#FF5555",
  },
  syntax: {
    keyword: "#FF79C6", control: "#FF79C6", string: "#F1FA8C", number: "#BD93F9", comment: "#6272A4",
    function: "#50FA7B", type: "#8BE9FD", variable: "#F8F8F2", property: "#8BE9FD", attribute: "#50FA7B",
    tag: "#FF79C6", punctuation: "#F8F8F2", regexp: "#FF5555", meta: "#50FA7B",
  },
  heading: "#BD93F9",
  quote: "#F1FA8C",
  selection: "#44475A",
  highlight: "rgba(255, 184, 108, 0.3)",
  searchMatch: "#F1FA8C",
  callouts: {
    blue: ["#8BE9FD", "#8BE9FD"], green: ["#50FA7B", "#50FA7B"], purple: ["#BD93F9", "#BD93F9"],
    yellow: ["#F1FA8C", "#F1FA8C"], red: ["#FF5555", "#FF6E6E"], gray: ["#6272A4", "#BFC3D9"],
  },
  accent: { glyph: "#BD93F9", text: "#D6BCFA", fill: "#7349C2" },
};

// nordtheme.com (Polar Night / Snow Storm / Frost / Aurora), as in the VS Code port.
const nord: Theme = {
  id: "nord",
  name: "Nord",
  kind: "dark",
  source: "Nord (nordtheme.com)",
  palette: {
    editorBackground: "#2E3440", sidebarBackground: "#2A2F3A", titleBar: "#2A2F3A", panelBackground: "#2A2F3A",
    overlayBackground: "#3B4252", raised: "#3B4252", chip: "#434C5E",
    border: "#3B4252", strongBorder: "#4C566A",
    strongText: "#ECEFF4", text: "#E5E9F0", bodyText: "#D8DEE9", emphasizedSecondaryText: "#E5E9F0",
    secondaryText: "#B4BCCB", tertiaryText: "#8F9AAE", faintText: "#616E88",
    codeBackground: "#3B4252", synced: "#A3BE8C", warning: "#EBCB8B", danger: "#BF616A",
  },
  syntax: {
    keyword: "#81A1C1", control: "#81A1C1", string: "#A3BE8C", number: "#B48EAD", comment: "#616E88",
    function: "#88C0D0", type: "#8FBCBB", variable: "#D8DEE9", property: "#D8DEE9", attribute: "#8FBCBB",
    tag: "#81A1C1", punctuation: "#ECEFF4", regexp: "#EBCB8B", meta: "#D08770",
  },
  heading: "#88C0D0",
  selection: "#434C5E",
  highlight: "rgba(235, 203, 139, 0.3)",
  searchMatch: "#88C0D0",
  callouts: {
    blue: ["#81A1C1", "#88C0D0"], green: ["#A3BE8C", "#A3BE8C"], purple: ["#B48EAD", "#C7A9C1"],
    yellow: ["#EBCB8B", "#EBCB8B"], red: ["#BF616A", "#D88A91"], gray: ["#616E88", "#AEB7C6"],
  },
  accent: { glyph: "#88C0D0", text: "#88C0D0", fill: "#4C6F99" },
};

// GitHub's Primer "dark default" (as in the GitHub Dark Default VS Code theme).
const githubDark: Theme = {
  id: "github-dark",
  name: "GitHub Dark",
  kind: "dark",
  source: "GitHub Primer dark default",
  palette: {
    editorBackground: "#0D1117", sidebarBackground: "#010409", titleBar: "#010409", panelBackground: "#010409",
    overlayBackground: "#161B22", raised: "#161B22", chip: "#21262D",
    border: "#30363D", strongBorder: "#3D444D",
    strongText: "#F0F6FC", text: "#E6EDF3", bodyText: "#E6EDF3", emphasizedSecondaryText: "#C9D1D9",
    secondaryText: "#8B949E", tertiaryText: "#7D8590", faintText: "#6E7681",
    codeBackground: "#161B22", synced: "#3FB950", warning: "#D29922", danger: "#F85149",
  },
  syntax: {
    keyword: "#FF7B72", control: "#FF7B72", string: "#A5D6FF", number: "#79C0FF", comment: "#8B949E",
    function: "#D2A8FF", type: "#FFA657", variable: "#E6EDF3", property: "#79C0FF", attribute: "#79C0FF",
    tag: "#7EE787", punctuation: "#C9D1D9", regexp: "#7EE787", meta: "#D2A8FF",
  },
  quote: "#8B949E",
  highlight: "rgba(187, 128, 9, 0.4)",
  searchMatch: "#FFD33D",
  callouts: {
    blue: ["#4493F8", "#4493F8"], green: ["#3FB950", "#3FB950"], purple: ["#AB7DF8", "#AB7DF8"],
    yellow: ["#D29922", "#D29922"], red: ["#F85149", "#F85149"], gray: ["#8B949E", "#8B949E"],
  },
  accent: { glyph: "#4493F8", text: "#58A6FF", fill: "#1F6FEB" },
};

// Ethan Schoonover's Solarized (ethanschoonover.com/solarized), dark background.
const solarizedDark: Theme = {
  id: "solarized-dark",
  name: "Solarized Dark",
  kind: "dark",
  source: "Solarized (ethanschoonover.com/solarized)",
  palette: {
    editorBackground: "#002B36", sidebarBackground: "#00212B", titleBar: "#00212B", panelBackground: "#00212B",
    overlayBackground: "#00212B", raised: "#073642", chip: "#073642",
    border: "#0A3B47", strongBorder: "#1B4B57",
    strongText: "#EEE8D5", text: "#93A1A1", bodyText: "#93A1A1", emphasizedSecondaryText: "#93A1A1",
    secondaryText: "#839496", tertiaryText: "#6F8A92", faintText: "#586E75",
    codeBackground: "#073642", synced: "#859900", warning: "#B58900", danger: "#DC322F",
  },
  syntax: {
    keyword: "#859900", control: "#859900", string: "#2AA198", number: "#D33682", comment: "#586E75",
    function: "#268BD2", type: "#CB4B16", variable: "#268BD2", property: "#839496", attribute: "#93A1A1",
    tag: "#268BD2", punctuation: "#839496", regexp: "#DC322F", meta: "#6C71C4",
  },
  heading: "#268BD2",
  selection: "#274642",
  highlight: "rgba(181, 137, 0, 0.35)",
  searchMatch: "#B58900",
  callouts: {
    blue: ["#268BD2", "#4FA6E3"], green: ["#859900", "#A3B92A"], purple: ["#6C71C4", "#9A9EE0"],
    yellow: ["#B58900", "#D3A62B"], red: ["#DC322F", "#EE6A63"], gray: ["#586E75", "#93A1A1"],
  },
  accent: { glyph: "#268BD2", text: "#4FA6E3", fill: "#1D6EA8" },
};

// VS Code "Default Light+" (light_vs.json + light_plus.json, and the workbench defaults).
const lightPlus: Theme = {
  id: "light-plus",
  name: "Light+",
  kind: "light",
  source: "VS Code Default Light+",
  palette: {
    editorBackground: "#FFFFFF", sidebarBackground: "#F3F3F3", titleBar: "#DDDDDD", panelBackground: "#F3F3F3",
    overlayBackground: "#F3F3F3", raised: "#FFFFFF", chip: "#E4E4E4",
    border: "#E5E5E5", strongBorder: "#CECECE",
    strongText: "#000000", text: "#3B3B3B", bodyText: "#000000", emphasizedSecondaryText: "#3B3B3B",
    secondaryText: "#616161", tertiaryText: "#6E6E6E", faintText: "#A0A0A0",
    codeBackground: "#F3F3F3", synced: "#388A34", warning: "#BF8803", danger: "#C72E0F",
  },
  syntax: {
    keyword: "#0000FF", control: "#AF00DB", string: "#A31515", number: "#098658", comment: "#008000",
    function: "#795E26", type: "#267F99", variable: "#001080", property: "#001080", attribute: "#E50000",
    tag: "#800000", punctuation: "#000000", regexp: "#811F3F", meta: "#AF00DB",
  },
  heading: "#800000",
  quote: "#0451A5",
  selection: "#ADD6FF",
  highlight: "rgba(255, 214, 0, 0.42)",
  searchMatch: "#EA5C00",
  callouts: {
    blue: ["#007ACC", "#005FB8"], green: ["#388A34", "#2D7029"], purple: ["#AF00DB", "#8F00B3"],
    yellow: ["#BF8803", "#835E00"], red: ["#E51400", "#A1260D"], gray: ["#6E6E6E", "#4D4D4D"],
  },
  accent: { glyph: "#005FB8", text: "#005FB8", fill: "#005FB8" },
};

// GitHub's Primer "light default" (as in the GitHub Light Default VS Code theme).
const githubLight: Theme = {
  id: "github-light",
  name: "GitHub Light",
  kind: "light",
  source: "GitHub Primer light default",
  palette: {
    editorBackground: "#FFFFFF", sidebarBackground: "#F6F8FA", titleBar: "#F6F8FA", panelBackground: "#F6F8FA",
    overlayBackground: "#FFFFFF", raised: "#FFFFFF", chip: "#EAEEF2",
    border: "#D8DEE4", strongBorder: "#D0D7DE",
    strongText: "#1F2328", text: "#1F2328", bodyText: "#1F2328", emphasizedSecondaryText: "#424A53",
    secondaryText: "#57606A", tertiaryText: "#656D76", faintText: "#8C959F",
    codeBackground: "#F6F8FA", synced: "#1A7F37", warning: "#9A6700", danger: "#CF222E",
  },
  syntax: {
    keyword: "#CF222E", control: "#CF222E", string: "#0A3069", number: "#0550AE", comment: "#6E7781",
    function: "#8250DF", type: "#953800", variable: "#1F2328", property: "#0550AE", attribute: "#0550AE",
    tag: "#116329", punctuation: "#1F2328", regexp: "#116329", meta: "#8250DF",
  },
  quote: "#656D76",
  highlight: "rgba(255, 212, 59, 0.45)",
  searchMatch: "#FFD33D",
  callouts: {
    blue: ["#0969DA", "#0969DA"], green: ["#1A7F37", "#1A7F37"], purple: ["#8250DF", "#8250DF"],
    yellow: ["#9A6700", "#9A6700"], red: ["#D1242F", "#D1242F"], gray: ["#656D76", "#656D76"],
  },
  accent: { glyph: "#0969DA", text: "#0969DA", fill: "#0969DA" },
};

// Solarized, light background. Body text is base01 rather than base00: base00
// on base3 is only ~4.1:1 (below WCAG AA).
const solarizedLight: Theme = {
  id: "solarized-light",
  name: "Solarized Light",
  kind: "light",
  source: "Solarized (ethanschoonover.com/solarized)",
  palette: {
    editorBackground: "#FDF6E3", sidebarBackground: "#EEE8D5", titleBar: "#EEE8D5", panelBackground: "#EEE8D5",
    overlayBackground: "#FDF6E3", raised: "#FDF6E3", chip: "#E4DDC8",
    border: "#DDD6C1", strongBorder: "#CCC4AE",
    strongText: "#073642", text: "#073642", bodyText: "#586E75", emphasizedSecondaryText: "#586E75",
    secondaryText: "#586E75", tertiaryText: "#657B83", faintText: "#93A1A1",
    codeBackground: "#EEE8D5", synced: "#859900", warning: "#B58900", danger: "#DC322F",
  },
  syntax: {
    keyword: "#859900", control: "#859900", string: "#2AA198", number: "#D33682", comment: "#93A1A1",
    function: "#268BD2", type: "#CB4B16", variable: "#268BD2", property: "#657B83", attribute: "#586E75",
    tag: "#268BD2", punctuation: "#657B83", regexp: "#DC322F", meta: "#6C71C4",
  },
  heading: "#268BD2",
  highlight: "rgba(181, 137, 0, 0.25)",
  searchMatch: "#B58900",
  callouts: {
    blue: ["#268BD2", "#1B6FA8"], green: ["#859900", "#5F6E00"], purple: ["#6C71C4", "#5357AE"],
    yellow: ["#B58900", "#7F6000"], red: ["#DC322F", "#B02220"], gray: ["#93A1A1", "#586E75"],
  },
  accent: { glyph: "#268BD2", text: "#1B6FA8", fill: "#1D6EA8" },
};

/** Every theme, dark ones first, in picker order. */
export const themes: readonly Theme[] = [
  holocronDark, darkPlus, oneDark, dracula, nord, githubDark, solarizedDark,
  holocronLight, lightPlus, githubLight, solarizedLight,
];

export const darkThemes = themes.filter((theme) => theme.kind === "dark");
export const lightThemes = themes.filter((theme) => theme.kind === "light");
export const darkThemeIds = darkThemes.map((theme) => theme.id);
export const lightThemeIds = lightThemes.map((theme) => theme.id);
export const DEFAULT_DARK_THEME = holocronDark.id;
export const DEFAULT_LIGHT_THEME = holocronLight.id;

const byId = new Map(themes.map((theme) => [theme.id, theme]));

export function themeById(id: string): Theme | undefined {
  return byId.get(id);
}

/** The theme for the effective appearance; unknown ids fall back to Holocron's own. */
export function resolveTheme(isDark: boolean, settings: { darkTheme: string; lightTheme: string }): Theme {
  const theme = byId.get(isDark ? settings.darkTheme : settings.lightTheme);
  if (theme && theme.kind === (isDark ? "dark" : "light")) return theme;
  return isDark ? holocronDark : holocronLight;
}

/** The accent in use: the theme's own ("theme") or a crystal in the theme's kind. */
export function accentColors(theme: Theme, accent: Crystal | "theme"): AccentColors {
  const crystal = accent === "theme" ? undefined : crystals[accent];
  if (!crystal) return theme.accent;
  return theme.kind === "dark"
    ? { glyph: crystal.dark, text: crystal.darkText, fill: crystal.fill }
    : { glyph: crystal.light, text: crystal.lightText, fill: crystal.fill };
}

/** The native window's colours: its background (no flash before paint) and the title-bar overlay. */
export function windowColors(theme: Theme) {
  return {
    background: theme.palette.sidebarBackground,
    titleBarOverlay: { color: theme.palette.titleBar, symbolColor: theme.palette.emphasizedSecondaryText },
  };
}

// MARK: Colour maths

/** "#RRGGBB" → "r, g, b" for rgba(var(--x), a). */
export function rgbTriple(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** WCAG relative luminance of "#RRGGBB". */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two "#RRGGBB" colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
