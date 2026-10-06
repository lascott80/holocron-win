// Smoke script: Paste as Markdown. Puts real clipboard contents (HTML + text
// from Word, Outlook, Teams, a web page, Excel and Holocron's own copy) on the
// system clipboard, presses Ctrl+V in a note and checks the markdown. Also
// Ctrl+Shift+V (plain text), pasting inside a code block, a URL over a
// selection, and pictures in the HTML (an Outlook-style file:/// temp image
// and a data: URI) being saved into the vault's Attachments folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const FIXTURES = path.resolve("tests/editor/fixtures");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

/** A small RGB PNG (gradient with a stripe). */
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

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail !== undefined ? `\n  got: ${JSON.stringify(detail)}` : ""}`);
};

export default async function ({ app, page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Paste Test.md"), "");
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Paste Test.md"));
  await page.waitForTimeout(1500);

  // Electron's clipboard is asynchronous (W3C-style ClipboardItems).
  const writeClipboard = (data) =>
    app.evaluate(async ({ clipboard, ClipboardItem }, data) => {
      const items = { "text/plain": new Blob([data.text ?? ""], { type: "text/plain" }) };
      if (data.html) items["text/html"] = new Blob([data.html], { type: "text/html" });
      await clipboard.write([new ClipboardItem(items)]);
    }, data);
  const readClipboard = () =>
    app.evaluate(async ({ clipboard }) => {
      const text = await clipboard.readText();
      let html = "";
      for (const item of await clipboard.read()) {
        if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
      }
      return { text, html };
    });
  const getText = () => page.evaluate(() => window.holocron.getText());
  const setText = async (text) => {
    await page.locator(".cm-content").first().click({ position: { x: 200, y: 10 } });
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    if (text) await page.evaluate((text) => window.holocron.insertAtCursor(text), text);
    await page.waitForTimeout(100);
  };
  const paste = async (data, { before = "", key = "Control+v", wait = 400 } = {}) => {
    await setText(before);
    await writeClipboard(data);
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
    return getText();
  };

  // Web page: headings, links, code, table, lists, no script.
  let text = await paste({ html: fixture("web.html"), text: "Installing the CLI\nRun the installer" });
  check("web: heading", text.startsWith("## Installing the CLI\n"), text.slice(0, 60));
  check("web: link kept, javascript dropped", text.includes("[CLI docs](https://example.com/docs/cli?tab=win)") && !text.includes("javascript"));
  check("web: python code block", text.includes("```python\ndef greet(name):"));
  check("web: table", text.includes("| OS      | Status |  Version |"));
  check("web: tasks", text.includes("- [ ] Docs\n- [x] Tests"));
  check("web: no script", !text.includes("alert"));
  await page.waitForTimeout(600);
  await shot("web-paste");

  // Word: lists, table, highlight.
  text = await paste({ html: fixture("word.html"), text: "Project Kyber status\r\nThe new build is ready." });
  check("word: heading + bold", text.startsWith("# Project Kyber status\n\nThe **new build** is *ready*"), text.slice(0, 80));
  check("word: nested bullets", text.includes("- First point\n  - A nested point with **bold**\n    - Deeper still\n- Second point"));
  check("word: numbered", text.includes("1. Plan the release\n   1. Draft notes\n2. Ship it"));
  check("word: table", text.includes("| Feature | Status        |"));
  check("word: highlight", text.includes("==Highlighted== and ~~struck~~"));
  await page.waitForTimeout(600);
  await shot("word-paste");

  // Teams: mentions and code.
  text = await paste({ html: fixture("teams.html"), text: "Hey Ana Lopez, the deploy script fails with:" });
  check("teams: mention", text.includes("Hey @Ana Lopez,"));
  check("teams: code block", text.includes("```powershell\nnpm.cmd run build\n"));
  check("teams: codeblock element", text.includes("```javascript\nconst a = 1;\nconsole.log(a);\n```"));

  // Outlook: a file:/// temp picture gets copied into Attachments.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "msohtmlclip-"));
  const clip = path.join(temp, "clip_image002.png");
  fs.writeFileSync(clip, makePng(320, 160));
  const clipUrl = "file:///" + clip.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:");
  const outlook = fixture("outlook.html").replaceAll("file:///C:/Users/ana/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png", clipUrl);
  text = await paste({ html: outlook, text: "Hi team,\r\n\r\nHere is the screenshot" }, { wait: 1500 });
  const attachments = () => (fs.existsSync(path.join(vault, "Attachments")) ? fs.readdirSync(path.join(vault, "Attachments")) : []);
  check("outlook: image embed inserted", /!\[\[clip_image002\.png\]\]/.test(text), text);
  check("outlook: attachment copied", attachments().includes("clip_image002.png"), attachments());
  check("outlook: safelink unwrapped", text.includes("[the report](https://example.com/report?id=7)"));
  check("outlook: signature", text.includes("**Ana Lopez**\nRelease Manager"));
  await page.waitForTimeout(800);
  await shot("outlook-paste");

  // A data: URI picture is saved as "Pasted image <stamp>.png".
  const dataUri = "data:image/png;base64," + makePng(120, 60).toString("base64");
  text = await paste({ html: `<p>Chart below:</p><p><img src="${dataUri}" alt="chart"></p><p>End.</p>`, text: "Chart below:\nEnd." }, { wait: 1500 });
  const pasted = attachments().find((name) => /^Pasted image \d{14}\.png$/.test(name));
  check("data uri: attachment saved", Boolean(pasted), attachments());
  check("data uri: embed inserted", pasted && text === `Chart below:\n\n![[${pasted}]]\n\nEnd.`, text);
  await page.waitForTimeout(800);
  await shot("data-image-paste");

  // Excel: TSV + HTML table → the ED-33 spreadsheet table.
  text = await paste({ html: fixture("excel.html"), text: fixture("excel.txt") });
  check("excel: spreadsheet table", text.includes("| Name   | Qty |\n| ------ | --- |\n| Apples | 3   |"), text);

  // Inside a code block: plain text only.
  text = await paste({ html: "<p>Some <b>bold</b> text</p>", text: "Some bold text" }, { before: "```\n\n```" });
  await page.evaluate(() => window.holocron.selectInLine(2, 0, 0));
  await writeClipboard({ html: "<p>Some <b>bold</b> text</p>", text: "Some bold text" });
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(300);
  text = await getText();
  check("code block: plain text", text.includes("```\nSome bold text\n```"), text);

  // A URL over selected text.
  await setText("Read the docs now");
  await page.evaluate(() => window.holocron.selectInLine(1, 9, 13));
  await writeClipboard({ text: "https://example.com/docs" });
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(300);
  text = await getText();
  check("url over selection", text === "Read the [docs](https://example.com/docs) now", text);

  // Ctrl+Shift+V: plain text, even with HTML on the clipboard.
  text = await paste({ html: "<p>Some <b>bold</b> <a href='https://e.com'>link</a></p>", text: "Some bold link" }, { key: "Control+Shift+v" });
  check("ctrl+shift+v: plain text", text === "Some bold link", text);
  // …and via the editor command the context menu uses.
  await setText("");
  await writeClipboard({ html: "<h1>Title</h1>", text: "Title" });
  await page.evaluate(() => window.holocron.run("pastePlainText"));
  await page.waitForTimeout(300);
  check("run('pastePlainText')", (await getText()) === "Title", await getText());

  // Trivially plain HTML pastes its text.
  text = await paste({ html: "<html><body><!--StartFragment--><p>line one</p><p>line two</p><!--EndFragment--></body></html>", text: "line one\r\nline two" });
  check("plain html: text/plain used", text === "line one\nline two", text);

  // Holocron's own copy → paste gives back the markdown. (1) Nothing to load:
  // the clipboard keeps the HTML from the copy event. (2) With a vault image:
  // the async pass rewrites the clipboard through main (Electron clipboard.write).
  const roundTrip = async (label, note, wantRewrite) => {
    await setText(note);
    const original = await getText();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(2500);
    const copied = await readClipboard();
    check(`${label}: marker in the clipboard HTML`, copied.html.includes("data-holocron-copy"), copied.html.slice(0, 200));
    check(`${label}: ${wantRewrite ? "rewritten with the image" : "copy-event HTML"}`, copied.html.includes("data:image/png") === wantRewrite);
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(300);
    check(`${label}: paste gives the original markdown`, (await getText()) === original, await getText());
  };
  const NOTE = "## Release notes\n\nThe **new build** is ready — see [[Roadmap|the roadmap]]. This is ==important==.\n\n- [x] Write the code\n- [ ] Ship it\n\n```python\nprint('hi')\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  await roundTrip("holocron copy (sync)", NOTE, false);
  await roundTrip("holocron copy (async)", NOTE + "\n\n![[clip_image002.png]]", true);

  // Source mode converts too.
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "source"));
  await page.waitForTimeout(800);
  text = await paste({ html: "<h2>Source</h2><ul><li><b>bold</b> item</li></ul>", text: "Source\nbold item" });
  check("source mode: converted", text === "## Source\n\n- **bold** item", text);
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "livePreview"));
  await page.waitForTimeout(800);

  // Undo takes the whole paste back in one step.
  await paste({ html: fixture("teams.html"), text: "x" }, { before: "Keep me" });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("undo: one step", (await getText()) === "Keep me", await getText());

  // A final mixed note for a screenshot.
  await paste({ html: fixture("web.html"), text: "x" });
  await page.waitForTimeout(800);
  await page.locator(".cm-scroller").first().evaluate((el) => (el.scrollTop = 0));
  await page.mouse.click(5, 5);
  await page.waitForTimeout(500);
  await shot("final");
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
