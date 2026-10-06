// Holocron's main process: the window, the vault, settings and the bridge to
// the renderer. (Plays the part of HolocronApp.swift + AppModel.swift.)

import fs from "node:fs";
import path from "node:path";
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, globalShortcut, nativeTheme, Notification, protocol, shell, ipcMain } from "electron";
import { assetResponse } from "./assets";
import { Channels, type AppState, type CaptureInfo, type CaptureResult, type EditorMessage, type QuickCaptureView, type RecentVault, type UiRequest } from "@shared/ipc";
import { normalizeShortcut, sanitizeSettings, shortcutLabel, type CaptureTarget, type Settings } from "@shared/settings";
import { resolveTheme, windowColors } from "@shared/themes";
import { stem } from "@core/paths";
import { FileStore } from "./store";
import { createTrash, isInside, writeAtomic } from "./fsx";
import { Vault } from "./vault";
import { VaultWatcher } from "./watcher";
import { EditorBridge, openExternalSafely } from "./editorBridge";
import { SearchService } from "./searchService";
import { createCommands } from "./commands";
import { Updater } from "./updater";
import { CAPTURE_COMMANDS, CaptureWindow } from "./capture";
import { TrayIcon } from "./tray";
import { applyJumpList, buildJumpList, MAX_JUMP_LIST_NOTES, type JumpListNote } from "./jumpList";
import { hasActions, parseLaunchArgs, type LaunchArgs } from "./launchArgs";

