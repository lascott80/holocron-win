// Smoke script: raw HTML (blocks, inline tags, sanitising) and audio/video/PDF
// embeds, in dark and light. Writes a tiny PDF, a WAV tone and a WebM clip
// (recorded in the page) into the vault, checks players load and seek, and
// that a malicious note renders inertly.
//
//   node scripts/smoke.mjs <outDir> --out <build dir> --script scripts/smoke-html-media.mjs
import fs from "node:fs";
import path from "node:path";

const HTML_NOTE = `# HTML

<div align="center">
  <img src="Media/pixel.png" width="48" height="48" alt="local pixel">
  <p>Centred <b>HTML</b> paragraph with <span style="color: #e5534b; position: fixed">red text</span>.</p>
</div>

<table>
  <tr><th>Name</th><th colspan="2">Values</th></tr>
  <tr><td>Kyber</td><td align="right">42</td><td><code>blue</code></td></tr>
</table>

Inline: <span style="color: orange; font-weight: 600">orange</span>, <font color="#3fb950">green font</font>,
<abbr title="HyperText Markup Language">HTML</abbr>, <q>a quote</q>, <cite>a cite</cite>, <code>code</code>,
<em>em</em>, <strong>strong</strong>, <var>x</var>, <samp>samp</samp>, <kbd>Ctrl</kbd>+<kbd>K</kbd>, <mark>marked</mark>.

Links: <a href="https://example.com">external</a>, <a href="Second.md">a note</a>, <https://autolink.example>.

Inline image: <img src="Media/pixel.png" width="20" alt="px"> after text. Comment: <!-- hidden inline --> gone.

<!-- a whole
comment block -->

<details>
<summary>Folded details</summary>
Inside the details.
</details>

| Table | With HTML |
|---|---|
| <b>bold</b> | <span style="color:red">span</span> |

Line one<br>line two.

<div align="center">

**Markdown** inside a wrapper div (the wrapper lines hide).

</div>

<p align="center"><img src="Media/missing.png" alt="no such image"></p>

<video src="clip.webm" width="240" controls></video>

Last line.
`;

const EVIL_NOTE = `# Evil

<img src=x onerror="window.__pwned = 'img'">

<a href="javascript:window.__pwned='link'">javascript link</a>

<script>window.__pwned = 'script'</script>

<iframe src="https://example.com"></iframe>

<div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: url(https://evil.example/x.png); color: red">styled div</div>

<form action="https://evil.example"><input value="x"><button>Go</button></form>

<svg><script>window.__pwned='svg'</script></svg>

<img src="data:text/html,<script>alert(1)</script>"> <a href="data:text/html,hi">data link</a>

Inline <span onclick="window.__pwned='span'" style="color: lime">span with onclick</span> and <a href="vbscript:x">vb</a>.
`;

const MEDIA_NOTE = `# Media

Audio:

![[tone.wav]]

Video:

![[clip.webm|360]]

PDF:

![[paper.pdf#page=2]]

Markdown form: ![tone](tone.wav)

Missing: ![[nothing.mp4]]

![[nothing.pdf]]
`;

