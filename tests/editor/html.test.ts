import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Frontmatter, Highlight, Tag, WikiLink } from "../../src/editor/syntax.js";
import {
  classifyHref,
  filterStyle,
  findHtmlBlocks,
  inlineMark,
  isInvisibleHtml,
  pairInlineTags,
  parseTag,
  rewriteSrc,
  sanitizerConfig,
} from "../../src/editor/html.js";

function state(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter, WikiLink, Tag, Highlight] })] });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

/** The parser's HTMLTag nodes on a line, as livePreview collects them. */
function tags(text: string) {
  const s = state(text);
  const found: { from: number; to: number; text: string; group: number }[] = [];
  ensureSyntaxTree(s, text.length, 5000)!.iterate({
    enter(node) {
      if (node.name === "HTMLTag") found.push({ from: node.from, to: node.to, text: text.slice(node.from, node.to), group: node.node.parent?.from ?? 0 });
    },
  });
  return found;
}

describe("parseTag", () => {
  it("reads names and attributes in any quoting", () => {
    expect(parseTag(`<span style="color: red" title='Hi &amp; bye' data-x=1 hidden>`)).toEqual({
      name: "span",
      closing: false,
      selfClosing: false,
      attrs: { style: "color: red", title: "Hi & bye", "data-x": "1", hidden: "" },
    });
    expect(parseTag("</A>")).toMatchObject({ name: "a", closing: true });
    expect(parseTag(`<img src="a.png"/>`)).toMatchObject({ name: "img", selfClosing: true, attrs: { src: "a.png" } });
  });

  it("rejects things that aren't tags", () => {
    expect(parseTag("<https://example.com>")).toBeNull();
    expect(parseTag("<!-- c -->")).toBeNull();
    expect(parseTag("< span>")).toBeNull();
  });
});

describe("filterStyle", () => {
  it("keeps colours, fonts, alignment, sizes, spacing and borders", () => {
    expect(filterStyle("color: red; background-color:#222; text-align:center; font-weight: 600; width: 50%; margin: 4px 0; padding: 2px; border: 1px solid #ccc"))
      .toBe("color: red; background-color: #222; text-align: center; font-weight: 600; width: 50%; margin: 4px 0; padding: 2px; border: 1px solid #ccc");
    expect(filterStyle("color: var(--hc-accent)")).toBe("color: var(--hc-accent)");
  });

  it("drops positioning, url(), expressions, escapes and negative margins", () => {
    expect(filterStyle("position: fixed; top: 0; z-index: 9999; color: red")).toBe("color: red");
    expect(filterStyle("background-color: url(https://evil.example/x.png)")).toBe("");
    expect(filterStyle("background: red")).toBe(""); // shorthand could carry url()
    expect(filterStyle("width: expression(alert(1))")).toBe("");
    expect(filterStyle("color: \\72 ed")).toBe("");
    expect(filterStyle("color: red /* x */")).toBe("");
    expect(filterStyle("font-family: javascript:alert(1)")).toBe("");
    expect(filterStyle("margin-top: -999px; margin: 0 -2em; padding-left: 4px")).toBe("padding-left: 4px");
    expect(filterStyle("display: none; content: 'x'; transform: scale(9)")).toBe("");
    expect(filterStyle("")).toBe("");
  });
});

describe("classifyHref", () => {
  it("sends web and mail links to the browser", () => {
    expect(classifyHref("https://example.com/a?b")).toEqual({ kind: "url", url: "https://example.com/a?b" });
    expect(classifyHref("HTTP://x.org")).toEqual({ kind: "url", url: "HTTP://x.org" });
    expect(classifyHref("mailto:a@b.c")).toEqual({ kind: "url", url: "mailto:a@b.c" });
  });

  it("opens note paths and [[targets]] as links", () => {
    expect(classifyHref("Lore/Kyber%20Crystal.md")).toEqual({ kind: "link", target: "Lore/Kyber Crystal.md" });
    expect(classifyHref("./Second.md#Intro")).toEqual({ kind: "link", target: "Second.md#Intro" });
    expect(classifyHref("[[Kyber|the crystal]]")).toEqual({ kind: "link", target: "Kyber" });
    expect(classifyHref("#Heading")).toEqual({ kind: "link", target: "#Heading" });
  });

  it("refuses every other scheme", () => {
    for (const href of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "vbscript:x", "data:text/html,hi", "file:///C:/x", "C:\\Windows\\x", "//evil.example/x", "\\\\server\\share", ""]) {
      expect(classifyHref(href), href).toBeNull();
    }
  });
});

