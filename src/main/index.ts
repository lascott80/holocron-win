// Holocron's main process: the window, the vault, settings and the bridge to
// the renderer. (Plays the part of HolocronApp.swift + AppModel.swift.)

import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, nativeTheme, protocol, shell, ipcMain } from "electron";
import { assetResponse } from "./assets";
import { Channels, type AppState, type EditorMessage, type RecentVault, type UiRequest } from "@shared/ipc";
import { sanitizeSettings, type Settings } from "@shared/settings";
import { FileStore } from "./store";
import { createTrash, writeAtomic } from "./fsx";
import { Vault } from "./vault";
import { VaultWatcher } from "./watcher";
import { EditorBridge, openExternalSafely } from "./editorBridge";
import { SearchService } from "./searchService";
import { createCommands } from "./commands";
import { Updater } from "./updater";

const ASSET_SCHEME = "holocron-asset";
protocol.registerSchemesAsPrivileged([
  // corsEnabled: the editor checks whether a PDF exists with fetch() (a frame can't tell it).
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const MAX_RECENT_VAULTS = 8;
const isDev = !app.isPackaged;

// Test and debug hooks: an isolated profile, and a vault to open at launch.
if (process.env.HOLOCRON_USER_DATA) app.setPath("userData", process.env.HOLOCRON_USER_DATA);
const launchVault = process.env.HOLOCRON_OPEN_VAULT;

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
  private watcher: VaultWatcher | null = null;
  private stateQueued = false;

  constructor() {
    this.applyThemeSource();
  }

  // MARK: State

  /** Pushes a state snapshot to the renderer (coalesced). */
  pushState() {
    if (this.stateQueued) return;
    this.stateQueued = true;
    setImmediate(() => {
      this.stateQueued = false;
      this.window?.webContents.send(Channels.state, this.state());
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
    this.pushState();
  }

  private applyThemeSource() {
    nativeTheme.themeSource = this.settings.appearance;
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

  // MARK: Window

  createWindow() {
    const dark = nativeTheme.shouldUseDarkColors;
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      title: "Holocron",
      show: false,
      backgroundColor: dark ? "#15181E" : "#F4F5F7",
      titleBarStyle: "hidden",
      titleBarOverlay: titleBarOverlay(dark),
      icon: path.join(app.getAppPath(), "resources", "icon.png"),
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

    window.once("ready-to-show", () => window.show());
    window.on("blur", () => this.saveAll());
    window.on("closed", () => {
      this.window = null;
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

    nativeTheme.on("updated", () => {
      window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
      window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#15181E" : "#F4F5F7");
      this.pushState();
    });

    if (isDev && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
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

function titleBarOverlay(dark: boolean) {
  return { color: dark ? "#15181E" : "#F4F5F7", symbolColor: dark ? "#C9CDD4" : "#3A3F47", height: 40 };
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

  app.on("second-instance", () => {
    const window = holocron?.window;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(async () => {
    holocron = new HolocronApp();
    const commands = createCommands(holocron);
    ipcMain.handle(Channels.command, async (_event, name: string, ...args: unknown[]) => {
      const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
      if (!command) throw new Error(`Unknown command: ${name}`);
      return command(...args);
    });
    ipcMain.on(Channels.editorMessage, (_event, message: EditorMessage) => {
      if (message && typeof message === "object") holocron?.editor.handle(message);
    });
    holocron.registerAssetProtocol();
    holocron.createWindow();
    holocron.updater.start();

    // Launch (REQUIREMENTS TAB-10).
    const last = holocron.recentVaults[0];
    if (launchVault) {
      await holocron.openVault(launchVault);
    } else if (holocron.settings.reopenLastVault && last) {
      await holocron.openVault(last);
      if (holocron.settings.openDailyNoteOnLaunch) holocron.vault?.openDailyNote();
    }
  });

  app.on("before-quit", () => {
    holocron?.saveAll();
    holocron?.store.flush();
  });

  app.on("window-all-closed", () => {
    holocron?.vault?.close();
    holocron?.store.flush();
    app.quit();
  });
}