/** A two-page PDF with correct xref offsets. */
function makePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    null,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = (text) => {
    const content = `BT /F1 24 Tf 40 300 Td (${text}) Tj ET`;
    return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  };
  objects[3] = stream("Holocron page 1");
  objects[5] = stream("Holocron page 2");
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** 3 seconds of a 440 Hz tone, 16-bit mono 22.05 kHz. */
function makeWav() {
  const rate = 22050;
  const samples = rate * 3;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// A 1×1 blue PNG.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function recordWebm(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(100);
    const start = performance.now();
    await new Promise((resolve) => {
      const draw = () => {
        const t = (performance.now() - start) / 1000;
        context.fillStyle = `hsl(${(t * 120) % 360} 70% 45%)`;
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = "#fff";
        context.font = "28px sans-serif";
        context.fillText(`t = ${t.toFixed(1)} s`, 90, 100);
        if (t < 3) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    recorder.stop();
    await done;
    const buffer = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

const open = (page, note) => page.evaluate((name) => window.holocronHost.call("open", name), note);
const blurEditor = (page) => page.evaluate(() => document.activeElement?.blur());

export default async function ({ page, shot, vault }) {
  fs.mkdirSync(path.join(vault, "Media"), { recursive: true });
  fs.writeFileSync(path.join(vault, "Media", "pixel.png"), PIXEL);
  fs.writeFileSync(path.join(vault, "paper.pdf"), makePdf());
  fs.writeFileSync(path.join(vault, "tone.wav"), makeWav());
  fs.writeFileSync(path.join(vault, "clip.webm"), await recordWebm(page));
  fs.writeFileSync(path.join(vault, "Second.md"), "# Second\n\nThe linked note.\n");
  fs.writeFileSync(path.join(vault, "HTML.md"), HTML_NOTE);
  fs.writeFileSync(path.join(vault, "Evil.md"), EVIL_NOTE);
  fs.writeFileSync(path.join(vault, "Media.md"), MEDIA_NOTE);
  await page.waitForTimeout(1200);

  // ---- HTML ----
  await open(page, "HTML.md");
  await page.waitForTimeout(1500);
  await blurEditor(page);
  await page.waitForTimeout(400);
  console.log("html blocks:", await page.locator(".cm-html-block").count());
  console.log("inline span styles:", await page.locator(".cm-content span[style]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("style"))));
  console.log("block span style:", await page.locator(".cm-html-block span[style]").first().getAttribute("style").catch(() => null));
  console.log("block links:", await page.locator(".cm-html-block a, .cm-content a").evaluateAll((nodes) => nodes.map((n) => [n.className, n.dataset.href ?? n.dataset.target ?? "", n.getAttribute("href")])));
  console.log("images loaded:", await page.locator(".cm-content img").evaluateAll((nodes) => nodes.map((n) => [n.getAttribute("src")?.slice(0, 60), n.naturalWidth])));
  console.log("comment text visible:", await page.locator(".cm-content", { hasText: "hidden inline" }).count(), await page.locator(".cm-content", { hasText: "comment block" }).count());
  console.log("details summary rows:", await page.locator(".cm-summary").count());
  await shot("html-dark");
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 420));
  await page.waitForTimeout(800);
  await shot("html-dark-middle");
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 1e6));
  await page.waitForTimeout(1200);
  console.log("html video:", await page.locator(".cm-html-block video, .cm-html-inline video").evaluateAll((nodes) => nodes.map((n) => [n.getAttribute("src")?.slice(0, 40), n.readyState])));
  console.log("html missing:", await page.locator(".cm-html-missing").allTextContents());
  await shot("html-dark-bottom");
  // Editing a paragraph shows its tags; the rest stays rendered.
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 0));
  await page.waitForTimeout(500);
  await page.locator(".cm-line", { hasText: "Inline:" }).first().click();
  await page.waitForTimeout(500);
  await shot("html-inline-active");
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 0));

  // Clicking the block shows the source.
  await page.locator(".cm-html-block").first().click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(500);
  console.log("after click raw <div visible:", await page.locator(".cm-line", { hasText: '<div align="center">' }).count());
  await shot("html-editing");

  // ---- Malicious ----
  await open(page, "Evil.md");
  await page.waitForTimeout(1500);
  await blurEditor(page);
  await page.waitForTimeout(800);
  const evil = await page.evaluate(() => ({
    pwned: window.__pwned ?? null,
    scripts: document.querySelectorAll(".cm-content script").length,
    iframes: document.querySelectorAll(".cm-content iframe").length,
    forms: document.querySelectorAll(".cm-content form, .cm-content input, .cm-content button").length,
    svgs: document.querySelectorAll(".cm-html-block svg").length,
    handlers: [...document.querySelectorAll(".cm-content *")].filter((n) => [...n.attributes].some((a) => a.name.startsWith("on"))).length,
    hrefs: [...document.querySelectorAll(".cm-content a[href]")].map((a) => a.getAttribute("href")),
    styles: [...document.querySelectorAll(".cm-html-block [style]")].map((n) => n.getAttribute("style")),
    imgSrcs: [...document.querySelectorAll(".cm-content img")].map((n) => n.getAttribute("src")),
    links: [...document.querySelectorAll(".cm-content .cm-md-link, .cm-content .cm-wikilink")].map((n) => n.dataset.href ?? n.dataset.target),
  }));
  console.log("evil:", JSON.stringify(evil));
  // Click the javascript: link text: nothing may happen.
  await page.locator(".cm-html-block", { hasText: "javascript link" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  console.log("after clicking js link, pwned:", await page.evaluate(() => window.__pwned ?? null), "url:", page.url().slice(0, 40));
  await blurEditor(page);
  await page.waitForTimeout(300);
  await shot("html-evil");

  // ---- Media ----
  await open(page, "Media.md");
  await page.waitForTimeout(2500);
  await blurEditor(page);
  await page.waitForTimeout(1500);
  const media = await page.evaluate(() => {
    const describe = (n) => ({ src: n.getAttribute("src")?.slice(0, 50), readyState: n.readyState, duration: n.duration, error: n.error?.code ?? null });
    return {
      audios: [...document.querySelectorAll(".cm-media-audio")].map(describe),
      videos: [...document.querySelectorAll(".cm-media-video")].map(describe),
      pdfs: document.querySelectorAll(".cm-media-pdf-frame").length,
      missing: [...document.querySelectorAll(".cm-media-missing")].map((n) => n.textContent),
      hiddenSyntax: [...document.querySelectorAll(".cm-line")].filter((n) => n.textContent.includes("![[")).length,
    };
  });
  console.log("media:", JSON.stringify(media));
  await shot("media-dark");

  // Seeking: the asset scheme must answer Range requests.
  const seek = await page.evaluate(async () => {
    const result = {};
    const audio = document.querySelector(".cm-media-audio");
    if (audio) {
      result.audioSeekable = audio.seekable.length ? [audio.seekable.start(0), audio.seekable.end(0)] : [];
      audio.currentTime = 2.2;
      await new Promise((resolve) => { audio.onseeked = resolve; setTimeout(resolve, 3000); });
      result.audioTime = audio.currentTime;
      result.audioError = audio.error?.code ?? null;
    }
    const video = document.querySelector(".cm-media-video");
    if (video) {
      // MediaRecorder WebM has no duration until the end has been read.
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e6;
        await new Promise((resolve) => { video.ondurationchange = resolve; setTimeout(resolve, 3000); });
      }
      result.videoDuration = video.duration;
      video.currentTime = 1.5;
      await new Promise((resolve) => { video.onseeked = resolve; setTimeout(resolve, 3000); });
      result.videoTime = video.currentTime;
      result.videoSeekable = video.seekable.length ? [video.seekable.start(0), video.seekable.end(0)] : [];
      result.videoError = video.error?.code ?? null;
    }
    // Range requests straight to the scheme.
    try {
      const src = document.querySelector(".cm-media-audio")?.src;
      const response = await fetch(src, { headers: { Range: "bytes=100-199" } });
      result.range = [response.status, response.headers.get("content-range"), (await response.arrayBuffer()).byteLength];
      const bad = await fetch(src, { headers: { Range: "bytes=99999999-" } });
      result.badRange = bad.status;
    } catch (error) {
      result.rangeError = String(error);
    }
    return result;
  });
  console.log("seek:", JSON.stringify(seek));
  await page.waitForTimeout(500);
  await shot("media-dark-seeked");

  await page.evaluate(() => document.querySelector(".cm-media-pdf")?.scrollIntoView());
  await page.waitForTimeout(1500);
  await shot("media-pdf");
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 1e6));
  await page.waitForTimeout(1500);
  console.log("missing boxes:", await page.locator(".cm-media-missing").allTextContents());
  await shot("media-missing");
  await page.evaluate(() => (document.querySelector(".cm-scroller").scrollTop = 0));

  // ---- Light theme ----
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector(".cm-scroller").scrollTop = 0);
  await page.waitForTimeout(500);
  await shot("media-light");
  await open(page, "HTML.md");
  await page.waitForTimeout(1500);
  await blurEditor(page);
  await page.waitForTimeout(500);
  // A PDF frame must not make the editor think the page reloaded.
  console.log("editor shows HTML.md after the PDF:", await page.evaluate(() => document.querySelector(".cm-content")?.innerText.startsWith("HTML")));
  await shot("html-light");
}
