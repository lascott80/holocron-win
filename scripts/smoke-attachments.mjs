// Smoke script: attachment housekeeping (REQUIREMENTS §3.5). Run against a
// vault with an "Attachments" folder holding used and unused files:
//
//   node scripts/smoke.mjs smoke-output --vault <folder> --script scripts/smoke-attachments.mjs
const call = (page, ...args) => page.evaluate((args) => window.holocronHost.call(...args), args);
const dialogText = async (page) => JSON.stringify(await page.locator("[role=dialog], [role=alertdialog]").first().innerText());

export default async function ({ page, shot }) {
  await call(page, "open", "Projects/Kyber Crystals.md");
  await page.waitForTimeout(800);

  await page.click("text=File");
  await page.waitForTimeout(300);
  await page.getByRole("menuitem", { name: /^Attachments/ }).hover();
  await page.waitForTimeout(400);
  await shot("attachments-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await call(page, "requestAttachmentOrganise");
  await page.waitForTimeout(800);
  console.log("organise:", await dialogText(page));
  await shot("organise");
  await call(page, "cancelAttachmentOrganise");

  await call(page, "requestAttachmentCleanup");
  await page.waitForTimeout(1000);
  console.log("cleanup:", await dialogText(page));
  await shot("cleanup");
  await call(page, "cancelAttachmentCleanup");

  await call(page, "requestDeletion", ["Projects/Kyber Crystals.md"]);
  await page.waitForTimeout(800);
  console.log("delete:", await dialogText(page));
  await shot("delete-with-attachments");
  await call(page, "cancelDeletion");

  await call(page, "requestAttachmentOrganise");
  await page.waitForTimeout(800);
  await page.click("button:has-text('Organise ')");
  await page.waitForTimeout(800);
  await shot("organised-toast");

  await call(page, "requestAttachmentCleanup");
  await page.waitForTimeout(800);
  await page.click("button:has-text('to _Unused')");
  await page.waitForTimeout(800);
  await shot("cleaned-toast");

  await call(page, "requestAttachmentUndo");
  await page.waitForTimeout(600);
  console.log("undo:", await dialogText(page));
  await shot("undo-confirm");
  await call(page, "cancelAttachmentAction");

  await call(page, "requestEmptyUnused");
  await page.waitForTimeout(800);
  console.log("empty:", await dialogText(page));
  await shot("empty-confirm");
  await call(page, "cancelAttachmentAction");
}
