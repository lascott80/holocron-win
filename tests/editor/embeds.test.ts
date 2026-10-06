import { describe, expect, it } from "vitest";
import { embedSection, findEmbeds, parseEmbed } from "../../src/editor/embeds.js";
import { findImages, isImageEmbed } from "../../src/editor/images.js";

describe("parseEmbed / findEmbeds", () => {
  it("accepts note, heading and block embeds", () => {
    expect(parseEmbed("Note")).toEqual({ target: "Note", heading: null });
    expect(parseEmbed("Note#Intro")).toEqual({ target: "Note", heading: "#Intro" });
    expect(parseEmbed("Note#^abc-1")).toEqual({ target: "Note", heading: "#^abc-1" });
    expect(parseEmbed("Note#^abc|alias")).toEqual({ target: "Note", heading: "#^abc" });
    expect(parseEmbed("Folder/Note.md#Intro")).toEqual({ target: "Folder/Note.md", heading: "#Intro" });
  });
  it("accepts embeds of the open note itself", () => {
    expect(parseEmbed("#^abc")).toEqual({ target: "", heading: "#^abc" });
    expect(parseEmbed("#Intro")).toEqual({ target: "", heading: "#Intro" });
  });
  it("rejects images, attachments and empty targets", () => {
    expect(parseEmbed("photo.png")).toBeNull();
    expect(parseEmbed("file.pdf")).toBeNull();
    expect(parseEmbed("")).toBeNull();
    expect(parseEmbed("#")).toBeNull();
    expect(parseEmbed("#^")).toBeNull();
  });
  it("finds block embeds on a line (the old pattern rejected ^)", () => {
    const line = "See ![[Note#^abc]] and ![[#^def]] and ![[Other#Heading]]";
    expect(findEmbeds(line).map((e: any) => [e.target, e.heading, line.slice(e.from, e.to)])).toEqual([
      ["Note", "#^abc", "![[Note#^abc]]"],
      ["", "#^def", "![[#^def]]"],
      ["Other", "#Heading", "![[Other#Heading]]"],
    ]);
  });
});

describe("live preview only hides embeds that render", () => {
  // livePreview hides ![[inner]] iff isImageEmbed(inner) || parseEmbed(inner);
  // each of those must be picked up by images.js / embeds.js.
  const inners = [
    "Note", "Note#H", "Note#^id", "#^id", "#H", "img.png", "img.png|300", "img.png|300x200",
    "img.png|300x", "a#b.png", "img.png|alt", "file.pdf", "#", "Note|alias", "Note.md",
  ];
  for (const inner of inners) {
    it(inner, () => {
      const text = `![[${inner}]]`;
      const hidden = isImageEmbed(inner) || parseEmbed(inner) !== null;
      const rendered = findImages(text).length > 0 || findEmbeds(text).length > 0;
      expect(hidden).toBe(rendered);
    });
  }
});

describe("embedSection blocks (ED-21)", () => {
  const note = [
    "---", "tags: x", "---",
    "# Title",
    "First paragraph line one",
    "line two ^para",
    "",
    "- item one",
    "- item two ^item",
    "  - child",
    "",
    "> quoted",
    "> more",
    "",
    "^quote",
    "",
    "Above the id",
    "^own",
    "## Section",
    "Body",
  ].join("\n");

  it("returns the paragraph carrying the id, id removed", () => {
    expect(embedSection(note, "#^para")).toBe("First paragraph line one\nline two");
  });
  it("returns the list item carrying the id, id removed", () => {
    expect(embedSection(note, "#^item")).toBe("- item two");
  });
  it("an id alone on a line names the block above", () => {
    expect(embedSection(note, "#^own")).toBe("Above the id");
    expect(embedSection(note, "#^quote")).toBe("> quoted\n> more");
  });
  it("missing ids give null", () => {
    expect(embedSection(note, "#^nope")).toBeNull();
  });
  it("handles CRLF text", () => {
    expect(embedSection("para ^x\r\nnext", "#^x")).toBe("para");
  });
  it("heading sections still work", () => {
    expect(embedSection(note, "#Section")).toBe("## Section\nBody");
    expect(embedSection(note, "#Missing")).toBeNull();
  });
});
