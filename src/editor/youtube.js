// YouTube links (ED-77): a line holding only a YouTube link (bare, or as
// [title](url)) gets the video's thumbnail below it. Clicking it opens the
// video in the browser; notes never load remote pages (NFR-04), so there's
// no in-note player.
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/** The 11-character video id of a YouTube URL, or null. */
export function youtubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = parsed.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else id = /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(parsed.pathname)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** A line that's only a YouTube link: { url, id, title }. */
export function youtubeLine(text) {
  const trimmed = text.trim();
  const markdown = /^\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)$/.exec(trimmed);
  const url = markdown ? markdown[2] : /^<?(https?:\/\/\S+?)>?$/.exec(trimmed)?.[1];
  const id = url ? youtubeId(url) : null;
  return id ? { url, id, title: markdown?.[1] || null } : null;
}

class YoutubeWidget extends WidgetType {
  constructor(card, open) {
    super();
    this.card = card;
    this.open = open;
  }
  eq(other) {
    return other.card.url === this.card.url && other.card.title === this.card.title;
  }
  toDOM() {
    const card = document.createElement("div");
    card.className = "cm-youtube";
    card.setAttribute("role", "link");
    card.tabIndex = 0;
    card.title = `Watch on YouTube: ${this.card.url}`;
    const image = card.appendChild(document.createElement("img"));
    image.src = `https://i.ytimg.com/vi/${this.card.id}/hqdefault.jpg`;
    image.alt = this.card.title ?? "YouTube video";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    card.appendChild(document.createElement("span")).className = "cm-youtube-play";
    if (this.card.title) card.appendChild(document.createElement("span")).className = "cm-youtube-title";
    if (this.card.title) card.lastChild.textContent = this.card.title;
    const open = (event) => {
      event.preventDefault();
      this.open(this.card.url);
    };
    card.addEventListener("mousedown", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    });
    return card;
  }
  ignoreEvent() {
    return true;
  }
}

// Block widgets have to come from a state field. Lines are scanned only for "youtu".
function build(doc, open) {
  const builder = new RangeSetBuilder();
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const card = line.text.includes("youtu") ? youtubeLine(line.text) : null;
    if (card) builder.add(line.to, line.to, Decoration.widget({ widget: new YoutubeWidget(card, open), block: true, side: 1 }));
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  ".cm-youtube": {
    position: "relative",
    display: "inline-block",
    width: "min(480px, 100%)",
    aspectRatio: "16 / 9",
    margin: "6px 0 10px",
    borderRadius: "8px",
    overflow: "hidden",
    background: "#000",
    cursor: "pointer",
    verticalAlign: "top",
  },
  ".cm-youtube img": { width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: "0.92" },
  ".cm-youtube:hover img": { opacity: "1" },
  ".cm-youtube-play": {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "64px",
    height: "44px",
    transform: "translate(-50%, -50%)",
    borderRadius: "12px",
    background: "rgba(23, 23, 23, 0.82)",
    transition: "background 0.12s",
  },
  ".cm-youtube:hover .cm-youtube-play": { background: "#e62117" },
  ".cm-youtube-play::after": {
    content: "''",
    position: "absolute",
    left: "26px",
    top: "13px",
    borderLeft: "16px solid #fff",
    borderTop: "9px solid transparent",
    borderBottom: "9px solid transparent",
  },
  ".cm-youtube-title": {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    padding: "18px 12px 8px",
    background: "linear-gradient(transparent, rgba(0, 0, 0, 0.75))",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "600",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

/** The extension; `open(url)` opens the video (in the browser). */
export function youtubeCards(open) {
  const cards = StateField.define({
    create: (state) => build(state.doc, open),
    update: (value, transaction) => (transaction.docChanged ? build(transaction.state.doc, open) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
  return [cards, theme];
}
