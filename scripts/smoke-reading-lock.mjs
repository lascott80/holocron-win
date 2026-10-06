// Smoke script: in reading view, clicking anything never reveals raw markdown.
import fs from "node:fs";
import path from "node:path";

const NOTE = `---
tags: [demo]
status: draft
---

# Reading lock

Plain text with **bold** and $x^2$ math.

| Name | Value |
| ---- | ----- |
| a    | 1     |

<div align="center"><b>Centred</b></div>

\`\`\`js
const a = 1;
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

const RAW_MARKERS = ["| ----", "status: draft", "$x^2$", "<div align", "**bold**", "flowchart LR", "# Reading lock"];

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Lock.md"), NOTE);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Lock.md"));
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.waitForTimeout(3500);
  const visibleRaw = () =>
    page.evaluate((markers) => {
      const text = document.querySelector(".cm-content").innerText;
      return markers.filter((m) => text.includes(m));
    }, RAW_MARKERS);
  console.log("before clicks, raw visible:", JSON.stringify(await visibleRaw()));
  const targets = [".cm-properties", ".cm-table-widget td", ".cm-math", ".cm-html-block", ".cm-line >> nth=3", "h1, .cm-header-1"];
  for (const selector of targets) {
    const target = page.locator(selector).first();
    if (await target.count()) {
      await target.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
      // Close the diagram viewer if a click opened it.
      await page.keyboard.press("Escape").catch(() => {});
    }
    console.log(`after clicking ${selector}:`, JSON.stringify(await visibleRaw()));
  }
  await shot("reading-after-clicks");
}
