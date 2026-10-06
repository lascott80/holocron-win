// Launches the built app (run `npm run build` first) against a throwaway
// copy of a vault, with an isolated profile, and saves screenshots.
//
//   node scripts/smoke.mjs [outDir] [--vault <folder>] [--light] [--script <file.mjs>]
//
// A --script module's default export receives { app, page, shot, vault } and
// can drive the UI before the final screenshot.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : null;
};
const light = args.includes("--light") ? (args.splice(args.indexOf("--light"), 1), true) : false;
const script = option("--script");
const sourceVault = option("--vault") ?? path.resolve("resources/guide");
const outDir = path.resolve(args[0] ?? "smoke-output");
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "holocron-smoke-"));
const vault = path.join(work, "Smoke Vault");
fs.cpSync(sourceVault, vault, { recursive: true });
const userData = path.join(work, "profile");
fs.mkdirSync(userData);
if (light) fs.writeFileSync(path.join(userData, "holocron.json"), JSON.stringify({ settings: { appearance: "light" } }));

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, HOLOCRON_USER_DATA: userData, HOLOCRON_OPEN_VAULT: vault, ELECTRON_RENDERER_URL: "" },
});
const page = await app.firstWindow();
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));
await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
await page.waitForTimeout(1500);

let count = 0;
const shot = async (name) => {
  const file = path.join(outDir, `${String(++count).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log("screenshot:", file);
};

try {
  if (script) {
    const module = await import(pathToFileURL(path.resolve(script)).href);
    await module.default({ app, page, shot, vault });
  } else {
    await shot("launch");
  }
} finally {
  fs.writeFileSync(path.join(outDir, "console.log"), logs.join("\n"));
  if (logs.some((line) => line.startsWith("[error]") || line.startsWith("[pageerror]"))) {
    console.log("Console errors:\n" + logs.filter((l) => /^\[(error|pageerror)\]/.test(l)).join("\n"));
  }
  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
}
