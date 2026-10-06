// Holocron's icon in the notification area, while it runs in the background
// (setting `runInBackground`). Left-click shows the window; right-click
// offers quick capture, today's note, a new note, updates and Quit.

import path from "node:path";
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from "electron";

export interface TrayActions {
  show(): void;
  capture(): void;
  today(): void;
  newNote(): void;
  checkForUpdates(): void;
  quit(): void;
  /** The quick capture shortcut (an Electron accelerator) to show beside its item, or null when it's off. */
  captureShortcut(): string | null;
}

/** The tray menu (kept separate so tests and the smoke script can read it). */
export function trayMenuTemplate(actions: TrayActions): MenuItemConstructorOptions[] {
  const shortcut = actions.captureShortcut();
  return [
    // registerAccelerator: false — the shortcut is a global one; this only displays it.
    { id: "capture", label: "Quick Capture", accelerator: shortcut ?? undefined, registerAccelerator: false, click: () => actions.capture() },
    { id: "today", label: "Today’s Note", click: () => actions.today() },
    { id: "newNote", label: "New Note", click: () => actions.newNote() },
    { type: "separator" },
    { id: "open", label: "Open Holocron", click: () => actions.show() },
    { id: "checkForUpdates", label: "Check for Updates…", click: () => actions.checkForUpdates() },
    { type: "separator" },
    { id: "quit", label: "Quit Holocron", click: () => actions.quit() },
  ];
}

/**
 * The app icon at the sizes Windows uses for the tray (16 px at 100% scaling
 * up to 32 px at 200%). Uses the hand-tuned `icons/icon-N.png` beside
 * `iconFile` when present (heavier strokes stay crisp), else scales `iconFile`.
 */
export function trayImage(iconFile: string): NativeImage {
  const source = nativeImage.createFromPath(iconFile);
  const image = nativeImage.createEmpty();
  for (const [scaleFactor, size] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]] as const) {
    const tuned = nativeImage.createFromPath(path.join(path.dirname(iconFile), "icons", `icon-${size}.png`));
    const sized = tuned.isEmpty() ? (source.isEmpty() ? null : source.resize({ width: size, height: size, quality: "best" })) : tuned;
    if (sized) image.addRepresentation({ scaleFactor, buffer: sized.toPNG() });
  }
  return image;
}

export class TrayIcon {
  tray: Tray | null = null;
  menu: Menu | null = null;

  constructor(
    private readonly iconFile: string,
    private readonly actions: TrayActions,
  ) {}

  get exists(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  create() {
    if (this.exists) return;
    const tray = new Tray(trayImage(this.iconFile));
    tray.setToolTip("Holocron");
    tray.on("click", () => this.actions.show());
    this.tray = tray;
    this.updateMenu();
  }

  /** Rebuilds the menu (the capture shortcut changed). */
  updateMenu() {
    if (!this.tray || this.tray.isDestroyed()) return;
    this.menu = Menu.buildFromTemplate(trayMenuTemplate(this.actions));
    this.tray.setContextMenu(this.menu);
  }

  destroy() {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
    this.menu = null;
  }
}
