// Smoke script: readable line length on vs off at a wide window.
export default async function ({ page, shot }) {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.evaluate(() => window.holocronHost.call("open", "Start Here.md"));
  await page.waitForTimeout(1200);
  const probe = () =>
    page.evaluate(async () => ({
      content: Math.round(document.querySelector(".cm-content").getBoundingClientRect().width),
      editor: Math.round(document.querySelector(".cm-editor").getBoundingClientRect().width),
      variable: getComputedStyle(document.documentElement).getPropertyValue("--hc-line-width"),
      setting: (await window.holocronHost.call("getState")).settings.readableLineLength,
    }));
  console.log("readable:", JSON.stringify(await probe()));
  await shot("readable");
  await page.evaluate(() => window.holocronHost.call("setSetting", "readableLineLength", false));
  await page.waitForTimeout(800);
  console.log("full width:", JSON.stringify(await probe()));
  await shot("full-width");
}
