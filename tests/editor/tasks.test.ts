import { describe, expect, it } from "vitest";
import { toggleTask, toggledTaskStatus } from "../../src/editor/commands.js";
import { toggleCheckboxAt } from "../../src/editor/livePreview.js";
import { makeView } from "./helpers";

describe("toggledTaskStatus", () => {
  it("toggles open ↔ done and completes custom statuses", () => {
    expect(toggledTaskStatus(" ")).toBe("x");
    expect(toggledTaskStatus("x")).toBe(" ");
    expect(toggledTaskStatus("X")).toBe(" ");
    for (const status of ["!", "?", "/", "-", ">", "<", "*", "a"]) expect(toggledTaskStatus(status)).toBe("x");
  });
});

describe("clicking a checkbox (toggleCheckboxAt)", () => {
  const click = (doc: string) => {
    const view = makeView(doc);
    expect(toggleCheckboxAt(view, doc.indexOf("["))).toBe(true);
    return view.state.doc.toString();
  };
  it("marks custom statuses done instead of clearing them", () => {
    expect(click("- [!] urgent")).toBe("- [x] urgent");
    expect(click("- [?] maybe")).toBe("- [x] maybe");
    expect(click("- [/] half")).toBe("- [x] half");
    expect(click("- [-] dropped")).toBe("- [x] dropped");
  });
  it("toggles open and done", () => {
    expect(click("- [ ] todo")).toBe("- [x] todo");
    expect(click("- [x] done")).toBe("- [ ] done");
    expect(click("- [X] done")).toBe("- [ ] done");
  });
  it("ignores positions that aren't a box", () => {
    const view = makeView("plain text");
    expect(toggleCheckboxAt(view, 0)).toBe(false);
  });
});

describe("toggleTask (Ctrl+L)", () => {
  const run = (doc: string, cursor = doc.length) => {
    const view = makeView(doc, cursor);
    toggleTask(view);
    return view.state.doc.toString();
  };
  it("toggles a custom status rather than adding a second box", () => {
    expect(run("- [!] text")).toBe("- [x] text");
    expect(run("  * [>] later")).toBe("  * [x] later");
    expect(run("1. [?] numbered")).toBe("1. [x] numbered");
  });
  it("keeps the existing cycle", () => {
    expect(run("text")).toBe("- [ ] text");
    expect(run("- item")).toBe("- [ ] item");
    expect(run("- [ ] item")).toBe("- [x] item");
    expect(run("- [x] item")).toBe("- [ ] item");
  });
  it("handles every selected line", () => {
    const doc = "- [!] a\n- [ ] b\n- [x] c";
    const view = makeView(doc, doc.length, [], 0);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [x] a\n- [x] b\n- [ ] c");
  });
});

describe("moveDoneTasksDown", () => {
  it("moves finished items below open ones, children and cursor included", async () => {
    const { moveDoneTasksDown } = await import("../../src/editor/commands.js");
    const doc = "# Plan\n\n- [x] Sweep\n  - note\n- [ ] Build\n- [-] Dropped\n- [ ] Source\n\nAfter";
    const view = makeView(doc, doc.indexOf("Build") + 2);
    expect(moveDoneTasksDown(view)).toBe(true);
    const text = view.state.doc.toString();
    expect(text).toBe("# Plan\n\n- [ ] Build\n- [ ] Source\n- [x] Sweep\n  - note\n- [-] Dropped\n\nAfter");
    expect(view.state.selection.main.head).toBe(text.indexOf("Build") + 2);
  });

  it("does nothing outside a list", async () => {
    const { moveDoneTasksDown } = await import("../../src/editor/commands.js");
    expect(moveDoneTasksDown(makeView("Just text", 2))).toBe(false);
  });
});

describe("line marker buttons put the cursor after the marker", async () => {
  const { toggleBulletList, toggleNumberedList, toggleQuote, setHeading } = await import("../../src/editor/commands.js");
  const cases: [string, (view: any) => boolean, string][] = [
    ["checklist", toggleTask, "- [ ] "],
    ["bullet", toggleBulletList, "- "],
    ["numbered", toggleNumberedList, "1. "],
    ["quote", toggleQuote, "> "],
    ["heading", setHeading(2), "## "],
  ];
  for (const [name, command, marker] of cases) {
    it(`${name} on an empty line`, () => {
      const view = makeView("", 0);
      command(view);
      expect(view.state.doc.toString()).toBe(marker);
      expect(view.state.selection.main.head).toBe(marker.length);
    });
    it(`${name} keeps the cursor in place on a line with text`, () => {
      const view = makeView("Buy milk", 3);
      command(view);
      expect(view.state.doc.toString()).toBe(marker + "Buy milk");
      expect(view.state.selection.main.head).toBe(marker.length + 3);
    });
  }
  it("a cursor at the start of a line with text moves past the marker too", () => {
    const view = makeView("Buy milk", 0);
    toggleTask(view);
    expect(view.state.selection.main.head).toBe("- [ ] ".length);
  });
});

describe("Return on an empty list item ends the list", async () => {
  const { continueMarkup } = await import("../../src/editor/commands.js");
  const enter = (doc: string) => {
    const view = makeView(doc, doc.length);
    continueMarkup(view);
    return { text: view.state.doc.toString(), head: view.state.selection.main.head };
  };
  it("even when it's the list's second item", () => {
    expect(enter("1. Eggs\n2. ")).toEqual({ text: "1. Eggs\n", head: 8 });
    expect(enter("- Bread\n- ")).toEqual({ text: "- Bread\n", head: 8 });
    expect(enter("- [ ] Milk\n- [ ] ")).toEqual({ text: "- [ ] Milk\n", head: 11 });
  });
  it("still continues a list with text", () => {
    expect(enter("1. Eggs").text).toBe("1. Eggs\n2. ");
    expect(enter("- [ ] Milk").text).toBe("- [ ] Milk\n- [ ] ");
  });
});

describe("moving heading sections (outline drag)", async () => {
  const { moveSectionChanges } = await import("../../src/editor/commands.js");
  const doc = "# A\na\n## A1\na1\n# B\nb\n# C\nc";
  const move = (from: number, before: number | null) => {
    const view = makeView(doc);
    const result = moveSectionChanges(view.state, from, before);
    if (!result) return null;
    const text = result.changes.apply(view.state.doc).toString();
    return { text, at: text.slice(result.at, result.at + 4) };
  };
  it("moves a section with its subsections before another heading", () => {
    expect(move(5, 1)).toEqual({ text: "# B\nb\n# A\na\n## A1\na1\n# C\nc", at: "# B\n" });
    expect(move(1, 7)).toEqual({ text: "# B\nb\n# A\na\n## A1\na1\n# C\nc", at: "# A\n" });
  });
  it("moves to the end, adding the missing final newline", () => {
    expect(move(1, null)).toEqual({ text: "# B\nb\n# C\nc\n# A\na\n## A1\na1", at: "# A\n" });
  });
  it("moves a subsection out of its parent", () => {
    expect(move(3, 7)?.text).toBe("# A\na\n# B\nb\n## A1\na1\n# C\nc");
  });
  it("refuses drops into the section itself or onto its own place", () => {
    expect(move(1, 3)).toBeNull();
    expect(move(1, 5)).toBeNull();
    expect(move(7, null)).toBeNull();
  });
});
