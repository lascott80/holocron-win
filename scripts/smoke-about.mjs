// Smoke script: Help › About Holocron in dark and light.
export default async function ({ page, shot }) {
  await page.evaluate(() => window.holocronHost.call("open", "Start Here.md"));
  await page.waitForTimeout(800);
  await page.click("text=Help");
  await page.waitForTimeout(300);
  await shot("help-menu");
  await page.click("text=About Holocron");
  await page.waitForTimeout(800);
  console.log("dialog text:", JSON.stringify(await page.locator("[role=dialog]").innerText()));
  await shot("about-dark");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.evaluate(() => window.holocronHost.call("setSetting", "lightTheme", "light-plus"));
  await page.waitForTimeout(600);
  await page.click("text=Help");
  await page.click("text=About Holocron");
  await page.waitForTimeout(800);
  await shot("about-light-plus");
}
