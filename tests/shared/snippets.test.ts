// CSS snippet sanitising and custom font stacks (src/shared/snippets.ts, REQUIREMENTS §16.11).

import { describe, expect, it } from "vitest";
import { compareSnippetNames, fontStack, isSnippetFile, sanitizeFontFamily, sanitizeSnippet, snippetsKey } from "../../src/shared/snippets";
import { defaultSettings, sanitizeSettings } from "../../src/shared/settings";

describe("sanitizeSnippet", () => {
  it("drops @import rules in every form", () => {
    const css = [
      '@import "https://fonts.example/x.css";',
      "@import url(https://evil.example/a.css) screen;",
      "@import url('b.css') layer(base) supports(display: grid);",
      ".cm-content { color: red; }",
    ].join("\n");
    const out = sanitizeSnippet(css);
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain(".cm-content { color: red; }");
  });

  it("neutralises remote and non-data url() references but keeps data: and local ones", () => {
    const css = [
      ".a { background: url(https://x.example/i.png); }",
      ".b { background: url('http://x.example/i.png'); }",
      '.c { background: url("//x.example/i.png"); }',
      ".d { background: url(file:///C:/Windows/x.png); }",
      ".e { background: url(data:image/png;base64,AAAA); }",
      "@font-face { font-family: X; src: local('Inter'), url(fonts/x.woff2); }",
    ].join("\n");
    const out = sanitizeSnippet(css);
    expect(out).not.toMatch(/https?:|file:|\/\/x\.example/);
    expect(out).toContain(".a { background: url(); }");
    expect(out).toContain(".d { background: url(); }");
    expect(out).toContain("url(data:image/png;base64,AAAA)");
    expect(out).toContain("url(fonts/x.woff2)");
    expect(out).toContain("local('Inter')");
  });

  it("leaves ordinary CSS alone", () => {
    const css = ":root { --hc-font-size: 18px; }\n.sidebar { width: 300px; }\n";
    expect(sanitizeSnippet(css)).toBe(css);
  });
});

describe("snippet files", () => {
  it("lists only .css files without a path, and orders them naturally", () => {
    expect(isSnippetFile("wide.css")).toBe(true);
    expect(isSnippetFile("Wide.CSS")).toBe(true);
    expect(isSnippetFile("notes.md")).toBe(false);
    expect(isSnippetFile(".hidden.css")).toBe(false);
    expect(isSnippetFile("sub/x.css")).toBe(false);
    expect(["b.css", "a10.css", "A2.css"].sort(compareSnippetNames)).toEqual(["A2.css", "a10.css", "b.css"]);
  });

  it("keys the enabled set by vault root", () => {
    expect(snippetsKey("C:\\Vaults\\Notes")).toBe("snippets:C:\\Vaults\\Notes");
  });
});

describe("custom fonts", () => {
  it("strips characters that could break out of a CSS value", () => {
    expect(sanitizeFontFamily("  Inter  ")).toBe("Inter");
    expect(sanitizeFontFamily("'Segoe UI'; color: red }")).toBe("Segoe UI color: red");
    expect(sanitizeFontFamily("A\nB")).toBe("A B");
    expect(sanitizeFontFamily(42)).toBe("");
    expect(sanitizeFontFamily("x".repeat(500))).toHaveLength(200);
  });

  it("builds a quoted stack with the fallback after the custom names", () => {
    expect(fontStack("", "system-ui, sans-serif")).toBe("system-ui, sans-serif");
    expect(fontStack("Inter", "system-ui, sans-serif")).toBe("'Inter', system-ui, sans-serif");
    expect(fontStack("Iosevka, Fira Code , ", "monospace")).toBe("'Iosevka', 'Fira Code', monospace");
  });

  it("is a setting: custom editor and reading fonts with their family names survive sanitising", () => {
    const settings = sanitizeSettings({ editorFont: "custom", editorFontFamily: " Inter ", readingFont: "custom", readingFontFamily: "Literata", uiFontFamily: "Bahnschrift" });
    expect(settings.editorFont).toBe("custom");
    expect(settings.editorFontFamily).toBe("Inter");
    expect(settings.readingFont).toBe("custom");
    expect(settings.readingFontFamily).toBe("Literata");
    expect(settings.uiFontFamily).toBe("Bahnschrift");
    expect(defaultSettings.editorFontFamily).toBe("");
    expect(defaultSettings.uiFontFamily).toBe("");
    expect(sanitizeSettings({ editorFont: "comic" }).editorFont).toBe("mono");
  });
});
