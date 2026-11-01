// What the index knows about a note (backlinks, mentions, headings…),
// re-fetched whenever the note or the index changes. Shared by the inspector
// and the backlinks panel under the note (UI-44).

import type { NoteDetails } from "@shared/ipc";
import { app } from "./app.svelte";
import { call } from "./host";

/**
 * Follows `path()` while `active()` is true. `current` is the details of
 * that path, or null until they arrive (a stale note's data never shows).
 * Call during component setup: it creates an effect.
 */
export function noteDetails(path: () => string | null, active: () => boolean = () => true): { readonly current: NoteDetails | null } {
  let details = $state<NoteDetails | null>(null);
  let detailsPath = $state<string | null>(null);
  let request = 0;

  $effect(() => {
    const current = path();
    void app.vault?.indexRevision;
    if (!current || !active()) {
      request++;
      details = null;
      detailsPath = null;
      return;
    }
    const id = ++request;
    call<NoteDetails | undefined>("details", current)
      .then((result) => {
        if (id !== request) return;
        details = result ?? null;
        detailsPath = current;
      })
      .catch((error: unknown) => console.error("[details]", error));
  });

  return {
    get current() {
      return details && detailsPath === path() ? details : null;
    },
  };
}
