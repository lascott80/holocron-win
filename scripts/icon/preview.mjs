// Renders every icon design on Windows 11 dark and light taskbar colours at
// real sizes, into one comparison sheet. Run: npx electron scripts/icon/preview.mjs <out.png>
import fs from "node:fs";
import { app, BrowserWindow } from "electron";
import { designs } from "./designs.mjs";

const out = process.argv.at(-1).endsWith(".png") ? process.argv.at(-1) : "icon-preview.png";
const sizes = [16, 24, 32, 48, 96];
const backgrounds = [
  { name: "Dark taskbar", color: "#202020", text: "#ddd" },
  { name: "Light taskbar", color: "#EEEEEE", text: "#222" },
];

const cell = (name, size) =>
  `<div style="width:${size}px;height:${size}px">${designs[name](size)}</div>`;

const html = `<!doctype html><html><body style="margin:0;font:13px 'Segoe UI';background:#888">
${backgrounds.map((bg) => `
  <div style="background:${bg.color};color:${bg.text};padding:14px 18px">
    <div style="font-weight:600;margin-bottom:8px">${bg.name}</div>
    ${Object.keys(designs).map((name) => `
      <div style="display:flex;align-items:center;gap:22px;height:110px">
        <div style="width:110px">${name}</div>
        ${sizes.map((size) => cell(name, size)).join("")}
      </div>`).join("")}
  </div>`).join("")}
</body></html>`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 560, height: 960, show: false, webPreferences: { offscreen: true } });
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  console.log("wrote", out);
  app.quit();
});
