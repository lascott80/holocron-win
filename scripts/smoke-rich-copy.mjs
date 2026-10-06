// Smoke script: rich copy. Live preview and reading view put markdown +
// email-safe HTML on the clipboard (images and diagrams as PNG data URIs after
// the async pass); source mode and Copy as Markdown copy markdown only. The
// clipboard HTML is shown in a plain white window, like a paste target.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const NOTE = `---
tags: [demo]
---
# Release notes :rocket:

The **new build** is _ready_ — see [[Roadmap|the roadmap]] and #project/alpha. This is ==important==.
Inline \`code\` and math $E = mc^2$ and a [link](https://example.com).

## Checklist

- [x] Write the code
- [ ] Ship it
  - nested bullet
1. First
2. Second

| Feature | Status | Owner |
| :------ | :----: | ----: |
| Copy    | done   | Ana   |
| Paste   | *wip*  | Bo    |

> [!warning] Heads up
> Callouts keep their **colour**.

> Plain quote with a footnote[^1].

\`\`\`js
// greet someone
const greet = (name) => \`Hello \${name} <3\`;
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Write] --> B{Copy?}
  B -- yes --> C[Paste in Outlook]
\`\`\`

![[photo.png|240]]

%% hidden comment %%
[^1]: The footnote text.
`;

/** A small RGB PNG (gradient with a stripe), so the vault has a real image. */
function makePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const stripe = Math.abs(x - y * 1.5) < 12;
      row[1 + x * 3] = stripe ? 255 : Math.round((x / width) * 90 + 30);
      row[2 + x * 3] = stripe ? 200 : Math.round((y / height) * 120 + 90);
      row[3 + x * 3] = stripe ? 60 : 210;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const check = (label, ok) => console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);

