import { describe, expect, test } from "vitest";
import { LinkResolver, parse, plainText } from "@core/noteParser";

describe("NoteParser", () => {
  const sample = [
    "---",
    "tags: [lore, crystals]",
    "aliases:",
    "  - Kyber",
    '  - "Living crystal"',
    "---",
    "",
    "# Kyber Crystal Notes",
    "",
    "Gathered on [[Ilum]] — see [[Lightsaber Construction|the checklist]] and [[Ilum#Caves]].",
    "Also [the log](Crystal%20Log.md) and [web](https://example.com/a.md). Tagged #mentor, #lore again.",
    "",
    "## Attunement **steps** ##",
    "",
    "```swift",
    "// [[Not a link]] #notatag",
    "# Not a heading",
    "```",
    "",
    "Inline `[[code link]] #codetag` is ignored. Issue #42 isn't a tag but #2026/q4 is.",
    "![[diagram.png]] and ![image](pic.md)",
  ].join("\n");

  test("parses frontmatter", () => {
    const info = parse(sample);
    expect(info.aliases).toEqual(["Kyber", "Living crystal"]);
    expect(info.tags.slice(0, 2)).toEqual(["lore", "crystals"]);
  });

  test("parses headings outside code", () => {
    const info = parse(sample);
    expect(info.headings.map((h) => h.text)).toEqual(["Kyber Crystal Notes", "Attunement steps"]);
    expect(info.headings.map((h) => h.level)).toEqual([1, 2]);
    expect(info.headings[0].line).toBe(8);
  });

  test("parses links outside code", () => {
    const info = parse(sample);
    expect(info.links.map((l) => l.target)).toEqual(["Ilum", "Lightsaber Construction", "Ilum#Caves", "Crystal Log.md", "diagram.png"]);
    expect(info.links.map((l) => l.kind)).toEqual(["wiki", "wiki", "wiki", "markdown", "wiki"]);
    expect(info.links[0].line).toBe(10);
    expect(info.links[0].context.startsWith("Gathered on [[Ilum]]")).toBe(true);
  });

  test("parses tags outside code", () => {
    expect(parse(sample).tags).toEqual(["lore", "crystals", "mentor", "2026/q4"]);
  });

  test("plain text strips inline markdown", () => {
    expect(plainText("**Bold** [[Ilum|planet]] and [link](x.md) `code`")).toBe("Bold planet and link code");
  });

  test("CRLF notes parse like LF notes", () => {
    const info = parse(sample.replace(/\n/g, "\r\n"));
    expect(info.aliases).toEqual(["Kyber", "Living crystal"]);
    expect(info.headings.map((h) => h.text)).toEqual(["Kyber Crystal Notes", "Attunement steps"]);
    expect(info.tags).toEqual(["lore", "crystals", "mentor", "2026/q4"]);
    expect(info.links[0].context.endsWith("\r")).toBe(false);
  });

  test("wikilink targets keep fragments", () => {
    const info = parse("[[Note#^id]] [[#Heading]] [[ Ilum |x]] [[]]\n");
    expect(info.links.map((l) => l.target)).toEqual(["Note#^id", "#Heading", "Ilum"]);
  });

  test("counts words outside code and frontmatter", () => {
    expect(parse("---\ntags: a\n---\n# Title here\n```\nnot counted\n```\none two\n").wordCount).toBe(5);
  });
});

