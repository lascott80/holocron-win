// Renders a single line of inline markdown to DOM, for places drawn outside
// the editor's own live preview (table cells). Links and tags get the same
// classes as in the editor, so clicking them works the same way.

const RULES = [
  // [pattern, build(match) → Node]
  [/^\\([\\`*_{}[\]()#+\-.!|=~<>])/, (m) => document.createTextNode(m[1])],
  [/^`([^`]+)`/, (m) => element("code", "cm-inline-code", m[1])],
  [/^\*\*(.+?)\*\*/, (m) => wrap("strong", m[1])],
  [/^__(.+?)__/, (m) => wrap("strong", m[1])],
  [/^\*(?!\s)(.+?)\*/, (m) => wrap("em", m[1])],
  [/^_(?!\s)(.+?)_/, (m) => wrap("em", m[1])],
  [/^~~(.+?)~~/, (m) => wrap("s", m[1])],
  [/^==(.+?)==/, (m) => wrap("mark", m[1], "cm-highlight")],
  [/^\[\[([^\]|#^]+)([#^][^\]|]*)?(?:\|([^\]]+))?\]\]/, (m) => {
    const link = element("span", "cm-wikilink", m[3] ?? (m[1] + (m[2] ?? "")));
    link.dataset.target = (m[1] + (m[2] ?? "")).trim();
    return link;
  }],
  [/^\[([^\]]+)\]\(<?([^)\s>]+)>?\)/, (m) => {
    const link = element("span", "cm-md-link");
    link.appendChild(renderInline(m[1]));
    link.dataset.href = m[2];
    return link;
  }],
  [/^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, (m) => {
    const link = element("span", "cm-md-link", m[0]);
    link.dataset.href = m[0];
    return link;
  }],
  [/^<(kbd|mark|sup|sub|u|b|i|s|small)>(.+?)<\/\1>/i, (m) => wrap(m[1].toLowerCase(), m[2], `cm-html-${m[1].toLowerCase()}`)],
  [/^<br\s*\/?>/i, () => document.createElement("br")],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function wrap(tag, inner, className) {
  const node = element(tag, className);
  node.appendChild(renderInline(inner));
  return node;
}

export function renderInline(text) {
  const fragment = document.createDocumentFragment();
  let plain = "";
  const flush = () => {
    if (plain) fragment.appendChild(document.createTextNode(plain));
    plain = "";
  };
  let rest = text;
  while (rest.length) {
    // #tags must start a word.
    const atWordStart = plain === "" ? true : /\s$/.test(plain);
    const tag = atWordStart ? /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(rest) : null;
    if (tag) {
      flush();
      const node = element("span", "cm-tag", tag[0]);
      node.dataset.tag = tag[1];
      fragment.appendChild(node);
      rest = rest.slice(tag[0].length);
      continue;
    }
    let matched = false;
    for (const [pattern, build] of RULES) {
      const match = pattern.exec(rest);
      if (match) {
        flush();
        fragment.appendChild(build(match));
        rest = rest.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return fragment;
}
