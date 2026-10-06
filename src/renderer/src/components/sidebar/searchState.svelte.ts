// Search panel state that outlives the panel, so switching to Files and back
// keeps the toggles, results and collapsed notes.

import { SvelteSet } from "svelte/reactivity";
import type { SearchOutcome } from "@core/vaultSearch";

class SearchState {
  matchCase = $state(false);
  useRegex = $state(false);
  outcome = $state<SearchOutcome>({ hits: [], totalMatches: 0, truncated: false });
  isSearching = $state(false);
  /** Paths of notes whose matching lines are hidden. */
  collapsed = new SvelteSet<string>();
}

export const searchState = new SearchState();
