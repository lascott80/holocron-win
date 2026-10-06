// Smoke script: KaTeX math (inline + display, dark and light) and emoji shortcodes render; clicking edits.
import fs from "node:fs";
import path from "node:path";

const NOTE = `# Math and emoji

Euler's identity $e^{i\\pi} + 1 = 0$ is neat, and $\\sqrt{a^2+b^2}$ too.
Prices stay text: it costs $5 and $10, and \\$x\\$ is escaped. Code: \`$x$\`.

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

One-liner:

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

Broken: $\\frac{1}{$ and $\\badcommand$.

Ship it :rocket: :tada: :+1: — but not 10:30:00 or :notanemoji: or \`:smile:\`.

| Item | Cost |
| ---- | ---- |
| Tea :tea: | $3 |
`;

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Math.md"), NOTE);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Math.md"));
  await page.waitForTimeout(3000);
  const count = (selector) => page.locator(selector).count();
  console.log("inline math:", await count(".cm-math-inline .katex"), "display math:", await count(".cm-math-display .katex-display"));
  console.log("katex errors:", await count(".katex-error"), "emoji:", await count(".cm-emoji"));
  const fontsLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.family.includes("KaTeX") && f.status === "loaded").map((f) => f.family);
  });
  console.log("KaTeX fonts loaded:", fontsLoaded.join(", "));
  await shot("math-dark");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(1500);
  await shot("math-light");
  await page.locator(".cm-math-display").first().click();
  await page.waitForTimeout(600);
  console.log("after click, raw display source visible:", (await page.locator(".cm-line", { hasText: "\\int_0" }).count()) > 0);
  await shot("math-editing-display");
  await page.locator(".cm-math-inline .mord").first().click();
  await page.waitForTimeout(600);
  console.log("after click, raw inline source visible:", (await page.locator(".cm-line", { hasText: "e^{i\\pi}" }).count()) > 0);
  await shot("math-editing-inline");
  // Emoji autocomplete: type ":ro" at the end of the note.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nLaunch :ro", { delay: 40 });
  await page.waitForTimeout(800);
  console.log("completion options:", (await page.locator(".cm-tooltip-autocomplete li").allTextContents()).slice(0, 6).join(" | "));
  await shot("emoji-completion");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" done", { delay: 20 });
  await page.waitForTimeout(500);
  console.log("last line:", await page.evaluate(() => window.holocron?.getText?.().split("\n").pop()));
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(500);
  await shot("emoji-after-insert");
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "dark"));
  await page.waitForTimeout(1500);
  console.log("reading view: inline", await count(".cm-math-inline .katex"), "display", await count(".cm-math-display .katex"), "emoji", await count(".cm-emoji"));
  await shot("reading-dark");
}
