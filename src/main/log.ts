// Append-only log files in the app's data folder (userData/logs/<name>.log),
// each kept under ~0.5 MB by rotating to <name>.log.old. Logging must never
// throw: a log that can't be written is simply dropped.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const LOG_LIMIT = 512 * 1024;

export type LogLevel = "info" | "warn" | "error";

/** Where the log files live. */
export function logsFolder(): string {
  return path.join(app.getPath("userData"), "logs");
}

/** An error's stack (or message), or any other value as text. */
export function errorText(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Appends one line to `<name>.log`; errors also go to the console. */
export function appendLog(name: string, level: LogLevel, message: unknown): void {
  const text = errorText(message);
  const line = `${new Date().toISOString()} [${level}] ${text}\n`;
  if (level === "error") console.error(`[${name}]`, text);
  try {
    const dir = logsFolder();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.log`);
    try {
      if (fs.statSync(file).size > LOG_LIMIT) fs.renameSync(file, file + ".old");
    } catch {
      // No log yet.
    }
    fs.appendFileSync(file, line);
  } catch {
    // Logging must never break the app.
  }
}

/** The app's own log (crashes, renderer errors, recovered failures). */
export const log = {
  info: (message: unknown) => appendLog("holocron", "info", message),
  warn: (message: unknown) => appendLog("holocron", "warn", message),
  error: (message: unknown) => appendLog("holocron", "error", message),
};
