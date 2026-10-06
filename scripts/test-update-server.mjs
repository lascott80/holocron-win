// A tiny local update server for testing auto-update without GitHub: serves
// a folder holding latest.yml, Holocron-Setup-<version>.exe and its
// .blockmap (what `npm run dist` writes to dist/). Supports Range requests.
//
//   node scripts/test-update-server.mjs <folder> [--port 8765] [--throttle <MB/s>]
//
// Then run a packaged build with HOLOCRON_UPDATE_URL=http://127.0.0.1:8765/
// (see scripts/smoke-update.mjs). Also importable: startUpdateServer(folder, port).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = { ".yml": "text/yaml", ".yaml": "text/yaml", ".exe": "application/octet-stream", ".blockmap": "application/octet-stream" };

/**
 * Starts the server; resolves to { server, url, requests }. `throttle` (bytes
 * per second) slows file downloads so progress can be watched.
 */
export function startUpdateServer(folder, port = 0, { throttle = 0 } = {}) {
  const stream = (file, range) => {
    const source = fs.createReadStream(file, { ...range, highWaterMark: 256 * 1024 });
    if (!throttle) return source;
    const delay = Math.round((256 * 1024 * 1000) / throttle);
    return source.compose(async function* (chunks) {
      for await (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        yield chunk;
      }
    });
  };
  const root = path.resolve(folder);
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, name);
    requests.push(`${request.method} ${url.pathname}${request.headers.range ? ` (${request.headers.range})` : ""}`);
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "Method not allowed");
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(response, 404, "Not found");
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const ranges = parseRanges(request.headers.range, size);
    if (ranges === "invalid") {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      return response.end();
    }
    if (!ranges) {
      response.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
      if (request.method === "HEAD") return response.end();
      return stream(file).pipe(response);
    }
    if (ranges.length === 1) {
      const [start, end] = ranges[0];
      response.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
      if (request.method === "HEAD") return response.end();
      return stream(file, { start, end }).pipe(response);
    }
    // Several ranges: multipart/byteranges (electron-updater's differential download asks for these).
    const boundary = "holocron" + Date.now().toString(16);
    const fd = fs.openSync(file, "r");
    const parts = [];
    for (const [start, end] of ranges) {
      parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${type}\r\nContent-Range: bytes ${start}-${end}/${size}\r\n\r\n`));
      const chunk = Buffer.alloc(end - start + 1);
      fs.readSync(fd, chunk, 0, chunk.length, start);
      parts.push(chunk);
    }
    fs.closeSync(fd);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    response.writeHead(206, { "Content-Type": `multipart/byteranges; boundary=${boundary}`, "Content-Length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address();
      resolve({ server, url: `http://127.0.0.1:${actual}/`, requests });
    });
  });
}

function send(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain" });
  response.end(text);
}

/** "bytes=0-99,200-" → [[0, 99], [200, size-1]]; null = no Range header. */
function parseRanges(header, size) {
  if (!header) return null;
  const match = /^bytes=(.+)$/.exec(header.trim());
  if (!match) return "invalid";
  const ranges = [];
  for (const part of match[1].split(",")) {
    const [a, b] = part.trim().split("-");
    let start;
    let end;
    if (a === "") {
      start = Math.max(0, size - Number(b));
      end = size - 1;
    } else {
      start = Number(a);
      end = b === "" || b === undefined ? size - 1 : Math.min(Number(b), size - 1);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return "invalid";
    ranges.push([start, end]);
  }
  return ranges;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? Number(args.splice(portIndex, 2)[1]) : 8765;
  const throttleIndex = args.indexOf("--throttle");
  const throttle = throttleIndex >= 0 ? Number(args.splice(throttleIndex, 2)[1]) * 1024 * 1024 : 0;
  const folder = args[0];
  if (!folder) {
    console.error("Usage: node scripts/test-update-server.mjs <folder> [--port 8765]");
    process.exit(1);
  }
  const { url, requests } = await startUpdateServer(folder, port, { throttle });
  console.log(`Serving ${path.resolve(folder)} at ${url}`);
  setInterval(() => {
    while (requests.length) console.log(requests.shift());
  }, 250);
}
