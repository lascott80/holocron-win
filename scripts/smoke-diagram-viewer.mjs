// Smoke script: the Mermaid diagram viewer (Expand button, fit, zoom, pan,
// copy image, Esc + focus return, reading-view click) and diagramImage().
import fs from "node:fs";
import path from "node:path";

const nodes = Array.from({ length: 25 }, (_, i) => `  N${i}[Step ${i + 1}: ${["Parse", "Validate", "Index", "Render", "Save"][i % 5]} note]`);
const edges = Array.from({ length: 24 }, (_, i) => `  N${Math.floor(i / 2)} --> N${i + 1}`);
const FLOW = ["flowchart TD", ...nodes, ...edges, "  N24 -. retry .-> N3"].join("\n");
const actors = ["Editor", "Renderer", "Main", "Vault", "Disk", "Watcher"];
const SEQ = ["sequenceDiagram", ...Array.from({ length: 30 }, (_, i) => {
  const a = actors[i % actors.length];
  const b = actors[(i * 2 + 1) % actors.length];
  return `  ${a}${i % 3 ? "->>" : "-->>"}${b === a ? actors[(i + 1) % actors.length] : b}: message ${i + 1}`;
})].join("\n");

const NOTE = `# Big diagrams

Intro paragraph.

\`\`\`mermaid
${FLOW}
\`\`\`

Between.

\`\`\`mermaid
${SEQ}
\`\`\`
`;

const log = (...args) => console.log("[viewer]", ...args);
const viewerOpen = (page) => page.locator(".hc-diagram-viewer").count().then((n) => n > 0);
const activeInEditor = (page) => page.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor")));
const rawFlowVisible = (page) => page.locator(".cm-line", { hasText: "flowchart TD" }).count().then((n) => n > 0);

async function clipboardPng(page) {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (!item?.types.includes("image/png")) return { types: item?.types ?? [] };
    const blob = await item.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    return { types: item.types, bytes: blob.size, width: bitmap.width, height: bitmap.height };
  });
}

async function checkImage(page, code, theme) {
  return page.evaluate(async ({ code, theme }) => {
    const { dataUrl, width, height } = await window.holocronDiagramImage(code, { theme });
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const corner = [...context.getImageData(2, 2, 1, 1).data].slice(0, 3);
    // Count non-background pixels on a coarse grid to be sure something was drawn.
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4 * 97) if (Math.abs(data[i] - corner[0]) + Math.abs(data[i + 1] - corner[1]) + Math.abs(data[i + 2] - corner[2]) > 60) ink++;
    return { prefix: dataUrl.slice(0, 22), width, height, natural: [image.naturalWidth, image.naturalHeight], corner, ink, dataUrl };
  }, { code, theme });
}

