import { describe, expect, it, vi } from "vitest";
import {
  checkAction,
  friendlyUpdateError,
  initialUpdateModel,
  isPlainVersion,
  reduceUpdate,
  releaseNotesText,
  releasePageUrl,
  type UpdateEvent,
  type UpdateModel,
} from "../../src/main/updateState";
import { Updater } from "../../src/main/updater";
import { defaultSettings } from "../../src/shared/settings";

const NOW = 1_760_000_000_000;

function apply(events: UpdateEvent[], model: UpdateModel = initialUpdateModel("0.3.9")): UpdateModel {
  return events.reduce(reduceUpdate, model);
}

const available = (version = "0.4.0", skippedVersion: string | null = null): UpdateEvent => ({
  type: "available",
  version,
  releaseNotes: "<p>Auto-update</p><ul><li>Faster &amp; safer</li></ul>",
  skippedVersion,
  now: NOW,
});

describe("update state", () => {
  it("starts idle with the card hidden", () => {
    const { view } = initialUpdateModel("0.3.9");
    expect(view).toEqual({ status: "idle", currentVersion: "0.3.9", showPrompt: false });
  });

  it("an automatic check that finds an update shows the card", () => {
    const { view } = apply([{ type: "checking", manual: false }, available()]);
    expect(view.status).toBe("available");
    expect(view.version).toBe("0.4.0");
    expect(view.releaseNotes).toBe("Auto-update\n\n• Faster & safer");
    expect(view.lastChecked).toBe(NOW);
    expect(view.showPrompt).toBe(true);
  });

  it("an automatic check doesn't show the card while checking or when nothing is new", () => {
    let model = apply([{ type: "checking", manual: false }]);
    expect(model.view.showPrompt).toBe(false);
    model = reduceUpdate(model, { type: "not-available", now: NOW });
    expect(model.view.status).toBe("not-available");
    expect(model.view.showPrompt).toBe(false);
    expect(model.view.message).toBeUndefined();
    expect(model.view.lastChecked).toBe(NOW);
  });

  it("a manual check shows Checking…, then “You’re up to date”", () => {
    let model = apply([{ type: "checking", manual: true }]);
    expect(model.view).toMatchObject({ status: "checking", showPrompt: true });
    model = reduceUpdate(model, { type: "not-available", now: NOW });
    expect(model.view.showPrompt).toBe(true);
    expect(model.view.message).toBe("You’re up to date — Holocron 0.3.9 is the newest version.");
  });

  it("a skipped version is not prompted automatically, but a manual check still shows it", () => {
    let model = apply([{ type: "checking", manual: false }, available("0.4.0", "0.4.0")]);
    expect(model.view.status).toBe("available");
    expect(model.view.showPrompt).toBe(false);
    model = apply([{ type: "checking", manual: true }, available("0.4.0", "0.4.0")], model);
    expect(model.view.showPrompt).toBe(true);
    // A newer version than the skipped one is prompted again.
    model = apply([{ type: "dismiss" }, { type: "checking", manual: false }, available("0.4.1", "0.4.0")], model);
    expect(model.view.showPrompt).toBe(true);
  });

  it("downloads with progress, then is ready to install", () => {
    let model = apply([{ type: "checking", manual: false }, available(), { type: "download-started" }]);
    expect(model.view).toMatchObject({ status: "downloading", percent: 0, showPrompt: true });
    model = reduceUpdate(model, { type: "progress", percent: 42.4 });
    expect(model.view.percent).toBe(42.4);
    model = reduceUpdate(model, { type: "progress", percent: 140 });
    expect(model.view.percent).toBe(100);
    model = reduceUpdate(model, { type: "downloaded", version: "0.4.0" });
    expect(model.view).toMatchObject({ status: "downloaded", version: "0.4.0", showPrompt: true });
  });

  it("ignores progress when not downloading", () => {
    const model = apply([{ type: "progress", percent: 50 }]);
    expect(model.view.status).toBe("idle");
    expect(model.view.percent).toBeUndefined();
  });

  it("a later check for the same version doesn't undo a finished download", () => {
    const model = apply([{ type: "checking", manual: false }, available(), { type: "download-started" }, { type: "downloaded" }, available()]);
    expect(model.view.status).toBe("downloaded");
  });

  it("errors from automatic checks are quiet; manual ones show the card", () => {
    const offline = new Error("net::ERR_INTERNET_DISCONNECTED");
    let model = apply([{ type: "checking", manual: false }, { type: "error", error: offline, now: NOW }]);
    expect(model.view).toMatchObject({ status: "error", showPrompt: false, error: "Couldn’t check for updates. Check your internet connection." });
    model = apply([{ type: "checking", manual: true }, { type: "error", error: offline, now: NOW }], model);
    expect(model.view.showPrompt).toBe(true);
  });

  it("download errors are always shown, worded for the download", () => {
    const model = apply([
      { type: "checking", manual: false },
      available(),
      { type: "download-started" },
      { type: "error", error: new Error("net::ERR_CONNECTION_RESET"), now: NOW + 5 },
    ]);
    expect(model.view.showPrompt).toBe(true);
    expect(model.view.error).toBe("Couldn’t download the update. Check your internet connection.");
    expect(model.view.lastChecked).toBe(NOW);
  });

  it("Later and Skip hide the card; show brings it back", () => {
    let model = apply([{ type: "checking", manual: true }, available(), { type: "dismiss" }]);
    expect(model.view.showPrompt).toBe(false);
    expect(model.view.status).toBe("available");
    model = reduceUpdate(model, { type: "show" });
    expect(model.view.showPrompt).toBe(true);
    model = reduceUpdate(model, { type: "skip" });
    expect(model.view.showPrompt).toBe(false);
  });

  it("a message shows in the card", () => {
    const model = apply([{ type: "message", message: "Updates are checked in the installed app." }]);
    expect(model.view).toMatchObject({ status: "idle", showPrompt: true, message: "Updates are checked in the installed app." });
  });
});

