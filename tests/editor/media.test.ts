import { describe, expect, it } from "vitest";
import { findMedia, isMediaEmbed, mediaKind, pdfPage } from "../../src/editor/media.js";
import { findImages, isImageEmbed } from "../../src/editor/images.js";

describe("mediaKind", () => {
  it("knows video, audio and PDF extensions in any case", () => {
    for (const name of ["a.mp4", "a.WEBM", "a.mov", "a.m4v", "a.ogv"]) expect(mediaKind(name), name).toBe("video");
    for (const name of ["a.mp3", "a.wav", "a.M4A", "a.ogg", "a.flac", "a.aac", "a.opus"]) expect(mediaKind(name), name).toBe("audio");
    expect(mediaKind("Papers/x.PDF")).toBe("pdf");
    for (const name of ["a.png", "a.md", "a.exe", "mp4", "a.mp4x"]) expect(mediaKind(name), name).toBeNull();
  });
});

describe("isMediaEmbed", () => {
  it("matches the inside of ![[…]] for media files only", () => {
    expect(isMediaEmbed("clip.mp4")).toBe(true);
    expect(isMediaEmbed("Media/song.mp3|300")).toBe(true);
    expect(isMediaEmbed("paper.pdf#page=3")).toBe(true);
    expect(isMediaEmbed("photo.png")).toBe(false);
    expect(isMediaEmbed("Note")).toBe(false);
    expect(isMediaEmbed("Note#Heading")).toBe(false);
    expect(isMediaEmbed("archive.zip")).toBe(false);
  });

  it("never overlaps image embeds", () => {
    for (const inner of ["clip.mp4", "paper.pdf", "song.wav", "a.png", "b.jpg|200"]) {
      expect(isMediaEmbed(inner) && isImageEmbed(inner), inner).toBe(false);
    }
  });
});

describe("pdfPage", () => {
  it("reads #page=N", () => {
    expect(pdfPage("#page=3")).toBe(3);
    expect(pdfPage("#zoom=50&page=12")).toBe(12);
    expect(pdfPage("#Heading")).toBeNull();
    expect(pdfPage(undefined)).toBeNull();
  });
});

describe("findMedia", () => {
  it("finds wikilink embeds with sizes and pages", () => {
    const text = "Watch ![[clip.mp4|400]] then ![[Audio/song.mp3]] and ![[paper.pdf#page=3]]";
    expect(findMedia(text).map(({ from, to, ...rest }: any) => ({ text: text.slice(from, to), ...rest }))).toEqual([
      { text: "![[clip.mp4|400]]", kind: "video", target: "clip.mp4", linkKind: "embed", name: "clip.mp4", page: null, width: 400 },
      { text: "![[Audio/song.mp3]]", kind: "audio", target: "Audio/song.mp3", linkKind: "embed", name: "song.mp3", page: null, width: null },
      { text: "![[paper.pdf#page=3]]", kind: "pdf", target: "paper.pdf", linkKind: "embed", name: "paper.pdf", page: 3, width: null },
    ]);
  });

  it("finds markdown embeds of local media files", () => {
    const [video, pdf] = findMedia("![A clip|320](Media/my%20clip.webm) ![](docs/paper.pdf#page=2)");
    expect(video).toMatchObject({ kind: "video", target: "Media/my clip.webm", linkKind: "relative", name: "A clip", width: 320 });
    expect(pdf).toMatchObject({ kind: "pdf", target: "docs/paper.pdf", linkKind: "relative", name: "paper.pdf", page: 2 });
  });

  it("ignores images, notes, plain links and remote URLs", () => {
    expect(findMedia("![[photo.png]] ![[Note]] [[clip.mp4]] ![x](https://example.com/clip.mp4) ![x](a.png)")).toEqual([]);
  });
});

describe("findImages and media", () => {
  it("leaves local media to media.js but keeps images", () => {
    expect(findImages("![](clip.mp4) ![](paper.pdf#page=1) ![a](pic.png)").map((i: any) => i.alt)).toEqual(["a"]);
  });
});
