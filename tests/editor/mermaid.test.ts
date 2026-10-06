import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { findMermaidBlocks } from "../../src/editor/mermaid.js";

const blocks = (text: string) => findMermaidBlocks(Text.of(text.split("\n")));

describe("findMermaidBlocks", () => {
  it("finds a fenced mermaid block with its code", () => {
    const doc = "# Title\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter";
    const [block] = blocks(doc);
    expect(block.code).toBe("flowchart LR\n  A --> B");
    expect(doc.slice(block.from, block.to)).toBe("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(doc.slice(block.codeFrom)).toMatch(/^flowchart LR/);
  });

  it("accepts tildes, longer fences, any case and extra info", () => {
    expect(blocks("~~~ Mermaid title\ngraph TD\n~~~")).toHaveLength(1);
    expect(blocks("````mermaid\ngraph TD\n```\nstill code\n````")[0].code).toBe("graph TD\n```\nstill code");
  });

  it("ignores other languages, unclosed blocks and lookalikes", () => {
    expect(blocks("```js\nconst a = 1\n```")).toHaveLength(0);
    expect(blocks("```mermaid\ngraph TD")).toHaveLength(0);
    expect(blocks("```mermaidx\ngraph TD\n```")).toHaveLength(0);
    expect(blocks("```mermaid\ngraph TD\n~~~")).toHaveLength(0);
  });

  it("finds several blocks and handles an empty one", () => {
    const found = blocks("```mermaid\n```\n\n```mermaid\npie\n```");
    expect(found.map((b) => b.code)).toEqual(["", "pie"]);
  });
});
