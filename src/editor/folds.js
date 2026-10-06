// Foldable blocks: callouts written `> [!note]-` (folded) or `> [!note]+`
// (open), and HTML <details> blocks (folded unless <details open>). The
// header stays visible with a chevron; clicking it folds or unfolds.
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/** Toggles the fold whose header line starts at `pos`. */
export const toggleFold = StateEffect.define({ map: (pos, mapping) => mapping.mapPos(pos) });

const FOLDABLE_CALLOUT = /^\s*>\s*\[![\w-]+\]([+-])/;
const DETAILS_OPEN = /^\s*<details(\s[^>]*)?>/i;
const DETAILS_CLOSE = /<\/details>\s*$/i;

/**
 * Foldable regions: { header (line start), bodyFrom, bodyTo, startsFolded }.
 * The body is the lines after the header (for <details>, through the
 * closing tag).
 */
export function foldableRegions(doc) {
  const regions = [];
  let fence = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const trimmed = line.text.trimStart();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }
    const callout = FOLDABLE_CALLOUT.exec(line.text);
    if (callout) {
      let last = n;
      while (last + 1 <= doc.lines && /^\s*>/.test(doc.line(last + 1).text)) last++;
      if (last > n) {
        regions.push({ header: line.from, bodyFrom: doc.line(n + 1).from, bodyTo: doc.line(last).to, startsFolded: callout[1] === "-" });
      }
      n = last;
      continue;
    }
    const details = DETAILS_OPEN.exec(line.text);
    if (details) {
      let end = n;
      while (end <= doc.lines && !DETAILS_CLOSE.test(doc.line(end).text)) end++;
      if (end > doc.lines) continue; // unclosed
      // The header is the <summary> line if it's next, else the <details> line.
      let headerLine = n;
      if (!/<summary>/i.test(line.text) && n + 1 < end && /<summary>/i.test(doc.line(n + 1).text)) headerLine = n + 1;
      if (end > headerLine) {
        regions.push({
          header: doc.line(headerLine).from,
          bodyFrom: doc.line(headerLine + 1).from,
          bodyTo: doc.line(end).to,
          startsFolded: !/\bopen\b/i.test(details[1] ?? ""),
        });
      }
      n = end;
    }
  }
  return regions;
}

/** Header positions currently folded. */
export const foldedHeaders = StateField.define({
  create(state) {
    return new Set(foldableRegions(state.doc).filter((r) => r.startsFolded).map((r) => r.header));
  },
  update(folded, transaction) {
    let next = folded;
    if (transaction.docChanged) {
      next = new Set([...folded].map((pos) => transaction.changes.mapPos(pos)));
    }
    for (const effect of transaction.effects) {
      if (!effect.is(toggleFold)) continue;
      next = new Set(next);
      if (next.has(effect.value)) next.delete(effect.value);
      else next.add(effect.value);
    }
    return next;
  },
});

function buildFolds(state) {
  const folded = state.field(foldedHeaders);
  const ranges = foldableRegions(state.doc)
    .filter((region) => folded.has(region.header))
    .map((region) => Decoration.replace({ block: true }).range(region.bodyFrom, region.bodyTo));
  return Decoration.set(ranges, true);
}

const foldDecorations = StateField.define({
  create: buildFolds,
  update(value, transaction) {
    const toggled = transaction.effects.some((effect) => effect.is(toggleFold));
    return transaction.docChanged || toggled ? buildFolds(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Whether the header starting at `pos` is foldable, and folded. */
export function foldStatus(state, pos) {
  const folded = state.field(foldedHeaders, false);
  if (!folded) return null;
  const region = foldableRegions(state.doc).find((r) => r.header === pos);
  if (!region) return null;
  return { folded: folded.has(pos) };
}

const foldClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const toggle = event.target.closest("[data-fold-header]");
    if (!toggle) return false;
    event.preventDefault();
    view.dispatch({ effects: toggleFold.of(Number(toggle.dataset.foldHeader)) });
    return true;
  },
});

export const folding = [foldedHeaders, foldDecorations, foldClicks];