describe("LinkResolver", () => {
  const resolver = new LinkResolver([
    "Ilum.md",
    "Lore/Crystals/Ilum.md",
    "Lore/Crystals/Kyber Crystal Notes.md",
    "Lore/Crystals/Crystal Log.md",
    "Specs/v1.2 notes.markdown",
  ]);

  test("resolves wiki links", () => {
    expect(resolver.resolveWiki("ilum")).toBe("Ilum.md");
    expect(resolver.resolveWiki("Lore/Crystals/Ilum")).toBe("Lore/Crystals/Ilum.md");
    expect(resolver.resolveWiki("Kyber Crystal Notes#Attunement")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(resolver.resolveWiki("v1.2 notes")).toBe("Specs/v1.2 notes.markdown");
    expect(resolver.resolveWiki("#Heading only")).toBeNull();
    expect(resolver.resolveWiki("Dagobah")).toBeNull();
  });

  test("resolves .markdown notes by path (REQUIREMENTS §19 #8)", () => {
    expect(resolver.resolveWiki("Specs/v1.2 notes")).toBe("Specs/v1.2 notes.markdown");
    expect(resolver.resolveWiki("/specs/V1.2 Notes")).toBe("Specs/v1.2 notes.markdown");
    expect(resolver.resolveWiki("Specs/v1.2 notes.markdown")).toBe("Specs/v1.2 notes.markdown");
  });

  test("resolves relative markdown links", () => {
    const source = "Lore/Crystals/Kyber Crystal Notes.md";
    expect(resolver.resolveMarkdown("Crystal Log.md", source)).toBe("Lore/Crystals/Crystal Log.md");
    expect(resolver.resolveMarkdown("../../Ilum.md", source)).toBe("Ilum.md");
    expect(resolver.resolveMarkdown("./Ilum.md#Caves", source)).toBe("Lore/Crystals/Ilum.md");
    expect(resolver.resolveMarkdown("/Ilum.md", source)).toBe("Ilum.md");
    expect(resolver.resolveMarkdown("Missing.md", source)).toBeNull();
  });
});

// The pure parts of LinkTests.swift (resolution through Vault.resolveLink).
describe("Link resolution", () => {
  const resolver = new LinkResolver([
    "Ilum.md",
    "Lore/Crystals/Kyber Crystal Notes.md",
    "Lore/Crystals/Ilum.md",
    "Daily/2026-10-05.md",
    "Specs/v1.2 notes.markdown",
  ]);

  test("resolves bare names ignoring case", () => {
    expect(resolver.resolveWiki("kyber crystal notes")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(resolver.resolveWiki("2026-10-05")).toBe("Daily/2026-10-05.md");
  });

  test("prefers the note nearest the root", () => {
    expect(resolver.resolveWiki("Ilum")).toBe("Ilum.md");
  });

  test("resolves paths, headings and extensions", () => {
    expect(resolver.resolveWiki("Lore/Crystals/Ilum")).toBe("Lore/Crystals/Ilum.md");
    expect(resolver.resolveWiki("Kyber Crystal Notes#Attunement")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(resolver.resolveWiki("Kyber Crystal Notes^abc123")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(resolver.resolveWiki("Ilum.md")).not.toBeNull();
    expect(resolver.resolveWiki("v1.2 notes")).toBe("Specs/v1.2 notes.markdown");
  });

  test("unknown targets do not resolve", () => {
    expect(resolver.resolveWiki("Dagobah")).toBeNull();
    expect(resolver.resolveWiki("Nowhere/Ilum")).toBeNull();
  });

  test("linkPath drops fragments and whitespace", () => {
    expect(LinkResolver.linkPath(" Ilum #Caves")).toBe("Ilum");
    expect(LinkResolver.linkPath("Kyber^abc")).toBe("Kyber");
    expect(LinkResolver.linkPath("#Heading")).toBe("");
  });

  test("resolve dispatches on the link kind", () => {
    expect(resolver.resolve({ target: "Ilum", kind: "wiki" }, "Lore/Crystals/Kyber Crystal Notes.md")).toBe("Ilum.md");
    expect(resolver.resolve({ target: "Ilum.md", kind: "markdown" }, "Lore/Crystals/Kyber Crystal Notes.md")).toBe("Lore/Crystals/Ilum.md");
  });
});

describe("Property parsing", () => {
  test("reads every frontmatter field", () => {
    const info = parse(
      [
        "---",
        "tags: [lore, crystals]",
        "created: 2026-09-28",
        'source: "[[Ilum]]"',
        "attuned: true",
        "mentors:",
        "  - Master Ilia",
        "  - 'Kael Voss'",
        "status:",
        "location:",
        "  planet: Ilum",
        "  region: north",
        "---",
        "# Body",
      ].join("\n"),
    );
    expect(info.properties.map((p) => p.key)).toEqual(["tags", "created", "source", "attuned", "mentors", "status", "location"]);
    expect(info.properties[0].values).toEqual(["lore", "crystals"]);
    expect(info.properties[2].values).toEqual(["[[Ilum]]"]);
    expect(info.properties[3].values).toEqual(["true"]);
    expect(info.properties[4].values).toEqual(["Master Ilia", "Kael Voss"]);
    expect(info.properties[5].values).toEqual([]);
    expect(info.properties[6].values).toEqual(["planet: Ilum, region: north"]);
  });

  test("notes without frontmatter have no properties", () => {
    expect(parse("# Just a note\n").properties).toEqual([]);
    expect(parse("---\nnot closed\n").properties).toEqual([]);
  });
});

describe("Angle bracket links", () => {
  test("parses markdown links with spaces in angle brackets", () => {
    const info = parse('See [the log](<Crystal Log.md>) and [x](Ilum.md "Planet").\n');
    expect(info.links.map((l) => l.target)).toEqual(["Crystal Log.md", "Ilum.md"]);
  });
});

describe("HTML attributes", () => {
  test("a # inside an HTML tag isn't a tag, but one beside it is", () => {
    const info = parse('<span style="color: #e5534b">red</span> #real\n<font color= #00ff00>x</font>');
    expect(info.tags).toEqual(["real"]);
  });
});