// Naming new notes from their first line (FOP-05).

import { stem } from "./paths";

const trimSpaces = (text: string) => text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");

/**
 * Strips the markdown most likely to appear in a heading: [[a|b]] → b,
 * [a](x) → a, **b** → b. Mirrors noteParser.plainText (kept local so this
 * module stands alone).
 */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (_m, _target: string, label: string) => label)
    .replace(/\[\[([^\]]*)\]\]/g, (_m, target: string) => target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, label: string) => label)
    .replace(/(\*\*|__|~~|==|\*|_|`)/g, "");
}

/** Windows device names, which can't be file names. */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** "Untitled", "Untitled 2", … — placeholder names safe to replace. */
export function isPlaceholderName(path: string): boolean {
  return /^Untitled( \p{Nd}+)?$/u.test(stem(path));
}

/**
 * A file name from a note's first line: properties skipped, markdown and
 * characters that can't be in file names removed, at most ~80 characters
 * (cut at a word). Null if there's no usable text yet.
 */
export function titleFromContent(text: string): string | null {
  let lines = text.split("\n");
  if (trimSpaces(lines[0]!) === "---") {
    const close = lines.findIndex((line, i) => i > 0 && ["---", "..."].includes(trimSpaces(line)));
    if (close >= 0) lines = lines.slice(close + 1);
  }
  const first = lines.find((line) => trimSpaces(line) !== "");
  if (first === undefined) return null;
  let title = trimSpaces(first);
  title = title.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/u, "");
  title = plainText(title);
  title = title.replace(/\s\^[A-Za-z0-9-]+$/u, ""); // block id
  title = title.replace(/[/\\:*?"<>|[\]#^\p{Cc}\p{Cf}]/gu, "");
  title = title.replace(/\s+/gu, " ").replace(/^[\t\p{Zs}.]+|[\t\p{Zs}.]+$/gu, "");
  // Swift counts grapheme clusters; code points are close enough here.
  const characters = Array.from(title);
  if (characters.length > 80) {
    const cut = characters.slice(0, 80).join("");
    const space = cut.lastIndexOf(" ");
    // Trailing dots are trimmed again too: Windows drops them from file names.
    title = (space >= 0 ? cut.slice(0, space) : cut).replace(/^[\t\p{Zs}]+|[\t\p{Zs}.]+$/gu, "");
  }
  if (title === "") return null;
  return RESERVED.test(title) ? `${title} note` : title;
}
