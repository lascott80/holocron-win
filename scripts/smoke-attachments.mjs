// Smoke script: attachment housekeeping (REQUIREMENTS §3.5). Run against a
// vault with an "Attachments" folder holding used and unused files:
//
//   node scripts/smoke.mjs smoke-output --vault <folder> --script scripts/smoke-attachments.mjs
const call = (page, ...args) => page.evaluate((args) => window.holocronHost.call(...args), args);

export default async function ({ page, shot }) {
  await call(page, "open", "Projects/Kyber Crystals.md");
  await page.waitForTimeout(800);

  await page.click("text=File");
  await page.waitForTimeout(300);
  await shot("file-menu");
  await page.click("text=Organise Attachments…");
  await page.waitForTimeout(800);
  console.log("organise:", JSON.stringify(await page.locator("[role=dialog]").innerText()));
  await shot("organise");
  await page.click("button:has-text('Cancel')");
  await page.waitForTimeout(300);

  await page.click("text=File");
  await page.click("text=Clean Up Unused Attachments…");
  await page.waitForTimeout(1000);
  console.log("cleanup:", JSON.stringify(await page.locator("[role=dialog]").innerText()));
  await shot("cleanup");
  await page.locator("[role=dialog] li").first().click();
  await page.waitForTimeout(200);
  await shot("cleanup-one-unticked");
  await page.click("button:has-text('Cancel')");
  await page.waitForTimeout(300);

  await call(page, "requestDeletion", ["Projects/Kyber Crystals.md"]);
  await page.waitForTimeout(800);
  console.log("delete:", JSON.stringify(await page.locator("[role=alertdialog]").innerText()));
  await shot("delete-with-attachments");
  await page.click("button:has-text('Cancel')");
  await page.waitForTimeout(300);

  await page.click("text=File");
  await page.click("text=Organise Attachments…");
  await page.waitForTimeout(800);
  await page.click("button:has-text('Organise')");
  await page.waitForTimeout(800);
  await shot("organised-toast");

  await call(page, "setSetting", "settingsTab", "editor");
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(800);
  await shot("settings-editor");
}