export default async function ({ app, page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Big Diagrams.md"), NOTE);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Big Diagrams.md"));
  await page.waitForTimeout(4500);
  log("diagrams rendered:", await page.locator(".cm-mermaid > svg").count());

  // Put the cursor in the intro paragraph so the editor has focus.
  await page.locator(".cm-line", { hasText: "Intro paragraph." }).click();
  await page.waitForTimeout(300);
  const selectionBefore = await page.evaluate(() => `${getSelection().anchorNode?.textContent}@${getSelection().anchorOffset}`);

  // Hover toolbar.
  const flow = page.locator(".cm-mermaid").first();
  await flow.hover({ position: { x: 60, y: 60 } });
  await page.waitForTimeout(300);
  log("toolbar opacity on hover:", await page.locator(".cm-mermaid-toolbar").first().evaluate((el) => getComputedStyle(el).opacity));
  await shot("hover-toolbar");

  // Expand: opens the viewer without editing the code.
  await page.locator(".cm-mermaid-expand").first().click();
  await page.waitForTimeout(400);
  log("viewer open after Expand:", await viewerOpen(page));
  log("raw code shown after Expand (should be false):", await rawFlowVisible(page));
  log("selection unchanged:", JSON.stringify(selectionBefore) === JSON.stringify(await page.evaluate(() => `${getSelection().anchorNode?.textContent}@${getSelection().anchorOffset}`)));
  log("zoom label (fit):", await page.locator(".hc-diagram-viewer-percent").textContent());
  await shot("viewer-fit-dark");

  // Ctrl+wheel zoom at a point.
  const stage = await page.locator(".hc-diagram-viewer-stage").boundingBox();
  const px = stage.x + stage.width * 0.5;
  const py = stage.y + stage.height * 0.3;
  await page.mouse.move(px, py);
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  log("zoom label after Ctrl+wheel:", await page.locator(".hc-diagram-viewer-percent").textContent());
  await shot("viewer-zoomed");

  // Drag to pan, then plain wheel pans.
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px - 250, py - 150, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  log("zoom label after panning (unchanged):", await page.locator(".hc-diagram-viewer-percent").textContent());
  await shot("viewer-panned");

  // Keys: 1 → 100%, + zooms, 0 fits, double-click zooms 2x.
  await page.keyboard.press("1");
  await page.waitForTimeout(250);
  log("after 1:", await page.locator(".hc-diagram-viewer-percent").textContent());
  await page.keyboard.press("+");
  await page.waitForTimeout(250);
  log("after +:", await page.locator(".hc-diagram-viewer-percent").textContent());
  await page.keyboard.press("0");
  await page.waitForTimeout(250);
  log("after 0:", await page.locator(".hc-diagram-viewer-percent").textContent());
  await page.mouse.dblclick(px, py);
  await page.waitForTimeout(250);
  log("after double-click:", await page.locator(".hc-diagram-viewer-percent").textContent());
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("0");
  await page.waitForTimeout(250);

  // Copy image (the flowchart: its on-screen labels are <foreignObject>).
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await page.locator(".hc-diagram-viewer-toolbar button", { hasText: "Copy image" }).click();
  await page.waitForTimeout(500);
  log("copy button text:", await page.locator(".hc-diagram-viewer-toolbar button").nth(4).textContent());
  log("clipboard image:", JSON.stringify(await clipboardPng(page)));
  await shot("viewer-copied");

  // Tab stays inside.
  for (let i = 0; i < 9; i++) await page.keyboard.press("Tab");
  log("focus still in viewer after 9 Tabs:", await page.evaluate(() => Boolean(document.activeElement?.closest(".hc-diagram-viewer"))));

  // Esc closes and focus returns to the editor.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  log("viewer open after Esc:", await viewerOpen(page));
  log("focus back in editor:", await activeInEditor(page));
  log("raw code shown after close (should be false):", await rawFlowVisible(page));

  // diagramImage: flowchart (foreignObject case) and sequence, light while the app is dark.
  const flowImage = await checkImage(page, FLOW, "light");
  log("diagramImage flow light:", JSON.stringify({ ...flowImage, dataUrl: undefined }));
  const out = path.resolve(process.argv[2] ?? "smoke-output");
  fs.writeFileSync(path.join(out, "export-flow-light.png"), Buffer.from(flowImage.dataUrl.split(",")[1], "base64"));
  const seqImage = await checkImage(page, SEQ, "dark");
  log("diagramImage seq dark:", JSON.stringify({ ...seqImage, dataUrl: undefined }));
  fs.writeFileSync(path.join(out, "export-seq-dark.png"), Buffer.from(seqImage.dataUrl.split(",")[1], "base64"));
  const bad = await page.evaluate(() => window.holocronDiagramImage("not a diagram").then(() => "resolved", (e) => "rejected: " + e.message.slice(0, 60)));
  log("diagramImage bad code:", bad);
  log("on-screen flowchart still uses HTML labels:", await page.locator(".cm-mermaid").first().evaluate((el) => el.querySelector(":scope > svg foreignObject") !== null));

  // Sequence diagram, light theme.
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(2500);
  const seq = page.locator(".cm-mermaid").nth(1);
  await seq.scrollIntoViewIfNeeded();
  await seq.hover({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(300);
  await shot("hover-toolbar-light");
  await page.locator(".cm-mermaid-expand").nth(1).click();
  await page.waitForTimeout(400);
  await shot("viewer-seq-light");
  // Backdrop click closes.
  await page.mouse.click(8, 400);
  await page.waitForTimeout(400);
  log("viewer open after backdrop click:", await viewerOpen(page));

  // Reading view: clicking the diagram itself expands it.
  await page.evaluate(() => window.holocron.setMode("reading"));
  await page.waitForTimeout(800);
  await page.locator(".cm-mermaid").first().scrollIntoViewIfNeeded();
  await page.locator(".cm-mermaid").first().click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(400);
  log("reading view click opens viewer:", await viewerOpen(page));
  await shot("reading-click-viewer-light");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  log("viewer open after Esc (reading):", await viewerOpen(page));
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "dark"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.holocron.setMode("reading")); // the setting change re-applies the default mode
  await page.waitForTimeout(800);
  log("reading view active:", await page.locator(".cm-mode-reading").count() > 0);
  await page.locator(".cm-mermaid").first().click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(400);
  await shot("reading-click-viewer-dark");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  log("leftover viewer elements:", await page.locator(".hc-diagram-viewer").count());

  // Live preview: a plain click on the diagram still edits it.
  await page.evaluate(() => window.holocron.setMode("live"));
  await page.waitForTimeout(800);
  await page.locator(".cm-mermaid").first().click({ position: { x: 100, y: 100 } });
  await page.waitForTimeout(500);
  log("live click edits (raw code shown):", (await page.locator(".cm-line", { hasText: /^(flowchart TD|sequenceDiagram)$/ }).count()) > 0);
  log("viewer open after live click (should be false):", await viewerOpen(page));
  log("mermaid widgets left (1 of 2 is being edited):", await page.locator(".cm-mermaid").count());
  await shot("live-click-edits");
}
