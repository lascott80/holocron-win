// Smoke script for the pane layout with bases: split right and down, a base
// in the primary pane and in other panes (also through the file tree's
// "Open to the Right"), a canvas in a pane, query/base blocks in a pane's
// editor, and stacked tabs with a base tab.
//   npm run build && node scripts/smoke.mjs smoke-output --script scripts/smoke-panes-bases.mjs
import fs from "node:fs";
import path from "node:path";

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Kyber.md"), "---\nstatus: active\nrating: 4\n---\n# Kyber\n\nA kyber crystal hums.\n");
  fs.writeFileSync(path.join(vault, "Temple.md"), "---\nstatus: done\nrating: 2\n---\n# Temple\n\nThe temple on Ilum.\n");
  fs.writeFileSync(path.join(vault, "Tasks.base"), 'filters: ""\nviews:\n  - type: table\n    name: Table\n    columns: [file.name, status, rating]\n');
  fs.writeFileSync(
    path.join(vault, "Blocks.md"),
    "# Blocks\n\n```query\n[status:active]\n```\n\n```base\nfilters: \"[status:done]\"\nviews:\n  - type: table\n    name: Done\n    columns: [file.name, rating]\n```\n",
  );
  fs.writeFileSync(path.join(vault, "Board.canvas"), JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 260, height: 120, text: "# Plan\n\nGather **kyber**." },
      { id: "b", type: "file", x: 360, y: 0, width: 300, height: 200, file: "Kyber.md" },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "needs" }],
  }));
  await page.waitForTimeout(1500);
  const call = (name, ...args) => page.evaluate(([n, a]) => window.holocronHost.call(n, ...a), [name, args]);

  // Split right and down from a note.
  await call("open", "Kyber.md");
  await page.waitForTimeout(500);
  await call("splitActiveNote", "row");
  await page.waitForTimeout(300);
  await call("splitActiveNote", "column");
  await page.waitForTimeout(600);
  await shot("split-right-down");

  // A base in the primary pane (focus it first, then open the base in its tab).
  await call("focusPane", "main");
  await call("open", "Tasks.base");
  await page.waitForTimeout(1200);
  await shot("base-in-primary");

  // A base in the focused split pane, via the file tree's Open Below.
  await page.locator(".pane").first().click({ position: { x: 40, y: 10 } });
  await page.waitForTimeout(200);
  await page.getByRole("treeitem", { name: /Tasks/ }).first().click({ button: "right" });
  await page.waitForTimeout(300);
  await shot("tree-menu-base");
  await page.getByText("Open Below", { exact: true }).click();
  await page.waitForTimeout(1200);
  await shot("base-in-pane");

  // A canvas in a pane, and a note with query/base blocks in another.
  await call("closeSplit");
  await page.waitForTimeout(300);
  await call("openInSplit", "Board.canvas", "row");
  await page.waitForTimeout(300);
  await call("openInSplit", "Blocks.md", "column");
  await page.waitForTimeout(1800);
  await shot("canvas-and-blocks-in-panes");

  // Stacked tabs with a base tab.
  await call("closeSplit");
  await call("open", "Kyber.md", true);
  await call("open", "Temple.md", true);
  await call("open", "Board.canvas", true);
  await call("open", "Tasks.base", true);
  await page.waitForTimeout(500);
  await call("setStackTabs", true);
  await page.waitForTimeout(1500);
  await shot("stacked-tabs-base-active");
  await page.locator(".stack .header", { hasText: "Kyber" }).first().click();
  await page.waitForTimeout(800);
  await shot("stacked-tabs-note-active");
  await call("setStackTabs", false);
  await page.waitForTimeout(800);
  await shot("unstacked");
}
