// Smoke script: reading and formatting features (REQUIREMENTS ED-62 to ED-70):
// text zoom, typography, heading trail and [TOC], footnote previews, image
// captions, resizing, galleries and viewer stepping, code blocks, tables,
// maths in callouts, HTML in table cells, Tidy Note and export. Run against a
// vault with Attachments/logo.png and Attachments/diagram.png:
//
//   node scripts/smoke.mjs smoke-output --vault <folder> --script scripts/smoke-reading.mjs
import fs from "node:fs";
import path from "node:path";

const filler = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} of filler text that runs long enough to wrap onto a second line in the editor at its usual width.`).join("\n\n");

export const NOTE = `# Reading test

[TOC]

## Pictures

![The Holocron logo](Attachments/logo.png)

![[logo.png]]
![[diagram.png]]

## Notes

A claim that needs a source.[^1] And another.[^cite]

${filler(8)}

### Deep section

${filler(6)}

## Code and tables

\`\`\`ts title="sync.ts" {2,4-5} linenos
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
\`\`\`

| Name | Size |
| --- | --- |
| Gamma | 30 |
| Alpha | 4 |
| Beta | 200 |
| <span style="color: red" title="hot">Delta</span> | 1,000 |

> [!note] Maths in a callout
> $$
> e^{i\\pi} + 1 = 0
> $$

* messy  bullet
+ another

[^1]: The source, with **bold** text.
[^cite]: Second footnote
  continued on an indented line.
`;

const log = (...args) => console.log("[reading]", ...args);
const call = (page, ...args) => page.evaluate((args) => window.holocronHost.call(...args), args);

