import { describe, expect, it } from "vitest";
import { fetchPageTitle, titleFromHtml } from "../../src/main/pageTitle";

describe("titleFromHtml", () => {
  it("prefers og:title, then twitter:title, then <title>", () => {
    expect(titleFromHtml(`<head><title>Site | Page</title><meta property="og:title" content="Page"></head>`)).toBe("Page");
    expect(titleFromHtml(`<meta name='twitter:title' content='Tweet title'><title>T</title>`)).toBe("Tweet title");
    expect(titleFromHtml(`<title>\n  Plain   title\n</title>`)).toBe("Plain title");
  });

  it("decodes entities and returns null without a title", () => {
    expect(titleFromHtml(`<title>Tom &amp; Jerry &#8212; &quot;Best&quot; &#x1F600;</title>`)).toBe('Tom & Jerry — "Best" 😀');
    expect(titleFromHtml(`<html><body>nothing</body></html>`)).toBeNull();
  });
});

describe("fetchPageTitle", () => {
  const page = (html: string, type = "text/html; charset=utf-8", ok = true) =>
    (async () => new Response(html, { status: ok ? 200 : 404, headers: { "content-type": type } })) as unknown as typeof fetch;

  it("reads the title of an HTML page", async () => {
    expect(await fetchPageTitle("https://e.com", page("<head><title>Hello</title></head><body>…</body>"))).toBe("Hello");
  });

  it("refuses other schemes, non-HTML and failed responses", async () => {
    expect(await fetchPageTitle("file:///C:/secret.html", page("<title>x</title>"))).toBeNull();
    expect(await fetchPageTitle("https://e.com/a.pdf", page("%PDF", "application/pdf"))).toBeNull();
    expect(await fetchPageTitle("https://e.com/missing", page("<title>404</title>", "text/html", false))).toBeNull();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchPageTitle("https://e.com", failing)).toBeNull();
  });
});
