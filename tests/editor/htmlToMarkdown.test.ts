import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { analyzeHtml, escapeMarkdownText, fileUrlToPath, htmlToMarkdown, imageKind, safeHref } from "../../src/editor/htmlToMarkdown.js";

// The app parses with the browser's DOMParser; in node, Turndown's own HTML parser.
const domino = createRequire(import.meta.url)("@mixmark-io/domino");
const parse = (html: string) => domino.createDocument(html);
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const md = (html: string, options: Record<string, unknown> = {}) => htmlToMarkdown(html, { parse, ...options });

describe("htmlToMarkdown: Word", () => {
  const out = md(fixture("word.html"));

  it("drops Word's head, XML, styles and <o:p>", () => {
    expect(out).not.toMatch(/mso|o:p|WordDocument|Font Definitions|StartFragment/);
    expect(out.startsWith("# Project Kyber status\n\nThe **new build** is *ready* for review.")).toBe(true);
  });

  it("keeps links with decoded ampersands", () => {
    expect(out).toContain("See [the build page](https://example.com/build?id=42&x=1).");
  });

  it("turns mso-list paragraphs into nested bullet lists", () => {
    expect(out).toContain("- First point\n  - A nested point with **bold**\n    - Deeper still\n- Second point");
  });

  it("turns numbered mso-list paragraphs into ordered lists", () => {
    expect(out).toContain("1. Plan the release\n   1. Draft notes\n2. Ship it");
  });

  it("makes a tidy table with the bold first row as its header", () => {
    expect(out).toContain("| Feature | Status        |\n| ------- | ------------- |\n| Paste   | *In progress* |");
  });

  it("converts highlights and strikethrough, and leaves paths and snake_case alone", () => {
    expect(out).toContain("==Highlighted== and ~~struck~~ text, with a path C:\\Users\\ana\\file_name.txt.");
  });
});

describe("htmlToMarkdown: Outlook", () => {
  const html = fixture("outlook.html");
  const image = "file:///C:/Users/ana/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png";

  it("finds the local picture (not the VML one) with its Windows path", () => {
    const { images } = analyzeHtml(html, { parse });
    expect(images).toEqual([{ src: image, kind: "file", path: "C:\\Users\\ana\\AppData\\Local\\Temp\\msohtmlclip1\\01\\clip_image002.png" }]);
  });

  it("uses the saved attachment's embed and unwraps Safe Links", () => {
    const out = md(html, { images: new Map([[image, "![[Pasted image 20260101120000.png]]"]]) });
    expect(out).toBe(
      "Hi team,\n\nHere is the screenshot from the **staging** run (details in [the report](https://example.com/report?id=7)):\n\n" +
        "![[Pasted image 20260101120000.png]]\n\nThanks,\n\n**Ana Lopez**\nRelease Manager",
    );
  });

  it("leaves a picture out if it couldn't be saved", () => {
    expect(md(html)).not.toContain("clip_image");
  });
});

describe("htmlToMarkdown: Teams", () => {
  const out = md(fixture("teams.html"));

  it("turns mentions into @Name", () => {
    expect(out).toContain("Hey @Ana Lopez, the deploy script fails with:");
    expect(out).toContain("Can you take a look? @Bo FYI");
  });

  it("keeps code blocks with their language and line breaks", () => {
    expect(out).toContain("```powershell\nnpm.cmd run build\nError: EPERM, operation not permitted\n```");
    expect(out).toContain("```javascript\nconst a = 1;\nconsole.log(a);\n```");
  });

  it("keeps lists and inline code, without zero-width characters", () => {
    expect(out).toContain("- Step one\n- Step `two`");
    expect(out).not.toMatch(/[\u200b\u00a0]/);
  });
});

describe("htmlToMarkdown: web pages", () => {
  const out = md(fixture("web.html"));

  it("drops scripts and styles", () => {
    expect(out).not.toMatch(/alert|hidden|display/);
  });

  it("keeps headings without anchor links", () => {
    expect(out.startsWith("## Installing the CLI\n\n")).toBe(true);
    expect(out).toContain("### Supported platforms");
  });

  it("keeps http links, drops javascript: and relative hrefs but keeps their text", () => {
    expect(out).toContain("check the [CLI docs](https://example.com/docs/cli?tab=win) or this page. Don't click this.");
    expect(out).not.toContain("javascript");
  });

  it("doesn't over-escape ordinary text", () => {
    expect(out).toContain("Use `holo --help` for options; files like my_file_name.md and 2 * 3 = 6 stay readable.");
  });

  it("takes the code language from a highlight-source wrapper", () => {
    expect(out).toContain('```python\ndef greet(name):\n    return f"Hello {name}"\n```');
  });

  it("makes an aligned table with escaped pipes", () => {
    expect(out).toContain(
      "| OS      | Status |  Version |\n| ------- | :----: | -------: |\n| Windows |   ✅   |       11 |\n| macOS   |  beta  | 14 \\| 15 |",
    );
  });

  it("keeps nested lists, task checkboxes, quotes, remote images, rules and mail links", () => {
    expect(out).toContain("- Fast\n- Small\n  - ~2 MB\n- [ ] Docs\n- [x] Tests");
    expect(out).toContain("> Note: **back up** first.");
    expect(out).toContain("![Architecture diagram](https://example.com/img/diagram.png)");
    expect(out).toContain("\n---\n");
    expect(out).toContain("See help@example.com.");
  });
});

