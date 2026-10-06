// Non-note files in a vault (images, PDFs…): finding them for embeds and
// links, and naming new ones from paste or drag and drop. Scanning the
// disk happens in the main process; these functions work on path lists.

import { LinkResolver } from "./noteParser";
import { IMAGE_EXTENSIONS, NOTE_EXTENSIONS, basename, dirname, extname, isHidden, isImage, isNote } from "./paths";

export { IMAGE_EXTENSIONS as imageExtensions, isImage };

/**
 * Whether a link target names a file rather than a note: it has an
 * extension that isn't markdown ("photo.png", "report.pdf").
 */
export function isAttachmentTarget(target: string): boolean {
  const ext = extname(LinkResolver.linkPath(target)).toLowerCase();
  return ext !== "" && !NOTE_EXTENSIONS.has(ext) && /^[\p{L}\p{N}]+$/u.test(ext);
}

/**
 * The vault's attachments from a list of every file's vault path: the
 * non-note, non-hidden ones, sorted.
 */
export function attachmentPaths(files: Iterable<string>): string[] {
  return [...files].filter((path) => !isNote(path) && !isHidden(path)).sort();
}

/**
 * Finds an attachment for an embed or link target, Obsidian-style:
 * a path relative to the linking note, a vault path, or just a file
 * name anywhere in the vault (nearest the root wins).
 */
export function resolve(rawTarget: string, notePath: string, paths: readonly string[]): string | null {
  const target = LinkResolver.linkPath(rawTarget).replace(/\\/g, "/");
  if (target === "") return null;
  const lowered = new Map<string, string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (!lowered.has(key)) lowered.set(key, path);
  }

  if (target.startsWith("/")) {
    return lowered.get(normalize(target.slice(1)).toLowerCase()) ?? null;
  }
  const noteFolder = dirname(notePath);
  const relative = normalize(noteFolder === "" ? target : noteFolder + "/" + target);
  const match = lowered.get(relative.toLowerCase()) ?? lowered.get(normalize(target).toLowerCase());
  if (match !== undefined) return match;
  if (target.includes("/")) return null;
  const name = target.toLowerCase();
  let best: string | null = null;
  let bestDepth = Infinity;
  for (const path of paths) {
    if (basename(path).toLowerCase() !== name) continue;
    const depth = segments(path).length;
    if (depth < bestDepth) {
      best = path;
      bestDepth = depth;
    }
  }
  return best;
}

function segments(path: string): string[] {
  return path.split("/").filter((part) => part !== "");
}

/** Resolves "." and ".." segments; never climbs above the vault root. */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of segments(path)) {
    if (part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "application/pdf": "pdf",
};

/** The usual file extension for a MIME type ("image/jpeg" → "jpg"), falling back to "png". */
export function extensionForMimeType(mimeType: string): string {
  return mimeExtensions[mimeType.toLowerCase().split(";")[0].trim()] ?? "png";
}

/** The file name for a pasted image: "Pasted image 20261005143522.png" (local time). */
export function pastedImageName(mimeType: string, date: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stamp =
    pad(date.getFullYear(), 4) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds());
  return `Pasted image ${stamp}.${extensionForMimeType(mimeType)}`;
}

/**
 * The text to insert for an attachment: an embed for images, a link
 * otherwise; by name when the name is unique in the vault.
 */
export function linkText(path: string, paths: readonly string[]): string {
  const name = basename(path).toLowerCase();
  const unique = paths.filter((other) => basename(other).toLowerCase() === name).length <= 1;
  const target = unique ? basename(path) : path;
  return isImage(path) ? `![[${target}]]` : `[[${target}]]`;
}
