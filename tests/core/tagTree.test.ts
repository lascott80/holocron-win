import { describe, expect, test } from "vitest";
import { buildTagTree, isValidTagName, renameTagInText, visibleTagRows } from "@core/tagTree";

describe("buildTagTree", () => {
  const counts = [
    { tag: "project/alpha", count: 3 },
    { tag: "project", count: 2 },
    { tag: "project/beta", count: 1 },
    { tag: "lore", count: 4 },
    { tag: "lore/planets/ilum", count: 1 },
  ];

  test("nests tags under their parents with own counts and subtree totals", () => {
    const tree = buildTagTree(counts);
    expect(tree.map((node) => [node.tag, node.count, node.total])).toEqual([
      ["project", 2, 6],
      ["lore", 4, 5],
    ]);
    expect(tree[0].children.map((node) => [node.name, node.count, node.total])).toEqual([
      ["alpha", 3, 3],
      ["beta", 1, 1],
    ]);
    // "lore/planets" is nobody's tag but still a node.
    const planets = tree[1].children[0];
    expect([planets.tag, planets.name, planets.count, planets.total]).toEqual(["lore/planets", "planets", 0, 1]);
    expect(planets.children[0].tag).toBe("lore/planets/ilum");
  });

  test("totals count a note once per subtree when note tags are given", () => {
    const tree = buildTagTree(counts, "count", 1000, [["project", "project/alpha"], ["project/alpha"], ["project/alpha", "project/beta"], ["project"], ["lore"], ["lore"], ["lore"], ["lore", "lore/planets/ilum"]]);
    // Equal totals: the one used more on its own comes first.
    expect(tree.map((node) => [node.tag, node.count, node.total])).toEqual([
      ["lore", 4, 4],
      ["project", 2, 4],
    ]);
  });

  test("sorts by count or by name at every level", () => {
    const byName = buildTagTree(counts, "name");
    expect(byName.map((node) => node.tag)).toEqual(["lore", "project"]);
    expect(byName[1].children.map((node) => node.name)).toEqual(["alpha", "beta"]);
    const byCount = buildTagTree([{ tag: "b", count: 1 }, { tag: "a", count: 1 }, { tag: "c/x", count: 5 }], "count");
    expect(byCount.map((node) => node.tag)).toEqual(["c", "a", "b"]);
  });

  test("merges tags differing only in case and caps the node count in display order", () => {
    const tree = buildTagTree([{ tag: "Lore", count: 1 }, { tag: "lore/x", count: 1 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].tag).toBe("lore/x");
    const capped = buildTagTree(counts, "count", 4);
    expect(capped.map((node) => node.tag)).toEqual(["project", "lore"]);
    expect(capped[0].children.map((node) => node.tag)).toEqual(["project/alpha", "project/beta"]);
    expect(capped[1].children).toEqual([]);
    expect(buildTagTree(counts, "count", 2).map((node) => [node.tag, node.children.length])).toEqual([["project", 1]]);
  });

  test("visibleTagRows follows expanded parents", () => {
    const tree = buildTagTree(counts);
    expect(visibleTagRows(tree, new Set()).map((row) => row.node.tag)).toEqual(["project", "lore"]);
    const rows = visibleTagRows(tree, new Set(["project", "lore/planets"]));
    expect(rows.map((row) => [row.node.tag, row.depth, row.parent])).toEqual([
      ["project", 0, null],
      ["project/alpha", 1, "project"],
      ["project/beta", 1, "project"],
      ["lore", 0, null],
    ]);
  });
});

describe("isValidTagName", () => {
  test("accepts tag syntax and rejects the rest", () => {
    for (const ok of ["project", "project/alpha", "a-b_c", "Été", "x1/2y", "_private", "a/1"]) expect(isValidTagName(ok), ok).toBe(true);
    for (const bad of ["", "1st", "a b", "#a", "a/", "/a", "a//b", "a.b"]) expect(isValidTagName(bad), bad).toBe(false);
  });
});

describe("renameTagInText", () => {
  test("renames inline tags and nested tags, whole-tag matches only, case-insensitively", () => {
    const text = "Plan #project and #Project/alpha, not #projects or #myproject.\n#PROJECT/beta/x ends.\n";
    const result = renameTagInText(text, "project", "work");
    expect(result.count).toBe(3);
    expect(result.text).toBe("Plan #work and #work/alpha, not #projects or #myproject.\n#work/beta/x ends.\n");
  });

  test("writes the new name as typed, keeps line endings and leaves unrelated text alone", () => {
    const result = renameTagInText("#project one\r\n\r\nplain\r\n", "project", "Work");
    expect(result.text).toBe("#Work one\r\n\r\nplain\r\n");
    const same = renameTagInText("nothing here\n", "project", "work");
    expect(same).toEqual({ text: "nothing here\n", count: 0 });
  });

  test("skips code spans, fenced code, links, URLs and HTML", () => {
    const text = [
      "Real #project here.",
      "Code `#project` stays.",
      "```",
      "#project in a fence",
      "```",
      "~~~md",
      "#project too",
      "~~~",
      "[[Note#project]] and [text](http://x.y/#project) and <http://x/#project> stay.",
      "https://example.com/#project stays, <span id=\"#project\">#project</span>",
      "",
    ].join("\n");
    const result = renameTagInText(text, "project", "work");
    expect(result.count).toBe(2);
    expect(result.text).toBe(
      [
        "Real #work here.",
        "Code `#project` stays.",
        "```",
        "#project in a fence",
        "```",
        "~~~md",
        "#project too",
        "~~~",
        "[[Note#project]] and [text](http://x.y/#project) and <http://x/#project> stay.",
        "https://example.com/#project stays, <span id=\"#project\">#work</span>",
        "",
      ].join("\n"),
    );
  });

  test("renames frontmatter tags in every accepted form", () => {
    const text = [
      "---",
      "title: X",
      "tags: [project, 'project/alpha', \"#Project/beta\", other]",
      "Tag: project, projects",
      "---",
      "#project body",
      "",
    ].join("\n");
    const result = renameTagInText(text, "project", "work");
    expect(result.count).toBe(5);
    expect(result.text).toBe(
      ["---", "title: X", "tags: [work, 'work/alpha', \"#work/beta\", other]", "Tag: work, projects", "---", "#work body", ""].join("\n"),
    );

    const scalar = renameTagInText("---\ntags: project\n---\n", "project", "work");
    expect(scalar.text).toBe("---\ntags: work\n---\n");

    const block = renameTagInText("---\ntags:\n  - project\n  - \"project/x\"\n  - lore\naliases:\n  - project\n---\n", "project", "work");
    expect(block.count).toBe(2);
    expect(block.text).toBe("---\ntags:\n  - work\n  - \"work/x\"\n  - lore\naliases:\n  - project\n---\n");
  });

  test("frontmatter that never closes is body text", () => {
    const result = renameTagInText("---\ntags: project\n#project\n", "project", "work");
    expect(result.text).toBe("---\ntags: project\n#work\n");
  });

  test("renames a nested tag on its own, leaving its parent", () => {
    const result = renameTagInText("#project #project/alpha #project/alpha/x\n", "project/alpha", "work/done");
    expect(result.text).toBe("#project #work/done #work/done/x\n");
  });
});
