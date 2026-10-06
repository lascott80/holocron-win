// Highlight tags shared by the small stream modes and codeHighlight.
import { Tag, tags as t } from "@lezer/highlight";

/** Headings inside a ```markdown block (the note's own headings use t.heading). */
export const codeHeading = Tag.define(t.keyword);
