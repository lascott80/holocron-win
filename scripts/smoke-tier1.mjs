// Smoke script for the wave-1 features: search operators and sort, property
// search, the Properties section, the tag tree and Rename Tag, the backlinks
// panel with Link buttons, the Hotkeys tab, CSS snippets, the canvas viewer
// and the note composer.
//   npm run build && node scripts/smoke.mjs smoke-output --script scripts/smoke-tier1.mjs
import fs from "node:fs";
import path from "node:path";

export default async function ({ page, shot, vault }) {
  fs.mkdirSync(path.join(vault, "Projects"), { recursive: true });
  fs.mkdirSync(path.join(vault, ".holocron", "snippets"), { recursive: true });
  fs.writeFileSync(path.join(vault, ".holocron", "snippets", "wide-headings.css"), "h1, .cm-header-1 { letter-spacing: 0.08em; }\n");
  fs.writeFileSync(path.join(vault, "Projects", "Hilt.md"), "---\nstatus: active\ndue: 2026-12-01\nrating: 4\ntags: [project/saber, lore]\n---\n# Hilt\n\nBuild a new hilt for the kyber crystal. See [[Kyber]].\n\n## Parts\n\n- [ ] Source a kyber crystal\n- [x] Sweep the temple\n\n## Notes\n\nIlum caves are cold.\n");
  fs.writeFileSync(path.join(vault, "Projects", "Temple.md"), "---\nstatus: done\nrating: 2\ntags: [project/temple]\n---\n# Temple\n\nThe temple on Ilum. Kyber is mentioned here without a link.\n");
  fs.writeFileSync(path.join(vault, "Kyber.md"), "# Kyber\n\nA kyber crystal hums. #lore\n");
  fs.writeFileSync(path.join(vault, "Board.canvas"), JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 260, height: 120, text: "# Plan\n\nGather **kyber**." },
      { id: "b", type: "file", x: 360, y: 0, width: 300, height: 200, file: "Kyber.md" },
      { id: "c", type: "link", x: 0, y: 200, width: 260, height: 80, url: "https://example.com", color: "4" },
      { id: "g", type: "group", x: -40, y: -60, width: 740, height: 380, label: "Saber project", color: "6" },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left", label: "needs" }],
  }));
  await page.waitForTimeout(1200);
  const call = (name, ...args) => page.evaluate(([n, a]) => window.holocronHost.call(n, ...a), [name, args]);

  // Tag tree, Properties section
  await page.waitForTimeout(400);
  await shot("sidebar-tags-properties");

  // Search operators, sort menu, copy results
  await page.getByRole("radio", { name: "Search" }).click();
  await page.getByLabel("Search vault").fill("kyber OR temple [status:active]");
  await page.waitForTimeout(700);
  await shot("search-operators");
  await page.getByLabel("Search vault").fill("task-todo:kyber");
  await page.waitForTimeout(700);
  await shot("search-tasks");

  // Backlinks panel + Link buttons
  await page.getByRole("radio", { name: "Files" }).click();
  await call("open", "Kyber.md");
  await page.waitForTimeout(600);
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(200);
  await page.keyboard.type("Show Backlinks in Note");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  await shot("backlinks-panel");

  // Hotkeys tab
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(500);
  const hotkeys = page.getByText("Hotkeys", { exact: true }).first();
  await hotkeys.click();
  await page.waitForTimeout(400);
  await shot("settings-hotkeys");
  await page.getByText("Appearance", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await shot("settings-appearance-snippets");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Canvas viewer
  await call("open", "Board.canvas");
  await page.waitForTimeout(1200);
  await shot("canvas");

  // Note composer: extract a selection
  await call("open", "Projects/Hilt.md");
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const lines = window.holocron.getText().split("\n");
    const line = lines.findIndex((l) => l.startsWith("Ilum caves")) + 1;
    window.holocron.selectInLine(line, 0, "Ilum caves are cold.".length);
  });
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(200);
  await page.keyboard.type("Extract Selection");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await shot("composer-extract");
  await page.keyboard.press("Escape");
}