export default async function ({ app, page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Reading Test.md"), NOTE);
  await page.waitForTimeout(600);
  await call(page, "open", "Reading Test.md");
  await page.waitForTimeout(1500);
  await shot("top");

  // [TOC] and gallery.
  log("toc items:", await page.locator(".cm-toc-item").allInnerTexts());
  log("gallery images:", await page.locator(".cm-image-gallery .cm-image").count(), "captions:", await page.locator(".cm-image-caption").allInnerTexts());

  // Text zoom.
  const size = () => page.evaluate(() => getComputedStyle(document.querySelector(".cm-editor")).fontSize);
  log("font size before zoom:", await size());
  await page.locator(".cm-content").click({ position: { x: 40, y: 400 } });
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  await page.waitForTimeout(300);
  log("after Ctrl+= twice:", await size());
  await page.keyboard.press("Control+0");
  await page.waitForTimeout(300);
  log("after Ctrl+0:", await size());

  // Footnote preview (with the cursor away from that line, so it renders).
  await page.evaluate(() => window.holocron.scrollToLine(1));
  await page.waitForTimeout(300);
  // The editor only draws what's on screen: scroll until the reference is.
  for (let i = 0; i < 20 && (await page.locator(".cm-footnote-ref").count()) === 0; i++) {
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop += 250));
    await page.waitForTimeout(150);
  }
  await page.locator(".cm-footnote-ref").first().hover();
  await page.waitForTimeout(300);
  log("footnote popover:", JSON.stringify(await page.locator(".cm-footnote-popover.is-shown").innerText().catch(() => null)));
  await shot("footnote-popover");

  // Heading trail once the headings have scrolled away.
  for (let i = 0; i < 30 && !(await page.locator(".cm-heading-trail.is-shown").innerText().catch(() => "")).includes("Deep section"); i++) {
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop += 200));
    await page.waitForTimeout(150);
  }
  log("heading trail:", JSON.stringify(await page.locator(".cm-heading-trail.is-shown").innerText().catch(() => null)));
  await shot("heading-trail");

  // Viewer stepping from the gallery.
  await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(300);
  await page.locator(".cm-image-gallery .cm-image").first().dblclick();
  await page.waitForTimeout(700);
  log("viewer counter:", await page.locator(".hc-diagram-viewer-counter").innerText().catch(() => null));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(700);
  log("after →:", await page.locator(".hc-diagram-viewer-counter").innerText().catch(() => null), await page.locator(".hc-diagram-viewer-caption").innerText().catch(() => null));
  await shot("viewer-step");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Resize the captioned image by dragging its corner.
  const frame = page.locator(".cm-image-frame").first();
  await frame.hover();
  const handle = frame.locator(".cm-image-resize");
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, box.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  const text = await page.evaluate(() => window.holocron.getText());
  log("after resize:", JSON.stringify(text.split("\n").find((line) => line.includes("Holocron logo"))));

  // Reading view: footnotes heading, typography.
  await call(page, "setSetting", "editorMode", "reading");
  await page.waitForTimeout(600);
  for (let i = 0; i < 40 && (await page.locator(".cm-footnotes-start").count()) === 0; i++) {
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop += 300));
    await page.waitForTimeout(120);
  }
  await page.locator(".cm-footnotes-start").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("reading-footnotes");
  await call(page, "setSetting", "paragraphSpacing", "compact");
  await call(page, "setSetting", "readingFont", "serif");
  await page.waitForTimeout(500);
  log("blank line height (compact):", await page.locator(".cm-blank-line").first().evaluate((el) => el.getBoundingClientRect().height).catch(() => null));
  await shot("reading-compact-serif");

  // Dark images.
  await call(page, "setSetting", "darkImages", "invertLight");
  await page.waitForTimeout(500);
  await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(300);
  log("light images detected:", await page.locator(".cm-image-light").count());
  await shot("dark-invert");

  // Code block, table sorting, HTML in a cell, maths in a callout (reading view).
  const reveal = async (selector) => {
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(400); // let the editor redraw before looking
    for (let i = 0; i < 40 && (await page.locator(selector).count()) === 0; i++) {
      await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop += 250));
      await page.waitForTimeout(100);
    }
    await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  };
  await reveal(".cm-code-title");
  log("code title:", await page.locator(".cm-code-title").first().innerText().catch(() => null),
    "numbered lines:", await page.locator(".cm-code-numbered").count(), "highlighted:", await page.locator(".cm-code-highlighted").count());
  await shot("code-block");
  await reveal(".cm-table-widget");
  const names = () => page.locator(".cm-table-widget tbody tr td:first-child").allInnerTexts();
  log("table rows:", await names(), "html cell:", await page.locator(".cm-table-widget span[title=hot]").count());
  await page.locator(".cm-table-widget th").nth(1).click();
  await page.waitForTimeout(200);
  log("sorted by size:", await names());
  await page.locator(".cm-table-widget th").first().click();
  await page.locator(".cm-table-widget th").first().click();
  await page.waitForTimeout(200);
  log("sorted by name, descending:", await names());
  await shot("table-sorted");
  await reveal(".cm-callout .katex, .cm-callout-first .katex");
  log("maths in callout rendered:", await page.locator(".cm-callout .katex, .cm-callout-first .katex").count());
  await shot("callout-maths");

  // Tidy Note (live preview).
  await call(page, "setSetting", "editorMode", "livePreview");
  await page.waitForTimeout(600);
  await page.evaluate(() => window.holocron.run("tidyNote"));
  await page.waitForTimeout(300);
  const tidied = await page.evaluate(() => window.holocron.getText());
  log("tidied bullets:", JSON.stringify(tidied.split("\n").filter((line) => /messy|another/.test(line))));
  await page.evaluate(() => window.holocron.run("undo"));
  await page.waitForTimeout(200);
  log("undo restores:", (await page.evaluate(() => window.holocron.getText())).includes("* messy  bullet"));

  // Export: the real path, with the Save dialog answered for us.
  const out = path.join(path.dirname(vault), "exports");
  fs.mkdirSync(out, { recursive: true });
  for (const format of ["pdf", "html"]) {
    const file = path.join(out, `Reading Test.${format}`);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await page.evaluate((format) => window.holocron.exportHtml("Reading Test").then((html) => window.holocronHost.call("exportNote", format, html)), format);
    await page.waitForTimeout(500);
    const ok = fs.existsSync(file);
    const head = ok ? fs.readFileSync(file).subarray(0, 5).toString() : "";
    const html = format === "html" && ok ? fs.readFileSync(file, "utf8") : "";
    log(`export ${format}:`, ok ? `${fs.statSync(file).size} bytes, starts ${JSON.stringify(head)}` : "missing",
      format === "html" ? `images inlined: ${(html.match(/data:image/g) ?? []).length}, MathML: ${html.includes("<math")}, title: ${html.includes("<title>Reading Test</title>")}` : "");
    if (format === "pdf" && ok) fs.copyFileSync(file, path.join(process.argv[2] ?? ".", "export.pdf"));
  }
  log("toast:", await page.locator(".toast, [role=status]").first().innerText().catch(() => null));
}
