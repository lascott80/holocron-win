// Smoke script: a tour of the main views, one screenshot each.
export default async function ({ page, shot }) {
  const call = (name, ...args) => page.evaluate(([n, a]) => window.holocronHost.call(n, ...a), [name, args]);
  const key = (combo) => page.keyboard.press(combo);
  const settle = (ms = 500) => page.waitForTimeout(ms);

  await call("open", "Start Here.md");
  await settle(1200);
  await shot("note");

  await key("Control+o");
  await settle();
  await page.keyboard.type("link");
  await settle();
  await shot("quick-open");
  await key("Escape");

  await key("Control+Shift+p");
  await settle();
  await page.keyboard.type("dark");
  await settle();
  await shot("command-palette");
  await key("Escape");

  await key("Control+Shift+f");
  await settle();
  await page.keyboard.type("note");
  await settle(900);
  await shot("search");

  await page.evaluate(() => window.holocronHost.call("setSetting", "inspectorTab", "links"));
  await call("open", "Linked Note.md");
  await settle(900);
  await shot("linked-note-backlinks");

  await key("Control+,");
  await settle();
  await shot("settings");
  await key("Escape");

  await page.click("text=Files");
  await settle(300);
  await page.click(".file-row >> text=Start Here", { button: "right" }).catch(() => {});
  await settle(300);
  await shot("context-menu");
  await key("Escape");

  await call("closeVault");
  await settle(800);
  await shot("welcome");
}
