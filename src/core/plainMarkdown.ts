// Markdown → the text a reader sees, for one line shown out of context (search
// snippets, backlink cards, the outline). Every output character remembers the
// source index it came from, so match ranges found in the markdown can be
// carried over onto the plain text.

export interface PlainText {
  text: string;
  /** `map[i]` is the index in the source line of `text[i]`. */
  map: number[];
}

// Heading marks, quote/callout prefixes, and bullet or task markers.
const BLOCK_PREFIX = /^[ \t]{0,3}(?:#{1,6}[ \t]+|(?:>[ \t]?)+(?:\[![\w-]+\][-+]?[ \t]*)?)?(?:[-*+][ \t]+(?:\[.\][ \t]+)?)?/;
const LINK = /^!?\[([^\]]*)\]\([^)]*\)/;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Strips inline markdown: **b**, ~~s~~, ==h==, `code`, [[a|b]] → b,
 * [[Note#Part]] → Note › Part, ![[embeds]], [a](x) → a. With `block`, the
 * line's heading, quote, callout and list markers go too.
 */
export function stripMarkdown(line: string, { block = false } = {}): PlainText {
  const out: string[] = [];
  const map: number[] = [];
  const emit = (character: string, from: number) => {
    out.push(character);
    map.push(from);
  };
  const emitRange = (from: number, to: number) => {
    for (let k = from; k < to; k++) emit(line[k]!, k);
  };

  let i = block ? (BLOCK_PREFIX.exec(line)?.[0].length ?? 0) : 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) {
      emit(line[i + 1]!, i + 1);
      i += 2;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      const fence = "`".repeat(run);
      const close = line.indexOf(fence, i + run);
      if (close > 0) {
        emitRange(i + run, close);
        i = close + run;
      } else {
        emitRange(i, i + run);
        i += run;
      }
      continue;
    }
    const wikiStart = line.startsWith("![[", i) ? i + 3 : line.startsWith("[[", i) ? i + 2 : -1;
    if (wikiStart >= 0) {
      const close = line.indexOf("]]", wikiStart);
      if (close > 0) {
        const bar = line.indexOf("|", wikiStart);
        if (bar >= 0 && bar < close) emitRange(bar + 1, close);
        else {
          for (let k = wikiStart; k < close; k++) {
            if (line[k] === "#") for (const s of " › ") emit(s, k);
            else emit(line[k]!, k);
          }
        }
        i = close + 2;
        continue;
      }
    }
    if (c === "[" || (c === "!" && line[i + 1] === "[")) {
      const link = LINK.exec(line.slice(i));
      if (link) {
        const labelStart = i + (c === "!" ? 2 : 1);
        emitRange(labelStart, labelStart + link[1]!.length);
        i += link[0].length;
        continue;
      }
    }
    const pair = line.slice(i, i + 2);
    if (pair === "**" || pair === "__" || pair === "~~" || pair === "==") {
      i += 2;
      continue;
    }
    if (c === "*") {
      i++;
      continue;
    }
    // Emphasis underscores, but not the ones inside snake_case words.
    if (c === "_" && !(WORD.test(line[i - 1] ?? "") && WORD.test(line[i + 1] ?? ""))) {
      i++;
      continue;
    }
    emit(c, i);
    i++;
  }
  return { text: out.join(""), map };
}