describe("htmlToMarkdown: details", () => {
  it("drops javascript:, data: and file: links", () => {
    expect(md('<p><a href="javascript:alert(1)">a</a> <a href="data:text/html,x">b</a> <a href="file:///C:/x">c</a></p>')).toBe("a b c");
  });

  it("writes a link whose text is its URL as a bare URL", () => {
    expect(md('<p>Go to <a href="https://example.com/a_b">https://example.com/a_b</a></p>')).toBe("Go to https://example.com/a_b");
  });

  it("encodes spaces and parentheses in link destinations", () => {
    expect(md('<a href="https://example.com/a b(c)">x</a>')).toBe("[x](https://example.com/a%20b%28c%29)");
  });

  it("nests ordered and bullet lists", () => {
    expect(md("<ol><li>one<ul><li>a</li><li>b</li></ul></li><li>two</li></ol>")).toBe("1. one\n   - a\n   - b\n2. two");
  });

  it("keeps list items tight when they hold paragraphs", () => {
    expect(md("<ul><li><p>one</p></li><li><p>two</p></li></ul>")).toBe("- one\n- two");
  });

  it("makes task items from checkboxes and ☐/☑ characters", () => {
    expect(md('<ul><li><input type="checkbox"> a</li><li><input type="checkbox" checked> b</li></ul>')).toBe("- [ ] a\n- [x] b");
    expect(md("<ul><li>☐ open</li><li>☑ done</li></ul>")).toBe("- [ ] open\n- [x] done");
    expect(md("<p>☐ open</p><p>☑ done</p>")).toBe("- [ ] open\n- [x] done");
  });

  it("converts <mark> and yellow backgrounds to ==highlight==", () => {
    expect(md('<p><mark>a</mark> and <span style="background-color: rgb(255, 255, 0)">b</span> but not <span style="background-color: #ddeeff">c</span></p>')).toBe(
      "==a== and ==b== but not c",
    );
  });

  it("reads Google Docs' styled spans", () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Bold</span> <span style="font-style:italic">it</span> <span style="text-decoration:line-through">gone</span></p></b>';
    expect(md(html)).toBe("**Bold** *it* ~~gone~~");
  });

  it("merges formatting runs Word splits", () => {
    expect(md("<p><b>Hel</b><b>lo</b> <i>wor</i><i>ld</i></p>")).toBe("**Hello** *world*");
  });

  it("detects code languages from class names", () => {
    expect(md('<pre><code class="language-ts">let a = 1;</code></pre>')).toBe("```ts\nlet a = 1;\n```");
    expect(md('<pre class="lang-rust">fn main() {}</pre>')).toBe("```rust\nfn main() {}\n```");
    expect(md('<pre class="brush: sql;">select 1</pre>')).toBe("```sql\nselect 1\n```");
    expect(md('<pre><code class="language-plaintext">x</code></pre>')).toBe("```\nx\n```");
  });

  it("uses a longer fence when the code contains backticks", () => {
    expect(md("<pre>a ``` b</pre>")).toBe("````\na ``` b\n````");
  });

  it("turns line <div>s and <br> in code blocks into newlines", () => {
    expect(md("<pre><div>one</div><div>  two</div><div><br></div><div>four</div></pre>")).toBe("```\none\n  two\n\nfour\n```");
  });

  it("turns <br> into a line break and table cell breaks into <br>", () => {
    expect(md("<p>one<br>two</p>")).toBe("one\ntwo");
    expect(md("<table><tr><th>A</th><th>B</th></tr><tr><td>x<br>y</td><td>z</td></tr></table>")).toBe("| A      | B   |\n| ------ | --- |\n| x<br>y | z   |");
  });

  it("pads ragged tables and colspans", () => {
    expect(md('<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>')).toBe("| wide |     |\n| ---- | --- |\n| a    | b   |");
  });

  it("unwraps one-column layout tables (email templates)", () => {
    expect(md("<table><tr><td><p>Hello</p></td></tr><tr><td><p>World</p></td></tr></table>")).toBe("Hello\n\nWorld");
  });

  it("keeps sup, sub, kbd and u as inline HTML", () => {
    expect(md("<p>x<sup>2</sup> H<sub>2</sub>O <kbd>Ctrl</kbd> <u>u</u></p>")).toBe("x<sup>2</sup> H<sub>2</sub>O <kbd>Ctrl</kbd> <u>u</u>");
  });

  it("escapes what would become markdown, not ordinary punctuation", () => {
    expect(md("<p>* not a list</p>")).toBe("\\* not a list");
    expect(md("<p># not a heading</p>")).toBe("\\# not a heading");
    expect(md("<p>1. not a list</p>")).toBe("1\\. not a list");
    expect(md("<p>[[not a link]] and &lt;b&gt;text&lt;/b&gt;</p>")).toBe("\\[[not a link]] and \\<b>text\\</b>");
    expect(md("<p>a - b, 3.5 + 2, well-known, e.g. this. 50% off!</p>")).toBe("a - b, 3.5 + 2, well-known, e.g. this. 50% off!");
  });

  it("returns nothing for empty HTML", () => {
    expect(md("<p> </p>")).toBe("");
  });
});

