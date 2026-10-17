// Which notes use which attachments, and where each attachment belongs.
// Used to keep the attachment folder tidy: one subfolder per note
// ("Attachments/Lore/Kyber/crystal.png"), shared files in "Shared", and
// unused files found for clean-up. Pure functions over paths and texts.
//
// Safety comes first: a file counts as used by every link form the editor
// shows (REQUIREMENTS VLT-17), a file whose name merely appears in a note is
// "mentioned" and never moved or offered as unused by default, and every
// change can be checked with `brokenLinks` before and after it's made.

import { AttachmentLookup, isAttachmentTarget, normalize } from "./attachments";
import { relativePath, rewrite } from "./linkRewriter";
import { percentDecode } from "./noteParser";
import { basename, dirname, extname, isUnder, join, stem, uniqueName, withoutExtension } from "./paths";

/** The subfolder of the attachment folder for files used by more than one note. */
export const SHARED_FOLDER = "Shared";
/** The subfolder of the attachment folder that unused files are moved to before they're deleted. */
export const UNUSED_FOLDER = "_Unused";

export interface AttachmentMove {
  from: string;
  to: string;
}

/** The folder a note's own attachments go in: "Attachments" + "Lore/Kyber.md" → "Attachments/Lore/Kyber". */
export function noteAttachmentFolder(root: string, notePath: string): string {
  return join(root, withoutExtension(notePath));
}

/** Each attachment link's target in a note, in order; null where it doesn't resolve. Links in code are ignored. */
export function attachmentTargets(text: string, notePath: string, lookup: AttachmentLookup): (string | null)[] {
  const targets: (string | null)[] = [];
  rewrite(
    text,
    (target) => {
      if (isAttachmentTarget(target.path)) targets.push(lookup.resolve(target.path, notePath));
      return null;
    },
    { extended: true },
  );
  return targets;
}

/** Every attachment a note links to or embeds, by vault path. */
export function attachmentRefs(text: string, notePath: string, lookup: AttachmentLookup): Set<string> {
  return new Set(attachmentTargets(text, notePath, lookup).filter((path): path is string => path !== null));
}

/**
 * Finds attachments whose file name appears anywhere in a text (in code,
 * in HTML Holocron doesn't parse, percent-encoded…), as a safety net for
 * references `attachmentRefs` doesn't understand.
 */
export class NameMentions {
  /** Suffix length → lower-cased name suffix → paths. Names are matched at each "." in the text. */
  private readonly bySuffix = new Map<number, Map<string, string[]>>();

  constructor(paths: Iterable<string>) {
    for (const path of paths) {
      const name = basename(path).toLowerCase();
      const length = Math.min(name.length, 8);
      let table = this.bySuffix.get(length);
      if (!table) this.bySuffix.set(length, (table = new Map()));
      const key = name.slice(-length);
      const list = table.get(key);
      if (list) list.push(path);
      else table.set(key, [path]);
    }
  }

  find(text: string): Set<string> {
    const found = new Set<string>();
    this.scan(text.toLowerCase(), found);
    if (text.includes("%")) this.scan((percentDecode(text) ?? text.replace(/%20/g, " ")).toLowerCase(), found);
    return found;
  }

  private scan(lower: string, found: Set<string>) {
    for (let dot = lower.indexOf("."); dot >= 0; dot = lower.indexOf(".", dot + 1)) {
      let end = dot + 1;
      while (end < lower.length && /[\p{L}\p{N}]/u.test(lower[end]!)) end++;
      if (end === dot + 1) continue;
      for (const [length, table] of this.bySuffix) {
        if (end < length) continue;
        for (const path of table.get(lower.slice(end - length, end)) ?? []) {
          const name = basename(path).toLowerCase();
          const start = end - name.length;
          if (start < 0 || !lower.startsWith(name, start)) continue;
          // Not the tail of a longer name: "mylogo.png" isn't "logo.png".
          if (start > 0 && /[\p{L}\p{N}]/u.test(lower[start - 1]!)) continue;
          found.add(path);
        }
      }
    }
  }
}

export interface AttachmentUsage {
  /** For each attachment, the notes that link to or embed it (empty when none do). */
  users: Map<string, Set<string>>;
  /** For each attachment, other notes that mention its file name without a link Holocron understands. */
  mentions: Map<string, Set<string>>;
}

/** Works out `AttachmentUsage` from every note's text. */
export function attachmentUsage(
  texts: Iterable<readonly [notePath: string, text: string]>,
  attachments: readonly string[],
): AttachmentUsage {
  const lookup = new AttachmentLookup(attachments);
  const names = new NameMentions(attachments);
  const users = new Map<string, Set<string>>(attachments.map((path) => [path, new Set<string>()]));
  const mentions = new Map<string, Set<string>>(attachments.map((path) => [path, new Set<string>()]));
  for (const [note, text] of texts) {
    const linked = attachmentRefs(text, note, lookup);
    for (const path of linked) users.get(path)?.add(note);
    for (const path of names.find(text)) if (!linked.has(path)) mentions.get(path)?.add(note);
  }
  return { users, mentions };
}

/** Attachments no note links to. Some may still be mentioned (see `usage.mentions`). */
export function unusedAttachments(usage: AttachmentUsage): string[] {
  return [...usage.users].filter(([, users]) => users.size === 0).map(([path]) => path);
}

/**
 * Attachments used only by notes for which `isGoing` is true, e.g. the notes
 * being deleted, and not mentioned by any other note.
 */
