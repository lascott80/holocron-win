// Installed font families, read from the Windows registry (§16.11). Each
// entry there is "<face name> (TrueType)" → a file name; faces of one family
// ("Arial", "Arial Bold", "Arial Italic") collapse to the family name.

import { execFile } from "node:child_process";

const FONT_KEYS = [
  String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`,
  String.raw`HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`,
];

/**
 * Face-style words a registry name may end with; stripped one at a time until
 * none remain. Only the ones that never form a family name: "Segoe UI Light",
 * "Arial Black" and "Franklin Gothic Medium" are families in their own right
 * (and work as font-family names), so weights and widths stay.
 */
const STYLE_WORDS = new Set(["regular", "bold", "italic", "oblique"]);

/** A family name's position in the list: case-insensitive, numbers in order. */
function compareFamilies(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || a.localeCompare(b, "en");
}

/** "Segoe UI Semibold Italic" → "Segoe UI"; "Arial" → "Arial". */
export function familyName(face: string): string {
  const words = face.trim().split(/\s+/);
  while (words.length > 1 && STYLE_WORDS.has(words[words.length - 1]!.toLowerCase().replace(/-/g, ""))) words.pop();
  return words.join(" ");
}

/**
 * Family names from the output of `reg query …\Fonts`, each line being
 * "    <name> (TrueType)    REG_SZ    <file>". The "(TrueType)" / "(OpenType)"
 * suffix goes, "A & B" entries become two families, faces collapse to their
 * family, and the result is de-duplicated and sorted.
 */
export function parseFontNames(output: string): string[] {
  const seen = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^(.*?)\s{2,}REG_(?:SZ|EXPAND_SZ)\s{2,}(.*)$/.exec(line) ?? /^(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line);
    if (!match) continue;
    let name = match[1]!.trim();
    if (!name) continue;
    // "(TrueType)", "(OpenType)", "(All res)", "(VGA res)", "(8514 res)"…
    name = name.replace(/\s*\([^()]*\)\s*$/g, "").trim();
    for (const part of name.split(/\s+&\s+/)) {
      const family = familyName(part);
      if (!family || /^@/.test(family)) continue; // "@" entries are vertical variants
      const key = family.toLowerCase();
      if (!seen.has(key)) seen.set(key, family);
    }
  }
  return [...seen.values()].sort(compareFamilies);
}

function regQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("reg", ["query", key], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

let cached: Promise<string[]> | null = null;

/**
 * The installed font families (machine-wide and per-user), sorted; cached
 * for the session. Empty on other platforms or when the registry can't be
 * read, in which case Settings falls back to a plain text field.
 */
export function listInstalledFonts(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  cached ??= Promise.all(FONT_KEYS.map(regQuery)).then((outputs) => parseFontNames(outputs.join("\n")));
  return cached;
}