const ASSET_SCHEME = "holocron-asset";
protocol.registerSchemesAsPrivileged([
  // corsEnabled: the editor checks whether a PDF exists with fetch() (a frame can't tell it).
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const MAX_RECENT_VAULTS = 8;
const isDev = !app.isPackaged;

// Test and debug hooks: an isolated profile, and a vault to open at launch.
const testProfile = Boolean(process.env.HOLOCRON_USER_DATA);
if (process.env.HOLOCRON_USER_DATA) app.setPath("userData", process.env.HOLOCRON_USER_DATA);
const launchVault = process.env.HOLOCRON_OPEN_VAULT;
const devRendererUrl = isDev && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
/** Window icon: the multi-size .ico on Windows (crisp in the taskbar at every scale). */
const appIcon = () => path.join(app.getAppPath(), "resources", process.platform === "win32" ? "icon.ico" : "icon.png");
/** The 1024 px master; the tray picks hand-tuned small sizes from resources/icons beside it. */
const trayIcon = () => path.join(app.getAppPath(), "resources", "icon.png");
const BACKGROUND_NOTICE_KEY = "backgroundNoticeShown";

export class HolocronApp {
  readonly store = new FileStore(path.join(app.getPath("userData"), "holocron.json"));
  settings: Settings = sanitizeSettings(this.store.get("settings") ?? {});
  vault: Vault | null = null;
  window: BrowserWindow | null = null;
  errorMessage: string | null = null;
  recentVaults: string[] = (this.store.get<string[]>("recentVaultPaths") ?? []).filter(folderExists);
  readonly editor = new EditorBridge(() => this.window?.webContents ?? null);
  readonly search = new SearchService();
  readonly updater = new Updater({ store: this.store, settings: () => this.settings, pushState: () => this.pushState(), saveAll: () => this.saveAll() });
  readonly trash = createTrash(path.join(app.getPath("userData"), "trash-staging"), (file) => shell.trashItem(file));
  readonly capture = new CaptureWindow({
    info: () => this.captureInfo(),
    preload: path.join(import.meta.dirname, "../preload/index.cjs"),
    icon: appIcon(),
    devUrl: devRendererUrl,
    load: (window) => (devRendererUrl ? window.loadURL(`${devRendererUrl}/capture.html`) : window.loadFile(path.join(import.meta.dirname, "../renderer/capture.html"))),
  });
  readonly tray = new TrayIcon(trayIcon(), {
    show: () => this.showMainWindow(),
    capture: () => void this.showCapture(),
    today: () => {
      this.showMainWindow();
      this.vault?.openDailyNote();
    },
    newNote: () => {
      this.showMainWindow();
      this.vault?.createNote();
    },
    checkForUpdates: () => {
      this.showMainWindow();
      void this.updater.check(true);
    },
    quit: () => this.quit(),
    captureShortcut: () => (this.quickCapture.registered ? this.registeredShortcut : null),
  });
  /** Holocron is really quitting (not just hiding the window in the background). */
  quitting = false;
  /** Launched with --hidden (sign-in) or just for quick capture: don't show the window yet. */
  startHidden = false;
  quickCapture: QuickCaptureView = { registered: false, error: null };
  private registeredShortcut: string | null = null;
  /** Settings is recording a new shortcut: the current one mustn't fire meanwhile. */
  private shortcutSuspended = false;
  private jumpListTimer: NodeJS.Timeout | null = null;
  private jumpListKey = "";
  private watcher: VaultWatcher | null = null;
  private stateQueued = false;

  constructor() {
    this.applyThemeSource();
    nativeTheme.on("updated", () => this.capture.refresh());
  }

  // MARK: State

  /** Pushes a state snapshot to the renderer (coalesced). */
  pushState() {
    if (this.stateQueued) return;
    this.stateQueued = true;
    setImmediate(() => {
      this.stateQueued = false;
      this.window?.webContents.send(Channels.state, this.state());
      this.scheduleJumpList();
    });
  }

  pushTree() {
    this.window?.webContents.send(Channels.tree, this.vault?.tree ?? []);
  }

  state(): AppState {
    return {
      vault: this.vault?.view() ?? null,
      recentVaults: this.recentVaults.map(describeVault),
      settings: this.settings,
      errorMessage: this.errorMessage ?? this.vault?.errorMessage ?? null,
      version: app.getVersion(),
      isDark: nativeTheme.shouldUseDarkColors,
      update: this.updater.view(),
      quickCapture: this.quickCapture,
    };
  }

  dismissError() {
    this.errorMessage = null;
    if (this.vault) this.vault.errorMessage = null;
    this.pushState();
  }

  showError(message: string) {
    this.errorMessage = message;
    this.pushState();
  }

  // MARK: Settings

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = sanitizeSettings({ ...this.settings, [key]: value });
    if (key === "editorMode" && next.editorMode !== "reading") next.lastEditingMode = next.editorMode;
    this.settings = next;
    this.store.set("settings", next);
    if (key === "appearance") this.applyThemeSource();
    if (key === "appearance" || key === "darkTheme" || key === "lightTheme") this.applyWindowColors();
    if (key === "quickCaptureEnabled" || key === "quickCaptureShortcut") this.registerCaptureShortcut();
    if (key === "runInBackground") this.updateTray();
    if (key === "launchAtLogin") this.applyLoginItem();
    if (key === "accent" || key === "appearance" || key === "darkTheme" || key === "lightTheme" || key === "quickCaptureTarget" || key === "quickCaptureInbox") this.capture.refresh();
    this.pushState();
  }

  private applyThemeSource() {
    nativeTheme.themeSource = this.settings.appearance;
  }

  /** The window background and title-bar overlay follow the colour theme (§16.10). */
  private applyWindowColors() {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const colors = windowChrome(this.settings, nativeTheme.shouldUseDarkColors);
    window.setTitleBarOverlay(colors.titleBarOverlay);
    window.setBackgroundColor(colors.backgroundColor);
  }

  // MARK: Vaults

  async openVault(root: string) {
    if (!folderExists(root)) {
      this.showError(`The folder “${path.basename(root)}” no longer exists.`);
      this.forgetVault(root);
      return;
    }
    await this.closeVault();
    const vault = new Vault(root, {
      store: this.store,
      settings: () => this.settings,
      editor: this.editor,
      trash: (file) => this.trash.trash(file),
      openPath: (file) => void shell.openPath(file),
      ui: (request) => {
        if (request.type === "beep") shell.beep();
        else this.window?.webContents.send(Channels.ui, request);
      },
      onChange: () => this.pushState(),
      onTreeChange: () => this.pushTree(),
      onIndexChange: (updated, removed) => {
        this.search.update(updated.map(({ path: notePath, text }) => ({ path: notePath, text, tags: vault.index.info(notePath)?.tags ?? [] })));
        this.search.remove(removed);
      },
    });
    this.vault = vault;
    this.editor.vault = vault;
    this.rememberVault(vault.root);
    this.watcher = new VaultWatcher(vault.root, (paths) => vault.handleDiskChanges(paths));
    this.watcher.start().catch((error) => console.error("Watcher failed:", error));
    this.window?.setTitle(`${vault.name} — Holocron`);
    this.pushTree();
    this.pushState();
    this.capture.refresh();
  }

  async closeVault() {
    if (!this.vault) return;
    this.vault.close();
    await this.watcher?.stop();
    this.watcher = null;
    this.vault = null;
    this.editor.vault = null;
    this.editor.show(null, null);
    this.search.clear();
    this.window?.setTitle("Holocron");
    this.pushTree();
    this.pushState();
    this.capture.refresh();
  }

  forgetVault(root: string) {
    this.recentVaults = this.recentVaults.filter((recent) => !samePath(recent, root));
    this.store.set("recentVaultPaths", this.recentVaults);
    this.pushState();
  }

  private rememberVault(root: string) {
    this.recentVaults = [root, ...this.recentVaults.filter((recent) => !samePath(recent, root))].slice(0, MAX_RECENT_VAULTS);
    this.store.set("recentVaultPaths", this.recentVaults);
  }

  async presentOpenDialog() {
    const result = await dialog.showOpenDialog(this.window!, {
      title: "Open Folder as Vault",
      buttonLabel: "Open Vault",
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) await this.openVault(result.filePaths[0]);
  }

  async presentCreateDialog() {
    const result = await dialog.showSaveDialog(this.window!, {
      title: "Create New Vault",
      buttonLabel: "Create Vault",
      nameFieldLabel: "Vault name:",
      defaultPath: path.join(app.getPath("documents"), "My Vault"),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return;
    try {
      fs.mkdirSync(result.filePath);
      installStarterGuide(result.filePath);
      await this.openVault(result.filePath);
      this.vault?.open("Start Here.md");
    } catch (error) {
      this.showError(`Couldn’t create the vault: ${(error as Error).message}`);
    }
  }

  /** Help › Add Start Here Guide to Vault. */
  addStarterGuide() {
    const vault = this.vault;
    if (!vault) return;
    try {
      installStarterGuide(vault.root);
      vault.reload();
      vault.open("Start Here.md", vault.document !== null);
    } catch (error) {
      this.showError(`Couldn’t add the guide: ${(error as Error).message}`);
    }
  }

  saveAll() {
    this.vault?.saveAll();
  }

  /** Quits for real — File › Exit Holocron, the tray's Quit — even when running in the background. */
  quit() {
    this.prepareToQuit();
    app.quit();
  }

  /** From now on closing windows quits instead of hiding them (before-quit, updates, Windows shutting down). */
  prepareToQuit() {
    this.quitting = true;
    this.capture.quitting = true;
  }

  // MARK: Quick capture

  captureInfo(): CaptureInfo {
    const vault = this.vault;
    return {
      vaultName: vault?.name ?? null,
      target: this.settings.quickCaptureTarget,
      dailyPath: vault?.dailyNotePathFor(new Date()) ?? null,
      inboxPath: vault?.inboxPath ?? null,
      isDark: nativeTheme.shouldUseDarkColors,
      settings: this.settings,
    };
  }

  /** Shows the capture window (the global shortcut, tray, jump list and File › Quick Capture). */
  showCapture() {
    return this.capture.show();
  }

  /** The capture window's Save: appends to the note, hides the window and confirms with a notification. */
  saveCapture(text: string, target: CaptureTarget): CaptureResult {
    const vault = this.vault;
    if (!vault) return { ok: false, error: "Open a vault in Holocron first." };
    let notePath: string;
    try {
      notePath = vault.appendCapture(text, target);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    this.capture.hide(true);
    if (Notification.isSupported()) {
      const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
      const notification = new Notification({
        title: target === "daily" ? "Saved to Today’s note" : `Saved to “${stem(notePath)}”`,
        body: firstLine.length > 120 ? firstLine.slice(0, 119) + "…" : firstLine,
        silent: true,
      });
      notification.on("click", () => {
        this.showMainWindow();
        if (this.vault === vault) vault.open(notePath);
      });
      notification.show();
    }
    return { ok: true, path: notePath };
  }

  /**
   * (Re)registers the system-wide quick capture shortcut from Settings and
   * records whether Windows accepted it (another app may own it).
   */
  registerCaptureShortcut() {
    if (this.registeredShortcut) globalShortcut.unregister(this.registeredShortcut);
    this.registeredShortcut = null;
    let view: QuickCaptureView = { registered: false, error: null };
    const accelerator = normalizeShortcut(this.settings.quickCaptureShortcut);
    if (this.settings.quickCaptureEnabled && !this.shortcutSuspended) {
      if (!accelerator) {
        view = { registered: false, error: "That isn’t a shortcut Holocron can use." };
      } else {
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => void this.showCapture());
        } catch {
          ok = false;
        }
        if (ok) {
          this.registeredShortcut = accelerator;
          view = { registered: true, error: null };
        } else {
          view = { registered: false, error: "That shortcut is in use by another app." };
        }
      }
    }
    this.quickCapture = view;
    this.tray.updateMenu();
    this.pushState();
  }

  /** While Settings records a new shortcut, the old one is released so pressing it again can be recorded. */
  suspendCaptureShortcut(suspended: boolean) {
    if (this.shortcutSuspended === suspended) return;
    this.shortcutSuspended = suspended;
    if (suspended) {
      if (this.registeredShortcut) globalShortcut.unregister(this.registeredShortcut);
      this.registeredShortcut = null;
      // Keep reporting the last result, so Settings doesn't flash an error while recording.
      this.pushState();
    } else {
      this.registerCaptureShortcut();
    }
  }

  // MARK: Background, tray and sign-in

  /** Shows (creating if needed), restores and focuses the main window. */
  showMainWindow() {
    if (!this.window || this.window.isDestroyed()) this.createWindow();
    const window = this.window!;
    this.startHidden = false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** The tray icon is there while Holocron runs in the background. */
  updateTray() {
    if (this.settings.runInBackground) this.tray.create();
    else this.tray.destroy();
  }

  /** Start at sign-in (`launchAtLogin`), hidden in the notification area. Only the installed app registers itself. */
  applyLoginItem() {
    if (!app.isPackaged) {
      console.info("Start at sign-in is only set by the installed app.");
      return;
    }
    try {
      app.setLoginItemSettings({ openAtLogin: this.settings.launchAtLogin, args: ["--hidden"] });
    } catch (error) {
      console.warn("Couldn’t change the sign-in setting:", error);
    }
  }

  /** The first time the window hides into the background, say where Holocron went. */
  private showBackgroundNotice() {
    if (this.store.get<boolean>(BACKGROUND_NOTICE_KEY)) return;
    this.store.set(BACKGROUND_NOTICE_KEY, true);
    if (!Notification.isSupported()) return;
    const shortcut = this.quickCapture.registered && this.registeredShortcut ? shortcutLabel(this.registeredShortcut) : null;
    const notification = new Notification({
      title: "Holocron",
      body: shortcut
        ? `Holocron is still running — use ${shortcut} to capture, or the tray icon to open it.`
        : "Holocron is still running — use the tray icon to open it.",
      silent: true,
    });
    notification.on("click", () => this.showMainWindow());
    notification.show();
  }

  // MARK: Launch arguments (jump list, sign-in, file association, second launch)

  /** The known vault (the open one first, then recent ones) whose folder holds `file`. */
  vaultContaining(file: string): string | null {
    const candidates = [...(this.vault ? [this.vault.root] : []), ...this.recentVaults];
    return candidates.find((root) => folderExists(root) && isInside(root, file)) ?? null;
  }

  /**
   * Acts on launch arguments. `initial`: the app's own command line;
   * otherwise a second launch, which always brings the window forward
   * unless it only asked for quick capture (or only said --hidden).
   */
  async handleLaunchArgs(args: LaunchArgs, initial: boolean) {
    if (args.open) await this.openNoteFile(args.open);
    if (args.newNote) {
      this.showMainWindow();
      this.vault?.createNote();
    }
    if (args.today) {
      this.showMainWindow();
      this.vault?.openDailyNote();
    }
    if (args.capture) await this.showCapture();
    if (!initial && !hasActions(args) && !args.hidden) this.showMainWindow();
  }

  /** Opens a note given as an absolute path (already checked to be absolute .md/.markdown) if it's in a known vault. */
  async openNoteFile(file: string) {
    const fail = () => {
      this.showMainWindow();
      this.showError("That note isn’t in a vault Holocron knows.");
    };
    let real: string;
    try {
      if (!fs.statSync(file).isFile()) return fail();
      real = fs.realpathSync.native(file);
    } catch {
      return fail();
    }
    const root = this.vaultContaining(real);
    if (!root) return fail();
    if (!this.vault || !samePath(this.vault.root, root)) await this.openVault(root);
    const vault = this.vault;
    if (!vault) return fail();
    let realRoot = vault.root;
    try {
      realRoot = fs.realpathSync.native(vault.root);
    } catch {
      // Use it as it is.
    }
    const wanted = path.relative(realRoot, real).split(path.sep).join("/").toLowerCase();
    vault.reload();
    // Hidden notes (".obsidian/…") aren't part of the vault, so they aren't found here.
    const notePath = vault.allNotes.find((candidate) => candidate.toLowerCase() === wanted);
    if (!notePath) return fail();
    this.showMainWindow();
    vault.open(notePath);
    this.editor.focus();
  }

  // MARK: Jump list

  private get jumpListEnabled() {
    // Only the installed app, with its real profile: the jump list belongs to
    // the app id, so a dev or test run would overwrite the installed app's.
    return process.platform === "win32" && app.isPackaged && !testProfile;
  }

  /** The open vault's recent notes for the jump list, most recent first. */
  jumpListNotes(): JumpListNote[] {
    const vault = this.vault;
    if (!vault) return [];
    return vault.recentNotes.slice(0, MAX_JUMP_LIST_NOTES * 2).map((notePath) => ({ title: stem(notePath), file: vault.abs(notePath), vaultPath: notePath }));
  }

  /** What the jump list would be set to now (also for the smoke test). */
  jumpListCategories() {
    return buildJumpList(process.execPath, this.jumpListNotes());
  }

  /** Updates the jump list a moment after recent notes (or the vault) change. */
  scheduleJumpList() {
    if (!this.jumpListEnabled) return;
    const notes = this.jumpListNotes();
    const key = JSON.stringify(notes.slice(0, MAX_JUMP_LIST_NOTES).map((note) => note.file));
    if (key === this.jumpListKey) return;
    if (this.jumpListTimer) clearTimeout(this.jumpListTimer);
    this.jumpListTimer = setTimeout(() => {
      this.jumpListTimer = null;
      const current = this.jumpListNotes();
      this.jumpListKey = JSON.stringify(current.slice(0, MAX_JUMP_LIST_NOTES).map((note) => note.file));
      applyJumpList(app, process.execPath, current);
    }, 1500);
  }

  // MARK: Window

  createWindow() {
    const colors = windowChrome(this.settings, nativeTheme.shouldUseDarkColors);
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      title: "Holocron",
      show: false,
      backgroundColor: colors.backgroundColor,
      titleBarStyle: "hidden",
      titleBarOverlay: colors.titleBarOverlay,
      icon: appIcon(),
      webPreferences: {
        preload: path.join(import.meta.dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        // Chromium's built-in PDF viewer, for ![[paper.pdf]] embeds. (The only
        // plugin left in Electron; PDFs come from the vault-confined asset scheme.)
        plugins: true,
      },
    });
    this.window = window;

    window.once("ready-to-show", () => {
      if (!this.startHidden) window.show();
    });
    window.on("blur", () => this.saveAll());
    // In the background (the default) closing hides the window to the tray,
    // after saving everything; only Exit/Quit (or Windows shutting down) quits.
    window.on("close", (event) => {
      if (this.quitting || !this.settings.runInBackground || !this.tray.exists) return;
      event.preventDefault();
      this.saveAll();
      this.store.flush();
      window.hide();
      this.showBackgroundNotice();
    });
    window.on("query-session-end", () => {
      this.prepareToQuit();
      this.saveAll();
      this.store.flush();
    });
    window.on("closed", () => {
      this.window = null;
      // The hidden capture window would otherwise keep Holocron running.
      app.quit();
    });

    // The window only ever shows Holocron's own page (REQUIREMENTS ARC-06).
    const contents = window.webContents;
    contents.on("will-navigate", (event, url) => {
      if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "\0")) return;
      event.preventDefault();
      openExternalSafely(url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url);
      return { action: "deny" };
    });
    // The page itself reloading, not a frame inside it (a PDF embed is a frame).
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) this.editor.reset();
    });
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i" && isDev))) {
        contents.toggleDevTools();
        event.preventDefault();
      }
    });
    contents.session.setSpellCheckerLanguages(["en-US"]);
    // Right-click: the renderer draws the menu (spelling suggestions, Cut/Copy/Paste, link items).
    contents.on("context-menu", (_event, params) => {
      const request: UiRequest = {
        type: "contextMenu",
        x: params.x,
        y: params.y,
        misspelledWord: params.misspelledWord ?? "",
        suggestions: [...(params.dictionarySuggestions ?? [])],
        isEditable: params.isEditable,
        selectionText: params.selectionText ?? "",
        editFlags: {
          canCut: params.editFlags.canCut,
          canCopy: params.editFlags.canCopy,
          canPaste: params.editFlags.canPaste,
          canSelectAll: params.editFlags.canSelectAll,
          canUndo: params.editFlags.canUndo,
          canRedo: params.editFlags.canRedo,
        },
        linkURL: params.linkURL ?? "",
        mediaType: params.mediaType ?? "none",
      };
      contents.send(Channels.ui, request);
    });

    const onThemeChange = () => {
      if (window.isDestroyed()) return;
      const colors = windowChrome(this.settings, nativeTheme.shouldUseDarkColors);
      window.setTitleBarOverlay(colors.titleBarOverlay);
      window.setBackgroundColor(colors.backgroundColor);
      this.pushState();
    };
    nativeTheme.on("updated", onThemeChange);
    window.on("closed", () => nativeTheme.off("updated", onThemeChange));

    if (devRendererUrl) void window.loadURL(devRendererUrl);
    else void window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }

  /**
   * Serves vault images, audio, video and PDFs to the editor:
   * holocron-asset://<kind>/<target>?from=<note path> (REQUIREMENTS ARC-07).
   * Range requests are answered so media can seek.
   */
  registerAssetProtocol() {
    const appOrigins = new Set(["file://"]);
    if (isDev && process.env.ELECTRON_RENDERER_URL) appOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin);
    protocol.handle(ASSET_SCHEME, async (request) => {
      const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      let response: Response;
      try {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
        const url = new URL(request.url);
        const kind = url.hostname;
        const target = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        const from = url.searchParams.get("from") ?? "";
        const file = this.vault?.resolveAsset(kind, target, from);
        response = file ? await assetResponse(file, request) : notFound();
      } catch {
        response = notFound();
      }
      // Only Holocron's own page may read responses with fetch().
      const origin = request.headers.get("origin");
      if (origin && appOrigins.has(origin)) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
        response.headers.append("Vary", "Origin");
      }
      return response;
    });
  }
}

