import { describe, expect, test } from "vitest";
import { AttachmentLookup } from "@core/attachments";
import {
  attachmentRefs,
  attachmentUsage,
  attachmentsOnlyUsedBy,
  noteAttachmentFolder,
  planOrganise,
  rewriteAttachmentLinks,
  unusedAttachments,
} from "@core/attachmentUsage";

const attachments = [
  "Attachments/crystal.png",
  "Attachments/map.pdf",
  "Attachments/logo.png",
  "Attachments/stray.png",
  "Lore/beside.jpg",
];
const lookup = new AttachmentLookup(attachments);

describe("Attachment references", () => {
  test("finds embeds, wikilinks and markdown links", () => {
    const text = [
      "![[crystal.png|300]]",
      "See [[map.pdf#page=2]].",
      "![logo](../Attachments/logo.png)",
      "![](beside.jpg)",
      "[[Other note]] and [x](Other.md) are notes.",
    ].join("\n");
    expect([...attachmentRefs(text, "Lore/Kyber.md", lookup)].sort()).toEqual([
      "Attachments/crystal.png",
      "Attachments/logo.png",
      "Attachments/map.pdf",
      "Lore/beside.jpg",
    ]);
  });

  test("ignores links in code and URLs", () => {
    const text = "```\n![[crystal.png]]\n```\n`![[map.pdf]]`\n![](https://example.com/logo.png)";
    expect(attachmentRefs(text, "Kyber.md", lookup).size).toBe(0);
  });

  test("usage, unused files and files only some notes use", () => {
    const usage = attachmentUsage(
      [
        ["Lore/Kyber.md", "![[crystal.png]] ![[logo.png]]"],
        ["Ilum.md", "![[logo.png]] [[map.pdf]]"],
      ],
      attachments,
    );
    expect([...usage.get("Attachments/logo.png")!].sort()).toEqual(["Ilum.md", "Lore/Kyber.md"]);
    expect(unusedAttachments(usage)).toEqual(["Attachments/stray.png", "Lore/beside.jpg"]);
    expect(attachmentsOnlyUsedBy(usage, (note) => note === "Lore/Kyber.md")).toEqual(["Attachments/crystal.png"]);
    expect(attachmentsOnlyUsedBy(usage, () => true).sort()).toEqual([
      "Attachments/crystal.png",
      "Attachments/logo.png",
      "Attachments/map.pdf",
    ]);
  });
});

describe("Organising", () => {
  test("a note's folder mirrors its path", () => {
    expect(noteAttachmentFolder("Attachments", "Lore/Kyber.md")).toBe("Attachments/Lore/Kyber");
    expect(noteAttachmentFolder("", "Kyber.md")).toBe("Kyber");
  });

  test("files go to their note's folder, shared ones to Shared", () => {
    const usage = attachmentUsage(
      [
        ["Lore/Kyber.md", "![[crystal.png]] ![[logo.png]] ![[beside.jpg]]"],
        ["Ilum.md", "![[logo.png]] [[map.pdf]]"],
      ],
      attachments,
    );
    expect(planOrganise(usage, "Attachments", attachments)).toEqual([
      { from: "Attachments/crystal.png", to: "Attachments/Lore/Kyber/crystal.png" },
      { from: "Attachments/logo.png", to: "Attachments/Shared/logo.png" },
      { from: "Attachments/map.pdf", to: "Attachments/Ilum/map.pdf" },
    ]);
  });

  test("leaves files already in place, and numbers clashes", () => {
    const files = ["Attachments/Kyber/a.png", "Attachments/a.png", "Attachments/Kyber/b.png"];
    const usage = attachmentUsage([["Kyber.md", "![[Attachments/Kyber/a.png]] ![[Attachments/a.png]] ![[b.png]]"]], files);
    expect(planOrganise(usage, "Attachments", files)).toEqual([
      { from: "Attachments/a.png", to: "Attachments/Kyber/a 2.png" },
    ]);
  });
});

describe("Rewriting attachment links", () => {
  const before = new AttachmentLookup(["Attachments/crystal.png", "Attachments/logo.png"]);
  const after = new AttachmentLookup(["Attachments/Kyber/crystal.png", "Attachments/logo.png", "Other/crystal.png"]);
  const moves = new Map([["Attachments/crystal.png", "Attachments/Kyber/crystal.png"]]);

  test("updates links to moved files and leaves the rest", () => {
    const text = "![[crystal.png|200]]\n![[logo.png]]\n![c](Attachments/crystal.png)\n![c](/Attachments/crystal.png)";
    expect(rewriteAttachmentLinks(text, { oldNote: "Kyber.md", newNote: "Kyber.md", before, after, moves })).toBe(
      "![[Attachments/Kyber/crystal.png|200]]\n![[logo.png]]\n![c](Attachments/Kyber/crystal.png)\n![c](/Attachments/Kyber/crystal.png)",
    );
  });

  test("keeps bare names that still resolve", () => {
    const solo = new AttachmentLookup(["Attachments/Kyber/crystal.png"]);
    const text = "![[crystal.png]]";
    expect(rewriteAttachmentLinks(text, { oldNote: "Kyber.md", newNote: "Kyber.md", before, after: solo, moves })).toBe(text);
  });

  test("re-relativises markdown links when the note moves", () => {
    const files = new AttachmentLookup(["Attachments/logo.png"]);
    const text = "![](../Attachments/logo.png)";
    expect(
      rewriteAttachmentLinks(text, { oldNote: "Lore/Kyber.md", newNote: "Lore/Deep/Kyber.md", before: files, after: files, moves: new Map() }),
    ).toBe("![](../../Attachments/logo.png)");
  });
});
