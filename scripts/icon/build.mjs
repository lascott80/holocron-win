// Builds Holocron's icon files from scripts/icon/designs.mjs:
//   resources/icon.png           1024 px master (window icon fallback, docs)
//   resources/icon.ico           16–256 px, each size rendered for its size (exe, installer, taskbar)
//   resources/icons/icon-N.png   the same small sizes as PNG (tray)
// Run: npx electron scripts/icon/build.mjs
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { designs } from "./designs.mjs";

const DESIGN = "blueTile";
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const root = path.resolve(import.meta.dirname, "../..");

let window;

/** Renders the design at `size` px into the corner of one shared offscreen window and captures it. */
async function render(size) {
  window ??= new BrowserWindow({
    width: 1100, height: 1100, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
    <div style="width:${size}px;height:${size}px">${designs[DESIGN](size)}</div></body></html>`;
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((resolve) => setTimeout(resolve, 150));
  let image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  if (image.getSize().width !== size) image = image.resize({ width: size, height: size, quality: "best" });
  return image.toPNG();
}
/** An .ico holding PNG images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); // palette
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

app.whenReady().then(async () => {
  const resources = path.join(root, "resources");
  fs.mkdirSync(path.join(resources, "icons"), { recursive: true });
  fs.writeFileSync(path.join(resources, "icon.png"), await render(1024));
  const images = [];
  for (const size of ICO_SIZES) {
    const png = await render(size);
    images.push({ size, png });
    fs.writeFileSync(path.join(resources, "icons", `icon-${size}.png`), png);
  }
  fs.writeFileSync(path.join(resources, "icon.ico"), ico(images));
  console.log(`wrote icon.png, icon.ico (${ICO_SIZES.join(", ")}) and icons/icon-N.png`);
  app.quit();
});
