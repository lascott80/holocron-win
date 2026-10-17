// Talks to the search worker: forwards note text updates and runs searches.
// If the worker dies (out of memory, a bug in a search), it's started again
// and refilled from the index, so search keeps working.

import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SearchNote, SearchOutcome } from "@core/vaultSearch";
import type { WorkerRequest } from "./indexWorker";
import { log } from "./log";

const EMPTY: SearchOutcome = { hits: [], totalMatches: 0, truncated: false };

export class SearchService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (outcome: SearchOutcome) => void>();
  private disposed = false;
  private restarts = 0;

  /**
   * `refill` returns every note the worker should hold, for when it has to
   * be started again after a crash.
   */
  constructor(private readonly refill: () => SearchNote[] = () => []) {
    this.start();
  }

  private start() {
    const worker = new Worker(path.join(import.meta.dirname, "indexWorker.js"));
    worker.on("message", ({ id, outcome }: { id: number; outcome: SearchOutcome }) => {
      this.pending.get(id)?.(outcome);
      this.pending.delete(id);
    });
    worker.on("error", (error) => log.error(`Search worker failed: ${error.stack ?? error.message}`));
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      // Searches in flight will never be answered; settle them empty.
      for (const resolve of this.pending.values()) resolve({ ...EMPTY, error: "Search stopped unexpectedly. Try again." });
      this.pending.clear();
      if (this.disposed || code === 0) return;
      log.warn(`Search worker exited with code ${code}; restarting`);
      if (++this.restarts > 5) {
        log.error("Search worker keeps failing; giving up until the next launch");
        return;
      }
      this.start();
      this.post({ type: "update", notes: this.refill() });
    });
    worker.unref();
    this.worker = worker;
  }

  private post(request: WorkerRequest) {
    this.worker?.postMessage(request);
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
    if (!this.worker) return Promise.resolve({ ...EMPTY, error: "Search isn’t available right now." });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: "search", id, query, matchCase, useRegex });
    });
  }

  dispose() {
    this.disposed = true;
    void this.worker?.terminate();
    this.worker = null;
  }
}
