// Smoke script: open the guide note and screenshot the editor, then the File menu.
export default async function ({ page, shot }) {
  await page.evaluate(() => window.holocronHost.call("open", "Start Here.md"));
  await page.waitForTimeout(1200);
  await shot("note");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(600);
  await shot("note-light");
  await page.click("text=File");
  await page.waitForTimeout(300);
  await shot("file-menu");
}
