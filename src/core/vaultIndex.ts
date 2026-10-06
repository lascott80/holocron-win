// In-memory index of every note's headings, links, tags and aliases. Powers
// backlinks, mentions, tags and quick open. It never reads files: the owner
// feeds it the vault's note paths (`setPaths`) and each note's text (`update`).

import { isAttachmentTarget } from "./attachments";
import { LinkResolver, parse, trimWhitespace, type NoteInfo } from "./noteParser";
import { naturalCompare, title as pathTitle } from "./paths";

export interface Backlink {
  /** Vault-relative path of the linking note. */
  source: string;
  title: string;
  /** The lines containing the links. */
  contexts: string[];
}

export interface Mention {
  source: string;
  title: string;
  context: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface OutgoingLink {
  /** The link's path as written. */
  target: string;
  /** The note it resolves to, or null when it doesn't exist yet. */
  resolved: string | null;
}

/** A note's text and tags, for full-text search. */
export interface SearchNote {
  path: string;
  text: string;
  tags: string[];
}

/** Lines split at "\n" with a trailing "\r" removed, matching `parse`'s line numbers. */
function textLines(text: string): string[] {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

export class VaultIndex {
  private notes = new Map<string, NoteInfo>();
  private texts = new Map<string, string>();
  private knownPaths = new Set<string>();
  private _resolver = new LinkResolver([]);
  private _revision = 0;

  /** Bumped on every change, so observers can check cheaply. */
  get revision(): number {
    return this._revision;
  }

  get resolver(): LinkResolver {
    return this._resolver;
  }

  /** Every indexed note's info, by path. */
  get allNotes(): ReadonlyMap<string, NoteInfo> {
    return this.notes;
  }

  // MARK: - Updating

  /**
   * Sets the vault's note paths: rebuilds the resolver and drops removed
   * notes. Returns the paths not indexed yet, whose text should be read
   * and passed to `update`.
   */
  setPaths(paths: Iterable<string>): string[] {
    const all = [...paths];
    this._resolver = new LinkResolver(all);
    this.knownPaths = new Set(all);
    for (const path of [...this.notes.keys()]) {
      if (!this.knownPaths.has(path)) {
        this.notes.delete(path);
        this.texts.delete(path);
      }
    }
    this._revision++;
    return all.filter((path) => !this.notes.has(path));
  }

  /** Whether `path` is one of the vault's notes as of the last `setPaths`. */
  hasPath(path: string): boolean {
    return this.knownPaths.has(path);
  }

  /** Re-parses a note from its text. Returns false when the text is unchanged. */
  update(path: string, text: string): boolean {
    if (this.texts.get(path) === text) return false;
    this.texts.set(path, text);
    this.notes.set(path, parse(text));
    this._revision++;
    return true;
  }

  // MARK: - Queries

  info(path: string): NoteInfo | null {
    return this.notes.get(path) ?? null;
  }

  /** Every indexed note's text and tags, for searching. */
  searchSnapshot(): SearchNote[] {
    return [...this.texts].map(([path, text]) => ({ path, text, tags: this.notes.get(path)?.tags ?? [] }));
  }

  /** Notes that link to `path`, by title. */
  backlinks(path: string): Backlink[] {
    const result: Backlink[] = [];
    for (const [source, info] of this.notes) {
      if (source === path) continue;
      const contexts = [
        ...new Set(info.links.filter((link) => this._resolver.resolve(link, source) === path).map((link) => link.context)),
      ];
      if (contexts.length > 0) result.push({ source, title: VaultIndex.title(source), contexts });
    }
    return result.sort((a, b) => naturalCompare(a.title, b.title));
  }

  /** Notes that mention `path`'s name (or an alias) in plain text without linking to it. */
  unlinkedMentions(path: string, limit = 50): Mention[] {
    const names = [VaultIndex.title(path), ...(this.notes.get(path)?.aliases ?? [])].filter(
      (name) => [...name].length >= 3,
    );
    if (names.length === 0) return [];

    const result: Mention[] = [];
    for (const [source, text] of this.texts) {
      if (source === path) continue;
      const linkedLines = new Set(
        (this.notes.get(source)?.links ?? [])
          .filter((link) => this._resolver.resolve(link, source) === path)
          .map((link) => link.line),
      );
      const lines = textLines(text);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (linkedLines.has(index + 1) || !names.some((name) => VaultIndex.containsWord(name, line))) continue;
        result.push({ source, title: VaultIndex.title(source), context: trimWhitespace(line) });
        break;
      }
      if (result.length >= limit) break;
    }
    return result.sort((a, b) => naturalCompare(a.title, b.title));
  }

  /** Notes that `path` links to, de-duplicated, skipping attachments and same-note headings. */
  outgoingLinks(path: string): OutgoingLink[] {
    const seen = new Set<string>();
    const result: OutgoingLink[] = [];
    for (const link of this.notes.get(path)?.links ?? []) {
      const target = LinkResolver.linkPath(link.target);
      const key = target.toLowerCase();
      if (target === "" || isAttachmentTarget(target) || seen.has(key)) continue;
      seen.add(key);
      result.push({ target, resolved: this._resolver.resolve(link, path) });
    }
    return result;
  }

  /** Every tag with the number of notes using it, most used first. */
  allTags(): TagCount[] {
    const counts = new Map<string, TagCount>();
    for (const info of this.notes.values()) {
      for (const tag of info.tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || naturalCompare(a.tag, b.tag));
  }

  /** Notes tagged `tag` or a nested tag under it ("lore" matches "lore/crystals"). */
  notesTaggedWith(tag: string): string[] {
    const wanted = tag.toLowerCase().replace(/^#+|#+$/g, "");
    const result: string[] = [];
    for (const [path, info] of this.notes) {
      if (info.tags.some((t) => t.toLowerCase() === wanted || t.toLowerCase().startsWith(wanted + "/"))) result.push(path);
    }
    return result.sort(naturalCompare);
  }

  // MARK: - Helpers

  static title(path: string): string {
    return pathTitle(path);
  }

  /** Case- and accent-insensitive whole-word search (letter/digit boundaries). */
  static containsWord(word: string, line: string): boolean {
    const needle = fold(word);
    if (needle === "") return false;
    const haystack = fold(line);
    for (let found = haystack.indexOf(needle); found >= 0; found = haystack.indexOf(needle, found + 1)) {
      if (isBoundary(codePointBefore(haystack, found)) && isBoundary(haystack.codePointAt(found + needle.length))) {
        return true;
      }
    }
    return false;
  }
}

/** Lowercased with accents removed: "Ébène" → "ebene". */
function fold(text: string): string {
  return text.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "");
}

function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(index - 2);
  }
  return low;
}

function isBoundary(codePoint: number | undefined): boolean {
  return codePoint === undefined || !/[\p{L}\p{N}]/u.test(String.fromCodePoint(codePoint));
}
