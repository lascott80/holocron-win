// End-to-end auto-update test against a local update server — never GitHub,
// and never installs anything. Needs two builds made with
// `electron-builder --win nsis` (see README › Updates): an older packaged
// app and a newer version's latest.yml + installer + .blockmap.
//
//   node scripts/smoke-update.mjs --app dist-test-0.3.9/win-unpacked/Holocron.exe --feed dist-test-0.4.0 [outDir]
//
// Each scenario gets a fresh profile (HOLOCRON_USER_DATA) and updater cache
// (LOCALAPPDATA), and the app is killed rather than quit once an update is
// downloaded, so the installer can't run.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { startUpdateServer } from "./test-update-server.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : null;
};
const executablePath = path.resolve(option("--app") ?? "dist-test-0.3.9/win-unpacked/Holocron.exe");
const feedFolder = path.resolve(option("--feed") ?? "dist-test-0.4.0");
const only = option("--only");
const outDir = path.resolve(args[0] ?? "smoke-output/update");
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "holocron-update-"));
const results = [];
let failed = false;
function check(condition, message) {
  results.push(`${condition ? "PASS" : "FAIL"} ${message}`);
  console.log(`${condition ? "PASS" : "FAIL"} ${message}`);
  if (!condition) failed = true;
}

const latest = fs.readFileSync(path.join(feedFolder, "latest.yml"), "utf8");
const expected = {
  version: /^version:\s*(\S+)/m.exec(latest)?.[1],
  path: /^path:\s*(\S+)/m.exec(latest)?.[1],
  sha512: /^sha512:\s*(\S+)/m.exec(latest)?.[1],
};

async function launch(name, feedUrl, { profile, seed } = {}) {
  const base = path.join(work, name);
  const userData = profile ?? path.join(base, "profile");
  const localAppData = path.join(base, "localappdata");
  const vault = path.join(base, "Vault");
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });
  if (!fs.existsSync(vault)) fs.cpSync(path.resolve("resources/guide"), vault, { recursive: true });
  if (seed) fs.writeFileSync(path.join(userData, "holocron.json"), JSON.stringify(seed));
  const app = await electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, HOLOCRON_USER_DATA: userData, HOLOCRON_OPEN_VAULT: vault, HOLOCRON_UPDATE_URL: feedUrl, LOCALAPPDATA: localAppData, ELECTRON_RENDERER_URL: "" },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await page.waitForTimeout(1500);
  let count = 0;
  const shot = async (label) => {
    const file = path.join(outDir, `${name}-${String(++count).padStart(2, "0")}-${label}.png`);
    await page.screenshot({ path: file });
    console.log("screenshot:", file);
  };
  const state = () => page.evaluate(() => window.holocronHost.call("getState"));
  // Ends the whole process tree at once, so no quit handlers run.
  const kill = () => {
    try {
      execFileSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  };
  return { app, page, shot, state, kill, userData, localAppData };
}

async function waitFor(page, predicate, arg, timeout = 30_000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 100 });
}

const cardText = (page) => page.locator(".update-card").innerText().catch(() => "");

async function checkFromHelpMenu(page) {
  await page.locator(".menu-title", { hasText: "Help" }).click();
  await page.locator(".menu-item", { hasText: "Check for Updates" }).click();
}

// ~40 MB/s, so the progress bar is visible for a few seconds.
process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});
const server = await startUpdateServer(feedFolder, 0, { throttle: 40 * 1024 * 1024 });
const emptyFolder = path.join(work, "empty-feed");
fs.mkdirSync(emptyFolder);
const emptyServer = await startUpdateServer(emptyFolder);
// A port nothing listens on (connection refused, like being offline).
const closedPort = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

