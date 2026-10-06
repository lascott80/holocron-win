// Port of LinkTests.swift (resolution, opening/creating, fragments) and the
// vault-level parts of LinkRewriterTests.swift (rewriting across files on
// rename and move). Pure rewriter rules are covered in tests/core.

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineOfFragment, linkFragment, type Vault } from "../../src/main/vault";
import { TempVault, recordingEditor } from "./helpers";

let temp: TempVault;

afterEach(async () => {
  await temp.cleanup();
});

describe("Link resolution and opening", () => {
  let vault: Vault;
  let editor: ReturnType<typeof recordingEditor>;
  const opened: string[] = [];

  beforeEach(() => {
    temp = new TempVault();
    temp.write("Ilum.md");
    temp.write("Lore/Crystals/Kyber Crystal Notes.md", "# Kyber Crystal Notes\n\nIntro.\n\n## Attunement\n\nText ^block1\n");
    temp.write("Lore/Crystals/Ilum.md");
    temp.write("Daily/2026-10-05.md");
    temp.write("Specs/v1.2 notes.markdown");
    temp.write("Docs/report.pdf", "PDF");
    editor = recordingEditor();
    opened.length = 0;
    vault = temp.open({ editor, openPath: (file) => opened.push(file) });
  });

  it("resolves bare names ignoring case", () => {
    expect(vault.resolveLink("kyber crystal notes")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(vault.resolveLink("2026-10-05")).toBe("Daily/2026-10-05.md");
  });

  it("prefers the note nearest the root", () => {
    expect(vault.resolveLink("Ilum")).toBe("Ilum.md");
  });

  it("resolves paths, headings and extensions", () => {
    expect(vault.resolveLink("Lore/Crystals/Ilum")).toBe("Lore/Crystals/Ilum.md");
    expect(vault.resolveLink("Kyber Crystal Notes#Attunement")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(vault.resolveLink("Kyber Crystal Notes^abc123")).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(vault.resolveLink("Ilum.md")).not.toBeNull();
    expect(vault.resolveLink("v1.2 notes")).toBe("Specs/v1.2 notes.markdown");
    expect(vault.resolveLink("Specs/v1.2 notes")).toBe("Specs/v1.2 notes.markdown");
  });

  it("an empty path means the open note", () => {
    expect(vault.resolveLink("#Attunement")).toBeNull();
    vault.open("Ilum.md");
    expect(vault.resolveLink("#Attunement")).toBe("Ilum.md");
  });

  it("unknown targets don't resolve", () => {
    expect(vault.resolveLink("Dagobah")).toBeNull();
    expect(vault.resolveLink("Nowhere/Ilum")).toBeNull();
  });

  it("opening a link opens the note and reveals its fragment", () => {
    vault.openLink("Kyber Crystal Notes#attunement");
    expect(vault.activeTab?.path).toBe("Lore/Crystals/Kyber Crystal Notes.md");
    expect(editor.calls.some((call) => call.method === "focus")).toBe(true);
    const reveal = editor.calls.find((call) => call.method === "reveal");
    expect(reveal?.args).toEqual(["Lore/Crystals/Kyber Crystal Notes.md", 5, 0, 0]);

    vault.openLink("Kyber Crystal Notes#^block1");
    expect(editor.calls.filter((call) => call.method === "reveal").at(-1)?.args[1]).toBe(7);
  });

  it("opening a link in a new tab", () => {
    vault.open("Ilum.md");
    vault.openLink("2026-10-05", true);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Ilum.md", "Daily/2026-10-05.md"]);
  });

  it("opening a missing link creates the note", () => {
    vault.openLink("Dagobah#Swamps");
    expect(temp.exists("Dagobah.md")).toBe(true);
    expect(temp.read("Dagobah.md")).toBe("");
    expect(vault.activeTab?.path).toBe("Dagobah.md");
    expect(vault.resolveLink("Dagobah")).toBe("Dagobah.md");
  });

  it("a missing link with a path creates folders", () => {
    vault.openLink("Planets/Hoth");
    expect(temp.exists("Planets/Hoth.md")).toBe(true);
    expect(vault.activeTab?.path).toBe("Planets/Hoth.md");
  });

  it("link paths can't escape the vault", () => {
    vault.openLink("../../Escaped");
    expect(fs.existsSync(`${temp.base}/Escaped.md`)).toBe(false);
    expect(fs.existsSync(`${temp.root}/../Escaped.md`)).toBe(false);
    expect(temp.exists("Escaped.md")).toBe(true);
  });

  it("colons and empty segments are cleaned up when creating", () => {
    vault.openLink("Meetings: Q3//./Plan.markdown");
    expect(temp.exists("Meetings- Q3/Plan.markdown")).toBe(true);
    vault.openLink(" / ../ ");
    expect(vault.errorMessage).toBeNull();
  });

  it("attachment links open the file and never create notes", () => {
    vault.openLink("report.pdf#page=2");
    expect(opened).toEqual([temp.abs("Docs/report.pdf")]);
    vault.openLink("missing.pdf");
    expect(temp.exists("missing.pdf.md")).toBe(false);
    expect(vault.errorMessage).toBe("“missing.pdf” isn’t in this vault.");
  });

  it("characters Windows forbids in names become dashes, like ':'", () => {
    vault.openLink("What? <draft> | v2");
    expect(temp.exists("What- -draft- - v2.md")).toBe(true);
    expect(vault.errorMessage).toBeNull();
  });
});

describe("Link fragments", () => {
  const text = [
    "# Kyber Crystal Notes",
    "",
    "Intro paragraph. ^intro",
    "",
    "## **Attunement** steps",
    "",
    "- Clear the mind ^step-one",
    "- Record the frequency",
    "",
    "A paragraph whose id follows it.",
    "",
    "^after",
  ].join("\n");

  it("extracts fragments", () => {
    expect(linkFragment("Kyber#Attunement")).toBe("Attunement");
    expect(linkFragment("#Attunement")).toBe("Attunement");
    expect(linkFragment("Kyber#^intro")).toBe("^intro");
    expect(linkFragment("Kyber")).toBeNull();
    expect(linkFragment("Kyber#")).toBeNull();
  });

  it("finds headings like Obsidian", () => {
    expect(lineOfFragment("attunement steps", text)).toBe(5);
    expect(lineOfFragment("Kyber Crystal Notes#Attunement steps", text)).toBe(5);
    expect(lineOfFragment("Missing", text)).toBeNull();
  });

  it("finds blocks", () => {
    expect(lineOfFragment("^intro", text)).toBe(3);
    expect(lineOfFragment("^step-one", text)).toBe(7);
    expect(lineOfFragment("^after", text)).toBe(10);
    expect(lineOfFragment("^nope", text)).toBeNull();
  });

  it("works with CRLF text", () => {
    const crlf = text.replaceAll("\n", "\r\n");
    expect(lineOfFragment("attunement steps", crlf)).toBe(5);
    expect(lineOfFragment("^intro", crlf)).toBe(3);
    expect(lineOfFragment("^after", crlf)).toBe(10);
  });
});

describe("Rewriting links across the vault", () => {
  let vault: Vault;

  beforeEach(async () => {
    temp = new TempVault();
    temp.write("Lore/Ilum.md", "# Ilum\n");
    temp.write("Archive/Ilum.md", "# Old Ilum\n");
    temp.write("Lore/Kyber.md", "# Kyber\n");
    temp.write(
      "Notes.md",
      "[[Kyber]] [[Kyber#Caves]] [[Kyber|crystal]] ![[Kyber]] [[Kyber.md]] [[lore/kyber]]\n" +
        "[raw](<Lore/Kyber.md>) [abs](/Lore/Kyber.md) [titled](Lore/Kyber.md \"Title\") [web](https://x.test/Lore/Kyber.md)\n" +
        "```\n[[Kyber]]\n```\n",
    );
    vault = temp.open();
    await vault.indexingFinished();
  });

  it("keeps fragments, aliases, embeds, extensions and link styles", () => {
    vault.rename("Lore/Kyber.md", "Kyber Prime");
    expect(temp.read("Notes.md")).toBe(
      "[[Kyber Prime]] [[Kyber Prime#Caves]] [[Kyber Prime|crystal]] ![[Kyber Prime]] [[Kyber Prime.md]] [[Lore/Kyber Prime]]\n" +
        "[raw](<Lore/Kyber Prime.md>) [abs](/Lore/Kyber%20Prime.md) [titled](Lore/Kyber%20Prime.md \"Title\") [web](https://x.test/Lore/Kyber.md)\n" +
        "```\n[[Kyber]]\n```\n",
    );
  });

  it("a bare name that would become ambiguous is written as a path", () => {
    temp.write("Moon.md", "# Moon\n");
    temp.write("Links.md", "[[Kyber]]\n");
    vault.reload();
    vault.rename("Lore/Kyber.md", "Moon");
    // "Moon" alone would resolve to the root note, so the full path is written.
    expect(temp.read("Links.md")).toBe("[[Lore/Moon]]\n");
  });

  it("moving a note between folders keeps name links but fixes path links", () => {
    vault.move(["Lore/Kyber.md"], "Archive");
    const text = temp.read("Notes.md");
    expect(text.startsWith("[[Kyber]] [[Kyber#Caves]] [[Kyber|crystal]] ![[Kyber]] [[Kyber.md]] [[Archive/Kyber]]\n")).toBe(true);
    expect(text).toContain("[raw](<Archive/Kyber.md>) [abs](/Archive/Kyber.md)");
  });

  it("a moved note's own relative links follow it", () => {
    temp.write("Lore/Index.md", "[k](Kyber.md) [up](../Notes.md) [[Kyber]]\n");
    vault.reload();
    vault.move(["Lore/Index.md"], "");
    expect(temp.read("Index.md")).toBe("[k](Lore/Kyber.md) [up](Notes.md) [[Kyber]]\n");
  });

  it("an open note's links are rewritten in memory, keeping its unsaved edits", () => {
    vault.open("Notes.md");
    vault.editorChanged("Notes.md", "Draft line\n" + temp.read("Notes.md"));
    vault.rename("Lore/Kyber.md", "Kyber Prime");
    expect(vault.document?.text.startsWith("Draft line\n[[Kyber Prime]]")).toBe(true);
    expect(temp.read("Notes.md").startsWith("Draft line\n[[Kyber Prime]]")).toBe(true);
    expect(vault.document?.isDirty).toBe(false);
  });

  it("undo restores every link", () => {
    // A path link comes back in the note's real case.
    const before = temp.read("Notes.md").replace("[[lore/kyber]]", "[[Lore/Kyber]]");
    vault.rename("Lore/Kyber.md", "Kyber Prime");
    vault.runToastAction();
    expect(temp.read("Notes.md")).toBe(before);
    vault.move(["Lore/Kyber.md"], "Archive");
    vault.runToastAction();
    expect(temp.read("Notes.md")).toBe(before);
  });

  it("CRLF notes keep their line endings when links are rewritten", () => {
    const crlf = "One [[Kyber]]\r\nTwo [k](Lore/Kyber.md)\r\nThree\r\n";
    temp.write("Crlf.md", crlf);
    vault.reload();
    vault.rename("Lore/Kyber.md", "Kyber Prime");
    expect(fs.readFileSync(temp.abs("Crlf.md")).equals(
      Buffer.from("One [[Kyber Prime]]\r\nTwo [k](Lore/Kyber%20Prime.md)\r\nThree\r\n"),
    )).toBe(true);
    vault.runToastAction();
    expect(fs.readFileSync(temp.abs("Crlf.md")).equals(Buffer.from(crlf))).toBe(true);
  });

  it("notes without affected links are not touched", () => {
    temp.write("Other.md", "[[Ilum]] only\r\n");
    vault.reload();
    const before = fs.statSync(temp.abs("Other.md")).mtimeMs;
    vault.rename("Lore/Kyber.md", "Kyber Prime");
    expect(fs.statSync(temp.abs("Other.md")).mtimeMs).toBe(before);
  });
});
