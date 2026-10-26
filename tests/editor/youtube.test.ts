import { describe, expect, it } from "vitest";
import { youtubeId, youtubeLine } from "../../src/editor/youtube.js";

describe("youtube links", () => {
  it("finds the video id in the usual URL shapes", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) expect(youtubeId(url)).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/@channel")).toBeNull();
    expect(youtubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("only treats a line that is just the link as a card", () => {
    expect(youtubeLine("https://youtu.be/dQw4w9WgXcQ")).toEqual({ url: "https://youtu.be/dQw4w9WgXcQ", id: "dQw4w9WgXcQ", title: null });
    expect(youtubeLine("  [Never gonna](https://youtu.be/dQw4w9WgXcQ)  ")).toMatchObject({ id: "dQw4w9WgXcQ", title: "Never gonna" });
    expect(youtubeLine("Watch https://youtu.be/dQw4w9WgXcQ later")).toBeNull();
  });
});
