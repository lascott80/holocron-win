// Footnotes you can read in place: hovering a reference ([^1], drawn by
// livePreview.js) shows its text in a small popover, and in reading view the
// first definition gets a "Footnotes" heading above it (theme below).
import { EditorView, ViewPlugin } from "@codemirror/view";
import { renderInline } from "./inline.js";
import { UI_FONT } from "./platform.js";

/**
 * A footnote's text: what follows `[^label]:` plus any indented lines after
 * it (joined with spaces). null when there's no definition.
 */
export function footnoteText(doc, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = typeof doc === "string" ? doc : doc.toString();
  const lines = text.split("\n");
  const head = new RegExp(`^\\[\\^${escaped}\\]:\\s?(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const match = head.exec(lines[i].replace(/\r$/, ""));
    if (!match) continue;
    const parts = [match[1].trim()];
    for (let j = i + 1; j < lines.length && /^( {2,}|\t)\S/.test(lines[j]); j++) parts.push(lines[j].trim());
    return parts.filter(Boolean).join(" ");
  }
  return null;
}

export const footnotes = [
  ViewPlugin.define((view) => {
    const popover = document.createElement("div");
    popover.className = "cm-footnote-popover";
    popover.setAttribute("role", "tooltip");
    let shownFor = null;
    let hideTimer = 0;
    const hide = () => {
      clearTimeout(hideTimer);
      shownFor = null;
      popover.classList.remove("is-shown");
    };
    const show = (ref) => {
      clearTimeout(hideTimer);
      if (shownFor === ref) return;
      const text = footnoteText(view.state.doc, ref.dataset.footnote);
      popover.replaceChildren();
      const number = document.createElement("span");
      number.className = "cm-footnote-popover-number";
      number.textContent = `${ref.textContent}.`;
      popover.append(number, text === null ? Object.assign(document.createElement("em"), { textContent: "No footnote text yet." }) : renderInline(text));
      const box = ref.getBoundingClientRect();
      const host = view.dom.getBoundingClientRect();
      const left = Math.min(Math.max(8, box.left - host.left - 12), host.width - 340);
      popover.style.left = `${Math.max(8, left)}px`;
      popover.style.top = `${box.bottom - host.top + 6}px`;
      popover.classList.add("is-shown");
      shownFor = ref;
      shownAt = view.scrollDOM.scrollTop;
    };
    const onOver = (event) => {
      const ref = event.target instanceof Element ? event.target.closest(".cm-footnote-ref") : null;
      if (ref && ref.closest(".cm-editor") === view.dom) show(ref);
      else if (shownFor && !popover.contains(event.target)) hideTimer = setTimeout(hide, 120);
    };
    view.dom.appendChild(popover);
    view.dom.addEventListener("mouseover", onOver);
    view.dom.addEventListener("mouseleave", hide);
    // Only a real scroll hides it, not the editor nudging its scroll position while measuring.
    let shownAt = 0;
    const onScroll = () => {
      if (Math.abs(view.scrollDOM.scrollTop - shownAt) > 4) hide();
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return {
      update(update) {
        if (update.docChanged) hide();
      },
      destroy() {
        clearTimeout(hideTimer);
        popover.remove();
        view.dom.removeEventListener("mouseover", onOver);
        view.dom.removeEventListener("mouseleave", hide);
        view.scrollDOM.removeEventListener("scroll", onScroll);
      },
    };
  }),
  EditorView.baseTheme({
    ".cm-footnote-popover": {
      position: "absolute",
      zIndex: "6",
      maxWidth: "320px",
      padding: "8px 11px",
      borderRadius: "8px",
      border: "1px solid var(--hc-border)",
      background: "var(--hc-panel)",
      color: "var(--hc-text)",
      boxShadow: "0 6px 20px rgba(0, 0, 0, 0.2)",
      fontSize: "0.88em",
      lineHeight: "1.5",
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 100ms",
    },
    ".cm-footnote-popover.is-shown": { opacity: "1", pointerEvents: "auto" },
    ".cm-footnote-popover-number": { color: "var(--hc-muted)", marginRight: "6px", fontFamily: UI_FONT },
    // Reading view: a "Footnotes" heading above the first definition.
    "&.cm-mode-reading .cm-footnotes-start::before": {
      content: '"Footnotes"',
      display: "block",
      margin: "1.2em 0 0.4em",
      paddingTop: "0.6em",
      borderTop: "1px solid var(--hc-border)",
      fontFamily: UI_FONT,
      fontSize: "12px",
      fontWeight: "600",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "var(--hc-muted)",
    },
  }),
];