describe("rewriteSrc", () => {
  it("loads web images directly and vault paths through the asset scheme", () => {
    expect(rewriteSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(rewriteSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    // Without Holocron's bridge (tests, browser dev mode) local files come from Editor/dev.
    expect(rewriteSrc("Media/pixel%20one.png?x#y")).toBe("/Editor/dev/pixel one.png");
  });

  it("refuses scripts, other data URLs and odd schemes", () => {
    expect(rewriteSrc("javascript:alert(1)")).toBeNull();
    expect(rewriteSrc("data:text/html,<script>")).toBeNull();
    expect(rewriteSrc("data:image/png;base64,AAAA", "video")).toBeNull();
    expect(rewriteSrc("file:///C:/x.png")).toBeNull();
    expect(rewriteSrc("holocron-asset://embed/x.png")).toBeNull();
    expect(rewriteSrc("//evil.example/x.png")).toBeNull();
    expect(rewriteSrc("")).toBeNull();
  });
});

describe("pairInlineTags", () => {
  it("pairs inline tags within a paragraph", () => {
    const text = `A <span style="color:red">red <em>it</em></span> and <a href="x.md">x</a>.`;
    const pairs = pairInlineTags(tags(text));
    expect(pairs.map((p: any) => [p.type, p.name, text.slice(p.openTo, p.closeFrom)])).toEqual([
      ["pair", "span", "red <em>it</em>"],
      ["pair", "em", "it"],
      ["pair", "a", "x"],
    ]);
    expect(pairs[0].attrs).toEqual({ style: "color:red" });
  });

  it("returns <img> as a void tag", () => {
    const text = `Icon <img src="a.png" width=20> here`;
    const [img] = pairInlineTags(tags(text));
    expect(img).toMatchObject({ type: "void", name: "img", attrs: { src: "a.png", width: "20" } });
    expect(text.slice(img.from, img.to)).toBe(`<img src="a.png" width=20>`);
  });

  it("draws inline <video>/<audio> whole, with nothing inside styled separately", () => {
    const text = `<video src="clip.webm" width="240" controls><span>fallback</span></video> after`;
    const found = pairInlineTags(tags(text));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "element", name: "video", openFrom: 0 });
    expect(text.slice(found[0].openFrom, found[0].closeTo)).toBe(`<video src="clip.webm" width="240" controls><span>fallback</span></video>`);
  });

  it("leaves plain <kbd>-style tags to livePreview, but takes them with attributes", () => {
    expect(pairInlineTags(tags("Press <kbd>K</kbd> or <b>bold</b>"))).toEqual([]);
    expect(pairInlineTags(tags(`<mark style="background-color: pink">x</mark> y`)).map((p: any) => p.name)).toEqual(["mark"]);
  });

  it("ignores unknown, unmatched and block tags, autolinks and code", () => {
    expect(pairInlineTags(tags("a <span>open only and </em> stray"))).toEqual([]);
    expect(pairInlineTags(tags("x <div>y</div> <details> <https://example.com>"))).toEqual([]);
    expect(pairInlineTags(tags("`<span>code</span>`"))).toEqual([]);
  });
});

describe("inlineMark", () => {
  it("styles spans, fonts and semantic tags", () => {
    expect(inlineMark("span", { style: "color: red; position: fixed" })).toEqual({ tagName: "span", attributes: { style: "color: red" } });
    expect(inlineMark("font", { color: "#3fb950", size: "5" })).toEqual({ tagName: "span", attributes: { style: "color: #3fb950; font-size: 1.5em" } });
    expect(inlineMark("abbr", { title: "HyperText" })).toEqual({ tagName: "abbr", attributes: { title: "HyperText" } });
    expect(inlineMark("code")).toEqual({ class: "cm-inline-code", attributes: {} });
    expect(inlineMark("q")).toEqual({ tagName: "q", attributes: {} });
    expect(inlineMark("font", { color: "url(x)" })).toEqual({ tagName: "span", attributes: {} });
  });

  it("turns links into livePreview's clickable link marks", () => {
    expect(inlineMark("a", { href: "https://example.com" })).toEqual({ class: "cm-md-link", attributes: { "data-href": "https://example.com" } });
    expect(inlineMark("a", { href: "Second.md" })).toEqual({ class: "cm-wikilink", attributes: { "data-target": "Second.md" } });
    expect(inlineMark("a", { href: "javascript:alert(1)" })).toBeNull();
  });
});

