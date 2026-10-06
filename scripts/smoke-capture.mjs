// Smoke script: quick capture, the tray, running in the background, the jump
// list and launch arguments.
//
//   node scripts/smoke.mjs <shots> --out <build> --script scripts/smoke-capture.mjs
//
// Global keys can't be pressed from Playwright, so the shortcut's handler
// (HolocronApp.showCapture) is called from main and `globalShortcut.isRegistered`
// is checked instead. Needs the test profile hook (HOLOCRON_USER_DATA, set by
// smoke.mjs), which exposes the app object as globalThis.holocron in main.

import fs from "node:fs";
import path from "node:path";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const pad = (n) => String(n).padStart(2, "0");
const today = new Date();
const dailyPath = `Daily/${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.md`;
const bullet = /- \d\d:\d\d /;

export default async function ({ app, page, shot, vault }) {
  const outDir = path.resolve(process.argv[2] ?? "smoke-output");
  const read = (vaultPath) => {
    try {
      return fs.readFileSync(path.join(vault, ...vaultPath.split("/")), "utf8");
    } catch {
      return null;
    }
  };
  const main = (fn, arg) => app.evaluate(fn, arg);
  const captureVisible = () => main(() => globalThis.holocron.capture.isVisible);
  const mainVisible = () => main(() => globalThis.holocron.window?.isVisible() ?? false);
  const captureLogs = [];
  let capturePage = null;
  let captureShots = 0;
  const captureShot = async (name) => {
    const file = path.join(outDir, `capture-${String(++captureShots).padStart(2, "0")}-${name}.png`);
    await capturePage.screenshot({ path: file });
    console.log("screenshot:", file);
  };
  /** Shows the capture window the way the global shortcut does. */
  const showCapture = async () => {
    await main(() => globalThis.holocron.showCapture());
    await capturePage.waitForTimeout(250);
  };
  const textarea = () => capturePage.locator("textarea");

  // Mocks: never touch this machine's sign-in items or the installed app's jump list.
  await main(({ app: electronApp }) => {
    globalThis.loginItemCalls = [];
    electronApp.setLoginItemSettings = (settings) => globalThis.loginItemCalls.push(settings);
    globalThis.jumpListCalls = [];
    const real = electronApp.setJumpList.bind(electronApp);
    electronApp.setJumpList = (categories) => {
      globalThis.jumpListCalls.push(categories);
      return "ok";
    };
    globalThis.realSetJumpList = real;
  });
  await main(() => globalThis.holocron.setSetting("appearance", "dark"));
  await page.waitForTimeout(300);

  // ---- Global shortcut registered ----
  const registered = await main(({ globalShortcut }) => globalShortcut.isRegistered("Super+Alt+N"));
  check("Win+Alt+N (Super+Alt+N) is registered system-wide", registered);
  const state = await page.evaluate(() => window.holocronHost.call("getState"));
  check("state reports the shortcut registered", state.quickCapture.registered && state.quickCapture.error === null, JSON.stringify(state.quickCapture));

  // ---- Tray ----
  const tray = await main(() => {
    const t = globalThis.holocron.tray;
    return { exists: t.exists, items: t.menu?.items.map((item) => ({ label: item.label, type: item.type, accelerator: item.accelerator ?? null })) ?? [] };
  });
  check("tray icon exists", tray.exists);
  const trayLabels = tray.items.filter((item) => item.type !== "separator").map((item) => item.label);
  check(
    "tray menu items",
    JSON.stringify(trayLabels) === JSON.stringify(["Quick Capture", "Today’s Note", "New Note", "Open Holocron", "Check for Updates…", "Quit Holocron"]),
    JSON.stringify(tray.items),
  );
  check("tray shows the capture shortcut", tray.items[0]?.accelerator === "Super+Alt+N");

  // ---- Command palette → Quick Capture (first use creates the window) ----
  await page.click(".cm-content").catch(() => {});
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(300);
  await page.keyboard.type("Quick Capture");
  await page.waitForTimeout(300);
  [capturePage] = await Promise.all([app.waitForEvent("window"), page.keyboard.press("Enter")]);
  capturePage.on("console", (message) => captureLogs.push(`[${message.type()}] ${message.text()}`));
  capturePage.on("pageerror", (error) => captureLogs.push(`[pageerror] ${error.message}`));
  await capturePage.waitForSelector("textarea");
  await capturePage.waitForTimeout(400);
  check("capture window opened from the palette", await captureVisible());
  const bounds = await main(() => globalThis.holocron.capture.window.getBounds());
  check("capture window is 520×220", bounds.width === 520 && bounds.height === 220, JSON.stringify(bounds));
  const header = await capturePage.locator("header").innerText();
  check("header says Quick capture → Today’s note", /Quick capture\s*→/.test(header) && header.includes("Today’s note"), JSON.stringify(header));
  check("textarea is focused", await capturePage.evaluate(() => document.activeElement?.tagName === "TEXTAREA"));
  await textarea().pressSequentially("Buy kyber crystals");
  await capturePage.keyboard.press("Enter");
  await textarea().pressSequentially("for the new saber");
  await captureShot("dark");
  await capturePage.keyboard.press("Control+Enter");
  await capturePage.waitForTimeout(600);
  check("Ctrl+Enter hides the window", !(await captureVisible()));
  const daily1 = read(dailyPath) ?? "";
  check("multi-line capture appended to today’s note on disk", /\n?- \d\d:\d\d Buy kyber crystals\n {2}for the new saber\n$/.test(daily1), JSON.stringify(daily1));
  check("textarea cleared after saving", (await textarea().inputValue()) === "");

  // ---- Daily note open in the editor with unsaved edits + capture through the shortcut handler ----
  await page.evaluate(() => window.holocronHost.call("openDailyNote"));
  await page.waitForTimeout(700);
  await page.click(".cm-content");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Unsaved edit in the editor");
  await page.waitForTimeout(100);
  const dirty = await main((_e, p) => globalThis.holocron.vault.documents.get(p)?.isDirty ?? null, dailyPath);
  check("the daily note has unsaved edits before capturing", dirty === true, String(dirty));
  await showCapture();
  check("capture window shown by the shortcut handler", await captureVisible());
  await textarea().fill("Captured while editing");
  await capturePage.keyboard.press("Control+Enter");
  await page.waitForTimeout(600);
  const editorText = await page.evaluate(() => window.holocron.getText());
  check("editor shows both the edit and the capture", editorText.includes("Unsaved edit in the editor") && /- \d\d:\d\d Captured while editing\n$/.test(editorText), JSON.stringify(editorText.slice(-120)));
  const daily2 = read(dailyPath) ?? "";
  check("disk has both the edit and the capture", daily2.includes("Unsaved edit in the editor") && daily2.includes("Captured while editing") && daily2.includes("Buy kyber crystals"), JSON.stringify(daily2.slice(-160)));
  await shot("editor-after-capture");

  // ---- Inbox target ----
  await showCapture();
  await capturePage.getByRole("radio", { name: "Inbox" }).click();
  const inboxHeader = await capturePage.locator("textarea").getAttribute("placeholder");
  check("switching to Inbox changes the destination", inboxHeader?.includes("Inbox.md"), inboxHeader);
  await textarea().fill("Inbox item");
  await capturePage.keyboard.press("Control+Enter");
  await capturePage.waitForTimeout(500);
  const inbox = read("Inbox.md") ?? "";
  check("Inbox.md created with the capture", /^- \d\d:\d\d Inbox item\n$/.test(inbox), JSON.stringify(inbox));
  await showCapture();
  check("the next capture starts at the default target again", (await capturePage.getByRole("radio", { name: "Today’s note" }).getAttribute("aria-checked")) === "true");

  // ---- Esc discards; clicking elsewhere keeps the draft ----
  await textarea().fill("throwaway");
  await capturePage.keyboard.press("Escape");
  await capturePage.waitForTimeout(300);
  check("Esc hides the window", !(await captureVisible()));
  await showCapture();
  check("Esc discarded the draft", (await textarea().inputValue()) === "");
  await textarea().fill("keep me");
  await capturePage.waitForTimeout(200);
  await main(() => globalThis.holocron.capture.window.emit("blur"));
  await capturePage.waitForTimeout(200);
  check("blur hides the window", !(await captureVisible()));
  await showCapture();
  check("blur kept the draft", (await textarea().inputValue()) === "keep me");
  const dailyBefore = read(dailyPath);
  await capturePage.keyboard.press("Escape");
  await capturePage.waitForTimeout(200);
  check("nothing was written by Esc", read(dailyPath) === dailyBefore);

  // ---- Light theme ----
  await main(() => globalThis.holocron.setSetting("appearance", "light"));
  await showCapture();
  await textarea().fill("A thought in the light\nSecond line");
  await capturePage.waitForTimeout(200);
  await captureShot("light");
  check("light theme applied", await capturePage.evaluate(() => document.documentElement.classList.contains("hc-light")));
  await capturePage.keyboard.press("Escape");
  await main(() => globalThis.holocron.setSetting("appearance", "dark"));

  // ---- No vault ----
  await main(() => globalThis.holocron.closeVault());
  await showCapture();
  const empty = await capturePage.locator(".empty").innerText().catch(() => "");
  check("no vault: asks to open one", empty.includes("Open a vault in Holocron first.") && empty.includes("Open Holocron"), JSON.stringify(empty));
  await captureShot("no-vault");
  await main(() => globalThis.holocron.window.hide());
  await capturePage.getByRole("button", { name: "Open Holocron" }).click();
  await page.waitForTimeout(400);
  check("Open Holocron shows the main window", await mainVisible());
  await main((_e, root) => globalThis.holocron.openVault(root), vault);
  await page.waitForTimeout(500);

  // ---- File menu ----
  await page.locator(".menu-title", { hasText: "File" }).click();
  await page.waitForTimeout(250);
  const fileMenu = await page.locator(".menu").innerText();
  check("File menu has Quick Capture and Exit Holocron", fileMenu.includes("Quick Capture") && fileMenu.includes("Win+Alt+N") && fileMenu.includes("Exit Holocron"), JSON.stringify(fileMenu));
  await shot("file-menu");
  await page.keyboard.press("Escape");

  // ---- Settings: shortcut recorder, in-use error, reset ----
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(400);
  await page.locator(".nav-item", { hasText: "General" }).click();
  await page.locator("[data-shortcut-recorder]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot("settings-quick-capture");
  const recorder = page.locator("[data-shortcut-recorder]");
  await recorder.click();
  check("recording suspends the shortcut", !(await main(({ globalShortcut }) => globalShortcut.isRegistered("Super+Alt+N"))));
  await page.keyboard.press("Control+Alt+N");
  await page.waitForTimeout(200);
  const clash = await page.locator(".row-help.error").innerText().catch(() => "");
  check("a Holocron shortcut is refused", clash.includes("Holocron already uses Ctrl+Alt+N for “New Folder”."), JSON.stringify(clash));
  await page.keyboard.press("Control+Alt+K");
  await page.waitForTimeout(400);
  const changed = await main(({ globalShortcut }) => ({ k: globalShortcut.isRegistered("Ctrl+Alt+K"), space: globalShortcut.isRegistered("Super+Alt+N"), setting: globalThis.holocron.settings.quickCaptureShortcut }));
  check("recorded Ctrl+Alt+K is registered instead", changed.k && !changed.space && changed.setting === "Ctrl+Alt+K", JSON.stringify(changed));
  // Pretend another app owns Ctrl+Alt+J.
  await main(({ globalShortcut }) => {
    const register = globalShortcut.register.bind(globalShortcut);
    globalShortcut.register = (accelerator, callback) => (accelerator === "Ctrl+Alt+J" ? false : register(accelerator, callback));
  });
  await recorder.click();
  await page.keyboard.press("Control+Alt+J");
  await page.waitForTimeout(400);
  const inUse = await page.locator(".row-help.error").innerText().catch(() => "");
  check("in-use shortcut shows the error", inUse === "That shortcut is in use by another app.", JSON.stringify(inUse));
  await shot("settings-shortcut-in-use");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(400);
  const reset = await main(({ globalShortcut }) => ({ space: globalShortcut.isRegistered("Super+Alt+N"), setting: globalThis.holocron.settings.quickCaptureShortcut, error: globalThis.holocron.quickCapture.error }));
  check("Reset restores Win+Alt+N", reset.space && reset.setting === "Super+Alt+N" && reset.error === null, JSON.stringify(reset));
  // Disabling releases it.
  await main(() => globalThis.holocron.setSetting("quickCaptureEnabled", false));
  check("disabling releases the shortcut", !(await main(({ globalShortcut }) => globalShortcut.isRegistered("Super+Alt+N"))));
  await main(() => globalThis.holocron.setSetting("quickCaptureEnabled", true));
  check("re-enabling registers it again", await main(({ globalShortcut }) => globalShortcut.isRegistered("Super+Alt+N")));
  // Sign-in: the dev build never registers a login item (the installed app does).
  await page.getByRole("switch", { name: "Start Holocron when you sign in to Windows" }).click().catch(async () => {
    await main(() => globalThis.holocron.setSetting("launchAtLogin", true));
  });
  await page.waitForTimeout(200);
  const login = await main(() => ({ setting: globalThis.holocron.settings.launchAtLogin, calls: globalThis.loginItemCalls }));
  check("launchAtLogin toggles without registering a dev login item", login.setting === true && login.calls.length === 0, JSON.stringify(login));
  await main(() => globalThis.holocron.setSetting("launchAtLogin", false));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ---- Running in the background ----
  await main(() => globalThis.holocron.window.close());
  await page.waitForTimeout(400);
  const hidden = await main(() => ({ exists: Boolean(globalThis.holocron.window && !globalThis.holocron.window.isDestroyed()), visible: globalThis.holocron.window?.isVisible() ?? false }));
  check("closing the window hides it to the tray", hidden.exists && !hidden.visible, JSON.stringify(hidden));
  check("first hide remembered the notice", await main(() => globalThis.holocron.store.get("backgroundNoticeShown") === true));
  await main(() => globalThis.holocron.tray.tray.emit("click"));
  await page.waitForTimeout(300);
  check("tray click shows the window again", await mainVisible());

  // ---- Jump list ----
  const jump = await main(() => globalThis.holocron.jumpListCategories());
  const tasks = jump.find((category) => category.type === "tasks");
  const recent = jump.find((category) => category.type === "custom");
  check(
    "jump list tasks",
    JSON.stringify(tasks?.items.map((item) => [item.title, item.args])) === JSON.stringify([["New Note", "--new-note"], ["Today’s Note", "--today"], ["Quick Capture", "--capture"]]),
  );
  check(
    "jump list recent notes",
    recent?.name === "Recent Notes" && recent.items.length >= 1 && recent.items.length <= 8 && recent.items.every((item) => item.args.startsWith('--open="') && item.program === item.iconPath),
    JSON.stringify(recent?.items.map((item) => [item.title, item.description, item.args])),
  );
  check("jump list's first recent note is today’s note", recent?.items[0]?.description === dailyPath);
  await page.waitForTimeout(1800);
  check("dev/test runs never set the real jump list", (await main(() => globalThis.jumpListCalls.length)) === 0);

  // ---- Launch arguments (second instance) ----
  const emitSecond = async (argv) => {
    await main(({ app: electronApp }, args) => electronApp.emit("second-instance", {}, [process.execPath, ...args], process.cwd(), {}), argv);
    await page.waitForTimeout(500);
  };
  const activePath = () => page.evaluate(() => window.holocronHost.call("getState").then((s) => s.vault?.doc?.path ?? null));
  const linked = path.join(vault, "Linked Note.md");
  await main(() => globalThis.holocron.window.hide());
  await emitSecond(["--open", linked]);
  check("--open <path> opens the note", (await activePath()) === "Linked Note.md");
  check("--open shows the window", await mainVisible());
  await emitSecond(["--today"]);
  check("--today opens today’s note", (await activePath()) === dailyPath);
  const notesBefore = await main(() => globalThis.holocron.vault.allNotes.length);
  await emitSecond(["--new-note"]);
  const created = await activePath();
  check("--new-note creates and opens a note", /(^|\/)Untitled( \d+)?\.md$/.test(created ?? "") && (await main(() => globalThis.holocron.vault.allNotes.length)) === notesBefore + 1, created);
  await emitSecond(["--capture"]);
  check("--capture shows the capture window", await captureVisible());
  await capturePage.keyboard.press("Escape");
  await emitSecond([`--open=${path.join(path.dirname(vault), "elsewhere.md")}`]);
  const err1 = await page.evaluate(() => window.holocronHost.call("getState").then((s) => s.errorMessage));
  check("a path outside known vaults is refused", err1 === "That note isn’t in a vault Holocron knows.", err1);
  await page.evaluate(() => window.holocronHost.call("dismissError"));
  await emitSecond(["--open", path.join(vault, "nope.txt")]);
  const err2 = await page.evaluate(() => window.holocronHost.call("getState").then((s) => s.errorMessage));
  check("a non-note path is ignored", err2 === null, err2);
  await main(() => globalThis.holocron.window.hide());
  await emitSecond([]);
  check("a plain second launch shows the window", await mainVisible());
  await emitSecond([linked]);
  check("a bare .md path (file association) opens the note", (await activePath()) === "Linked Note.md");

  // ---- Logs ----
  fs.writeFileSync(path.join(outDir, "capture-console.log"), captureLogs.join("\n"));
  const errors = captureLogs.filter((line) => /^\[(error|pageerror)\]/.test(line));
  check("capture window logged no errors", errors.length === 0, errors.join(" | "));

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log("Failed:\n" + failed.map((result) => "  " + result.name).join("\n"));

  // ---- Exit Holocron really quits, even in the background ----
  await page.locator(".menu-title", { hasText: "File" }).click();
  await page.waitForTimeout(200);
  const closed = app.waitForEvent("close", { timeout: 10_000 }).then(() => true, () => false);
  await page.locator(".menu-item", { hasText: "Exit Holocron" }).click().catch(() => {});
  console.log(`${(await closed) ? "PASS" : "FAIL"} File › Exit Holocron quits the app`);
}
