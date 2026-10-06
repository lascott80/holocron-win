import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Frontmatter, Highlight, Tag, WikiLink } from "../../src/editor/syntax.js";
import { findShortcodes, shortcodesIn } from "../../src/editor/emoji.js";
import { EMOJI } from "../../src/editor/emojiData.js";
import { emojiCompletions } from "../../src/editor/completions.js";
import { makeView } from "./helpers";

const names = (text: string) => findShortcodes(text).map((c: any) => c.name);

function inDoc(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter, WikiLink, Tag, Highlight] })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return shortcodesIn(state, 0, doc.length).map((c: any) => c.emoji);
}

describe("emoji data", () => {
  it("has the common GitHub set", () => {
    expect(Object.keys(EMOJI).length).toBeGreaterThan(800);
    expect(EMOJI.rocket).toBe("🚀");
    expect(EMOJI["+1"]).toBe("👍");
    expect(EMOJI.tada).toBe("🎉");
    expect(EMOJI.smile).toBe("😄");
  });
});

describe("findShortcodes", () => {
  it("finds known shortcodes with their range and emoji", () => {
    const text = "Ship it :rocket: :+1:";
    const found = findShortcodes(text);
    expect(found.map((c: any) => c.emoji)).toEqual(["🚀", "👍"]);
    expect(text.slice(found[0].from, found[0].to)).toBe(":rocket:");
  });

  it("ignores unknown names", () => {
    expect(names(":notanemoji: :Rocket:")).toEqual([]);
  });

  it("needs word boundaries, so times and URLs don't match", () => {
    expect(names("10:30:00")).toEqual([]);
    expect(names("at 1:100:2")).toEqual([]);
    expect(names("http://x:smile:")).toEqual([]);
    expect(names("a:smile:")).toEqual([]);
    expect(names(":smile:s")).toEqual([]);
    expect(names("(:smile:)")).toEqual(["smile"]);
    expect(names(":smile:.")).toEqual(["smile"]);
  });

  it("handles adjacent shortcodes", () => {
    expect(names(":smile::rocket:")).toEqual(["smile", "rocket"]);
    expect(names("::smile:")).toEqual([]);
  });
});

describe("shortcodesIn (with the syntax tree)", () => {
  it("skips code, frontmatter, URLs and wikilinks", () => {
    expect(inDoc("`:rocket:` and :tada:")).toEqual(["🎉"]);
    expect(inDoc("```\n:rocket:\n```\n:tada:")).toEqual(["🎉"]);
    expect(inDoc("---\nmood: :smile:\n---\n:tada:")).toEqual(["🎉"]);
    expect(inDoc("[[Note :rocket:]] and <https://x.com/:tada:>")).toEqual([]);
    expect(inDoc("[link](https://x.com/:rocket:) :tada:")).toEqual(["🎉"]);
  });
});

describe("emoji completion", () => {
  const complete = (doc: string) => emojiCompletions(new CompletionContext(makeView(doc, doc.length).state, doc.length, false));

  it("offers shortcodes after a colon and two characters", () => {
    const result: any = complete("Launch :ro");
    expect(result.from).toBe("Launch ".length);
    const rocket = result.options.find((o: any) => o.label === ":rocket:");
    expect(rocket.emoji).toBe("🚀");
    expect(rocket.apply ?? rocket.label).toBe(":rocket:"); // inserts the shortcode, not the emoji
    // Popular shortcodes rank above rarer ones with the same prefix.
    expect(rocket.boost).toBeGreaterThan(result.options.find((o: any) => o.label === ":rofl:").boost);
    expect(complete(":ta")).not.toBeNull();
  });

  it("stays quiet for one character, mid-word colons, times and code", () => {
    expect(complete("Launch :r")).toBeNull();
    expect(complete("Note:ro")).toBeNull();
    expect(complete("at 10:30")).toBeNull();
    expect(complete("```\n:ro")).toBeNull();
  });
});
