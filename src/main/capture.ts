// The quick capture window: a small frameless box that a system-wide
// shortcut (or the tray, jump list or File menu) brings up over whatever the
// user is doing. Its page is the renderer's second entry, capture.html
// (src/renderer/src/capture). Saving appends to today's note or the inbox
// (Vault.appendCapture). Clicking elsewhere hides it and keeps the draft;
// Esc discards the draft. The window is created on first use and then
// hidden, never closed, until Holocron quits.

import { BrowserWindow, Menu, screen, type ContextMenuParams, type WebContents } from "electron";
import { Channels, type CaptureInfo, type UiRequest } from "@shared/ipc";
import { resolveTheme } from "@shared/themes";

/** The capture window's background: the active theme's overlay colour (avoids a flash before the page paints). */
function captureBackground(info: CaptureInfo): string {
  return resolveTheme(info.isDark, info.settings).palette.overlayBackground;
}

export const CAPTURE_WIDTH = 520;
export const CAPTURE_HEIGHT = 220;

/** The only commands the capture page may run (src/main/commands.ts). */
export const CAPTURE_COMMANDS: ReadonlySet<string> = new Set(["captureInfo", "captureSave", "captureHide", "showMainWindow"]);

export interface CaptureWindowOptions {
  /** What the page shows: vault, targets, theme. */
  info(): CaptureInfo;
  preload: string;
  icon: string;
  /** Loads the page: a dev-server URL or the built capture.html. */
  load(window: BrowserWindow): Promise<void>;
  /** Dev server origin allowed for reloads in development, if any. */
  devUrl: string | null;
}

export class CaptureWindow {
  window: BrowserWindow | null = null;
  /** Set when Holocron is quitting, so closing is allowed. */
  quitting = false;
  private loading: Promise<void> | null = null;
  private shownAt = 0;

  constructor(private readonly options: CaptureWindowOptions) {}

  /** Whether `contents` is the capture page (it only gets CAPTURE_COMMANDS). */
  owns(contents: WebContents): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.webContents === contents;
  }

  get isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /** Shows the window centred on the monitor with the mouse pointer, focused, draft kept. */
  async show() {
    const window = this.create();
    await this.loading;
    if (window.isDestroyed()) return;
    const info = this.options.info();
    window.setBackgroundColor(captureBackground(info));
    this.send({ type: "capture", info });
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window.setBounds({
      x: Math.round(workArea.x + (workArea.width - CAPTURE_WIDTH) / 2),
      y: Math.round(workArea.y + (workArea.height - CAPTURE_HEIGHT) / 2),
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
    });
    this.shownAt = Date.now();
    window.show();
    window.focus();
    window.webContents.focus();
  }

  /** Hides the window; `discard` also clears the draft (Esc, or after saving). */
  hide(discard = false) {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (discard) this.send({ type: "capture", info: this.options.info(), reset: true });
    window.hide();
  }

  /** Re-sends the info (theme or vault changed) if the page is loaded. */
  refresh() {
    if (!this.window || this.window.isDestroyed() || !this.loading) return;
    this.window.setBackgroundColor(captureBackground(this.options.info()));
    this.send({ type: "capture", info: this.options.info() });
  }

  destroy() {
    this.quitting = true;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.loading = null;
  }

  private send(request: UiRequest) {
    this.window?.webContents.send(Channels.ui, request);
  }

  private create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const info = this.options.info();
    const window = new BrowserWindow({
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "Quick Capture — Holocron",
      icon: this.options.icon,
      backgroundColor: captureBackground(info),
      // Windows 11 rounds frameless windows' corners (roundedCorners defaults to true).
      // The same isolation as the main window (minus the PDF plugin it doesn't need).
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    this.window = window;
    const contents = window.webContents;

    // Only ever Holocron's capture page: no navigation, no new windows, no webviews.
    contents.on("will-navigate", (event, url) => {
      if (this.options.devUrl && url.startsWith(this.options.devUrl)) return;
      event.preventDefault();
    });
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("context-menu", (_event, params) => this.showContextMenu(params));

    // Clicking elsewhere hides it; the draft stays for next time. (Ignore a
    // blur in the moment after showing: Windows can bounce focus once.)
    window.on("blur", () => {
      if (Date.now() - this.shownAt < 150 || contents.isDevToolsOpened()) return;
      window.hide();
    });
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
    });
    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.loading = null;
      }
    });

    this.loading = this.options.load(window).catch((error) => console.error("Couldn’t load the capture window:", error));
    return window;
  }

  /** Spelling suggestions and the usual edit items for the text box. */
  private showContextMenu(params: ContextMenuParams) {
    const window = this.window;
    if (!window || !params.isEditable) return;
    const contents = window.webContents;
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (!params.dictionarySuggestions.length) template.push({ label: "No suggestions", enabled: false });
      template.push(
        { label: "Add to Dictionary", click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: "separator" },
      );
    }
    template.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll" },
    );
    Menu.buildFromTemplate(template).popup({ window });
  }
}
