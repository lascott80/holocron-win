// Shows the built icon files (resources/icons/icon-N.png, icon.png) on dark and light taskbar colours.
// Run: npx electron scripts/icon/check.mjs <out.png>
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const out = process.argv.at(-1);
const root = path.resolve(import.meta.dirname, "../..");
const dataUrl = (file) => "data:image/png;base64," + fs.readFileSync(path.join(root, "resources", file)).toString("base64");
const sizes = [16, 20, 24, 32, 48, 64, 128];
const row = (bg) => `<div style="background:${bg};padding:16px;display:flex;align-items:center;gap:18px">
  ${sizes.map((s) => `<img src="${dataUrl(`icons/icon-${s}.png`)}" width="${s}" height="${s}" style="image-rendering:pixelated">`).join("")}
  <img src="${dataUrl("icon.png")}" width="160" height="160"></div>`;
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 640, height: 420, show: false, webPreferences: { offscreen: true } });
  await window.loadURL("data:text/html," + encodeURIComponent(`<body style="margin:0">${row("#202020")}${row("#EEEEEE")}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(out, (await window.webContents.capturePage()).toPNG());
  app.quit();
});
