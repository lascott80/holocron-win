import { describe, expect, it } from "vitest";
import { wrapSelection } from "../../src/editor/wrapSelection.js";
import { makeView } from "./helpers";

const type = (view: any, mark: string) => {
  const spec = wrapSelection(view.state, mark);
  if (spec) view.dispatch(spec);
  return spec !== null;
};

describe("wrapSelection", () => {
  it("wraps the selection and keeps it selected", () => {
    const view = makeView("Last paragraph.", 4, [], 0);
    expect(type(view, "*")).toBe(true);
    expect(view.state.doc.toString()).toBe("*Last* paragraph.");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("Last");
    type(view, "*");
    expect(view.state.doc.toString()).toBe("**Last** paragraph.");
  });

  it("handles the other marks", () => {
    for (const mark of ["_", "~", "=", "`"]) {
      const view = makeView("ab", 2, [], 0);
      type(view, mark);
      expect(view.state.doc.toString()).toBe(`${mark}ab${mark}`);
    }
  });

  it("does nothing without a selection, for other characters, or in code", () => {
    expect(type(makeView("ab", 1), "*")).toBe(false);
    expect(type(makeView("ab", 2, [], 0), "x")).toBe(false);
    expect(type(makeView("```\nab\n```", 6, [], 4), "*")).toBe(false);
  });
});
