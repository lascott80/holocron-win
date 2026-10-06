// Smoke script: Ctrl+F opens find in reading view.
export default async function ({ page }) {
  await page.evaluate(() => window.holocronHost.call("open", "Start Here.md"));
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.waitForTimeout(1200);
  await page.locator(".cm-line").nth(4).click();
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(400);
  console.log("find panel open in reading view:", (await page.locator(".cm-search").count()) > 0);
}
