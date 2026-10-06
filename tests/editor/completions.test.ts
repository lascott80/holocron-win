import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { htmlTagCompletions } from "../../src/editor/completions.js";
import { makeView } from "./helpers";

// The editor is untyped JS; results are checked at runtime by the assertions.
function complete(doc: string, explicit = false): { view: ReturnType<typeof makeView>; result: any } {
  const view = makeView(doc, doc.length);
  return { view, result: htmlTagCompletions(new CompletionContext(view.state, doc.length, explicit)) };
}

describe("HTML tag completion", () => {
  it("offers the tags live preview renders after < + letters", () => {
    const { result } = complete("Press <k");
    expect(result).not.toBeNull();
    expect(result.from).toBe("Press ".length);
    const labels = result.options.map((o: any) => o.label);
    for (const tag of ["kbd", "mark", "sup", "sub", "u", "b", "i", "s", "small", "ins", "del", "br", "details", "summary"]) {
      expect(labels).toContain(`<${tag}>`);
    }
  });

  it("needs a letter unless invoked explicitly", () => {
    expect(complete("a <").result).toBeNull();
    expect(complete("a <", true).result).not.toBeNull();
    expect(complete("a < b").result).toBeNull();
  });

  it("stays quiet in code and frontmatter", () => {
    expect(complete("```\n<k").result).toBeNull();
    expect(complete("---\ntitle: <k").result).toBeNull();
  });

  it("inserts a tag pair with the cursor inside", () => {
    const { view, result } = complete("Press <k");
    const kbd = result.options.find((o: any) => o.label === "<kbd>");
    kbd.apply(view, kbd, result.from, "Press <k".length);
    expect(view.state.doc.toString()).toBe("Press <kbd></kbd>");
    expect(view.state.selection.main.head).toBe("Press <kbd>".length);
  });

  it("inserts <br> alone", () => {
    const { view, result } = complete("<b");
    const br = result.options.find((o: any) => o.label === "<br>");
    br.apply(view, br, result.from, 2);
    expect(view.state.doc.toString()).toBe("<br>");
  });
});
