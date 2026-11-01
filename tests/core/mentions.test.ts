import { describe, expect, test } from "vitest";
import { linkMentionOnLine } from "@core/mentions";

const names = ["Kyber Crystal Notes", "Kyber"];

describe("Linking a mention (LNK-15)", () => {
  test("the first whole-word occurrence on the line becomes a link, as written", () => {
    const text = "# Log\n\nAttuned the kyber crystal today; kyber again.\nRead kyber crystal notes again.\n";
    const result = linkMentionOnLine(text, 3, names, "Kyber Crystal Notes");
    expect(result?.matched).toBe("kyber");
    expect(result?.text).toBe("# Log\n\nAttuned the [[Kyber Crystal Notes|kyber]] crystal today; kyber again.\nRead kyber crystal notes again.\n");
  });

  test("text that matches the target exactly gets a plain link", () => {
    expect(linkMentionOnLine("See Kyber now.\n", 1, names, "Kyber")?.text).toBe("See [[Kyber]] now.\n");
    expect(linkMentionOnLine("See Kyber now.\n", 1, names, "Lore/Kyber")?.text).toBe("See [[Lore/Kyber|Kyber]] now.\n");
  });

  test("prefers the earliest mention, and the longest at a tie", () => {
    expect(linkMentionOnLine("Kyber crystal notes, then Kyber.", 1, names, "Kyber Crystal Notes")?.text).toBe(
      "[[Kyber Crystal Notes|Kyber crystal notes]], then Kyber.",
    );
  });

  test("respects word boundaries and matches accents loosely", () => {
    expect(linkMentionOnLine("Kybers and kyberite aren't it.", 1, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("Le cristal Kybér brille.", 1, names, "Kyber")?.text).toBe("Le cristal [[Kyber|Kybér]] brille.");
    expect(linkMentionOnLine("Chez Ébène.", 1, ["Ebene"], "Ebene")?.text).toBe("Chez [[Ebene|Ébène]].");
  });

  test("skips inline code, fenced code, links, tags and URLs", () => {
    expect(linkMentionOnLine("Use `kyber` here, then kyber.", 1, names, "Kyber")?.text).toBe("Use `kyber` here, then [[Kyber|kyber]].");
    expect(linkMentionOnLine("Only `kyber` in code.", 1, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("```\nkyber\n```\n", 2, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("~~~\nkyber\n~~~\nkyber\n", 4, names, "Kyber")?.text).toBe("~~~\nkyber\n~~~\n[[Kyber|kyber]]\n");
    expect(linkMentionOnLine("[[Other|kyber]] and [kyber](https://kyber.example) and <https://kyber.example>", 1, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("Tagged #kyber only.", 1, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("Tagged #kyber and kyber.", 1, names, "Kyber")?.text).toBe("Tagged #kyber and [[Kyber|kyber]].");
  });

  test("leaves frontmatter alone", () => {
    expect(linkMentionOnLine("---\nrelated: Kyber\n---\nKyber\n", 2, names, "Kyber")).toBeNull();
    expect(linkMentionOnLine("---\nrelated: Kyber\n---\nKyber\n", 4, names, "Kyber")?.text).toBe("---\nrelated: Kyber\n---\n[[Kyber]]\n");
  });

  test("keeps CRLF line endings and the rest of the note byte for byte", () => {
    const text = "One\r\nkyber here\r\nThree\r\n";
    expect(linkMentionOnLine(text, 2, names, "Kyber")?.text).toBe("One\r\n[[Kyber|kyber]] here\r\nThree\r\n");
    expect(linkMentionOnLine(text, 9, names, "Kyber")).toBeNull();
  });
});
