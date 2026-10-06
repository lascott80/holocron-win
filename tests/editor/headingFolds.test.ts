import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { foldAllHeadings, foldHeading, headingFolding, headingSections, unfoldAll, unfoldHeading } from "../../src/editor/headingFolds.js";
import { makeView } from "./helpers";

const doc = (text: string) => Text.of(text.split("\n"));
/** Each section as "heading line text → folded text". */
const sections = (text: string) =>
  headingSections(doc(text)).map((s: any) => [text.slice(s.header, s.from), text.slice(s.from, s.to)]);

const folded = (view: any) => {
  const out: string[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    out.push(view.state.sliceDoc(from, to));
  });
  return out;
};

describe("headingSections", () => {
  it("runs to the next heading of the same or higher level", () => {
    const text = "# A\none\n## B\ntwo\n### C\nthree\n## D\nfour\n# E\nfive";
    expect(sections(text)).toEqual([
      ["# A", "\none\n## B\ntwo\n### C\nthree\n## D\nfour"],
      ["## B", "\ntwo\n### C\nthree"],
      ["### C", "\nthree"],
      ["## D", "\nfour"],
      ["# E", "\nfive"],
    ]);
  });

  it("runs to the end of the document, including trailing blank lines", () => {
    expect(sections("intro\n## Last\nbody\n\n")).toEqual([["## Last", "\nbody\n\n"]]);
  });

  it("a lower-level heading first still ends at the next higher one", () => {
    expect(sections("### Deep\nx\n# Top\ny")).toEqual([["### Deep", "\nx"], ["# Top", "\ny"]]);
  });

  it("ignores # lines inside fenced code and frontmatter", () => {
    const text = "---\n# yaml comment\ntitle: x\n---\n# Real\n```sh\n# not a heading\n```\n~~~\n## nor this\n~~~\nend";
    expect(sections(text)).toEqual([["# Real", "\n```sh\n# not a heading\n```\n~~~\n## nor this\n~~~\nend"]]);
  });

  it("an unclosed fence hides headings to the end; a longer fence needs a long close", () => {
    expect(sections("# A\nx\n````\n```\n# no\n````\n# B\ny")).toEqual([
      ["# A", "\nx\n````\n```\n# no\n````"],
      ["# B", "\ny"],
    ]);
    expect(sections("# A\nx\n```\n# no")).toEqual([["# A", "\nx\n```\n# no"]]);
  });

  it("requires a space after the hashes, allows 3 spaces of indent, max 6 levels", () => {
    expect(sections("#tag\nx\n   ## Indented\ny\n####### seven\nz\n#\nempty heading body")).toEqual([
      ["   ## Indented", "\ny\n####### seven\nz"],
      ["#", "\nempty heading body"],
    ]);
    expect(sections("    # code block indent\nx")).toEqual([]);
  });

  it("leaves out sections with nothing but blank lines", () => {
    expect(sections("# A\n\n# B\n   \n## C\ntext")).toEqual([["# B", "\n   \n## C\ntext"], ["## C", "\ntext"]]);
  });
});

describe("fold commands", () => {
  const text = "# A\none\n## B\ntwo\n## C\nthree";

  it("Fold Heading folds the innermost section around the cursor and keeps the cursor on the heading", () => {
    const view = makeView(text, text.indexOf("two"), [headingFolding]);
    expect(foldHeading(view)).toBe(true);
    expect(folded(view)).toEqual(["\ntwo"]);
    expect(view.state.selection.main.head).toBe(text.indexOf("## B") + 4);
    // Again: the enclosing section.
    expect(foldHeading(view)).toBe(true);
    expect(folded(view)).toContain("\none\n## B\ntwo\n## C\nthree");
  });

  it("Unfold Heading unfolds the section on the cursor's line", () => {
    const view = makeView(text, text.indexOf("## B") + 2, [headingFolding]);
    foldHeading(view);
    expect(folded(view)).toEqual(["\ntwo"]);
    expect(unfoldHeading(view)).toBe(true);
    expect(folded(view)).toEqual([]);
    expect(unfoldHeading(view)).toBe(false);
  });

  it("Fold All / Unfold All", () => {
    const view = makeView(text, text.indexOf("three"), [headingFolding]);
    expect(foldAllHeadings(view)).toBe(true);
    expect(folded(view)).toHaveLength(3);
    expect(view.state.selection.main.head).toBe(3); // end of "# A"
    expect(unfoldAll(view)).toBe(true);
    expect(folded(view)).toEqual([]);
  });

  it("moving the cursor into a folded section unfolds it", () => {
    const view = makeView(text, 0, [headingFolding]);
    foldAllHeadings(view);
    view.dispatch({ selection: { anchor: text.indexOf("one") + 1 } });
    expect(folded(view)).not.toContain("\none\n## B\ntwo\n## C\nthree");
  });

  it("does nothing without heading folding (source mode)", () => {
    const view = makeView(text, 0);
    expect(foldHeading(view)).toBe(false);
    expect(foldAllHeadings(view)).toBe(false);
    expect(unfoldAll(view)).toBe(false);
  });
});
