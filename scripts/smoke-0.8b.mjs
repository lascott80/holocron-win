// Second look at 0.8.0: the Spelling settings section and a history diff.
//   node scripts/smoke.mjs smoke-output --script scripts/smoke-0.8b.mjs
import fs from "node:fs";
import path from "node:path";

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Draft.md"), "# Draft\n\nFirst line.\nSecond line.\n");
  await page.waitForTimeout(900);
  const call = (name, ...args) => page.evaluate(([n, a]) => window.holocronHost.call(n, ...a), [name, args]);
  await call("open", "Draft.md");
  await page.waitForTimeout(500);
  await page.evaluate(() => window.holocron?.insertAtCursor("Inserted at the top.\n"));
  await call("saveAll");
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("Version History");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const options = page.getByRole("option");
  if ((await options.count()) > 1) await options.nth(1).click();
  await page.waitForTimeout(400);
  await shot("history-diff");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+,");
  await page.waitForTimeout(500);
  await page.getByText("Check spelling as you type").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("settings-spelling");
  await page.keyboard.press("Escape");
}
