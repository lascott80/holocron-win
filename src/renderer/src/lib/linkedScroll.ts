// Linked panes (UI-47): two editors kept at the same proportional line.

import { proportionalLine } from "@core/layout";

/** The part of an editor's API linked scrolling needs (host.ts's EditorApi has it). */
export interface Scrollable {
  getScrollLine(): { line: number; lines: number };
  setScrollLine(line: number): void;
  onScroll(listener: () => void): () => void;
}

/** How close (in lines) two positions must be to count as the same; stops round-trip jitter. */
const EPSILON = 0.05;
/** How long a programmatic scroll may take to report itself before it's assumed not to have moved anything. */
const SETTLE_MS = 200;

/**
 * Scrolling either editor scrolls the other to the line at the same
 * proportion of the way through its note, both ways. A scroll this made is
 * recognised when it reports back (and once only), so it never echoes.
 * Returns a function that unlinks them.
 */
export function linkScroll(a: Scrollable, b: Scrollable): () => void {
  let settling: Scrollable | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const follow = (from: Scrollable, to: Scrollable) => () => {
    if (settling === from) {
      settling = null;
      return;
    }
    const source = from.getScrollLine();
    const target = to.getScrollLine();
    const line = proportionalLine(source.line, source.lines, target.lines);
    if (Math.abs(line - target.line) < EPSILON) return;
    settling = to;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (settling = null), SETTLE_MS);
    to.setScrollLine(line);
  };
  const stopA = a.onScroll(follow(a, b));
  const stopB = b.onScroll(follow(b, a));
  return () => {
    stopA();
    stopB();
    if (timer) clearTimeout(timer);
  };
}
