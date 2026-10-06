import { describe, expect, it, vi } from "vitest";
import { collectResources, emojify, imageKey, markdownToHtml, prepareMarkdown } from "../../src/editor/markdownToHtml.js";

const html = (markdown: string, options = {}) => markdownToHtml(markdown, options);
/** The HTML with its style attributes removed, for checking structure. */
const bare = (markdown: string, options = {}) => html(markdown, options).replace(/ style="[^"]*"/g, "");

describe("markdownToHtml: blocks", () => {
  it("renders headings with inline sizes", () => {
    expect(bare("# One\n## Two\n###### Six")).toContain("<h1>One</h1>\n<h2>Two</h2>\n<h6>Six</h6>");
    expect(html("# One")).toMatch(/<h1 style="font-size: 1\.6em; font-weight: 600;/);
  });

  it("renders bold, italic, strike, inline code and line breaks", () => {
    expect(bare("**b** *i* ~~s~~ `c`\nnext")).toBe("<div><p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code><br>next</p></div>");
  });

  it("renders nested and ordered lists", () => {
    const out = bare("- a\n  - b\n- c\n\n3. x\n4. y");
    expect(out).toContain("<ul>\n<li>a<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>");
    expect(out).toContain('<ol start="3">\n<li>x</li>\n<li>y</li>\n</ol>');
  });

  it("draws task boxes as characters (mail clients strip <input>)", () => {
    const out = html("- [ ] open\n- [x] done");
    expect(out).toContain('<li style="list-style-type: none;">☐ open</li>');
    expect(out).toContain('<li style="list-style-type: none;">☑ done</li>');
    expect(out).not.toContain("<input");
  });

  it("renders tables with alignment and borders", () => {
    const out = html("| A | B | C |\n|:-|:-:|-:|\n| 1 | 2 | 3 |");
    expect(out).toContain("<table style=\"border-collapse: collapse;");
    expect(out).toMatch(/<th style="border: 1px solid #cdd1d7; padding: 6px 12px;[^"]*background-color: #f4f5f7;[^"]*text-align: left;">A<\/th>/);
    expect(out).toMatch(/<td style="[^"]*text-align: center;">2<\/td>/);
    expect(out).toMatch(/<td style="[^"]*text-align: right;">3<\/td>/);
  });

  it("renders blockquotes and rules", () => {
    expect(html("> quoted")).toContain('<blockquote style="margin: 0 0 10px 0; padding: 0 0 0 12px; border-left: 3px solid #cdd1d7; color: #3a3f47;">');
    expect(html("a\n\n---\n\nb")).toContain('<hr style="border: 0; border-top: 1px solid #cdd1d7;');
  });

  it("renders callouts as a tinted single-cell table", () => {
    const out = html("> [!warning] Mind the gap\n> Body **bold**");
    expect(out).toContain("border-left: 4px solid #c49200; background-color: #f9f4e6;");
    expect(out).toContain('font-weight: 600; color: #805c00;">Mind the gap</p>');
    expect(out).toContain("Body <strong>bold</strong>");
    expect(html("> [!tip]\n> x")).toContain(">Tip</p>");
    expect(html("> [!whatever]\n> x")).toContain("border-left: 4px solid #1f6fbf;"); // unknown → blue
  });

  it("escapes code blocks and keeps them pre-wrapped", () => {
    const out = html("```html\n<a href=\"x\">&amp;</a>\n```");
    expect(out).toContain("&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;</pre>");
    expect(out).toMatch(/<pre style="font-family: Consolas, 'Cascadia Mono', monospace;[^"]*background-color: #f4f5f7; border: 1px solid #e3e5e9;[^"]*padding: 12px;[^"]*white-space: pre-wrap;">/);
    expect(html("`a < b & c`")).toContain(">a &lt; b &amp; c</code>");
  });

  it("uses the highlighter for code when given one", () => {
    const highlight = vi.fn(() => '<span style="color: #8a3fbf;">const</span>');
    expect(html("```js\nconst\n```", { highlight })).toContain('<pre style="');
    expect(highlight).toHaveBeenCalledWith("const", "js");
    expect(html("```js\nconst\n```", { highlight })).toContain('<span style="color: #8a3fbf;">const</span></pre>');
  });
});

describe("markdownToHtml: Holocron syntax", () => {
  it("highlights with an inline background", () => {
    expect(html("a ==marked== b")).toContain('<mark style="background-color: #fff3a3; color: inherit;">marked</mark>');
    expect(html("a === b")).not.toContain("<mark");
  });

  it("shows wikilinks as their label in plain text", () => {
    expect(bare("[[Note]] [[Note|Alias]] [[Note#Heading]] [[#Local]]")).toBe("<div><p>Note Alias Note#Heading Local</p></div>");
    expect(bare("| a |\n| - |\n| [[T\\|label]] |")).toContain("<td>label</td>");
  });

  it("shows note embeds as their title and media as a file line", () => {
    expect(bare("![[Some Note#Part]]")).toContain("<em>Some Note › Part</em>");
    expect(bare("![[clip.mp4]] ![[song.mp3]] ![[paper.pdf]]")).toContain("▶ clip.mp4 🎵 song.mp3 📄 paper.pdf");
  });

  it("keeps tags as plain text", () => {
    expect(bare("#tag and #a/b")).toBe("<div><p>#tag and #a/b</p></div>");
  });

  it("numbers footnotes and lists their definitions at the end", () => {
    const out = bare("One[^a] two[^b] again[^a] missing[^zz].\n\n[^b]: Bee.\n[^a]: Ay *it*.");
    // Numbered by first reference, like live preview (even without a definition).
    expect(out).toContain("One<sup>1</sup> two<sup>2</sup> again<sup>1</sup> missing<sup>3</sup>.");
    expect(bare("x[^q]", { context: "other" })).toContain("x<sup>?</sup>");
    expect(out).toContain("<p>1. Ay <em>it</em>.</p><p>2. Bee.</p>");
    expect(out).not.toContain("[^b]:");
  });

  it("takes footnote numbers and definitions from the whole note", () => {
    const context = "First[^x] then[^y].\n\n[^x]: Ex.\n[^y]: Why.";
    const out = bare("then[^y].", { context });
    expect(out).toContain("then<sup>2</sup>.");
    expect(out).toContain("2. Why.");
    expect(out).not.toContain("Ex.");
  });

  it("removes comments, frontmatter and block ids", () => {
    const out = bare("---\ntitle: x\ntags: [a]\n---\nVisible %%hidden%% text ^block1\n%%\nwhole\n%%\n<!-- html comment -->\nend");
    expect(out).not.toMatch(/hidden|whole|title|html comment|block1/);
    expect(out).toContain("Visible");
    expect(out).toContain("end");
    expect(bare("---\nkeep: me\n---", { stripFrontmatter: false })).toContain("keep: me");
    expect(prepareMarkdown("```\n%% kept %%\n```")).toContain("%% kept %%");
  });

  it("shows math as its TeX source in monospace", () => {
    const out = html("Inline $x^2 < y$ and\n$$\n\\int_0^1 f\n$$");
    expect(out).toContain(">x^2 &lt; y</code>");
    expect(out).toMatch(/<p style="font-family: Consolas[^"]*text-align: center;[^"]*">\\int_0\^1 f<\/p>/);
    expect(bare("costs $5 and $10")).toBe("<div><p>costs $5 and $10</p></div>");
    expect(bare("$$E=mc^2$$")).toContain(">E=mc^2</p>");
  });

  it("turns emoji shortcodes into emoji", () => {
    expect(bare("Ship it :rocket: :+1:")).toBe("<div><p>Ship it 🚀 👍</p></div>");
    expect(emojify("10:30:00 :notanemoji: :smile::rocket:")).toBe("10:30:00 :notanemoji: 😄🚀");
    expect(bare("`:rocket:`")).toContain(":rocket:");
  });

  it("links only to web and mail addresses", () => {
    const out = html("[web](https://example.com) [mail](mailto:a@b.c) [note](Other.md) https://bare.example");
    expect(out).toContain('<a href="https://example.com" style="color: #1f6fbf; text-decoration: underline;">web</a>');
    expect(out).toContain('<a href="mailto:a@b.c"');
    expect(out).toContain(" note ");
    expect(out).not.toContain("Other.md");
    expect(out).toContain('<a href="https://bare.example"');
  });
});

describe("markdownToHtml: images and diagrams", () => {
  const png = { src: "data:image/png;base64,AAAA", width: 400, height: 200 };

  it("uses resolved images and placeholders for the rest", () => {
    const images = { [imageKey("embed", "photo.png")]: png, [imageKey("relative", "img/a b.png")]: png };
    const out = html("![[photo.png|200]] ![alt](img/a%20b.png) ![[missing.png]] ![remote](https://x.test/r.png)", { images });
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="photo.png" width="200" height="100" style="max-width: 100%; height: auto;">');
    expect(out).toContain('alt="alt" width="400" height="200"');
    expect(out).toContain("[Image: missing.png]");
    expect(out).toContain('<img src="https://x.test/r.png" alt="remote"');
  });

  it("renders Mermaid blocks as images once drawn", () => {
    const code = "flowchart LR\n  A --> B";
    const markdown = `\`\`\`mermaid\n${code}\n\`\`\``;
    expect(html(markdown)).toContain("[Diagram]");
    expect(html(markdown, { diagrams: { [code]: png } })).toContain('<img src="data:image/png;base64,AAAA" alt="Diagram" width="400" height="200"');
  });

  it("collects what needs loading", () => {
    const resources = collectResources("![[a.png]] ![x](sub/b%20c.png) ![y](https://r/x.png)\n\n<img src=\"raw.gif\">\n\n```mermaid\ngraph TD\n```\n\n```python\nx\n```\n\n![[clip.mp4]]");
    expect(resources.images.map((i: { key: string }) => i.key)).toEqual(["embed:a.png", "relative:sub/b c.png", "relative:raw.gif"]);
    expect(resources.diagrams).toEqual(["graph TD"]);
    expect(resources.languages).toEqual(["python"]);
  });
});

describe("markdownToHtml: raw HTML and styling", () => {
  it("escapes raw HTML without a sanitiser", () => {
    expect(html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')).not.toMatch(/<script|<img/);
  });

  it("passes the whole result through the sanitiser", () => {
    const sanitize = vi.fn((input: string) => input.replace(/<script[\s\S]*?<\/script>/g, "").replace(/ onerror="[^"]*"/g, ""));
    const out = html('Hi <span style="color: red">red</span>\n\n<script>alert(1)</script>\n\n<img src="https://x/y.png" onerror="alert(1)">', { sanitize });
    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(sanitize.mock.calls[0][0]).toContain('<span style="color: red">red</span>');
    expect(out).not.toMatch(/<script|onerror/);
  });

  it("uses inline styles only: no classes, no <style>, no dark colours", () => {
    const markdown = "# H\n\n**b** ==m== `c` [l](https://x)\n\n- [ ] t\n\n| a |\n| - |\n| b |\n\n> [!note]\n> c\n\n> q\n\n```js\nx\n```\n\n$$x$$\n\nr[^1]\n\n[^1]: n";
    const out = html(markdown);
    expect(out).not.toMatch(/class=|<style|<input/);
    // Dark-theme colours (§16.1/§16.6) never appear.
    expect(out.toLowerCase()).not.toMatch(/#(?:15181e|1e222a|161a20|d8dbe0|c792ea|a5d6a7|82aaff|5ab4ff)/);
    for (const tag of ["h1", "p", "mark", "code", "a", "ul", "table", "th", "td", "blockquote", "pre"]) {
      expect(out).toMatch(new RegExp(`<${tag} [^>]*style="`));
    }
    expect(out.startsWith("<div>")).toBe(true);
  });
});
