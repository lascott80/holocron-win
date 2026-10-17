import { describe, expect, test } from "vitest";
import { AttachmentLookup } from "@core/attachments";
import {
  attachmentRefs,
  attachmentTargets,
  attachmentUsage,
  attachmentsOnlyUsedBy,
  brokenLinks,
  NameMentions,
  noteAttachmentFolder,
  planHolding,
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
const sorted = (set: Set<string>) => [...set].sort();

describe("Attachment references", () => {
  test("finds embeds, wikilinks and markdown links", () => {
    const text = [
      "![[crystal.png|300]]",
      "See [[map.pdf#page=2]].",
      "![logo](../Attachments/logo.png)",
      "![](beside.jpg)",
      "[[Other note]] and [x](Other.md) are notes.",
    ].join("\n");
    expect(sorted(attachmentRefs(text, "Lore/Kyber.md", lookup))).toEqual([
      "Attachments/crystal.png",
      "Attachments/logo.png",
      "Attachments/map.pdf",
      "Lore/beside.jpg",
    ]);
  });

  test("finds HTML, reference definitions and property values", () => {
    const text = [
      "---",
      "cover: crystal.png",
      "files:",
      '  - "Attachments/map.pdf"',
      "title: Kyber",
      "---",
      '<img src="../Attachments/logo.png" width="200">',
      "<video poster='beside.jpg'></video>",
      "[stray]: <../Attachments/stray.png>",
      "[^1]: a footnote, not a link",
    ].join("\n");
    expect(sorted(attachmentRefs(text, "Lore/Kyber.md", lookup))).toEqual([
      "Attachments/crystal.png",
      "Attachments/logo.png",
      "Attachments/map.pdf",
      "Attachments/stray.png",
      "Lore/beside.jpg",
    ]);
  });

  test("ignores links in code and URLs", () => {
    const text = '```\n![[crystal.png]]\n<img src="logo.png">\n```\n`![[map.pdf]]`\n![](https://example.com/logo.png)\n<img src="data:image/png;base64,AA">';
    expect(attachmentRefs(text, "Kyber.md", lookup).size).toBe(0);
  });

  test("lists targets in order, null where a link doesn't resolve", () => {
    expect(attachmentTargets("![[logo.png]] ![[gone.png]] [[Note]] ![](crystal.png)", "Kyber.md", lookup)).toEqual([
      "Attachments/logo.png",
      null,
      "Attachments/crystal.png",
    ]);
  });
});

describe("Name mentions", () => {
  const names = new NameMentions(["Attachments/logo.png", "Attachments/Pasted image 1.png", "Attachments/map.pdf"]);

  test("finds file names anywhere, plain or percent-encoded", () => {
    expect(sorted(names.find("```\nsee logo.png\n```\n<IMG SRC=Pasted%20image%201.png>"))).toEqual([
      "Attachments/Pasted image 1.png",
      "Attachments/logo.png",
    ]);
  });

  test("doesn't match the tail of a longer name", () => {
    expect(names.find("mylogo.png and mapx.pdf").size).toBe(0);
  });
});

describe("Usage", () => {
  test("usage, unused files and files only some notes use", () => {
    const usage = attachmentUsage(
      [
        ["Lore/Kyber.md", "![[crystal.png]] ![[logo.png]]"],
        ["Ilum.md", "![[logo.png]] [[map.pdf]]"],
      ],
      attachments,
    );
    expect(sorted(usage.users.get("Attachments/logo.png")!)).toEqual(["Ilum.md", "Lore/Kyber.md"]);
    expect(unusedAttachments(usage)).toEqual(["Attachments/stray.png", "Lore/beside.jpg"]);
    expect(attachmentsOnlyUsedBy(usage, (note) => note === "Lore/Kyber.md")).toEqual(["Attachments/crystal.png"]);
  });

  test("a mention elsewhere keeps a file from going with its note", () => {
    const usage = attachmentUsage(
      [
        ["Lore/Kyber.md", "![[crystal.png]]"],
        ["Ilum.md", "Remember crystal.png from the cave."],
      ],
      attachments,
    );
    expect([...usage.mentions.get("Attachments/crystal.png")!]).toEqual(["Ilum.md"]);
    expect(attachmentsOnlyUsedBy(usage, (note) => note === "Lore/Kyber.md")).toEqual([]);
  });
});

describe("Organising", () => {
  test("a note's folder mirrors its path", () => {
    expect(noteAttachmentFolder("Attachments", "Lore/Kyber.md")).toBe("Attachments/Lore/Kyber");
    expect(noteAttachmentFolder("", "Kyber.md")).toBe("Kyber");
  });

  test("files go to their note's folder, shared ones to Shared, mentioned ones are skipped", () => {
    const usage = attachmentUsage(
      [
        ["Lore/Kyber.md", "![[crystal.png]] ![[logo.png]] ![[beside.jpg]]"],
        ["Ilum.md", "![[logo.png]] [[map.pdf]]"],
        ["Notes.md", "the map.pdf is old"],
      ],
      attachments,
    );
    expect(planOrganise(usage, "Attachments", attachments)).toEqual({
      moves: [
        { from: "Attachments/crystal.png", to: "Attachments/Lore/Kyber/crystal.png" },
        { from: "Attachments/logo.png", to: "Attachments/Shared/logo.png" },
      ],
      skipped: [{ path: "Attachments/map.pdf", notes: ["Notes.md"] }],
    });
    expect(planOrganise(usage, "Attachments", attachments, "Ilum.md").moves).toEqual([
      { from: "Attachments/logo.png", to: "Attachments/Shared/logo.png" },
    ]);
  });

  test("leaves files already in place, numbers clashes, rescues used files from _Unused", () => {
    const files = ["Attachments/Kyber/a.png", "Attachments/a.png", "Attachments/Kyber/b.png", "Attachments/_Unused/2026-10-01/c.png"];
    const usage = attachmentUsage([["Kyber.md", "![[Attachments/Kyber/a.png]] ![[Attachments/a.png]] ![[b.png]] ![[c.png]]"]], files);
    expect(planOrganise(usage, "Attachments", files).moves).toEqual([
      { from: "Attachments/_Unused/2026-10-01/c.png", to: "Attachments/Kyber/c.png" },
      { from: "Attachments/a.png", to: "Attachments/Kyber/a 2.png" },
    ]);
  });

  test("holding keeps each file's place under a dated folder", () => {
    expect(
      planHolding(["Attachments/Old/a.png", "Attachments/b.png"], "Attachments", "2026-10-17", ["Attachments/_Unused/2026-10-17/b.png"]),
    ).toEqual([
      { from: "Attachments/Old/a.png", to: "Attachments/_Unused/2026-10-17/Old/a.png" },
      { from: "Attachments/b.png", to: "Attachments/_Unused/2026-10-17/b 2.png" },
    ]);
  });
});

describe("Rewriting attachment links", () => {
  const before = new AttachmentLookup(["Attachments/crystal.png", "Attachments/logo.png"]);
  const after = new AttachmentLookup(["Attachments/Kyber/crystal.png", "Attachments/logo.png", "Other/crystal.png"]);
  const moves = new Map([["Attachments/crystal.png", "Attachments/Kyber/crystal.png"]]);
  const same = { oldNote: "Kyber.md", newNote: "Kyber.md", before, after, moves };

  test("updates links to moved files and leaves the rest", () => {
    const text = "![[crystal.png|200]]\n![[logo.png]]\n![c](Attachments/crystal.png)\n![c](/Attachments/crystal.png)";
    expect(rewriteAttachmentLinks(text, same)).toBe(
      "![[Attachments/Kyber/crystal.png|200]]\n![[logo.png]]\n![c](Attachments/Kyber/crystal.png)\n![c](/Attachments/Kyber/crystal.png)",
    );
  });

  test("updates HTML, reference definitions and property values", () => {
    const text = '---\ncover: Attachments/crystal.png\n---\n<img src="Attachments/crystal.png" alt="x">\n[c]: Attachments/crystal.png "Crystal"';
    expect(rewriteAttachmentLinks(text, same)).toBe(
      '---\ncover: Attachments/Kyber/crystal.png\n---\n<img src="Attachments/Kyber/crystal.png" alt="x">\n[c]: Attachments/Kyber/crystal.png "Crystal"',
    );
  });

  test("keeps bare names that still resolve", () => {
    const solo = new AttachmentLookup(["Attachments/Kyber/crystal.png"]);
    const text = "![[crystal.png]]";
    expect(rewriteAttachmentLinks(text, { ...same, after: solo })).toBe(text);
  });

  test("re-relativises markdown links when the note moves", () => {
    const files = new AttachmentLookup(["Attachments/logo.png"]);
    const text = "![](../Attachments/logo.png)";
    expect(
      rewriteAttachmentLinks(text, { oldNote: "Lore/Kyber.md", newNote: "Lore/Deep/Kyber.md", before: files, after: files, moves: new Map() }),
    ).toBe("![](../../Attachments/logo.png)");
  });

  test("brokenLinks spots links that no longer reach the moved file", () => {
    const text = "![[crystal.png]] ![[logo.png]]";
    const rewritten = rewriteAttachmentLinks(text, same);
    expect(brokenLinks([{ oldNote: "Kyber.md", newNote: "Kyber.md", before: text, after: rewritten }], before, after, moves)).toEqual([]);
    // Not rewritten: the bare name now finds the other crystal.png.
    expect(brokenLinks([{ oldNote: "Kyber.md", newNote: "Kyber.md", before: text, after: text }], before, after, moves)).toEqual(["Kyber.md"]);
  });
});