export default async function ({ app, page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Rich Copy.md"), NOTE);
  fs.mkdirSync(path.join(vault, "Attachments"), { recursive: true });
  fs.writeFileSync(path.join(vault, "Attachments", "photo.png"), makePng(360, 200));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Rich Copy.md"));
  await page.waitForTimeout(3500);
  await shot("live-preview");

  // Electron's clipboard is asynchronous (W3C-style ClipboardItems).
  const readClipboard = () => app.evaluate(async ({ clipboard }) => {
    const text = await clipboard.readText();
    let html = "";
    for (const item of await clipboard.read()) {
      if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
    }
    return { text, html };
  });
  const resetClipboard = () => app.evaluate(({ clipboard }) => clipboard.writeText("(before)"));
  const selectAllAndPress = async (key) => {
    await page.locator(".cm-content").first().click({ position: { x: 300, y: 10 } });
    await page.keyboard.press("Control+a");
    await page.keyboard.press(key);
  };

  // Live preview: both formats, then the async pass adds the diagram and image.
  await resetClipboard();
  await selectAllAndPress("Control+c");
  await page.waitForTimeout(150);
  const first = await readClipboard();
  check("live: sync HTML present", first.html.includes("<table"));
  await page.waitForTimeout(3000);
  const live = await readClipboard();
  const markdown = await page.evaluate(() => window.holocron.getText());
  check("live: text is the markdown", live.text.replace(/\r\n/g, "\n") === markdown);
  check("live: html has a table", live.html.includes("<table"));
  const pngs = live.html.match(/<img src="data:image\/png/g)?.length ?? 0;
  check(`live: html has diagram + image PNGs (${pngs})`, pngs >= 2);
  check("live: no class attributes", !/class=/.test(live.html));
  check("live: inline styles", /style="/.test(live.html));
  check("live: no placeholders left", !live.html.includes("[Diagram]") && !live.html.includes("[Image:"));
  check("live: frontmatter and comment removed", !live.html.includes("tags: [demo]") && !live.html.includes("hidden comment"));
  console.log("html length:", live.html.length);

  // Show the HTML as a paste target would: a plain white page with a mail font.
  const out = path.join(path.dirname(vault), "pasted.html");
  const fragment = live.html.replace(/^[\s\S]*?<!--StartFragment-->/, "").replace(/<!--EndFragment-->[\s\S]*$/, "");
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><body style="margin:24px;background:#fff;color:#222;font-family:Aptos,Calibri,'Segoe UI',sans-serif;font-size:15px">${fragment}</body>`);
  const pasteWindow = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }, file) => {
    const win = new BrowserWindow({ width: 820, height: 1400, show: true, webPreferences: { javascript: false } });
    void win.loadFile(file);
  }, out);
  const pastePage = await pasteWindow;
  await pastePage.waitForLoadState();
  await pastePage.waitForTimeout(800);
  const pasteShot = path.join((await import("node:os")).tmpdir(), "holocron-rich-copy-paste.png");
  await pastePage.screenshot({ path: process.env.RICH_COPY_SHOT ?? pasteShot, fullPage: true });
  console.log("paste screenshot:", process.env.RICH_COPY_SHOT ?? pasteShot);
  await pastePage.close();

  // Copy as Markdown: text only, even in live preview.
  await resetClipboard();
  await selectAllAndPress("Control+Shift+c");
  await page.waitForTimeout(3000);
  const plain = await readClipboard();
  check("copy as markdown: text", plain.text.replace(/\r\n/g, "\n") === markdown);
  check(`copy as markdown: no html (${plain.html.length})`, !plain.html.includes("<table"));

  // A partial selection: one line.
  await resetClipboard();
  await page.evaluate(() => window.holocron.selectInLine(6, 0, 200));
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(500);
  const line = await readClipboard();
  console.log("partial text:", JSON.stringify(line.text));
  check("partial: highlight rendered", line.html.includes("<mark"));

  // Cut removes the text and still copies rich.
  await resetClipboard();
  await page.evaluate(() => window.holocron.selectInLine(4, 0, 200));
  await page.keyboard.press("Control+x");
  await page.waitForTimeout(500);
  const cut = await readClipboard();
  const afterCut = await page.evaluate(() => window.holocron.getText());
  check("cut: text removed from the note", !afterCut.includes("# Release notes"));
  check("cut: html heading", cut.html.includes("<h1"));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);

  // Reading view: rich.
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.waitForTimeout(1200);
  await resetClipboard();
  await selectAllAndPress("Control+c");
  await page.waitForTimeout(3000);
  const reading = await readClipboard();
  const readingText = reading.text.replace(/\r\n/g, "\n");
  check("reading: text is the markdown", readingText === markdown);
  if (readingText !== markdown) console.log("reading text:", JSON.stringify(readingText.slice(0, 80)), "…", JSON.stringify(readingText.slice(-60)), readingText.length, "vs", markdown.length);
  check("reading: html has table + PNGs", reading.html.includes("<table") && (reading.html.match(/data:image\/png/g)?.length ?? 0) >= 2);
  await shot("reading-view");

  // Reading view, a selection dragged with the mouse: the checklist.
  await page.locator(".cm-scroller").first().evaluate((el) => (el.scrollTop = 0));
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  const from = await page.locator(".cm-line", { hasText: "Checklist" }).first().boundingBox();
  const to = await page.locator(".cm-line", { hasText: "Second" }).first().boundingBox();
  await resetClipboard();
  // A click first collapses the select-all (pressing inside a selection would drag it).
  await page.mouse.click(from.x + 2, from.y + from.height / 2);
  await page.waitForTimeout(400);
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 200, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(500);
  const part = await readClipboard();
  console.log("reading partial text:", JSON.stringify(part.text));
  check("reading partial: markdown + html list", part.text.includes("Checklist") && part.text.includes("- [ ] Ship it") && part.html.includes("☐") && !part.html.includes("<h1"));
  await resetClipboard();
  await page.keyboard.press("Control+Shift+c");
  await page.waitForTimeout(500);
  const partPlain = await readClipboard();
  const lf = (text) => text.replace(/\r\n/g, "\n");
  check("reading copy as markdown: markdown only", lf(partPlain.text) === lf(part.text) && !partPlain.html.includes("<li"));

  // Source mode: markdown only.
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "source"));
  await page.waitForTimeout(1200);
  await resetClipboard();
  await selectAllAndPress("Control+c");
  await page.waitForTimeout(2000);
  const source = await readClipboard();
  // (Leaving the table tidied its padding, so compare with the note as it is now.)
  check("source: text is the markdown", source.text.replace(/\r\n/g, "\n") === (await page.evaluate(() => window.holocron.getText())));
  check(`source: no rich html (${source.html.length})`, !source.html.includes("<table") && !source.html.includes("style="));
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "livePreview"));
  await page.waitForTimeout(500);
}
