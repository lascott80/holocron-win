// The note composer (FOP-13…FOP-15) and heading-rename link updates
// (LNK-15): extract, merge and split with their toasts and Undo, through
// open documents and on disk, against a temp vault.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault, recordingEditor, waitFor } from "./helpers";

const KYBER = "# Kyber\n\nIntro text.\n\n## Attunement\nHold the crystal.\n\n### Steps\nBreathe.\n\n## Colours\nBlue and green.\n";
const ILUM = "# Ilum\nSee [[Kyber#Attunement|tuning]], [[Kyber]] and [[Hoth#Weather|cold]].\n";
const SABER = "Read [steps](../Lore/Kyber.md#attunement) and [[Kyber#Colours]].\n";
const HOTH = "---\ntags: [planet]\n---\n# Hoth\nCold. See [[Kyber]] and [local](Ilum.md).\n\n## Weather\nSnow.\n";
const TODAY = "`[[Kyber#Attunement]]` in code.\n";

let temp: TempVault;
let vault: Vault;
let editor: ReturnType<typeof recordingEditor>;

beforeEach(async () => {
  temp = new TempVault();
  temp.write("Lore/Kyber.md", KYBER);
  temp.write("Lore/Ilum.md", ILUM);
  temp.write("Lore/Hoth.md", HOTH);
  temp.write("Orders/Saber.md", SABER);
  temp.write("Daily/Today.md", TODAY);
  editor = recordingEditor();
  vault = temp.open({ editor, headingLinksDelay: 10 });
  await vault.indexingFinished();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Extract Selection to New Note", () => {
  it("creates the note beside the current one, links to it, opens it and undoes", async () => {
    vault.open("Lore/Kyber.md");
    const from = KYBER.indexOf("Hold the crystal.");
    const to = from + "Hold the crystal.".length;

    expect(vault.extractSelection("Lore/Kyber.md", from, to, "Hold the crystal.", "Holding", false)).toBe("Lore/Holding.md");
    expect(temp.read("Lore/Holding.md")).toBe("Hold the crystal.\n");
    const replaced = KYBER.replace("Hold the crystal.", "[[Holding]]");
    expect(vault.documents.get("Lore/Kyber.md")!.text).toBe(replaced);
    expect(temp.read("Lore/Kyber.md")).toBe(replaced);
    // The editor got the change as an edit (cursor and undo kept), and the new note opened in a new tab.
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[0] === "Lore/Kyber.md")).toBe(true);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Lore/Kyber.md", "Lore/Holding.md"]);
    expect(vault.activeTab?.path).toBe("Lore/Holding.md");
    expect(vault.toast?.message).toBe("Extracted “Holding”");

    vault.runToastAction();
    await waitFor(() => !temp.exists("Lore/Holding.md"));
    expect(temp.read("Lore/Kyber.md")).toBe(KYBER);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Lore/Kyber.md"]);
  });

  it("embeds when asked, numbers a taken name and cleans it", () => {
    temp.write("Lore/Holding now.md", "taken\n");
    vault.open("Lore/Kyber.md");
    const from = KYBER.indexOf("Breathe.");
    expect(vault.extractSelection("Lore/Kyber.md", from, from + 8, "Breathe.", "# Holding: now?", true)).toBe("Lore/Holding now 2.md");
    expect(temp.read("Lore/Kyber.md")).toContain("![[Holding now 2]]");
    expect(temp.read("Lore/Holding now.md")).toBe("taken\n");
  });

  it("refuses a selection that no longer matches, and an empty name", () => {
    vault.open("Lore/Kyber.md");
    expect(vault.extractSelection("Lore/Kyber.md", 0, 5, "nope!", "Name", false)).toBeNull();
    expect(vault.errorMessage).toContain("selection has changed");
    expect(vault.extractSelection("Lore/Kyber.md", 2, 7, "Kyber", "  ", false)).toBeNull();
    expect(temp.read("Lore/Kyber.md")).toBe(KYBER);
  });
});

