// The auto-update state machine (pure: no Electron imports, so it's unit
// tested). src/main/updater.ts feeds it electron-updater's events and the
// user's choices; the result is the `update` part of AppState, including
// whether the update card is showing.

import type { UpdateView } from "@shared/ipc";

export interface UpdateModel {
  view: UpdateView;
  /** The current check or download was started by the user (errors are shown). */
  manual: boolean;
}

export type UpdateEvent =
  /** A check starts; `manual` = Help › Check for Updates… or the Settings button. */
  | { type: "checking"; manual: boolean }
  | { type: "available"; version: string; releaseNotes?: unknown; skippedVersion?: string | null; now: number }
  | { type: "not-available"; now: number }
  | { type: "download-started" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version?: string }
  | { type: "error"; error: unknown; now: number }
  /** A transient note in the card, e.g. "Updates are checked in the installed app." */
  | { type: "message"; message: string }
  /** Show the card again (a manual check while an update is downloading or ready). */
  | { type: "show" }
  /** Later / Esc: hide the card until the next check. */
  | { type: "dismiss" }
  /** Skip This Version (the caller remembers the version). */
  | { type: "skip" };

export function initialUpdateModel(currentVersion: string): UpdateModel {
  return { view: { status: "idle", currentVersion, showPrompt: false }, manual: false };
}

export function reduceUpdate(model: UpdateModel, event: UpdateEvent): UpdateModel {
  const view = model.view;
  switch (event.type) {
    case "checking":
      return {
        manual: event.manual,
        // A manual check shows the card at once ("Checking for updates…").
        view: { ...view, status: "checking", error: undefined, message: undefined, showPrompt: event.manual || view.showPrompt },
      };
    case "available": {
      const notes = releaseNotesText(event.releaseNotes);
      // A periodic check mustn't undo a download that's running or finished.
      if ((view.status === "downloading" || view.status === "downloaded") && view.version === event.version) {
        return { ...model, view: { ...view, releaseNotes: notes ?? view.releaseNotes } };
      }
      const skipped = !model.manual && event.skippedVersion != null && event.skippedVersion === event.version;
      return {
        ...model,
        view: {
          ...view,
          status: "available",
          version: event.version,
          releaseNotes: notes,
          percent: undefined,
          error: undefined,
          message: undefined,
          lastChecked: event.now,
          showPrompt: !skipped,
        },
      };
    }
    case "not-available":
      return {
        ...model,
        view: {
          ...view,
          status: "not-available",
          version: undefined,
          releaseNotes: undefined,
          percent: undefined,
          error: undefined,
          lastChecked: event.now,
          message: model.manual ? `You’re up to date — Holocron ${view.currentVersion} is the newest version.` : undefined,
          showPrompt: model.manual,
        },
      };
    case "download-started":
      return { manual: true, view: { ...view, status: "downloading", percent: 0, error: undefined, message: undefined, showPrompt: true } };
    case "progress":
      if (view.status !== "downloading") return model;
      return { ...model, view: { ...view, percent: clampPercent(event.percent) } };
    case "downloaded":
      return {
        ...model,
        view: { ...view, status: "downloaded", version: event.version ?? view.version, percent: 100, error: undefined, message: undefined, showPrompt: true },
      };
    case "error": {
      const downloading = view.status === "downloading";
      return {
        ...model,
        view: {
          ...view,
          status: "error",
          percent: undefined,
          error: friendlyUpdateError(event.error, downloading ? "download" : "check"),
          message: undefined,
          lastChecked: downloading ? view.lastChecked : event.now,
          // Automatic checks fail quietly (Settings shows the error).
          showPrompt: model.manual,
        },
      };
    }
    case "message":
      return { ...model, view: { ...view, message: event.message, showPrompt: true } };
    case "show":
      // A manual check joining an automatic one in progress: report its result too.
      return { manual: model.manual || view.status === "checking", view: { ...view, message: undefined, showPrompt: true } };
    case "dismiss":
    case "skip":
      return { ...model, view: { ...view, message: undefined, showPrompt: false } };
  }
}

/**
 * What a check request should do: start a network check, just show the card
 * (an update is already downloading or downloaded), or nothing.
 */
export function checkAction(view: UpdateView, manual: boolean, autoCheckEnabled: boolean): "check" | "show" | "skip" {
  if (view.status === "downloading" || view.status === "downloaded") return manual ? "show" : "skip";
  if (view.status === "checking") return manual ? "show" : "skip";
  if (!manual && !autoCheckEnabled) return "skip";
  return "check";
}

const NETWORK_ERROR =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|NETWORK_ACCESS_DENIED|CONNECTION_\w+|ADDRESS_UNREACHABLE|TIMED_OUT|PROXY_\w+|TUNNEL_CONNECTION_FAILED|SSL_\w+|CERT_\w+)|\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b|socket hang up/i;

const NOT_PUBLISHED_CODES = new Set([
  "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_RELEASE_NOT_FOUND",
  "ERR_UPDATER_ASSET_NOT_FOUND",
]);

/** A sentence for the user in place of electron-updater's stack traces. */
export function friendlyUpdateError(error: unknown, phase: "check" | "download" = "check"): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String((error as { message?: unknown })?.message ?? error);
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  if (NETWORK_ERROR.test(message) || NETWORK_ERROR.test(code)) {
    return phase === "download"
      ? "Couldn’t download the update. Check your internet connection."
      : "Couldn’t check for updates. Check your internet connection.";
  }
  if (/sha512 checksum mismatch|checksum mismatch/i.test(message)) return "The downloaded update was damaged. Please try again.";
  if (NOT_PUBLISHED_CODES.has(code) || /Cannot find (latest|channel)[^ ]*\.yml/i.test(message)) return "No update information is published yet.";
  if (/\b(403|429)\b/.test(message) && /rate limit|github/i.test(message)) return "GitHub is busy right now. Try again later.";
  const firstLine = message.split("\n")[0].trim();
  const detail = firstLine.length > 160 ? firstLine.slice(0, 157) + "…" : firstLine;
  const base = phase === "download" ? "Couldn’t download the update." : "Couldn’t check for updates.";
  return detail ? `${base} (${detail})` : base;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Release notes (GitHub gives HTML; latest.yml may give text or a list) as plain text. */
export function releaseNotesText(notes: unknown): string | undefined {
  let text: string;
  if (typeof notes === "string") text = notes;
  else if (Array.isArray(notes)) {
    text = notes
      .map((entry) => (entry && typeof entry === "object" && typeof (entry as { note?: unknown }).note === "string" ? (entry as { note: string }).note : ""))
      .filter(Boolean)
      .join("\n");
  } else return undefined;
  text = text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|pre|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) return safeChar(parseInt(lower.slice(2), 16)) ?? whole;
      if (lower.startsWith("#") && lower !== "#39") return safeChar(parseInt(lower.slice(1), 10)) ?? whole;
      return ENTITIES[lower] ?? whole;
    })
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return undefined;
  return text.length > 4000 ? text.slice(0, 3999) + "…" : text;
}

function safeChar(code: number): string | undefined {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** Only plain versions make it into the release URL. */
export function isPlainVersion(version: unknown): version is string {
  return typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.]{1,32})?$/.test(version);
}

export const RELEASES_URL = "https://github.com/lascott80/holocron-win/releases";

export function releasePageUrl(version: unknown): string {
  return isPlainVersion(version) ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}
