// Full-text search runs here, off the main process's event loop, so a big
// vault search never delays saving or the editor bridge. The main process
// keeps this worker's copy of note texts in step with the index.

import { parentPort } from "node:worker_threads";
import { search, type SearchNote } from "@core/vaultSearch";

export type WorkerRequest =
  | { type: "update"; notes: SearchNote[] }
  | { type: "remove"; paths: string[] }
  | { type: "clear" }
  | { type: "search"; id: number; query: string; matchCase: boolean; useRegex: boolean };

const notes = new Map<string, SearchNote>();

parentPort?.on("message", (request: WorkerRequest) => {
  switch (request.type) {
    case "update":
      for (const note of request.notes) notes.set(note.path, note);
      break;
    case "remove":
      for (const path of request.paths) notes.delete(path);
      break;
    case "clear":
      notes.clear();
      break;
    case "search": {
      const outcome = search(request.query, [...notes.values()], { matchCase: request.matchCase, useRegex: request.useRegex });
      parentPort?.postMessage({ id: request.id, outcome });
      break;
    }
  }
});
