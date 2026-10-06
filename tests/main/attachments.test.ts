// Port of AttachmentTests.swift (VaultAttachmentTests): pasted images,
// dropped files and asset resolution confined to the vault. Pure resolution
// rules are covered in tests/core/attachments.test.ts.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../src/main/vault";
import { TempVault } from "./helpers";
import { assetMimeType, assetResponse, isServableAsset, parseRange } from "../../src/main/assets";

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

  it("serves images, audio, video and PDFs", () => {
    const media = ["Docs/report.pdf", "Media/clip.mp4", "Media/clip.WEBM", "Media/a.mov", "Media/a.m4v", "Media/a.ogv",
      "Media/song.mp3", "Media/tone.wav", "Media/a.m4a", "Media/a.ogg", "Media/a.flac", "Media/a.aac", "Media/a.opus"];
    for (const file of media) temp.write(file, "DATA");
    vault.reload();
    for (const file of media) {
      expect(vault.resolveAsset("embed", file.split("/").pop()!, "Lore/Kyber.md"), file).toBe(temp.abs(file));
      expect(vault.resolveAsset("relative", `../${file}`, "Lore/Kyber.md"), file).toBe(temp.abs(file));
    }
    expect(vault.resolveAsset("embed", "report.pdf#page=3", "Lore/Kyber.md")).toBe(temp.abs("Docs/report.pdf"));
  });

  it("refuses notes, scripts, executables and other files", () => {
    const refused = ["Lore/Other.md", "Lore/Other.markdown", "Bin/run.exe", "Bin/run.bat", "Bin/run.cmd", "Bin/run.ps1", "Bin/a.js",
      "Bin/page.html", "Bin/page.htm", "Bin/a.svgz", "Bin/archive.zip", "Bin/notes.txt", "Bin/data.json", "Bin/noext", "Bin/clip.mp4.exe"];
    for (const file of refused) temp.write(file, "DATA");
    vault.reload();
    for (const file of refused) {
      expect(vault.resolveAsset("embed", file.split("/").pop()!, "Lore/Kyber.md"), file).toBeNull();
      expect(vault.resolveAsset("relative", `../${file}`, "Lore/Kyber.md"), file).toBeNull();
    }
    expect(vault.resolveAsset("embed", "Kyber.md", "Lore/Kyber.md")).toBeNull();
  });

  it("never serves media outside the vault", () => {
    fs.writeFileSync(path.join(temp.base, "secret.pdf"), "SECRET");
    fs.writeFileSync(path.join(temp.base, "secret.mp4"), "SECRET");
    for (const target of ["../secret.pdf", "../../secret.mp4", "..\\..\\secret.pdf", "/../secret.mp4"]) {
      expect(vault.resolveAsset("relative", target, "Lore/Kyber.md"), target).toBeNull();
      expect(vault.resolveAsset("embed", target, "Lore/Kyber.md"), target).toBeNull();
    }
    const outside = temp.outside();
    fs.writeFileSync(path.join(outside, "leak.pdf"), "LEAK");
    fs.writeFileSync(path.join(outside, "leak.wav"), "LEAK");
    fs.symlinkSync(outside, temp.abs("Linked"), "junction");
    vault.reload();
    expect(vault.resolveAsset("embed", "leak.pdf", "Lore/Kyber.md")).toBeNull();
    expect(vault.resolveAsset("relative", "../Linked/leak.wav", "Lore/Kyber.md")).toBeNull();
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

describe("The asset scheme's responses", () => {
  it("knows which files it may serve", () => {
    for (const file of ["a.png", "b.JPG", "c.svg", "d.mp4", "e.webm", "f.mp3", "g.wav", "h.flac", "i.opus", "Docs/j.pdf"]) expect(isServableAsset(file), file).toBe(true);
    for (const file of ["a.md", "b.exe", "c.html", "d.js", "e", "f.mp4.exe", ".pdf"]) expect(isServableAsset(file), file).toBe(false);
  });

  it("sends the right MIME types", () => {
    expect(assetMimeType("a.mp4")).toBe("video/mp4");
    expect(assetMimeType("a.webm")).toBe("video/webm");
    expect(assetMimeType("a.mov")).toBe("video/quicktime");
    expect(assetMimeType("a.MP3")).toBe("audio/mpeg");
    expect(assetMimeType("a.wav")).toBe("audio/wav");
    expect(assetMimeType("a.flac")).toBe("audio/flac");
    expect(assetMimeType("x/a.pdf")).toBe("application/pdf");
    expect(assetMimeType("a.svg")).toBe("image/svg+xml");
    expect(assetMimeType("a.jpg")).toBe("image/jpeg");
  });

  it("parses Range headers", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange(" Bytes = 1 - 2 ", 1000)).toEqual({ start: 1, end: 2 });
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull(); // several ranges: send it all
    expect(parseRange("items=0-1", 1000)).toBeNull();
    for (const bad of ["bytes=1000-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=abc", "bytes=1-x"]) {
      expect(parseRange(bad, 1000), bad).toBe("unsatisfiable");
    }
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("answers whole files, ranges and bad ranges", async () => {
    const file = temp.abs("Lore/crystal.png");
    fs.writeFileSync(file, "0123456789");
    const request = (range?: string, method = "GET") => ({ method, headers: new Headers(range ? { Range: range } : {}) });

    const whole = await assetResponse(file, request());
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("image/png");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe("10");
    expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
    expect(whole.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(await whole.text()).toBe("0123456789");

    const part = await assetResponse(file, request("bytes=2-5"));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(part.headers.get("content-length")).toBe("4");
    expect(await part.text()).toBe("2345");

    const tail = await assetResponse(file, request("bytes=-3"));
    expect(await tail.text()).toBe("789");

    const bad = await assetResponse(file, request("bytes=20-"));
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");

    const head = await assetResponse(file, request(undefined, "HEAD"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(head.body).toBeNull();

    temp.write("Docs/a.pdf", "%PDF");
    const pdf = await assetResponse(temp.abs("Docs/a.pdf"), request());
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-security-policy")).toBeNull(); // the sandbox would block the PDF viewer
  });
});
