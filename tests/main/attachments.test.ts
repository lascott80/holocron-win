// Port of AttachmentTests.swift (VaultAttachmentTests): pasted images,
// dropped files and asset resolution confined to the vault. Pure resolution
// rules are covered in tests/core/attachments.test.ts.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault } from "./helpers";

let temp: TempVault;
let vault: Vault;

beforeEach(() => {
  temp = new TempVault();
  temp.write("Lore/Kyber.md", "![[crystal.png]]\n");
  temp.write("Lore/crystal.png", "PNG");
  vault = temp.open();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("Attachments in the vault", () => {
  it("scans attachments but not notes", () => {
    expect(vault.attachments).toEqual(["Lore/crystal.png"]);
    expect(vault.noteCount).toBe(1);
  });

  it("resolves assets for the editor", () => {
    expect(vault.resolveAsset("embed", "crystal.png", "Lore/Kyber.md")).toBe(temp.abs("Lore/crystal.png"));
    expect(vault.resolveAsset("relative", "crystal.png", "Lore/Kyber.md")).toBe(temp.abs("Lore/crystal.png"));
    expect(vault.resolveAsset("relative", "../Lore/crystal.png", "Lore/Kyber.md")).toBe(temp.abs("Lore/crystal.png"));
    expect(vault.resolveAsset("relative", "https://example.com/a.png", "Lore/Kyber.md")).toBeNull();
    expect(vault.resolveAsset("embed", "missing.png", "Lore/Kyber.md")).toBeNull();
  });

  it("only serves images", () => {
    temp.write("Docs/report.pdf", "PDF");
    vault.reload();
    expect(vault.resolveAsset("embed", "report.pdf", "Lore/Kyber.md")).toBeNull();
    expect(vault.resolveAsset("embed", "Kyber.md", "Lore/Kyber.md")).toBeNull();
  });

  it("never serves files outside the vault", () => {
    // An image beside the vault folder.
    fs.writeFileSync(path.join(temp.base, "secret.png"), "SECRET");
    for (const target of ["../secret.png", "../../secret.png", "../../../secret.png", "..\\..\\secret.png", "/../secret.png"]) {
      expect(vault.resolveAsset("relative", target, "Lore/Kyber.md"), target).toBeNull();
      expect(vault.resolveAsset("embed", target, "Lore/Kyber.md"), target).toBeNull();
    }
    expect(vault.resolveAsset("relative", path.join(temp.base, "secret.png"), "Lore/Kyber.md")).toBeNull();
    expect(vault.resolveAsset("relative", "file:///C:/Windows/win.ini", "Lore/Kyber.md")).toBeNull();
  });

  it("never serves images reached through a junction out of the vault", () => {
    const outside = temp.outside();
    fs.writeFileSync(path.join(outside, "leak.png"), "LEAK");
    fs.symlinkSync(outside, temp.abs("Linked"), "junction");
    vault.reload();
    expect(vault.attachments).toContain("Linked/leak.png");
    expect(vault.resolveAsset("embed", "leak.png", "Lore/Kyber.md")).toBeNull();
    expect(vault.resolveAsset("relative", "../Linked/leak.png", "Lore/Kyber.md")).toBeNull();
  });

  it("saves pasted images in the attachment folder", () => {
    const text = vault.saveAttachment(new TextEncoder().encode("PNG"), "Pasted image 1.png");
    expect(text).toBe("![[Pasted image 1.png]]");
    expect(temp.read("Attachments/Pasted image 1.png")).toBe("PNG");

    const second = vault.saveAttachment(new TextEncoder().encode("PNG"), "Pasted image 1.png");
    expect(second).toBe("![[Pasted image 1 2.png]]");
    expect(vault.attachments).toContain("Attachments/Pasted image 1 2.png");
  });

  it("pasted images without a name are named from the time and type", () => {
    const text = vault.pasteImage("", "image/jpeg", new Uint8Array([1, 2, 3]));
    expect(text).toMatch(/^!\[\[Pasted image \d{14}\.jpg\]\]$/);
    const saved = vault.attachments.find((file) => file.startsWith("Attachments/Pasted image "));
    expect(fs.readFileSync(temp.abs(saved!))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("uses the attachment folder setting, never above the vault", () => {
    temp.settings.attachmentFolder = "../Media";
    expect(vault.saveAttachment(new TextEncoder().encode("x"), "a.png")).toBe("![[a.png]]");
    expect(temp.exists("Media/a.png")).toBe(true);
    expect(fs.existsSync(path.join(temp.base, "Media"))).toBe(false);

    temp.settings.attachmentFolder = "";
    vault.saveAttachment(new TextEncoder().encode("x"), "b.png");
    expect(temp.exists("b.png")).toBe(true);
  });

  it("a duplicate name links by path", () => {
    vault.saveAttachment(new TextEncoder().encode("x"), "crystal.png");
    expect(vault.attachments).toEqual(["Attachments/crystal.png", "Lore/crystal.png"]);
  });

  it("imports files from outside by copying", () => {
    const outside = temp.outside();
    const photo = path.join(outside, "photo.jpg");
    const doc = path.join(outside, "report.pdf");
    fs.writeFileSync(photo, "JPG");
    fs.writeFileSync(doc, "PDF");

    expect(vault.importFiles([photo, doc])).toEqual(["![[photo.jpg]]", "[[report.pdf]]"]);
    expect(temp.read("Attachments/photo.jpg")).toBe("JPG");
    expect(fs.existsSync(photo)).toBe(true); // the original is left alone
  });

  it("links files already in the vault without copying", () => {
    expect(vault.importFiles([temp.abs("Lore/crystal.png"), temp.abs("Lore/Kyber.md")])).toEqual(["![[crystal.png]]", "[[Lore/Kyber]]"]);
    expect(temp.exists("Attachments")).toBe(false);
  });

  it("a file that can't be copied reports an error and is skipped", () => {
    const outside = temp.outside();
    expect(vault.importFiles([path.join(outside, "gone.png")])).toEqual([]);
    expect(vault.errorMessage).toMatch(/^Couldn’t add “gone.png”/);
  });

  it("attachment links never create notes", () => {
    vault.openLink("missing.pdf");
    expect(temp.exists("missing.pdf.md")).toBe(false);
    expect(vault.errorMessage).not.toBeNull();
  });

  it("outgoing links skip attachments", async () => {
    await vault.indexingFinished();
    expect(vault.index.outgoingLinks("Lore/Kyber.md")).toEqual([]);
  });
});
