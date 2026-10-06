import { describe, expect, test } from "vitest";
import {
  attachmentPaths,
  isAttachmentTarget,
  linkText,
  normalize,
  pastedImageName,
  resolve,
} from "@core/attachments";

describe("Attachment resolution", () => {
  const paths = [
    "Attachments/diagram.png",
    "Lore/Crystals/kyber.jpg",
    "Lore/Crystals/img/close-up.png",
    "diagram.png",
    "Docs/report.pdf",
  ];

  test("resolves by name nearest the root", () => {
    expect(resolve("diagram.png", "Lore/Note.md", paths)).toBe("diagram.png");
    expect(resolve("KYBER.JPG", "Daily/x.md", paths)).toBe("Lore/Crystals/kyber.jpg");
    expect(resolve("report.pdf", "x.md", paths)).toBe("Docs/report.pdf");
  });

  test("resolves relative to the note first", () => {
    expect(resolve("img/close-up.png", "Lore/Crystals/Kyber.md", paths)).toBe("Lore/Crystals/img/close-up.png");
    expect(resolve("../../Attachments/diagram.png", "Lore/Crystals/Kyber.md", paths)).toBe("Attachments/diagram.png");
    expect(resolve("Attachments/diagram.png", "Lore/Crystals/Kyber.md", paths)).toBe("Attachments/diagram.png");
    expect(resolve("/diagram.png", "Lore/Crystals/Kyber.md", paths)).toBe("diagram.png");
  });

  test("normalises backslashes and fragments", () => {
    expect(resolve("img\\close-up.png#x", "Lore/Crystals/Kyber.md", paths)).toBe("Lore/Crystals/img/close-up.png");
    expect(resolve("missing.png", "x.md", paths)).toBeNull();
    expect(resolve("#only", "x.md", paths)).toBeNull();
  });

  test("never climbs out of the vault", () => {
    expect(normalize("../../../etc/passwd")).toBe("etc/passwd");
    expect(resolve("../../../etc/passwd", "a.md", paths)).toBeNull();
  });

  test("recognises attachment targets", () => {
    expect(isAttachmentTarget("photo.png")).toBe(true);
    expect(isAttachmentTarget("Docs/report.pdf#page=2")).toBe(true);
    expect(isAttachmentTarget("Kyber Crystal Notes")).toBe(false);
    expect(isAttachmentTarget("notes.md")).toBe(false);
    expect(isAttachmentTarget("v1.2 notes")).toBe(false); // "2 notes" isn't an extension
  });

  test("link text uses the name when unique", () => {
    expect(linkText("Lore/Crystals/kyber.jpg", paths)).toBe("![[kyber.jpg]]");
    expect(linkText("Attachments/diagram.png", paths)).toBe("![[Attachments/diagram.png]]");
    expect(linkText("Docs/report.pdf", paths)).toBe("[[report.pdf]]");
  });

  test("pasted image names", () => {
    const date = new Date(1_791_225_322 * 1000); // 2026-10-05 14:35:22 UTC
    const name = pastedImageName("image/png", date);
    expect(name.startsWith("Pasted image 2026100")).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
    expect(pastedImageName("image/jpeg").endsWith(".jpg")).toBe(true);
    expect(pastedImageName("application/x-unknown").endsWith(".png")).toBe(true);
    expect(pastedImageName("image/png", new Date(2026, 9, 5, 14, 3, 7))).toBe("Pasted image 20261005140307.png");
  });

  test("attachment paths skip notes and hidden files", () => {
    expect(attachmentPaths(["b.png", "Lore/Kyber.md", ".obsidian/x.json", "Lore/.DS_Store", "a.pdf", "x.MARKDOWN"])).toEqual([
      "a.pdf",
      "b.png",
    ]);
  });
});