describe("checkAction", () => {
  const view = (status: UpdateModel["view"]["status"]) => ({ status, currentVersion: "0.3.9", showPrompt: false });

  it("respects the setting for automatic checks only", () => {
    expect(checkAction(view("idle"), false, true)).toBe("check");
    expect(checkAction(view("idle"), false, false)).toBe("skip");
    expect(checkAction(view("idle"), true, false)).toBe("check");
    expect(checkAction(view("error"), false, true)).toBe("check");
  });

  it("doesn't check again while downloading or once downloaded", () => {
    for (const status of ["downloading", "downloaded", "checking"] as const) {
      expect(checkAction(view(status), false, true)).toBe("skip");
      expect(checkAction(view(status), true, true)).toBe("show");
    }
  });
});

describe("friendlyUpdateError", () => {
  it("maps network failures", () => {
    for (const message of [
      "net::ERR_INTERNET_DISCONNECTED",
      "Error: net::ERR_NAME_NOT_RESOLVED",
      "net::ERR_CONNECTION_REFUSED",
      "getaddrinfo ENOTFOUND github.com",
      "connect ETIMEDOUT 1.2.3.4:443",
    ]) {
      expect(friendlyUpdateError(new Error(message))).toBe("Couldn’t check for updates. Check your internet connection.");
    }
  });

  it("maps a release without latest.yml", () => {
    const error = Object.assign(new Error("Cannot find latest.yml in the latest release artifacts (https://github.com/…/latest.yml): HttpError: 404"), {
      code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
    });
    expect(friendlyUpdateError(error)).toBe("No update information is published yet.");
    expect(friendlyUpdateError(Object.assign(new Error("x"), { code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" }))).toBe("No update information is published yet.");
  });

  it("prefers the network message when GitHub can't be reached", () => {
    const error = Object.assign(new Error("Unable to find latest version on GitHub (…), please ensure a production release exists: Error: net::ERR_INTERNET_DISCONNECTED"), {
      code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
    });
    expect(friendlyUpdateError(error)).toBe("Couldn’t check for updates. Check your internet connection.");
  });

  it("maps a checksum mismatch", () => {
    expect(friendlyUpdateError(new Error("sha512 checksum mismatch, expected abc, got def"), "download")).toBe("The downloaded update was damaged. Please try again.");
  });

  it("falls back to the first line, shortened", () => {
    expect(friendlyUpdateError(new Error("Something odd\n    at stack"))).toBe("Couldn’t check for updates. (Something odd)");
    expect(friendlyUpdateError(new Error("x".repeat(300)))).toHaveLength("Couldn’t check for updates. ()".length + 158);
    expect(friendlyUpdateError("plain string", "download")).toBe("Couldn’t download the update. (plain string)");
  });
});

describe("releaseNotesText", () => {
  it("turns HTML into plain text", () => {
    expect(releaseNotesText("<h2>New</h2><p>Line one<br>Line two &lt;3 &#x2014; &#8212;</p>")).toBe("New\nLine one\nLine two <3 — —");
  });

  it("joins a list of notes and drops empty ones", () => {
    expect(releaseNotesText([{ version: "0.4.0", note: "Updates" }, { version: "0.3.9", note: null }])).toBe("Updates");
  });

  it("returns undefined for nothing", () => {
    expect(releaseNotesText(null)).toBeUndefined();
    expect(releaseNotesText("   <p></p> ")).toBeUndefined();
  });

  it("keeps unknown entities and caps the length", () => {
    expect(releaseNotesText("a &bogus; b")).toBe("a &bogus; b");
    expect(releaseNotesText("x".repeat(5000))).toHaveLength(4000);
  });
});

describe("release page URL", () => {
  it("only uses plain versions", () => {
    expect(releasePageUrl("0.4.0")).toBe("https://github.com/lascott80/holocron-win/releases/tag/v0.4.0");
    expect(releasePageUrl("0.4.0-beta.1")).toBe("https://github.com/lascott80/holocron-win/releases/tag/v0.4.0-beta.1");
    expect(releasePageUrl("../../evil")).toBe("https://github.com/lascott80/holocron-win/releases");
    expect(releasePageUrl("1.0.0/../x")).toBe("https://github.com/lascott80/holocron-win/releases");
    expect(releasePageUrl(null)).toBe("https://github.com/lascott80/holocron-win/releases");
    expect(isPlainVersion("0.4.0")).toBe(true);
    expect(isPlainVersion("v0.4.0")).toBe(false);
  });
});

// ---- Updater (electron and electron-updater mocked) ----

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    logger: null as unknown,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  };
  return { listeners, autoUpdater, emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args), openExternal: vi.fn(async () => {}) };
});

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.3.9", getPath: () => `${process.env.TEMP ?? "/tmp"}/holocron-updater-test` },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: mocks.autoUpdater } }));

