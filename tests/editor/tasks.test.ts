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
