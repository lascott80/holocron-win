// File › Export as PDF / Export as HTML / Print (REQUIREMENTS FOP-12). The
// editor builds the page (src/editor/exporter.js); this saves it, or loads it
// into a hidden window with scripts off to print it to PDF or to a printer.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, shell } from "electron";

export type ExportFormat = "pdf" | "html" | "print";

export interface ExportResult {
  /** Where the file was saved; null when cancelled or printed. */
  file: string | null;
  printed?: boolean;
}

/** A file name from a note title: no characters Windows forbids, never empty. */
export function exportFileName(title: string, extension: string): string {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/[. ]+$/, "").trim() || "Note";
  return `${base}.${extension}`;
}

/** US and Canada print on Letter; everywhere else on A4. */
function pageSize(): "Letter" | "A4" {
  return ["US", "CA", "MX", "PH"].includes(app.getLocaleCountryCode()) ? "Letter" : "A4";
}

/** Loads `html` into a hidden, script-free window (from a temp file, so big data URIs are fine). */
async function hiddenPage(html: string, title: string): Promise<{ window: BrowserWindow; dispose: () => void }> {
  const file = path.join(os.tmpdir(), `holocron-export-${randomUUID()}.html`);
  fs.writeFileSync(file, html, "utf8");
  const window = new BrowserWindow({
    show: false,
    title,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  // Nothing in the page may navigate or open anything.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const dispose = () => {
    if (!window.isDestroyed()) window.destroy();
    fs.rm(file, { force: true }, () => {});
  };
  try {
    await window.loadFile(file);
  } catch (error) {
    dispose();
    throw error;
  }
  return { window, dispose };
}

/**
 * Exports `html` (a whole page) for the note `title`. Asks where to save
 * (starting in Documents) unless printing. Throws with a message on failure.
 */
export async function exportNote(parent: BrowserWindow | null, format: ExportFormat, html: string, title: string): Promise<ExportResult> {
  if (format === "print") {
    const { window, dispose } = await hiddenPage(html, title);
    return new Promise((resolve, reject) => {
      window.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        dispose();
        if (success || reason === "cancelled") resolve({ file: null, printed: success });
        else reject(new Error(reason || "printing failed"));
      });
    });
  }

  const extension = format === "pdf" ? "pdf" : "html";
  const options = {
    title: format === "pdf" ? "Export as PDF" : "Export as HTML",
    buttonLabel: "Export",
    defaultPath: path.join(app.getPath("documents"), exportFileName(title, extension)),
    filters: [format === "pdf" ? { name: "PDF document", extensions: ["pdf"] } : { name: "Web page", extensions: ["html", "htm"] }],
  };
  const choice = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return { file: null };

  if (format === "html") {
    fs.writeFileSync(choice.filePath, html, "utf8");
    return { file: choice.filePath };
  }
  const { window, dispose } = await hiddenPage(html, title);
  try {
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: pageSize(), generateDocumentOutline: true });
    fs.writeFileSync(choice.filePath, pdf);
  } finally {
    dispose();
  }
  return { file: choice.filePath };
}

export function showExported(file: string) {
  shell.showItemInFolder(file);
}
