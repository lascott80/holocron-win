import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { slashCompletions } from "../../src/editor/slashMenu.js";
import { makeView } from "./helpers";

const complete = (doc: string, pos = doc.length) => {
  const view = makeView(doc, pos);
  return { view, result: slashCompletions(new CompletionContext(view.state, pos, false)) };
};

describe("slash menu", () => {
  it("opens for a slash alone on a line, filtering on what follows", () => {
    const { result } = complete("Intro\n\n/tab");
    expect(result).not.toBeNull();
    expect(result!.from).toBe("Intro\n\n/".length);
    expect(result!.options.some((o) => o.label === "Table")).toBe(true);
  });

  it("stays out of the way mid-sentence, in code and in tables", () => {
    expect(complete("and/or").result).toBeNull();
    expect(complete("```\n/").result).toBeNull();
    expect(complete("| a | b |\n| - | - |\n| /").result).toBeNull();
  });

  it("replaces the slash and query with the block", () => {
    const { view, result } = complete("/h2");
    const option = result!.options.find((o) => o.label === "Heading 2")!;
    (option.apply as any)(view, option, result!.from, view.state.doc.length);
    expect(view.state.doc.toString()).toBe("## ");
    expect(view.state.selection.main.head).toBe(3);
  });
});