/** The main window's background and title-bar overlay for the colour theme in use (§16.10). */
function windowChrome(settings: Settings, dark: boolean) {
  const colors = windowColors(resolveTheme(dark, settings));
  return { backgroundColor: colors.background, titleBarOverlay: { ...colors.titleBarOverlay, height: 40 } };
}

function folderExists(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string, b: string) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function describeVault(root: string): RecentVault {
  const home = app.getPath("home");
  const displayPath = root.toLowerCase().startsWith(home.toLowerCase()) ? "~" + root.slice(home.length) : root;
  return { path: root, name: path.basename(root), displayPath };
}

/**
 * Copies the Start Here guide into `folder`, never overwriting existing
 * notes; `{{date}}` becomes today's ISO date.
 */
function installStarterGuide(folder: string) {
  const source = path.join(app.getAppPath(), "resources", "guide");
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  for (const name of ["Start Here.md", "Linked Note.md"]) {
    const target = path.join(folder, name);
    if (fs.existsSync(target)) continue;
    const text = fs.readFileSync(path.join(source, name), "utf8").replaceAll("{{date}}", date);
    writeAtomic(target, text, { withoutOverwriting: true });
  }
}

// MARK: - Startup

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("app.holocron.notes");
  let holocron: HolocronApp | null = null;

  // A second launch (jump list item, taskbar, Start menu, a double-clicked
  // note, the sign-in item) hands its arguments to this instance.
  app.on("second-instance", (_event, argv) => {
    if (!holocron) return;
    void holocron.handleLaunchArgs(parseLaunchArgs(Array.isArray(argv) ? argv : []), false);
  });

  void app.whenReady().then(async () => {
    holocron = new HolocronApp();
    if (testProfile) (globalThis as { holocron?: HolocronApp }).holocron = holocron; // for the smoke scripts
    const commands = createCommands(holocron);
    ipcMain.handle(Channels.command, async (event, name: string, ...args: unknown[]) => {
      // The capture window only gets the few commands it needs.
      if (holocron?.capture.owns(event.sender) && !CAPTURE_COMMANDS.has(name)) throw new Error(`Not available here: ${name}`);
      const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
      if (!command) throw new Error(`Unknown command: ${name}`);
      return command(...args);
    });
    ipcMain.on(Channels.editorMessage, (event, message: EditorMessage) => {
      if (holocron?.capture.owns(event.sender)) return;
      if (message && typeof message === "object") holocron?.editor.handle(message);
    });
    // electron-updater's quitAndInstall announces itself here before quitting.
    nativeAutoUpdater.on("before-quit-for-update", () => holocron?.prepareToQuit());

    const launch = parseLaunchArgs(process.argv);
    // Signed in to Windows (--hidden), or started just to capture: stay in the
    // tray — but only when there is a tray to come back from.
    const captureOnly = launch.capture && !launch.open && !launch.newNote && !launch.today;
    holocron.startHidden = holocron.settings.runInBackground && (launch.hidden || captureOnly);

    holocron.registerAssetProtocol();
    holocron.updateTray();
    holocron.createWindow();
    holocron.registerCaptureShortcut();
    holocron.updater.start();

    // Launch (REQUIREMENTS TAB-10). A note to open picks its own vault.
    const last = holocron.recentVaults[0];
    const noteVault = launch.open ? holocron.vaultContaining(launch.open) : null;
    if (launchVault) {
      await holocron.openVault(launchVault);
    } else if (noteVault) {
      await holocron.openVault(noteVault);
    } else if (holocron.settings.reopenLastVault && last) {
      await holocron.openVault(last);
      if (holocron.settings.openDailyNoteOnLaunch && !hasActions(launch)) holocron.vault?.openDailyNote();
    }
    await holocron.handleLaunchArgs(launch, true);
    holocron.scheduleJumpList();
  });

  app.on("before-quit", () => {
    holocron?.prepareToQuit();
    holocron?.saveAll();
    holocron?.store.flush();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    holocron?.tray.destroy();
  });

  app.on("window-all-closed", () => {
    holocron?.vault?.close();
    holocron?.store.flush();
    app.quit();
  });
}
