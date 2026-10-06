// Talks to the search worker: forwards note text updates and runs searches.

import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SearchNote, SearchOutcome } from "@core/vaultSearch";
import type { WorkerRequest } from "./indexWorker";

export class SearchService {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (outcome: SearchOutcome) => void>();

  constructor() {
    this.worker = new Worker(path.join(import.meta.dirname, "indexWorker.js"));
    this.worker.on("message", ({ id, outcome }: { id: number; outcome: SearchOutcome }) => {
      this.pending.get(id)?.(outcome);
      this.pending.delete(id);
    });
    this.worker.unref();
  }

  private post(request: WorkerRequest) {
    this.worker.postMessage(request);
  }

  update(notes: SearchNote[]) {
    if (notes.length) this.post({ type: "update", notes });
  }

  remove(paths: string[]) {
    if (paths.length) this.post({ type: "remove", paths });
  }

  clear() {
    this.post({ type: "clear" });
  }

  search(query: string, matchCase: boolean, useRegex: boolean): Promise<SearchOutcome> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: "search", id, query, matchCase, useRegex });
    });
  }

  dispose() {
    void this.worker.terminate();
  }
}
