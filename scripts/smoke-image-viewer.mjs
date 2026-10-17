// Smoke script: the image viewer (Enlarge button, double-click, HTML <img>,
// zoom, copy image, Esc + focus return, reading-view click). Run against a
// vault with Attachments/logo.png and Attachments/diagram.png:
//
//   node scripts/smoke.mjs smoke-output --vault <folder> --script scripts/smoke-image-viewer.mjs
import fs from "node:fs";
import path from "node:path";

const NOTE = `# Pictures

![[logo.png|240]]

Some text between.

<img src="Attachments/diagram.png" width="160" alt="diagram">
`;

const log = (...args) => console.log("[images]", ...args);
const viewerOpen = (page) => page.locator(".hc-diagram-viewer").count().then((n) => n > 0);
const caption = (page) => page.locator(".hc-diagram-viewer-caption").innerText().catch(() => null);
const percent = (page) => page.locator(".hc-diagram-viewer-percent").innerText();

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Pictures.md"), NOTE);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.holocronHost.call("open", "Pictures.md"));
  await page.waitForTimeout(1200);

  // Hover shows the Enlarge button; clicking it opens the viewer.
  const image = page.locator(".cm-image").first();
  await image.hover();
  await page.waitForTimeout(300);
  await shot("hover-enlarge");
  await page.locator(".cm-image-frame .cm-image-toolbar button").first().click();
  await page.waitForTimeout(600);
  log("Enlarge opens viewer:", await viewerOpen(page), "caption:", await caption(page), "zoom:", await percent(page));
  await shot("viewer-fit");

  // Zoom in and copy.
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.waitForTimeout(300);
  log("after zooming in:", await percent(page));
  await shot("viewer-zoomed");
  await page.locator(".hc-diagram-viewer-copy").click();
  await page.waitForTimeout(800);
  log("copy button says:", await page.locator(".hc-diagram-viewer-copy").innerText());
  const clip = await page.evaluate(async () => {
    try {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType("image/png");
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height };
    } catch (error) {
      return { error: String(error) };
    }
  });
  log("clipboard image:", JSON.stringify(clip));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  log("open after Esc:", await viewerOpen(page), "focus back in editor:", await page.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor"))));

  // An HTML <img> gets a floating Enlarge button (a click would open it for editing).
  const html = page.locator(".cm-content img[alt=diagram]");
  log("html img found:", await html.count());
  await html.hover();
  await page.waitForTimeout(300);
  await shot("hover-html-img");
  await page.locator(".cm-image-float button").click();
  await page.waitForTimeout(600);
  log("floating Enlarge on HTML img opens viewer:", await viewerOpen(page), "caption:", await caption(page));
  log("HTML still rendered (not opened for editing):", (await html.count()) > 0);
  await shot("viewer-html-img");
  await page.mouse.click(8, 400); // backdrop
  await page.waitForTimeout(400);
  log("open after backdrop click:", await viewerOpen(page));

  // Reading view: a single click is enough.
  await page.evaluate(() => window.holocron.setMode("reading"));
  await page.waitForTimeout(800);
  await page.locator(".cm-image").first().click();
  await page.waitForTimeout(600);
  log("reading view click opens viewer:", await viewerOpen(page));
  await shot("viewer-reading");
  await page.keyboard.press("Escape");
}
