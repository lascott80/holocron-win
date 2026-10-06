// Smoke script: one note with every rich-rendering feature, dark and light, plus heading folding.
import fs from "node:fs";
import path from "node:path";

const NOTE = `# Features

Inline math $e^{i\\pi} + 1 = 0$ costs $5 and $10, and emoji :rocket: :tada: at 10:30:00.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Code

\`\`\`powershell
# Comment
Get-ChildItem -Path $env:USERPROFILE | Where-Object { $_.Length -gt 1MB }
\`\`\`

\`\`\`bat
@echo off
REM Batch file
set NAME=world
echo Hello %NAME%
\`\`\`

## HTML

<div align="center">
<b>Centred</b> with <span style="color: #e5534b">red text</span>
</div>

Press <kbd>Ctrl</kbd>+<kbd>O</kbd>, <abbr title="Markdown">MD</abbr> and <a href="https://example.com">a link</a>.

## Media

![[tone.wav]]

## Folded later

This section gets folded.
`;

/** A one-second 440 Hz mono WAV. */
function wav() {
  const rate = 8000, samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return buffer;
}

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Features.md"), NOTE);
  fs.writeFileSync(path.join(vault, "tone.wav"), wav());
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Features.md"));
  await page.waitForTimeout(4000);
  const counts = await page.evaluate(() => ({
    katex: document.querySelectorAll(".katex").length,
    emoji: [...document.querySelectorAll(".cm-content")].map((e) => e.textContent).join("").includes("🚀"),
    audio: document.querySelectorAll("audio").length,
    tags: null,
  }));
  console.log("rendered:", JSON.stringify(counts));
  const state = await page.evaluate(() => window.holocronHost.call("allTags"));
  console.log("tags in index:", JSON.stringify(state));
  await shot("features-dark");
  await page.evaluate(() => { const s = document.querySelector(".cm-scroller"); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(600);
  await shot("features-dark-lower");
  console.log("audio players:", await page.locator("audio").count(), "html blocks:", await page.locator(".cm-html-block, .cm-html").count());
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(2000);
  await page.evaluate(() => { document.querySelector(".cm-scroller").scrollTop = 0; });
  await page.waitForTimeout(500);
  await shot("features-light");
  await page.evaluate(() => window.holocron.run("foldAllHeadings"));
  await page.waitForTimeout(600);
  await shot("folded");
}
