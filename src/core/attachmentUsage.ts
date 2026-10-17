// Which notes use which attachments, and where each attachment belongs.
// Used to keep the attachment folder tidy: one subfolder per note
// ("Attachments/Lore/Kyber/crystal.png"), shared files in "Shared", and
// unused files found for clean-up. Pure functions over paths and texts.

import { AttachmentLookup, isAttachmentTarget, normalize } from "./attachments";
import { relativePath, rewrite } from "./linkRewriter";
import { basename, dirname, extname, isUnder, join, stem, uniqueName, withoutExtension } from "./paths";

/** The subfolder of the attachment folder for files used by more than one note. */
export const SHARED_FOLDER = "Shared";

export interface AttachmentMove {
  from: string;
  to: string;
}

/** The folder a note's own attachments go in: "Attachments" + "Lore/Kyber.md" → "Attachments/Lore/Kyber". */
export function noteAttachmentFolder(root: string, notePath: string): string {
  return join(root, withoutExtension(notePath));
}

/** Every attachment a note links to or embeds, by vault path. Links in code are ignored. */
export function attachmentRefs(text: string, notePath: string, lookup: AttachmentLookup): Set<string> {
  const found = new Set<string>();
  rewrite(text, (target) => {
    if (isAttachmentTarget(target.path)) {
      const path = lookup.resolve(target.path, notePath);
      if (path !== null) found.add(path);
    }
    return null;
  });
  return found;
}

/** For each attachment, the notes that use it (empty when none do). */
export function attachmentUsage(
  texts: Iterable<readonly [notePath: string, text: string]>,
  attachments: readonly string[],
): Map<string, Set<string>> {
  const lookup = new AttachmentLookup(attachments);
  const usage = new Map<string, Set<string>>(attachments.map((path) => [path, new Set<string>()]));
  for (const [note, text] of texts) {
    for (const path of attachmentRefs(text, note, lookup)) usage.get(path)?.add(note);
  }
  return usage;
}

/** Attachments no note uses. */
export function unusedAttachments(usage: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return [...usage].filter(([, users]) => users.size === 0).map(([path]) => path);
}

/** Attachments used only by notes for which `isGoing` is true, e.g. the notes being deleted. */
export function attachmentsOnlyUsedBy(
  usage: ReadonlyMap<string, ReadonlySet<string>>,
  isGoing: (notePath: string) => boolean,
): string[] {
  return [...usage]
    .filter(([, users]) => users.size > 0 && [...users].every(isGoing))
    .map(([path]) => path);
}

/**
 * Moves that sort the attachment folder: a file used by one note goes in
 * that note's folder, a file used by several goes in "Shared". Unused files,
 * files outside `root` and files already in place stay put. Clashing names
 * are numbered ("crystal 2.png"); `existing` is every file in the vault.
 */
export function planOrganise(
  usage: ReadonlyMap<string, ReadonlySet<string>>,
  root: string,
  existing: Iterable<string>,
): AttachmentMove[] {
  const taken = new Set([...existing].map((path) => path.toLowerCase()));
  const moves: AttachmentMove[] = [];
  for (const [path, users] of [...usage].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (users.size === 0 || !isUnder(path, root)) continue;
    const folder = users.size === 1 ? noteAttachmentFolder(root, [...users][0]) : join(root, SHARED_FOLDER);
    if (dirname(path).toLowerCase() === folder.toLowerCase()) continue;
    const name = uniqueName(stem(path), extname(path), (candidate) => taken.has(join(folder, candidate).toLowerCase()));
    const to = join(folder, name);
    taken.add(to.toLowerCase());
    moves.push({ from: path, to });
  }
  return moves;
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
 * else the vault path; markdown links stay relative (or absolute if they were).
 */
export function rewriteAttachmentLinks(text: string, change: AttachmentRewrite): string {
  return rewrite(text, (target) => {
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
    // Markdown links are read by other apps too, so they must be right as written.
    if (target.path.startsWith("/")) return now === undefined ? null : "/" + destination;
    const written = normalize(join(dirname(change.newNote), target.path.replace(/\\/g, "/")));
    if (written.toLowerCase() === destination.toLowerCase()) return null;
    return relativePath(dirname(change.newNote), destination);
  });
}
