import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Frontmatter, Highlight, Tag, WikiLink } from "../../src/editor/syntax.js";
import { findDisplayMath, findInlineMath, inlineMathIn } from "../../src/editor/math.js";

const blocks = (text: string) => findDisplayMath(Text.of(text.split("\n")));
const sources = (text: string) => findInlineMath(text).map((s: any) => s.source);

function inDoc(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter, WikiLink, Tag, Highlight] })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return inlineMathIn(state, 0, doc.length).map((s: any) => doc.slice(s.from, s.to));
}

describe("findInlineMath", () => {
  it("finds $…$ spans with their source and range", () => {
    const text = "Euler: $e^{i\\pi} + 1 = 0$ and $x$.";
    const spans = findInlineMath(text);
    expect(spans.map((s: any) => s.source)).toEqual(["e^{i\\pi} + 1 = 0", "x"]);
    expect(text.slice(spans[0].from, spans[0].to)).toBe("$e^{i\\pi} + 1 = 0$");
  });

  it("leaves prices alone", () => {
    expect(sources("It costs $5 and $10.")).toEqual([]);
    expect(sources("$5 or $6 each")).toEqual([]);
    expect(sources("between $20 and $30")).toEqual([]);
    expect(sources("between $20 and $30$")).toEqual(["30"]); // the first $ fails; $30$ is math
    expect(sources("Pay $5, get $x$ back")).toEqual(["x"]);
  });

  it("needs no whitespace inside the dollars and no digit after the closing one", () => {
    expect(sources("$ x$")).toEqual([]);
    expect(sources("$x $")).toEqual([]);
    expect(sources("$x$5")).toEqual([]);
    expect(sources("$x$, $y$.")).toEqual(["x", "y"]);
    expect(sources("a $x$b")).toEqual(["x"]);
  });

  it("treats \\$ as a literal dollar", () => {
    expect(sources("\\$5 and \\$x\\$")).toEqual([]);
    expect(sources("$a\\$b$")).toEqual(["a\\$b"]);
    expect(sources("\\\\$x$")).toEqual(["x"]); // an escaped backslash doesn't escape the dollar
  });

  it("never makes $$ inline", () => {
    expect(sources("$$x$$")).toEqual([]);
    expect(sources("a $$ b $c$")).toEqual(["c"]);
    expect(sources("$a$$b$")).toEqual([]);
  });

  it("skips masked positions", () => {
    const text = "`$x$` and $y$";
    const masked = (i: number) => i < 5;
    expect(findInlineMath(text, masked).map((s: any) => s.source)).toEqual(["y"]);
  });
});

describe("inlineMathIn (with the syntax tree)", () => {
  it("skips inline code but not text around it", () => {
    expect(inDoc("Code `$x$` but $y$ here")).toEqual(["$y$"]);
    expect(inDoc("`a $b` c$")).toEqual([]);
  });

  it("skips fenced and indented code, frontmatter and tables", () => {
    expect(inDoc("```\n$x$\n```\n\n$y$")).toEqual(["$y$"]);
    expect(inDoc("text\n\n    $x$ code\n")).toEqual([]);
    expect(inDoc("---\ntitle: $x$\n---\n$y$")).toEqual(["$y$"]);
    expect(inDoc("| a | b |\n| - | - |\n| $x$ | 2 |")).toEqual([]);
  });

  it("skips the lines of $$ blocks", () => {
    expect(inDoc("$$\na $b$ c\n$$\n\n$d$")).toEqual(["$d$"]);
  });
});

describe("findDisplayMath", () => {
  it("finds a multi-line block with its source", () => {
    const doc = "Intro\n\n$$\n\\int_0^1 x\\,dx\n= \\tfrac12\n$$\n\nAfter";
    const [block] = blocks(doc);
    expect(block.source).toBe("\\int_0^1 x\\,dx\n= \\tfrac12");
    expect(doc.slice(block.from, block.to)).toBe("$$\n\\int_0^1 x\\,dx\n= \\tfrac12\n$$");
    expect(block.sourceFrom).toBe(doc.indexOf("$$") + 2);
  });

  it("accepts one-line blocks and TeX on the fence lines", () => {
    expect(blocks("$$x^2$$").map((b: any) => b.source)).toEqual(["x^2"]);
    expect(blocks("  $$ a + b $$  ").map((b: any) => b.source)).toEqual(["a + b"]);
    expect(blocks("$$a\n+ b$$").map((b: any) => b.source)).toEqual(["a\n+ b"]);
  });

  it("ignores unclosed, empty, blank-line-broken and mid-line $$", () => {
    expect(blocks("$$\nx")).toHaveLength(0);
    expect(blocks("$$\n$$")).toHaveLength(0);
    expect(blocks("$$$$")).toHaveLength(0);
    expect(blocks("$$\nx\n\ny\n$$")).toHaveLength(0);
    expect(blocks("text $$x$$ text")).toHaveLength(0);
  });

  it("skips code fences and frontmatter", () => {
    expect(blocks("```\n$$\nx\n$$\n```")).toHaveLength(0);
    expect(blocks("~~~~\n$$x$$\n~~~~\n$$y$$").map((b: any) => b.source)).toEqual(["y"]);
    expect(blocks("---\na: $$x$$\n---\n$$y$$").map((b: any) => b.source)).toEqual(["y"]);
  });

  it("finds several blocks", () => {
    expect(blocks("$$a$$\n\n$$\nb\n$$\ntext\n$$c$$").map((b: any) => b.source)).toEqual(["a", "b", "c"]);
  });
});