describe("Updater", () => {
  function makeUpdater(settings = defaultSettings) {
    const values = new Map<string, unknown>();
    const calls: string[] = [];
    const host = {
      store: { get: <T>(key: string) => values.get(key) as T | undefined, set: (key: string, value: unknown) => values.set(key, value), flush: () => calls.push("flush") },
      settings: () => settings,
      pushState: () => {},
      saveAll: () => calls.push("saveAll"),
    };
    return { updater: new Updater(host), values, calls };
  }

  it("configures electron-updater to ask first", async () => {
    const { updater } = makeUpdater();
    await updater.check(true);
    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(mocks.autoUpdater.allowPrerelease).toBe(false);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalled();
    expect(updater.view()).toMatchObject({ status: "checking", showPrompt: true });
  });

  it("downloads only when asked, then installs silently after saving", async () => {
    const { updater, calls } = makeUpdater();
    await updater.check(false);
    mocks.emit("update-available", { version: "0.4.0", releaseNotes: "Notes" });
    expect(updater.view()).toMatchObject({ status: "available", version: "0.4.0", showPrompt: true });
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    await updater.download();
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    mocks.emit("download-progress", { percent: 50 });
    expect(updater.view().percent).toBe(50);
    mocks.emit("update-downloaded", { version: "0.4.0" });
    updater.install();
    expect(calls).toEqual(["saveAll", "flush"]);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("skipping remembers the version and suppresses the automatic prompt", async () => {
    const { updater, values } = makeUpdater();
    updater.skip("0.4.0");
    expect(values.get("skippedUpdateVersion")).toBe("0.4.0");
    updater.skip("../evil");
    expect(values.get("skippedUpdateVersion")).toBe("0.4.0");
    await updater.check(false);
    mocks.emit("update-available", { version: "0.4.0" });
    expect(updater.view()).toMatchObject({ status: "available", showPrompt: false });
  });

  it("automatic checks follow the setting", async () => {
    mocks.autoUpdater.checkForUpdates.mockClear();
    const { updater } = makeUpdater({ ...defaultSettings, checkForUpdates: false });
    await updater.check(false);
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    await updater.check(true);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("opens release pages built from the fixed repository", () => {
    const { updater } = makeUpdater();
    updater.openReleasePage("0.4.0");
    updater.openReleasePage("https://evil.example");
    expect(mocks.openExternal.mock.calls).toEqual([
      ["https://github.com/lascott80/holocron-win/releases/tag/v0.4.0"],
      ["https://github.com/lascott80/holocron-win/releases"],
    ]);
  });
});

describe("joining a check in progress", () => {
  it("a manual check during an automatic one reports its result", () => {
    const model = apply([{ type: "checking", manual: false }, { type: "show" }, { type: "not-available", now: NOW }]);
    expect(model.view.showPrompt).toBe(true);
    expect(model.view.message).toContain("You’re up to date");
  });
});
