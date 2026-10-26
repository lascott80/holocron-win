// Page titles for pasted links (ED-76): a pasted URL becomes [Title](url).
// Only http(s), a short timeout and the first 512 KB of the page.

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** The page's title from its HTML: og:title / twitter:title first (sites put the clean name there), then <title>. */
export function titleFromHtml(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    if (key !== "og:title" && key !== "twitter:title") continue;
    const content = attribute(tag, "content");
    if (content?.trim()) return clean(content);
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return title && title[1].trim() ? clean(title[1]) : null;
}

function clean(text: string): string {
  const value = decodeEntities(text).replace(/\s+/g, " ").trim();
  return value.length > 200 ? value.slice(0, 199) + "…" : value;
}

/** Fetches `url` and returns its title, or null (not http(s), not HTML, slow, failed). */
export async function fetchPageTitle(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(parsed.href, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Holocron", Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok || !/html/i.test(response.headers.get("content-type") ?? "text/html")) return null;
    const reader = response.body?.getReader();
    if (!reader) return titleFromHtml(await response.text());
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      // The title is near the top; stop once the head is over.
      if (/<\/head>|<body\b/i.test(html)) break;
    }
    void reader.cancel().catch(() => {});
    return titleFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