try {
  // ---- 1. Manual check → available → Download → progress → downloaded ----
  if (!only || only === "download") {
    const { page, shot, state, kill, userData, localAppData } = await launch("download", server.url);
    try {
      await checkFromHelpMenu(page);
      await page.locator(".update-card").waitFor({ timeout: 10_000 });
      await waitFor(page, () => document.querySelector(".update-card")?.textContent?.includes("is available"));
      await shot("available");
      const text = await cardText(page);
      check(text.includes(`Holocron ${expected.version} is available`), `card offers ${expected.version}`);
      check(/Download/.test(text) && /Skip This Version/.test(text) && /Later/.test(text), "card has Download / Skip This Version / Later");

      await page.locator(".update-card button", { hasText: "Download" }).click();
      await waitFor(page, () => /Downloading update… ([2-9]\d)%|Update ready/.test(document.querySelector(".update-card")?.textContent ?? ""));
      if ((await cardText(page)).includes("Downloading")) await shot("downloading");
      const sawProgress = (await cardText(page)).includes("Downloading") || (await state()).update.status === "downloaded";
      check(sawProgress, "download started and showed progress");
      await waitFor(page, () => document.querySelector(".update-card")?.textContent?.includes("Update ready"), undefined, 120_000);
      await shot("downloaded");
      const s = await state();
      check(s.update.status === "downloaded" && s.update.version === expected.version, `state is downloaded ${expected.version}`);
      check((await cardText(page)).includes("Restart Now"), "card offers Restart Now / Later");

      // Settings › General › Updates
      await page.locator(".update-card button", { hasText: "Later" }).click();
      await page.keyboard.press("Control+,");
      await page.locator(".panel.settings").waitFor();
      await page.locator(".nav-item", { hasText: "General" }).click();
      await page.locator(".panel.settings .content").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(300);
      await shot("settings-ready");
      const settingsText = await page.locator(".panel.settings").innerText();
      check(settingsText.includes("Restart to Update") && settingsText.includes(`Version ${expected.version} is ready to install.`), "Settings shows Restart to Update");

      // The installer is in the updater cache and matches latest.yml's sha512.
      const pending = path.join(localAppData, "holocron-updater", "pending");
      const installer = path.join(pending, expected.path);
      check(fs.existsSync(installer), `downloaded ${path.relative(work, installer)}`);
      if (fs.existsSync(installer)) {
        const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest("base64");
        check(sha512 === expected.sha512, `sha512 matches latest.yml (${sha512.slice(0, 16)}…)`);
      }
      const log = fs.readFileSync(path.join(userData, "logs", "updater.log"), "utf8");
      fs.writeFileSync(path.join(outDir, "download-updater.log"), log);
      // The one error allowed: no blockmap of an installed older version, so no differential download.
      const errors = log.split("\n").filter((line) => line.includes("[error]") && !line.includes("Cannot download differentially, fallback to full download"));
      check(/Downloaded .* \(sha512 verified\)/.test(log) && errors.length === 0, "updater log: downloaded, no errors");
      results.push("server requests: " + server.requests.join(" | "));
    } finally {
      // Killed, not quit: a quit would hand the downloaded installer to Windows.
      kill();
    }
  }

  // ---- 2. Errors: no latest.yml (404) and no server (connection refused) ----
  if (!only || only === "errors") {
    for (const [name, url, message] of [
      ["missing-yml", emptyServer.url, "No update information is published yet."],
      ["offline", `http://127.0.0.1:${closedPort}/`,"Couldn’t check for updates. Check your internet connection."],
    ]) {
      const { page, shot, state, kill } = await launch(name, url);
      try {
        await checkFromHelpMenu(page);
        await waitFor(page, () => document.querySelector(".update-card")?.textContent?.includes("Update problem"));
        await shot("error");
        check((await cardText(page)).includes(message), `${name}: card says “${message}”`);
        check((await state()).update.status === "error", `${name}: status is error`);
      } finally {
        kill();
      }
    }
  }

  // ---- 3. Skip This Version → no automatic prompt next launch ----
  if (!only || only === "skip") {
    const first = await launch("skip", server.url);
    try {
      await checkFromHelpMenu(first.page);
      await waitFor(first.page, () => document.querySelector(".update-card")?.textContent?.includes("is available"));
      await first.page.locator(".update-card button", { hasText: "Skip This Version" }).click();
      await first.page.waitForTimeout(800);
      check((await first.page.locator(".update-card").count()) === 0, "skip: card hides");
    } finally {
      await first.app.close().catch(first.kill);
    }
    const stored = JSON.parse(fs.readFileSync(path.join(first.userData, "holocron.json"), "utf8"));
    check(stored.skippedUpdateVersion === expected.version, `skip: stored skippedUpdateVersion ${stored.skippedUpdateVersion}`);

    const second = await launch("skip-relaunch", server.url, { profile: first.userData });
    try {
      // The automatic check runs ~15 s after launch.
      await waitFor(second.page, () => window.holocronHost.call("getState").then((s) => s.update.status === "available"), undefined, 40_000);
      await second.page.waitForTimeout(1000);
      check((await second.page.locator(".update-card").count()) === 0, "skip: automatic check found the skipped version and stayed quiet");
      await second.shot("no-prompt");
      await checkFromHelpMenu(second.page);
      await waitFor(second.page, () => document.querySelector(".update-card")?.textContent?.includes("is available"));
      check(true, "skip: a manual check still offers it");
      await second.shot("manual-still-offers");
    } finally {
      second.kill();
    }
  }

  // ---- 4. Up to date: the feed's own version ----
  if (!only || only === "uptodate") {
    const sameFolder = path.join(work, "same-feed");
    fs.mkdirSync(sameFolder);
    fs.writeFileSync(path.join(sameFolder, "latest.yml"), latest.replace(/^version:.*$/m, "version: 0.3.9"));
    const same = await startUpdateServer(sameFolder);
    const { page, shot, kill } = await launch("uptodate", same.url);
    try {
      await checkFromHelpMenu(page);
      await waitFor(page, () => document.querySelector(".update-card")?.textContent?.includes("up to date"));
      await shot("up-to-date");
      check((await cardText(page)).includes("You’re up to date — Holocron 0.3.9 is the newest version."), "up to date message");
    } finally {
      kill();
      same.server.close();
    }
  }
} catch (error) {
  check(false, `exception: ${error.stack ?? error}`);
} finally {
  server.server.close();
  emptyServer.server.close();
  fs.writeFileSync(path.join(outDir, "results.txt"), results.join("\n") + "\n");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.log(`Couldn’t remove ${work}: ${error.message}`);
  }
}
console.log(failed ? "\nSome checks FAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
