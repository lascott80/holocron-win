// File › Export as PDF / Export as HTML / Print: the whole note as one
// standalone HTML page, light-themed like rich copy (markdownToHtml.js), with
// images and diagrams embedded as data URIs, code coloured and maths drawn as
// MathML (which Chromium and other browsers render natively, so the page needs
// no fonts or scripts). The app saves it, prints it to PDF, or prints it.
import { collectResources, escapeHtml, markdownToHtml } from "./markdownToHtml.js";
import { assetSource } from "./images.js";
import { codeLanguage } from "./codeblocks.js";
import { highlightCode, loadDiagram, loadImage, sanitizeForClipboard } from "./richCopy.js";
import * as mermaid from "./mermaid.js";
import { Text } from "@codemirror/state";
import { noteHeadings, TOC_LINE } from "./headings.js";

const PAGE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; font-size: 15px; line-height: 1.6;
         color: #1f2328; background: #ffffff; max-width: 780px; margin: 40px auto; padding: 0 28px; }
  h1, h2, h3, h4, h5, h6 { color: #111418; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  math[display="block"] { display: block; margin: 0.6em 0 0.9em; }
  @page { margin: 16mm 15mm; }
  @media print {
    body { margin: 0 auto; padding: 0; max-width: none; }
    h1, h2, h3, h4 { break-after: avoid; }
    pre, table, img, blockquote, figure, math[display="block"] { break-inside: avoid; }
  }`;

let katex = null;
async function loadKatex() {
  katex ??= (await import("katex")).default;
  return katex;
}

/** TeX as MathML, or the source in a <code> if KaTeX can't read it. */
function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, output: "mathml", throwOnError: false, strict: "ignore" });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

/** `[TOC]` lines (outside code) as a nested list of the note's headings, as the editor shows them. */
export function withTableOfContents(markdown) {
  if (!/^\s*\[(?:TOC|toc)\]\s*$/m.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const headings = noteHeadings(Text.of(lines));
  const top = Math.min(...headings.map((h) => h.level));
  const list = headings.length
    ? headings.map((h) => `${"  ".repeat(h.level - top)}- ${h.text}`).join("\n")
    : "*No headings yet.*";
  let fence = null;
  return lines
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0]) fence = null;
        return line;
      }
      if (marker) {
        fence = marker[1];
        return line;
      }
      return TOC_LINE.test(line) ? `**Contents**\n\n${list}\n` : line;
    })
    .join("\n");
}

/**
 * The note as a complete HTML document. `title` names the page (and the PDF's
 * document title). Images, diagrams and code languages load first, so this
 * can take a moment for a long note.
 */
export async function exportHtml(note, title) {
  const markdown = withTableOfContents(note);
  const resources = collectResources(markdown);
  const urls = new Map(resources.images.map((image) => [image.key, assetSource(image.kind, image.target)]));
  const images = {};
  const diagrams = {};
  const tasks = [];
  for (const image of resources.images) {
    tasks.push(loadImage(urls.get(image.key)).then((loaded) => loaded && (images[image.key] = loaded)).catch(() => null));
  }
  if (typeof mermaid.diagramImage === "function") {
    for (const code of resources.diagrams) {
      tasks.push(loadDiagram(code).then((loaded) => loaded && (diagrams[code] = loaded)).catch(() => null));
    }
  }
  for (const language of resources.languages) {
    const description = codeLanguage(language);
    if (description && !description.support) tasks.push(description.load().catch(() => null));
  }
  const hasMath = /\$/.test(markdown);
  if (hasMath) tasks.push(loadKatex().catch(() => null));
  await Promise.all(tasks);

  // Maths can't go through the notes' sanitiser (it drops MathML): leave
  // placeholders (private-use characters, which survive as text), sanitise,
  // then put the formulas in.
  const formulas = [];
  const body = markdownToHtml(markdown, {
    images,
    diagrams,
    sanitize: (html) => sanitizeForClipboard(html, images),
    highlight: highlightCode,
    math: katex
      ? (tex, display) => {
          formulas.push(renderMath(tex, display));
          const marker = `${formulas.length - 1}`;
          return display ? `<div>${marker}</div>\n` : marker;
        }
      : undefined,
  }).replace(/(\d+)/g, (_, index) => formulas[Number(index)] ?? "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Holocron">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
