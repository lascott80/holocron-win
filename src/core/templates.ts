// Note templates: notes in the templates folder whose text is copied into
// new or existing notes, with {{placeholders}} filled in.

import { renderPlaceholders } from "./dailyNotes";

export const CURSOR_MARKER = "{{cursor}}";

export interface RenderedTemplate {
  /** The template's frontmatter YAML (without --- lines), if any. */
  frontmatter: string | null;
  /** Everything after the frontmatter, placeholders filled in. May still contain {{cursor}}, which callers turn into the cursor. */
  body: string;
}

const trimSpaces = (text: string) => text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");

/** Fills in placeholders and separates the frontmatter from the body. */
export function renderTemplate(template: string, title: string, dateFormat: string, date: Date = new Date()): RenderedTemplate {
  const filled = renderPlaceholders(template, date, title, dateFormat);
  const lines = filled.split("\n");
  const close = trimSpaces(lines[0]!) === "---"
    ? lines.findIndex((line, i) => i > 0 && ["---", "..."].includes(trimSpaces(line)))
    : -1;
  if (close < 0) return { frontmatter: null, body: filled };
  const yaml = lines.slice(1, close).join("\n");
  let body = lines.slice(close + 1).join("\n");
  if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter: yaml === "" ? null : yaml, body };
}

/** A complete new note from a rendered template, and where the cursor should go (UTF-16 offset), taken from {{cursor}} or the end. */
export function noteText(rendered: RenderedTemplate): { text: string; cursor: number } {
  let text = rendered.frontmatter !== null ? "---\n" + rendered.frontmatter + "\n---\n" : "";
  const body = rendered.body;
  const marker = body.indexOf(CURSOR_MARKER);
  if (marker >= 0) {
    return { text: text + body.replaceAll(CURSOR_MARKER, ""), cursor: text.length + marker };
  }
  text += body;
  return { text, cursor: text.length };
}
