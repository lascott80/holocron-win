import { describe, expect, it } from "vitest";
import { noteText, renderTemplate } from "@core/templates";

const date = new Date(2026, 9, 5, 9, 15);

describe("renderTemplate", () => {
  it("separates frontmatter and fills placeholders", () => {
    const template = "---\ntype: meeting\ncreated: {{date}}\n---\n# {{title}}\n\n{{cursor}}\n";
    const rendered = renderTemplate(template, "Council", "YYYY-MM-DD", date);
    expect(rendered.frontmatter).toBe("type: meeting\ncreated: 2026-10-05");
    expect(rendered.body).toBe("# Council\n\n{{cursor}}\n");
  });

  it("handles templates without frontmatter", () => {
    const rendered = renderTemplate("Hello {{title}}", "There", "YYYY-MM-DD", date);
    expect(rendered).toEqual({ frontmatter: null, body: "Hello There" });
  });

  it("removes only one leading newline from the body", () => {
    expect(renderTemplate("---\na: 1\n---\n\n\nBody", "x", "", date)).toEqual({ frontmatter: "a: 1", body: "\nBody" });
  });

  it("accepts ... as the closing line and ignores empty or unclosed frontmatter", () => {
    expect(renderTemplate("---\na: 1\n...\nBody", "x", "", date)).toEqual({ frontmatter: "a: 1", body: "Body" });
    expect(renderTemplate("---\n---\nBody", "x", "", date)).toEqual({ frontmatter: null, body: "Body" });
    expect(renderTemplate("---\na: 1\nBody", "x", "", date)).toEqual({ frontmatter: null, body: "---\na: 1\nBody" });
  });

  it("defaults to now", () => {
    const rendered = renderTemplate("{{date:YYYY}}", "x", "");
    expect(rendered.body).toBe(String(new Date().getFullYear()));
  });
});

describe("noteText", () => {
  it("places the cursor", () => {
    const { text, cursor } = noteText({ frontmatter: "type: meeting", body: "# Council\n\n{{cursor}}\n" });
    expect(text).toBe("---\ntype: meeting\n---\n# Council\n\n\n");
    expect(cursor).toBe("---\ntype: meeting\n---\n# Council\n\n".length);

    expect(noteText({ frontmatter: null, body: "Notes" })).toEqual({ text: "Notes", cursor: 5 });
  });

  it("uses the first marker, removes all of them and counts UTF-16 units", () => {
    expect(noteText({ frontmatter: null, body: "🪐 a{{cursor}}b{{cursor}}" })).toEqual({ text: "🪐 ab", cursor: 4 });
  });
});
