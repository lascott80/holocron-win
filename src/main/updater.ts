// Auto-update from GitHub Releases with electron-updater. Nothing is
// downloaded or installed without the user saying so: a check finds a newer
// version, the renderer's update card asks, Download fetches it (the app
// downloads it itself, so there's no Mark of the Web and no SmartScreen
// prompt), and Restart Now runs the installer silently and relaunches.
// The decisions live in updateState.ts.
//
// Test hook: HOLOCRON_UPDATE_URL=<url> reads updates from a "generic"
// server (a folder with latest.yml, the installer and its .blockmap)
// instead of GitHub (and a downloaded test update is never installed on
// quit). See scripts/test-update-server.mjs and scripts/smoke-update.mjs.

import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdateView } from "@shared/ipc";
import type { Settings } from "@shared/settings";
import { checkAction, initialUpdateModel, isPlainVersion, reduceUpdate, releasePageUrl, type UpdateEvent, type UpdateModel } from "./updateState";

const FIRST_CHECK_DELAY = 15_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const SKIPPED_KEY = "skippedUpdateVersion";
const LOG_LIMIT = 512 * 1024;

export interface UpdaterHost {
  store: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void; flush(): void };
  settings(): Settings;
  pushState(): void;
  saveAll(): void;
}

export class Updater {
  private model: UpdateModel = initialUpdateModel(app.getVersion());
  private updater: AppUpdater | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly feedUrl = process.env.HOLOCRON_UPDATE_URL || null;

  constructor(private readonly host: UpdaterHost) {}

  /** Updates only work in the installed app. */
  get isActive(): boolean {
    return app.isPackaged;
  }

  view(): UpdateView {
    return this.model.view;
  }

  /** Schedules automatic checks: ~15 s after launch, then every 6 hours. */
  start() {
    if (!this.isActive) return;
    this.timers.push(setTimeout(() => void this.check(false), FIRST_CHECK_DELAY));
    this.timers.push(setInterval(() => void this.check(false), CHECK_INTERVAL));
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async check(manual: boolean) {
    if (!this.isActive) {
      if (manual) this.dispatch({ type: "message", message: "Updates are checked in the installed app." });
      return;
    }
    const action = checkAction(this.model.view, manual, this.host.settings().checkForUpdates);
    if (action === "skip") return;
    if (action === "show") {
      this.dispatch({ type: "show" });
      return;
    }
    this.dispatch({ type: "checking", manual });
    try {
      // Errors arrive through the "error" event too; that's where they're handled.
      await this.autoUpdater().checkForUpdates();
    } catch {
      // Handled by onError.
    }
  }

  async download() {
    if (!this.isActive || this.model.view.status !== "available") return;
    this.dispatch({ type: "download-started" });
    try {
      await this.autoUpdater().downloadUpdate();
    } catch {
      // Handled by onError.
    }
  }

  /** Restart Now: save everything, then run the installer silently and relaunch. */
  install() {
    if (!this.isActive || this.model.view.status !== "downloaded") return;
    this.host.saveAll();
    this.host.store.flush();
    this.log("info", "Quitting to install the update");
    // isSilent: the assisted installer runs without its wizard; isForceRunAfter: relaunch.
    this.autoUpdater().quitAndInstall(true, true);
  }

  skip(version: string) {
    if (!isPlainVersion(version)) return;
    this.host.store.set(SKIPPED_KEY, version);
    this.dispatch({ type: "skip" });
  }

  dismiss() {
    this.dispatch({ type: "dismiss" });
  }

  openReleasePage(version: unknown) {
    void shell.openExternal(releasePageUrl(version));
  }

  // MARK: electron-updater

  private autoUpdater(): AppUpdater {
    if (this.updater) return this.updater;
    const updater = electronUpdater.autoUpdater;
    updater.autoDownload = false;
    // Only matters once the user has chosen to download an update. Test feeds
    // never install on quit, so a test build can't replace the real install.
    updater.autoInstallOnAppQuit = !this.feedUrl;
    updater.allowPrerelease = false;
    updater.logger = {
      info: (message?: unknown) => this.log("info", message),
      warn: (message?: unknown) => this.log("warn", message),
      error: (message?: unknown) => this.log("error", message),
    };
    if (this.feedUrl) {
      this.log("info", `Using the update feed ${this.feedUrl} (HOLOCRON_UPDATE_URL)`);
      updater.setFeedURL({ provider: "generic", url: this.feedUrl });
    }
    updater.on("update-available", (info: UpdateInfo) => {
      this.dispatch({
        type: "available",
        version: info.version,
        releaseNotes: info.releaseNotes,
        skippedVersion: this.host.store.get<string>(SKIPPED_KEY) ?? null,
        now: Date.now(),
      });
    });
    updater.on("update-not-available", () => this.dispatch({ type: "not-available", now: Date.now() }));
    updater.on("download-progress", (progress: ProgressInfo) => this.dispatch({ type: "progress", percent: progress.percent }));
    updater.on("update-downloaded", (info: UpdateInfo) => {
      this.log("info", `Downloaded ${info.version} to ${(info as UpdateInfo & { downloadedFile?: string }).downloadedFile ?? "?"} (sha512 verified)`);
      this.dispatch({ type: "downloaded", version: info.version });
    });
    updater.on("error", (error: Error) => this.dispatch({ type: "error", error, now: Date.now() }));
    this.updater = updater;
    return updater;
  }

  private dispatch(event: UpdateEvent) {
    this.model = reduceUpdate(this.model, event);
    this.host.pushState();
  }

  // MARK: Log (userData/logs/updater.log, kept under ~0.5 MB)

  private log(level: string, message: unknown) {
    const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    if (level === "error") console.error("[updater]", text);
    try {
      const dir = path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "updater.log");
      try {
        if (fs.statSync(file).size > LOG_LIMIT) fs.renameSync(file, file + ".old");
      } catch {
        // No log yet.
      }
      fs.appendFileSync(file, line);
    } catch {
      // Logging must never break updates.
    }
  }
}