export function attachmentsOnlyUsedBy(usage: AttachmentUsage, isGoing: (notePath: string) => boolean): string[] {
  return [...usage.users]
    .filter(([path, users]) => users.size > 0 && [...users].every(isGoing) && [...(usage.mentions.get(path) ?? [])].every(isGoing))
    .map(([path]) => path);
}

export interface OrganisePlan {
  moves: AttachmentMove[];
  /** Used files left where they are because a note mentions them in a way Holocron can't update. */
  skipped: { path: string; notes: string[] }[];
}

/**
 * Moves that sort the attachment folder: a file used by one note goes in
 * that note's folder, a file used by several goes in "Shared". Unused files,
 * files outside `root` and files already in place stay put; so do mentioned
 * files (listed in `skipped`). Files in the unused folder that are used again
 * move back out. Clashing names are numbered ("crystal 2.png"); `existing`
 * is every file in the vault. With `onlyNote`, only that note's files.
 */
export function planOrganise(
  usage: AttachmentUsage,
  root: string,
  existing: Iterable<string>,
  onlyNote: string | null = null,
): OrganisePlan {
  const taken = new Set([...existing].map((path) => path.toLowerCase()));
  const moves: AttachmentMove[] = [];
  const skipped: OrganisePlan["skipped"] = [];
  for (const [path, users] of [...usage.users].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (users.size === 0 || !isUnder(path, root)) continue;
    if (onlyNote !== null && !users.has(onlyNote)) continue;
    const folder = users.size === 1 ? noteAttachmentFolder(root, [...users][0]!) : join(root, SHARED_FOLDER);
    if (dirname(path).toLowerCase() === folder.toLowerCase()) continue;
    const mentionedBy = [...(usage.mentions.get(path) ?? [])];
    if (mentionedBy.length) {
      skipped.push({ path, notes: mentionedBy.sort() });
      continue;
    }
    const name = uniqueName(stem(path), extname(path), (candidate) => taken.has(join(folder, candidate).toLowerCase()));
    const to = join(folder, name);
    taken.add(to.toLowerCase());
    moves.push({ from: path, to });
  }
  return { moves, skipped };
}

/**
 * Moves into the unused folder, keeping each file's place inside the
 * attachment folder: "Attachments/Old/a.png" → "Attachments/_Unused/2026-10-17/Old/a.png".
 */
export function planHolding(paths: readonly string[], root: string, date: string, existing: Iterable<string>): AttachmentMove[] {
  const taken = new Set([...existing].map((path) => path.toLowerCase()));
  const holding = join(root, UNUSED_FOLDER, date);
  return paths.map((from) => {
    const inside = isUnder(from, root) && root !== "" ? from.slice(root.length + 1) : from;
    const folder = join(holding, dirname(inside));
    const name = uniqueName(stem(from), extname(from), (candidate) => taken.has(join(folder, candidate).toLowerCase()));
    const to = join(folder, name);
    taken.add(to.toLowerCase());
    return { from, to };
  });
}

export interface AttachmentRewrite {
  /** The note's path before and after (the same unless the note itself moves). */
  oldNote: string;
  newNote: string;
  /** The vault's attachments before and after the change. */
  before: AttachmentLookup;
  after: AttachmentLookup;
  /** Attachments that move: old vault path → new. */
  moves: ReadonlyMap<string, string>;
}

/**
 * Keeps a note's attachment links pointing at the same files after
 * attachments (or the note) move. Links that still resolve correctly are left
 * as written. Otherwise wikilinks use the bare file name when it's unique,
 * else the vault path; markdown and HTML links stay relative (or absolute if
 * they were). Every link form `attachmentRefs` understands is updated.
 */
export function rewriteAttachmentLinks(text: string, change: AttachmentRewrite): string {
  return rewrite(
    text,
    (target) => {
      if (!isAttachmentTarget(target.path)) return null;
      const old = change.before.resolve(target.path, change.oldNote);
      if (old === null) return null;
      const now = change.moves.get(old);
      if (now === undefined && change.oldNote === change.newNote) return null;
      const destination = now ?? old;
      if (target.kind === "wiki") {
        if (change.after.resolve(target.path, change.newNote) === destination) return null;
        const name = basename(destination);
        return change.after.isNameUnique(destination) && change.after.resolve(name, change.newNote) === destination
          ? name
          : destination;
      }
      // Paths are read by other apps too, so they must be right as written.
      if (target.path.startsWith("/")) return now === undefined ? null : "/" + destination;
      const written = normalize(join(dirname(change.newNote), target.path.replace(/\\/g, "/")));
      if (written.toLowerCase() === destination.toLowerCase()) return null;
      return relativePath(dirname(change.newNote), destination);
    },
    { extended: true },
  );
}

export interface NoteChange {
  oldNote: string;
  newNote: string;
  before: string;
  after: string;
}

/**
 * Notes (by new path) where some attachment link that reached a file before
 * the change doesn't reach the same file (moved per `moves`) afterwards.
 * Pass every note that survives the change, rewritten or not.
 */
export function brokenLinks(
  changes: Iterable<NoteChange>,
  before: AttachmentLookup,
  after: AttachmentLookup,
  moves: ReadonlyMap<string, string>,
): string[] {
  const broken: string[] = [];
  for (const change of changes) {
    const was = attachmentTargets(change.before, change.oldNote, before);
    const now = attachmentTargets(change.after, change.newNote, after);
    const ok =
      was.length === now.length &&
      was.every((path, i) => path === null || (moves.get(path) ?? path).toLowerCase() === now[i]?.toLowerCase());
    if (!ok) broken.push(change.newNote);
  }
  return broken;
}