describe("Merge Note Into", () => {
  it("appends the body under a heading, repoints links, trashes the note and undoes it all", async () => {
    vault.open("Lore/Hoth.md");
    const edited = HOTH + "Unsaved line.\n";
    vault.editorChanged("Lore/Hoth.md", edited);

    expect(await vault.mergeNote("Lore/Hoth.md", "Orders/Saber.md", true)).toBe(true);
    // Frontmatter dropped, the relative link recomputed for the new folder, a blank line and heading between.
    expect(temp.read("Orders/Saber.md")).toBe(SABER + "\n## Hoth\n\n# Hoth\nCold. See [[Kyber]] and [local](../Lore/Ilum.md).\n\n## Weather\nSnow.\nUnsaved line.\n");
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM.replace("[[Hoth#Weather|cold]]", "[[Saber#Weather|cold]]"));
    expect(temp.exists("Lore/Hoth.md")).toBe(false);
    expect(vault.tabs.map((tab) => tab.path)).toEqual(["Orders/Saber.md"]);
    expect(vault.toast?.message).toBe("Merged “Hoth” into “Saber”");

    vault.runToastAction();
    await waitFor(() => temp.exists("Lore/Hoth.md"));
    expect(temp.read("Lore/Hoth.md")).toBe(edited);
    expect(temp.read("Orders/Saber.md")).toBe(SABER);
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM);
  });

  it("can leave the heading out, and goes through the target's open document", async () => {
    vault.open("Orders/Saber.md");
    expect(await vault.mergeNote("Lore/Hoth.md", "Orders/Saber.md", false)).toBe(true);
    const expected = SABER + "\n# Hoth\nCold. See [[Kyber]] and [local](../Lore/Ilum.md).\n\n## Weather\nSnow.\n";
    expect(vault.documents.get("Orders/Saber.md")!.text).toBe(expected);
    expect(temp.read("Orders/Saber.md")).toBe(expected);
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[0] === "Orders/Saber.md")).toBe(true);
  });

  it("does nothing for a note merged into itself", async () => {
    expect(await vault.mergeNote("Lore/Hoth.md", "Lore/Hoth.md", true)).toBe(false);
    expect(temp.read("Lore/Hoth.md")).toBe(HOTH);
  });
});

describe("Split Note at Heading", () => {
  it("moves the section to a new note, promotes its headings and repoints heading links", async () => {
    // Line 6 is "Hold the crystal.", inside the Attunement section.
    expect(vault.splitAtHeading("Lore/Kyber.md", 6)).toBe("Lore/Attunement.md");
    expect(temp.read("Lore/Attunement.md")).toBe("Hold the crystal.\n\n# Steps\nBreathe.\n");
    expect(temp.read("Lore/Kyber.md")).toBe("# Kyber\n\nIntro text.\n\n[[Attunement]]\n\n## Colours\nBlue and green.\n");
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM.replace("[[Kyber#Attunement|tuning]]", "[[Attunement|tuning]]"));
    expect(temp.read("Orders/Saber.md")).toBe("Read [steps](../Lore/Attunement.md) and [[Kyber#Colours]].\n");
    expect(temp.read("Daily/Today.md")).toBe(TODAY);
    expect(vault.activeTab?.path).toBe("Lore/Attunement.md");
    expect(vault.toast?.message).toBe("Split “Attunement” into “Attunement”");

    vault.runToastAction();
    await waitFor(() => !temp.exists("Lore/Attunement.md"));
    expect(temp.read("Lore/Kyber.md")).toBe(KYBER);
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM);
    expect(temp.read("Orders/Saber.md")).toBe(SABER);
  });

  it("splits the last section through the open document, numbering a taken name", () => {
    temp.write("Lore/Colours.md", "taken\n");
    vault.open("Lore/Kyber.md");
    expect(vault.splitAtHeading("Lore/Kyber.md", 11)).toBe("Lore/Colours 2.md");
    expect(temp.read("Lore/Colours 2.md")).toBe("Blue and green.\n");
    const expected = "# Kyber\n\nIntro text.\n\n## Attunement\nHold the crystal.\n\n### Steps\nBreathe.\n\n[[Colours 2]]\n";
    expect(vault.documents.get("Lore/Kyber.md")!.text).toBe(expected);
    expect(temp.read("Orders/Saber.md")).toBe("Read [steps](../Lore/Kyber.md#attunement) and [[Colours 2]].\n");
  });

  it("needs a heading above the cursor", () => {
    temp.write("Plain.md", "Plain text\n\n# Later\n");
    vault.reload(["Plain.md"]);
    expect(vault.splitAtHeading("Plain.md", 1)).toBeNull();
    expect(vault.errorMessage).toContain("heading");
    expect(temp.read("Plain.md")).toBe("Plain text\n\n# Later\n");
  });
});

