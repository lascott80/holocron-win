// Linked panes (UI-47): two editors kept at the same proportional line, both ways, without echoing.

import { describe, expect, it } from "vitest";
import { linkScroll, type Scrollable } from "../../src/renderer/src/lib/linkedScroll";

/** A fake editor whose scroll position is a line; setting it fires its scroll listeners like a browser would. */
function fakeEditor(lines: number, line = 1) {
  const listeners = new Set<() => void>();
  /** The user scrolling: moves and fires the listeners. */
  const scrollTo = (next: number) => {
    if (next === editor.line) return; // no movement, no event (like the DOM)
    editor.line = next;
    for (const listener of listeners) listener();
  };
  const editor: Scrollable & { line: number; sets: number[]; scrollTo: (next: number) => void } = {
    line,
    /** Every programmatic scroll the link made. */
    sets: [],
    scrollTo,
    getScrollLine: () => ({ line: editor.line, lines }),
    setScrollLine(next) {
      editor.sets.push(next);
      scrollTo(next);
    },
    onScroll(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return editor;
}

describe("linkScroll", () => {
  it("scrolls the other editor to the proportional line, in both directions", () => {
    const a = fakeEditor(101);
    const b = fakeEditor(51);
    linkScroll(a, b);
    a.scrollTo(51); // halfway
    expect(b.line).toBe(26);
    b.scrollTo(51); // the end
    expect(a.line).toBe(101);
  });

  it("never echoes a scroll back to the editor it came from", () => {
    const a = fakeEditor(100);
    const b = fakeEditor(10);
    linkScroll(a, b);
    a.scrollTo(23);
    // b was set once for a's scroll; b's own event must not set a again (a is already in place).
    expect(b.sets).toHaveLength(1);
    expect(a.sets).toHaveLength(0);
    expect(a.line).toBe(23);
  });

  it("leaves an editor alone that is already at the mapped line, and stops when unlinked", () => {
    const a = fakeEditor(50, 25);
    const b = fakeEditor(50, 25);
    const unlink = linkScroll(a, b);
    b.scrollTo(25.01);
    expect(a.sets).toHaveLength(0);
    unlink();
    a.scrollTo(40);
    expect(b.line).toBe(25.01);
  });

  it("keeps following after a scroll the other side couldn't make (already at its limit)", () => {
    const a = fakeEditor(100);
    const b = fakeEditor(1); // one line: always line 1
    linkScroll(a, b);
    a.scrollTo(50);
    expect(b.line).toBe(1);
    a.scrollTo(60); // b still has nothing to do, but must not have swallowed a's state
    expect(b.sets).toEqual([]);
    expect(a.line).toBe(60);
  });
});
