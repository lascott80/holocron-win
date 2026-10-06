// Hover previews: hold ⌘ over a [[link]] to see the note in a popover
// without opening it. The popover stays while the mouse is over the link or
// the popover itself (so you can scroll it), and closes on Escape or scroll.
import { ViewPlugin } from "@codemirror/view";
import { embedDepth, notePreview } from "./embeds.js";

const SHOW_DELAY = 120;
const HIDE_DELAY = 250;

class HoverPreview {
  constructor(view) {
    this.view = view;
    this.link = null; // the link under the mouse
    this.shownFor = null; // the link the popover belongs to
    this.popover = null;
    this.preview = null;
    this.showTimer = null;
    this.hideTimer = null;

    this.onMove = (event) => {
      let link = event.target instanceof Element ? event.target.closest(".cm-wikilink[data-target]") : null;
      if (link && this.popover?.contains(link)) link = null; // links inside the preview just open on click
      if (link !== this.link) {
        this.link = link;
        clearTimeout(this.showTimer);
      }
      if (link && link === this.shownFor) return this.cancelHide();
      if (link && event.metaKey) this.scheduleShow();
      else if (this.popover && !this.popover.contains(event.target)) this.scheduleHide();
    };
    this.onLeave = () => {
      this.link = null;
      clearTimeout(this.showTimer);
      if (this.popover) this.scheduleHide();
    };
    this.onKeyDown = (event) => {
      if (event.key === "Meta" && this.link && this.link !== this.shownFor) this.scheduleShow();
      if (event.key === "Escape" && this.popover) {
        event.stopPropagation();
        this.hide();
      }
    };
    this.onScroll = () => this.hide();

    view.dom.addEventListener("mousemove", this.onMove);
    view.dom.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("keydown", this.onKeyDown, true);
    view.scrollDOM.addEventListener("scroll", this.onScroll);
  }

  scheduleShow() {
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.link && this.show(this.link), SHOW_DELAY);
  }

  scheduleHide() {
    if (this.hideTimer) return;
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY);
  }

  cancelHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  show(link) {
    this.hide();
    const raw = link.dataset.target;
    const hash = raw.indexOf("#");
    const target = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    const heading = hash >= 0 ? raw.slice(hash) : null;
    if (!target) return; // [[#Heading]] in the same note: nothing to preview

    this.preview = notePreview(target, heading);
    const popover = document.createElement("div");
    popover.className = "cm-hover-preview";
    popover.appendChild(this.preview.dom);
    popover.addEventListener("mouseenter", () => this.cancelHide());
    popover.addEventListener("mouseleave", () => this.scheduleHide());
    // Keep clicks inside the popover from moving the editor's cursor, and
    // close it once a link in it has been followed.
    popover.addEventListener("mousedown", (event) => event.stopPropagation());
    popover.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".cm-embed-header, .cm-wikilink")) this.hide();
    });
    this.view.dom.appendChild(popover);
    this.popover = popover;
    this.shownFor = link;
    this.place(link);
  }

  /** Below the link, or above it if there isn't room; kept inside the window. */
  place(link) {
    const anchor = link.getBoundingClientRect();
    const { width, height } = this.popover.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 && anchor.top - height - 6 > 8 ? anchor.top - height - 6 : below;
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  hide() {
    this.cancelHide();
    clearTimeout(this.showTimer);
    this.preview?.close();
    this.popover?.remove();
    this.preview = this.popover = this.shownFor = null;
  }

  destroy() {
    this.hide();
    this.view.dom.removeEventListener("mousemove", this.onMove);
    this.view.dom.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
  }
}

export const hoverPreview = ViewPlugin.define((view) => (view.state.facet(embedDepth) > 0 ? {} : new HoverPreview(view)));
