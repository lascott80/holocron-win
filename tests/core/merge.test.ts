import { describe, expect, test } from "vitest";
import { diff, edits, lines, merge } from "@core/merge";

describe("TextMerge", () => {
  test("splits lines keeping endings", () => {
    expect(lines("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(lines("a\nb")).toEqual(["a\n", "b"]);
    expect(lines("")).toEqual([]);
    expect(lines("a\r\nb").join("")).toBe("a\r\nb");
  });

  test("CRLF is one break and a lone CR is not a break", () => {
    expect(lines("a\r\nb\r\n")).toEqual(["a\r\n", "b\r\n"]);
    expect(lines("a\rb\nc")).toEqual(["a\rb\n", "c"]);
    expect(lines("\n\n")).toEqual(["\n", "\n"]);
  });

  test("diff finds changed regions", () => {
    const base = lines("one\ntwo\nthree\nfour\n");
    const other = lines("one\n2\nthree\nfour\nfive\n");
    expect(diff(base, other)).toEqual([
      { baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 2 },
      { baseStart: 4, baseEnd: 4, otherStart: 4, otherEnd: 5 },
    ]);
    expect(diff(base, base)).toEqual([]);
  });

  test("merges edits to different lines", () => {
    const base = "# Kyber\n\nIntro line.\n\n- [ ] Map caves\n- [ ] Log results\n";
    const mine = "# Kyber\n\nIntro line, expanded.\n\n- [ ] Map caves\n- [ ] Log results\n";
    const theirs = "# Kyber\n\nIntro line.\n\n- [x] Map caves\n- [ ] Log results\n";
    expect(merge(base, mine, theirs).mergedText).toBe(
      "# Kyber\n\nIntro line, expanded.\n\n- [x] Map caves\n- [ ] Log results\n",
    );
  });

  test("merges insertions at both ends", () => {
    expect(merge("b\nc\n", "a\nb\nc\n", "b\nc\nd\n").mergedText).toBe("a\nb\nc\nd\n");
  });

  test("identical edits are not a conflict", () => {
    const result = merge("a\nb\nc\n", "a\nB\nc\nx\n", "a\nB\nc\ny\n");
    expect(result.mergedText).toBeNull(); // x vs y at the end conflicts…
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].mine).toEqual(["x\n"]);

    const same = merge("a\nb\nc\n", "a\nB\nc\n", "a\nB\nc\nd\n");
    expect(same.mergedText).toBe("a\nB\nc\nd\n"); // …but the shared B edit is fine
  });

  test("overlapping edits conflict", () => {
    const result = merge("a\nb\nc\n", "a\nmine\nc\n", "a\ntheirs\nc\n");
    expect(result.isClean).toBe(false);
    expect(result.conflicts).toEqual([{ base: ["b\n"], mine: ["mine\n"], theirs: ["theirs\n"] }]);
  });

  test("one-sided changes take that side", () => {
    expect(merge("a\n", "a\n", "b\n").mergedText).toBe("b\n");
    expect(merge("a\n", "b\n", "a\n").mergedText).toBe("b\n");
    expect(merge("", "new\n", "").mergedText).toBe("new\n");
  });

  test("deletions merge with edits elsewhere", () => {
    const base = "1\n2\n3\n4\n5\n6\n";
    const mine = "1\n3\n4\n5\n6\n"; // deleted line 2
    const theirs = "1\n2\n3\n4\n5\nsix\n"; // edited line 6
    expect(merge(base, mine, theirs).mergedText).toBe("1\n3\n4\n5\nsix\n");
  });

  test("handles larger documents", () => {
    const base = Array.from({ length: 2000 }, (_, i) => `line ${i}\n`).join("");
    const mineLines = lines(base);
    mineLines[10] = "mine 10\n";
    const theirLines = lines(base);
    theirLines[1990] = "theirs 1990\n";
    theirLines.splice(500, 0, "inserted\n");
    const result = merge(base, mineLines.join(""), theirLines.join(""));
    const merged = result.mergedText;
    expect(merged).not.toBeNull();
    expect(merged).toContain("mine 10\n");
    expect(merged).toContain("theirs 1990\n");
    expect(merged).toContain("line 499\ninserted\nline 500\n");

    const expected = lines(base);
    expected[10] = "mine 10\n";
    expected[1990] = "theirs 1990\n";
    expected.splice(500, 0, "inserted\n");
    expect(merged).toBe(expected.join(""));
  });

  test("CRLF round-trips through a merge", () => {
    const base = "a\r\nb\r\nc\r\nd\r\n";
    const mine = "A\r\nb\r\nc\r\nd\r\n";
    const theirs = "a\r\nb\r\nc\r\nD\r\n";
    expect(merge(base, mine, theirs).mergedText).toBe("A\r\nb\r\nc\r\nD\r\n");
  });
});

describe("edits", () => {
  test("offsets count UTF-16 code units (emoji = 2)", () => {
    const old = "🙂 one\ntwo\nthree\n";
    const result = edits(old, "🙂 one\n2\nthree\n");
    // "🙂 one\n" is 2 + 5 = 7 UTF-16 units.
    expect(result).toEqual([{ from: 7, to: 11, insert: "2\n" }]);
  });

  test("applying edits gives the new text", () => {
    const old = "# Kyber 🔷\n\nIntro.\n- a\n- b\n";
    const updated = "# Kyber 🔷\n\nIntro, longer.\n- a\n- b\n- c 🌌\n";
    let text = old;
    for (const edit of [...edits(old, updated)].reverse()) {
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    }
    expect(text).toBe(updated);
  });

  test("no changes, no edits", () => {
    expect(edits("same\n", "same\n")).toEqual([]);
  });
});