describe("escapeMarkdownText", () => {
  it("escapes emphasis markers only where they could open or close", () => {
    expect(escapeMarkdownText("*bold* 2 * 3 snake_case _x_")).toBe("\\*bold\\* 2 * 3 snake_case \\_x\\_");
  });

  it("escapes backslashes only before punctuation", () => {
    expect(escapeMarkdownText("C:\\Users\\x \\*")).toBe("C:\\Users\\x \\\\\\*");
  });

  it("escapes ==highlight==, ~~strike~~ and backticks", () => {
    expect(escapeMarkdownText("==a== ~~b~~ `c` a == b")).toBe("\\=\\=a\\=\\= \\~\\~b\\~\\~ \\`c\\` a == b");
  });
});

describe("analyzeHtml", () => {
  it("marks trivially plain HTML", () => {
    expect(analyzeHtml("<p>Just text</p><div>more<br>lines</div>", { parse }).plain).toBe(true);
    expect(analyzeHtml("<html><body><p class=MsoNormal><span style='font-family:Calibri'>Hello</span><o:p></o:p></p></body></html>", { parse }).plain).toBe(true);
    expect(analyzeHtml("<p>Some <b>bold</b></p>", { parse }).plain).toBe(false);
    expect(analyzeHtml('<p><span style="font-weight:700">bold</span></p>', { parse }).plain).toBe(false);
    expect(analyzeHtml("<ul><li>x</li></ul>", { parse }).plain).toBe(false);
  });

  it("treats a code editor's coloured copy as plain (VS Code)", () => {
    const html =
      '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Consolas, \'Courier New\', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"><div><span style="color: #569cd6;">const</span><span style="color: #d4d4d4;"> a = </span><span style="color: #b5cea8;">1</span></div></div>';
    expect(analyzeHtml(html, { parse }).plain).toBe(true);
  });

  it("recognises Holocron's own rich copy", () => {
    expect(analyzeHtml(fixture("holocron.html"), { parse }).holocron).toBe(true);
    expect(analyzeHtml(fixture("web.html"), { parse }).holocron).toBe(false);
  });

  it("collects data: and file: pictures once each, not remote ones", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const { images, onlyImages } = analyzeHtml(
      `<p>x <img src="${png}"><img src="${png}"><img src="https://e.com/a.png"><img src="file:///C:/T/a%20b.jpg"><img src="file:///C:/T/notes.txt"></p>`,
      { parse },
    );
    expect(images).toEqual([
      { src: png, kind: "data", mime: "image/png", data: "iVBORw0KGgo=" },
      { src: "file:///C:/T/a%20b.jpg", kind: "file", path: "C:\\T\\a b.jpg" },
    ]);
    expect(onlyImages).toBe(false);
  });

  it("knows when the HTML is only a picture", () => {
    expect(analyzeHtml('<meta charset="utf-8"><img src="https://e.com/cat.png" alt="">', { parse }).onlyImages).toBe(true);
  });
});

describe("helpers", () => {
  it("fileUrlToPath", () => {
    expect(fileUrlToPath("file:///C:/Users/A%20B/clip_image001.png")).toBe("C:\\Users\\A B\\clip_image001.png");
    expect(fileUrlToPath("file://server/share/x.png")).toBe("\\\\server\\share\\x.png");
    expect(fileUrlToPath("file://localhost/C:/x.png")).toBe("C:\\x.png");
    expect(fileUrlToPath("C:\\temp\\x.png")).toBe("C:\\temp\\x.png");
    expect(fileUrlToPath("https://e.com/x.png")).toBeNull();
  });

  it("imageKind", () => {
    expect(imageKind("data:image/png;base64,AAAA")).toBe("data");
    expect(imageKind("file:///C:/x.png")).toBe("file");
    expect(imageKind("https://e.com/x.png")).toBe("remote");
    expect(imageKind("cid:image001.png@01D")).toBe("other");
  });

  it("safeHref", () => {
    expect(safeHref("https://e.com")).toBe("https://e.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref(" JavaScript:alert(1)")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
    expect(safeHref("#top")).toBeNull();
    expect(safeHref("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fx.org%2Fa&data=1")).toBe("https://x.org/a");
  });
});
