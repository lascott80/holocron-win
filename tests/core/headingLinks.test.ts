import { describe, expect, test } from "vitest";
import { fragmentMatchesHeading, renamedFragment, rewriteFragmentLinks, type FragmentLink } from "@core/headingLinks";

/** Renames the heading `from` to `to` in every link whose path is `note` (or empty). */
function rename(text: string, note: string, from: string, to: string): string {
  return rewriteFragmentLinks(text, (link: FragmentLink) =>
    (link.path === "" || link.path.toLowerCase().replace(/\.md$/, "").split("/").pop() === note.toLowerCase()) && fragmentMatchesHeading(link.fragment, from)
      ? { fragment: renamedFragment(link.fragment, from, to, link.kind) }
      : null,
  );
}

describe("Heading links", () => {
  test("rewrites wiki links to a heading, keeping aliases and embeds", () => {
    const text = "See [[Kyber#Attunement]], [[Kyber#Attunement|the notes]], ![[Kyber#Attunement]] and [[#Attunement]].\n";
    expect(rename(text, "Kyber", "Attunement", "Tuning")).toBe(
      "See [[Kyber#Tuning]], [[Kyber#Tuning|the notes]], ![[Kyber#Tuning]] and [[#Tuning]].\n",
    );
  });

  test("matches case-insensitively and ignores markup, and leaves other headings, notes and blocks alone", () => {
    const text = "[[Kyber#attunement]] [[Kyber#**Attunement**]] [[Kyber#Other]] [[Ilum#Attunement]] [[Kyber#^block]] [[Kyber]]";
    expect(rename(text, "Kyber", "Attunement", "Tuning")).toBe("[[Kyber#Tuning]] [[Kyber#Tuning]] [[Kyber#Other]] [[Ilum#Attunement]] [[Kyber#^block]] [[Kyber]]");
  });

  test("keeps a Parent#Child prefix", () => {
    expect(rename("[[Kyber#Crystals#Attunement]]", "Kyber", "Attunement", "Tuning")).toBe("[[Kyber#Crystals#Tuning]]");
  });

  test("rewrites markdown links in the hyphenated and encoded forms", () => {
    const text = "[a](Kyber.md#attunement) [b](Kyber.md#Attunement) [c](Lore/Kyber.md#Attunement%20Notes) [d](<Kyber.md#Attunement Notes>)";
    expect(rename(text, "Kyber", "Attunement", "Fine Tuning")).toBe(
      "[a](Kyber.md#fine-tuning) [b](Kyber.md#Fine%20Tuning) [c](Lore/Kyber.md#Attunement%20Notes) [d](<Kyber.md#Attunement Notes>)",
    );
    expect(rename("[c](Kyber.md#Attunement%20Notes) [d](<Kyber.md#Attunement Notes>)", "Kyber", "Attunement Notes", "Tuning")).toBe(
      "[c](Kyber.md#Tuning) [d](<Kyber.md#Tuning>)",
    );
  });

  test("never touches code, URLs or unchanged files", () => {
    const text = ["`[[Kyber#Attunement]]` stays", "```", "[[Kyber#Attunement]]", "```", "[x](https://example.com/#Attunement)", "[[Kyber#Attunement]]\r"].join("\n");
    const result = rename(text, "Kyber", "Attunement", "Tuning");
    expect(result).toBe(["`[[Kyber#Attunement]]` stays", "```", "[[Kyber#Attunement]]", "```", "[x](https://example.com/#Attunement)", "[[Kyber#Tuning]]\r"].join("\n"));
    const untouched = "[[Kyber#Other]] and [[Ilum#Attunement]]\r\n";
    expect(rename(untouched, "Kyber", "Attunement", "Tuning")).toBe(untouched);
  });

  test("can retarget a heading link at another note with no fragment", () => {
    const text = "[[Kyber#Attunement|notes]] and [more](Lore/Kyber.md#attunement)";
    const result = rewriteFragmentLinks(text, (link) =>
      fragmentMatchesHeading(link.fragment, "Attunement") ? { path: link.kind === "wiki" ? "Attunement" : "Lore/Attunement.md", fragment: "" } : null,
    );
    expect(result).toBe("[[Attunement|notes]] and [more](Lore/Attunement.md)");
  });

  test("fragmentMatchesHeading", () => {
    expect(fragmentMatchesHeading("Attunement", "Attunement")).toBe(true);
    expect(fragmentMatchesHeading("fine-tuning", "Fine Tuning")).toBe(true);
    expect(fragmentMatchesHeading("Parent#Fine tuning", "Fine Tuning")).toBe(true);
    expect(fragmentMatchesHeading("Fine", "Fine Tuning")).toBe(false);
    expect(fragmentMatchesHeading("", "Fine Tuning")).toBe(false);
  });
});