describe("sanitizerConfig", () => {
  it("allows formatting and media but never active content", () => {
    const config = sanitizerConfig();
    for (const tag of ["div", "p", "img", "table", "td", "center", "figure", "video", "audio", "a", "span", "font", "details"]) {
      expect(config.ALLOWED_TAGS, tag).toContain(tag);
    }
    for (const tag of ["script", "iframe", "object", "embed", "form", "input", "button", "style", "svg", "math", "link", "meta", "base"]) {
      expect(config.ALLOWED_TAGS, tag).not.toContain(tag);
      expect(config.FORBID_TAGS, tag).toContain(tag);
    }
    for (const attr of ["align", "width", "height", "style", "title", "alt", "src", "href", "colspan", "rowspan"]) {
      expect(config.ALLOWED_ATTR, attr).toContain(attr);
    }
    for (const attr of ["srcdoc", "srcset", "formaction", "autoplay", "id", "name", "class"]) {
      expect(config.FORBID_ATTR, attr).toContain(attr);
      expect(config.ALLOWED_ATTR, attr).not.toContain(attr);
    }
    expect(config.ALLOWED_ATTR.some((attr: string) => attr.startsWith("on"))).toBe(false);
    expect(config.ALLOW_DATA_ATTR).toBe(false);
    expect(config.ALLOW_UNKNOWN_PROTOCOLS).toBe(false);
  });

  it("only lets safe URL schemes through", () => {
    const { ALLOWED_URI_REGEXP: uri } = sanitizerConfig();
    for (const ok of ["https://a.b", "http://a.b", "mailto:a@b", "data:image/png;base64,AA", "a.png", "../x/y.md", "#h"]) expect(uri.test(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "vbscript:x", "data:text/html,x", "file:///c:/x", "holocron-asset://embed/x"]) expect(uri.test(bad), bad).toBe(false);
  });
});

describe("findHtmlBlocks", () => {
  it("finds top-level HTML blocks through the end of the block", () => {
    const doc = `# T\n\n<div align="center">\n  <img src="a.png">\n  text\n</div>\n\nPara with <span>inline</span>.\n\n<img src="b.png">\nstill html\n\nAfter`;
    const blocks = findHtmlBlocks(state(doc));
    expect(blocks.map((b: any) => b.html)).toEqual([`<div align="center">\n  <img src="a.png">\n  text\n</div>`, `<img src="b.png">\nstill html`]);
    expect(blocks.every((b: any) => !b.invisible)).toBe(true);
  });

  it("marks wrappers and comments as invisible and leaves <details> and <br> alone", () => {
    const doc = `<div align="center">\n\n**md**\n\n</div>\n\n<!-- a\ncomment -->\n\n<details>\n<summary>S</summary>\nbody\n</details>\n\n<br>\n\nend`;
    const blocks = findHtmlBlocks(state(doc));
    expect(blocks.map((b: any) => [b.html, b.invisible])).toEqual([
      [`<div align="center">`, true],
      ["</div>", true],
      ["<!-- a\ncomment -->", true],
    ]);
  });

  it("skips HTML inside code", () => {
    expect(findHtmlBlocks(state("```html\n<div>x</div>\n```\n\n    <div>indented code</div>"))).toEqual([]);
  });
});

describe("isInvisibleHtml", () => {
  it("is true only for markup with nothing to show", () => {
    expect(isInvisibleHtml("<div>\n</div>")).toBe(true);
    expect(isInvisibleHtml("<!-- x -->")).toBe(true);
    expect(isInvisibleHtml("<p>&nbsp;</p>")).toBe(true);
    expect(isInvisibleHtml("<div>hi</div>")).toBe(false);
    expect(isInvisibleHtml(`<img src="a.png">`)).toBe(false);
    expect(isInvisibleHtml("<hr>")).toBe(false);
    expect(isInvisibleHtml("<script>alert(1)</script>")).toBe(true);
    expect(isInvisibleHtml("<style>p { color: red }</style>")).toBe(true);
  });
});
