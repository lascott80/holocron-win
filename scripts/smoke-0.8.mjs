// Smoke script for the 0.8.0 features: tasks view, search & replace,
// bookmarks, pinned tabs, sort menu, calendar, version history, spelling.
//   npm run build && node scripts/smoke.mjs smoke-output --script scripts/smoke-0.8.mjs
import fs from "node:fs";
import path from "node:path";

export default async function ({ page, shot, vault }) {
  fs.mkdirSync(path.join(vault, "Daily"), { recursive: true });
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dayName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  for (const offset of [1, 3, 8]) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    fs.writeFileSync(path.join(vault, "Daily", `${dayName(d)}.md`), `# ${dayName(d)}\n\n- [ ] Follow up on kyber shipment\n- [x] Morning meditation\n`);
  }
  fs.writeFileSync(path.join(vault, "Plan.md"), "# Plan\n\n- [ ] Build a new hilt\n  - [ ] Source a kyber crystal\n  - [!] Ask Master Yoda\n- [x] Sweep the temple\n\nThe kyber crystal hums. Kyber everywhere.\n");
  await page.waitForTimeout(900);
  const call = (name, ...args) => page.evaluate(([n, a]) => window.holocronHost.call(n, ...a), [name, args]);

  // Tasks view
  await call("open", "Plan.md");
  await page.waitForTimeout(600);
  await page.getByRole("radio", { name: "Tasks" }).click();
  await page.waitForTimeout(500);
  await shot("tasks");

  // Search & replace
  await page.getByRole("radio", { name: "Search" }).click();
  await page.getByLabel("Search vault").fill("kyber");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await page.getByLabel("Replace with").fill("crystal");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Replace All" }).click();
  await page.waitForTimeout(300);
  await shot("replace-confirm");

  // Bookmarks, pinned tab, sort menu
  await page.getByRole("radio", { name: "Files" }).click();
  await call("toggleBookmark", "Plan.md");
  await call("toggleBookmark", "Daily");
  await call("open", "Daily/" + dayName(new Date(today.getTime() - 86400000)) + ".md", true);
  const tabs = await call("state").catch(() => null);
  await page.getByRole("tab").first().click({ button: "right" });
  await page.waitForTimeout(200);
  await page.getByText("Pin Tab").click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Sort files" }).click();
  await page.waitForTimeout(300);
  await shot("files-bookmarks-pin-sort");
  await page.keyboard.press("Escape");

  // Calendar
  await page.getByRole("button", { name: "Daily notes calendar" }).click();
  await page.waitForTimeout(400);
  await shot("calendar");
  await page.keyboard.press("Escape");

  // Version history: make a second version first.
  await page.evaluate(() => window.holocron?.insertAtCursor("\n\nA later addition.\n"));
  await call("saveAll");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" })));
  await call("saveAll");
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(200);
  await page.keyboard.type("Version History");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await shot("history");
  await page.keyboard.press("Escape");

  // Spelling settings
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(500);
  await shot("settings-general");
  await page.keyboard.press("Escape");
  void tabs;
}
