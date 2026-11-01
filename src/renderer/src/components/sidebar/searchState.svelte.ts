// Search panel state that outlives the panel, so switching to Files and back
// keeps the toggles, results and collapsed notes.

import { SvelteSet } from "svelte/reactivity";
import { naturalCompare } from "@core/paths";
import { resultsAsMarkdown, type SearchHit, type SearchOutcome } from "@core/vaultSearch";
import { call } from "../../lib/host";

/** Orders for the results list (SRCH-12). */
export type SearchSort = "relevance" | "name" | "modified" | "created";

export const SEARCH_SORTS: { value: SearchSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "name", label: "File Name (A to Z)" },
  { value: "modified", label: "Modified (Newest First)" },
  { value: "created", label: "Created (Newest First)" },
];

export interface NoteTimes {
  modified: number;
  created: number;
}

class SearchState {
  matchCase = $state(false);
  useRegex = $state(false);
  /** The Replace field is shown (SRCH-10). */
  replaceOpen = $state(false);
  replacement = $state("");
  outcome = $state<SearchOutcome>({ hits: [], totalMatches: 0, truncated: false });
  isSearching = $state(false);
  /** Paths of notes whose matching lines are hidden. */
  collapsed = new SvelteSet<string>();
  sort = $state<SearchSort>("relevance");
  /** File times of the listed notes, fetched from main for the time sorts. */
  times = $state<Record<string, NoteTimes>>({});
  /** The hits in the chosen order; relevance is the order the search returned. */
  sortedHits = $derived.by(() => sortHits(this.outcome.hits, this.sort, this.times));

  /** Puts the results on the clipboard as markdown and shows a toast (SRCH-13). */
  copyResults() {
    const hits = this.sortedHits;
    if (hits.length === 0) return;
    const message = `Copied ${hits.length === 1 ? "1 result" : `${hits.length.toLocaleString()} results`}`;
    call("copyToClipboard", resultsAsMarkdown(hits), message).catch((error: unknown) => console.error("[copyResults]", error));
  }
}

export function sortHits(hits: SearchHit[], sort: SearchSort, times: Record<string, NoteTimes>): SearchHit[] {
  if (sort === "relevance") return hits;
  const byName = (a: SearchHit, b: SearchHit) => naturalCompare(a.title, b.title) || naturalCompare(a.path, b.path);
  if (sort === "name") return [...hits].sort(byName);
  return [...hits].sort((a, b) => (times[b.path]?.[sort] ?? 0) - (times[a.path]?.[sort] ?? 0) || byName(a, b));
}

export const searchState = new SearchState();
