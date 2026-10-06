// What the editor's holocron-asset:// scheme may serve and how: the file
// types (images, audio, video, PDF), their MIME types, and HTTP Range
// requests so audio and video can seek (REQUIREMENTS ARC-07).

import fs from "node:fs";
import { Readable } from "node:stream";
import { IMAGE_EXTENSIONS, extname } from "@core/paths";

export const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
export const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus"]);
export const PDF_EXTENSIONS = new Set(["pdf"]);

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/ogg",
  pdf: "application/pdf",
};

/** Whether the asset scheme may serve this vault path: images, audio, video and PDF only. */
export function isServableAsset(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext);
}

/** The Content-Type for a servable asset. */
export function assetMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Parses a Range header against a file of `size` bytes:
 * - null: no usable range (absent, another unit, or several ranges) → send the whole file;
 * - "unsatisfiable": a bytes range that can't be served → 416;
 * - { start, end }: inclusive byte offsets → 206.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) return null;
  const spec = match[1].trim();
  if (spec.includes(",")) return null; // multipart ranges: the whole file is a valid answer
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!parts || (parts[1] === "" && parts[2] === "")) return "unsatisfiable";
  if (parts[1] === "") {
    // Suffix: the last N bytes.
    const length = Number(parts[2]);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(parts[1]);
  let end = parts[2] === "" ? size - 1 : Number(parts[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return "unsatisfiable";
  end = Math.min(end, size - 1);
  return { start, end };
}

/**
 * Hardening for everything the scheme serves: no sniffing, and documents
 * (an SVG opened as a page, say) can't run scripts. PDFs skip the sandbox,
 * which would stop Chromium's viewer from showing them.
 */
function securityHeaders(file: string): Record<string, string> {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" };
  if (!PDF_EXTENSIONS.has(extname(file.replaceAll("\\", "/")).toLowerCase())) {
    headers["Content-Security-Policy"] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
  }
  return headers;
}

/** Answers a request for `file` (already resolved and confined to the vault), honouring Range. */
export async function assetResponse(file: string, request: { method: string; headers: Headers }): Promise<Response> {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const size = stat.size;
  const headers: Record<string, string> = {
    ...securityHeaders(file),
    "Content-Type": assetMimeType(file.replaceAll("\\", "/")),
    "Accept-Ranges": "bytes",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const head = request.method === "HEAD";
  if (range === null) {
    headers["Content-Length"] = String(size);
    return new Response(head || size === 0 ? null : stream(file, 0, size - 1), { status: 200, headers });
  }
  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(head ? null : stream(file, range.start, range.end), { status: 206, headers });
}

function stream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
}