describe("Heading rename updates links", () => {
  it("offers to update links after a heading is renamed, updates them and undoes", async () => {
    vault.open("Lore/Kyber.md");
    vault.editorChanged("Lore/Kyber.md", KYBER.replace("## Attunement", "## Tuning"));
    await waitFor(() => vault.toast !== null);
    // Ilum's wikilink and Saber's markdown link; Today's is in code.
    expect(vault.toast?.message).toBe("Heading renamed — update 2 links in 2 notes?");
    expect(vault.toast?.actionTitle).toBe("Update Links");

    vault.runToastAction();
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM.replace("[[Kyber#Attunement|tuning]]", "[[Kyber#Tuning|tuning]]"));
    expect(temp.read("Orders/Saber.md")).toBe("Read [steps](../Lore/Kyber.md#tuning) and [[Kyber#Colours]].\n");
    expect(temp.read("Daily/Today.md")).toBe(TODAY);
    expect(vault.toast?.message).toBe("Updated 2 links");

    vault.runToastAction();
    expect(temp.read("Lore/Ilum.md")).toBe(ILUM);
    expect(temp.read("Orders/Saber.md")).toBe(SABER);
  });

  it("counts links in the note itself and goes through open documents", async () => {
    temp.write("Lore/Kyber.md", KYBER + "Back to [[#Attunement]] and [[Kyber#Attunement]].\n");
    vault.reload(["Lore/Kyber.md"]);
    await vault.indexingFinished();
    vault.open("Lore/Ilum.md", true);
    vault.open("Lore/Kyber.md", true);
    const text = vault.documents.get("Lore/Kyber.md")!.text;
    vault.editorChanged("Lore/Kyber.md", text.replace("## Attunement", "## Tuning"));
    await waitFor(() => vault.toast !== null);
    expect(vault.toast?.message).toBe("Heading renamed — update 4 links in 3 notes?");
    vault.runToastAction();
    expect(vault.documents.get("Lore/Kyber.md")!.text).toBe(KYBER.replace("## Attunement", "## Tuning") + "Back to [[#Tuning]] and [[Kyber#Tuning]].\n");
    expect(vault.documents.get("Lore/Ilum.md")!.text).toContain("[[Kyber#Tuning|tuning]]");
    expect(editor.calls.some((call) => call.method === "externalChange" && call.args[0] === "Lore/Ilum.md")).toBe(true);
  });

  it("stays quiet when the setting is off, when headings are added or removed, or when nothing links there", async () => {
    temp.settings.updateHeadingLinks = false;
    vault.open("Lore/Kyber.md");
    vault.editorChanged("Lore/Kyber.md", KYBER.replace("## Attunement", "## Tuning"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(vault.toast).toBeNull();

    temp.settings.updateHeadingLinks = true;
    vault.editorChanged("Lore/Kyber.md", KYBER.replace("## Attunement", "## Tuning\n\n## Added"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(vault.toast).toBeNull();

    // "Steps" renamed, but nothing links to it.
    vault.editorChanged("Lore/Kyber.md", KYBER.replace("## Attunement", "## Tuning\n\n## Added").replace("### Steps", "### Stages"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(vault.toast).toBeNull();
  });
});
