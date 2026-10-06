// An open markdown note. Edits are written back to disk shortly after typing
// stops, always atomically so sync tools never see a half-written file.
//
// The file on disk can also change underneath us (Dropbox, Git, another
// editor). `reconcileWithDisk()` handles that: clean notes reload, edits that
// don't overlap are merged, and overlapping edits raise a `conflict` for the
// user to resolve. Nothing is written while a conflict is open.
// (REQUIREMENTS §14; port of NoteDocument.swift.)

import path from "node:path";
import { merge, type MergeResult } from "@core/merge";
import { uniqueName } from "@core/paths";
import * as fsx from "./fsx";

export type SyncEvent = "reloaded" | "merged";
export type Resolution = "mine" | "theirs" | "both";

/** Two versions of the note to choose between: Holocron's (`text`) and another (`diskText`). */
export interface Conflict {
  diskText: string;
  merge: MergeResult;
  /** The text both versions started from. */
  baseText: string;
  /** Where the other version came from. Only outside changes on disk for now (no iCloud on Windows). */
  origin: "disk";
}

export interface NoteDocumentOptions {
  /** Delay between the last edit and the autosave, in ms. */
  saveDelay?: number;
  /** Merge non-overlapping outside changes without asking. */
  autoMerge?: () => boolean;
  /** Called with the conflicted copy's file name so the vault can remember it. */
  now?: () => Date;
}

export class NoteDocument {
  private _file: string;
  private _text: string;
  /** The text as last read from or written to disk — the common ancestor for merging. */
  private _savedText: string;
  private _isDirty = false;
  private _lastSaved: Date | null = null;
  private _saveError: string | null = null;
  private _conflict: Conflict | null = null;
  private _isMissingOnDisk = false;
  private _lastSyncEvent: { kind: SyncEvent; date: Date } | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly saveDelay: number;
  private readonly autoMerge: () => boolean;
  private readonly now: () => Date;

  /** Called after every change to `text`, from any source. */
  onTextChange: ((text: string) => void) | null = null;
  /** Called with (old, new) when the text was replaced from outside the editor (a reload or merge). */
  onExternalTextChange: ((oldText: string, newText: string) => void) | null = null;
  /** Called whenever anything observable changes (dirty, saved, error, conflict…). */
  onStateChange: (() => void) | null = null;

  constructor(file: string, options: NoteDocumentOptions = {}) {
    this._file = file;
    this.saveDelay = options.saveDelay ?? 1000;
    this.autoMerge = options.autoMerge ?? (() => true);
    this.now = options.now ?? (() => new Date());
    const contents = fsx.readText(file);
    this._text = contents;
    this._savedText = contents;
  }

  get file() { return this._file; }
  get text() { return this._text; }
  get savedText() { return this._savedText; }
  get isDirty() { return this._isDirty; }
  get lastSaved() { return this._lastSaved; }
  get saveError() { return this._saveError; }
  get conflict() { return this._conflict; }
  get isMissingOnDisk() { return this._isMissingOnDisk; }
  get lastSyncEvent() { return this._lastSyncEvent; }
  get title() { return path.parse(this._file).name; }

  /** Words: whitespace-separated tokens of the whole text (the status bar's count). */
  get wordCount() {
    return this._text.split(/\s+/).filter(Boolean).length;
  }

  /** Sets the text from the editor. */
  setText(text: string) {
    if (text === this._text) return;
    this._text = text;
    this._isDirty = text !== this._savedText;
    if (this._isDirty) this.scheduleSave();
    this.onTextChange?.(text);
    this.changed();
  }

  // MARK: Saving

  /**
   * Writes pending edits immediately. Safe to call when nothing changed. If
   * the file changed on disk since we last looked, reconciles first instead
   * of overwriting.
   */
  save() {
    this.cancelSave();
    if (this._conflict) return;
    if (this._text === this._savedText && !this._isMissingOnDisk) {
      this.setDirty(false);
      return;
    }
    if (!this._isMissingOnDisk) {
      let disk: string | null = null;
      try {
        disk = fsx.readText(this._file);
      } catch {
        disk = null;
      }
      if (disk !== null && disk !== this._savedText) {
        // Reconciling may merge (and schedule another save) or raise a
        // conflict; either way don't write the old text now.
        this.reconcileWithDisk();
        return;
      }
    }
    this.write(this._text);
  }

  private write(contents: string) {
    try {
      fsx.writeAtomic(this._file, contents);
      this._savedText = contents;
      this._isDirty = this._text !== this._savedText;
      this._isMissingOnDisk = false;
      this._saveError = null;
      this._lastSaved = this.now();
    } catch (error) {
      this._saveError = (error as Error).message;
    }
    this.changed();
  }

  private scheduleSave() {
    this.cancelSave();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, this.saveDelay);
  }

  private cancelSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  // MARK: Changes on disk

  /**
   * Compares the file on disk with what we last read or wrote, and folds in
   * any outside change. Called when the watcher reports this file, and
   * before every save.
   */
  reconcileWithDisk() {
    if (!fsx.exists(this._file)) {
      if (!this._isMissingOnDisk) {
        this._isMissingOnDisk = true;
        this.changed();
      }
      return;
    }
    if (this._isMissingOnDisk) {
      this._isMissingOnDisk = false;
      this.changed();
    }
    let disk: string;
    try {
      disk = fsx.readText(this._file);
    } catch {
      return;
    }

    const conflict = this._conflict;
    if (conflict) {
      // Still unresolved; keep the sheet in step with the latest disk text.
      if (disk !== conflict.diskText) {
        this._conflict = { ...conflict, diskText: disk, merge: merge(conflict.baseText, this._text, disk) };
        this.changed();
      }
      return;
    }

    if (disk === this._savedText) return; // our own write, or no real change
    if (disk === this._text) {
      // The outside change matches our unsaved edits exactly.
      this.adoptDiskText(disk);
      return;
    }

    if (!this._isDirty) {
      this.adoptDiskText(disk);
      this._lastSyncEvent = { kind: "reloaded", date: this.now() };
      this.changed();
      return;
    }

    const result = merge(this._savedText, this._text, disk);
    if (this.autoMerge() && result.mergedText !== null) {
      this._savedText = disk;
      this.replaceText(result.mergedText);
      this._lastSyncEvent = { kind: "merged", date: this.now() };
      if (this._text !== this._savedText) this.scheduleSave();
    } else {
      this.cancelSave();
      this._conflict = { diskText: disk, merge: result, baseText: this._savedText, origin: "disk" };
    }
    this.changed();
  }

  /** The file vanished from disk and there's nothing to lose by closing it. */
  get canBeClosedSafely() {
    return this._isMissingOnDisk && !this._isDirty && this._conflict === null;
  }

  // MARK: Resolving a conflict

  /** Overwrites the disk version with the text in Holocron. */
  resolveKeepingMine() {
    if (!this._conflict) return;
    this._conflict = null;
    this.write(this._text);
  }

  /** Discards the edits made in Holocron and shows the disk version. */
  resolveUsingDisk() {
    const conflict = this._conflict;
    if (!conflict) return;
    this._conflict = null;
    this.adoptDiskText(conflict.diskText);
    this._lastSyncEvent = { kind: "reloaded", date: this.now() };
    this.changed();
  }

  /** Applies the clean three-way merge (only possible when the changes don't overlap). */
  resolveMerging() {
    const conflict = this._conflict;
    if (!conflict || conflict.merge.mergedText === null) return;
    const merged = conflict.merge.mergedText;
    this._conflict = null;
    this._savedText = conflict.diskText;
    this.replaceText(merged);
    this._lastSyncEvent = { kind: "merged", date: this.now() };
    this.write(merged);
  }

  /**
   * Saves Holocron's text as a separate "conflicted copy" note beside this
   * one, then shows the disk version here. Returns the copy's file, or null
   * (with `saveError` set) if the copy couldn't be written — the conflict
   * then stays open so nothing is lost.
   */
  resolveKeepingBoth(): string | null {
    const conflict = this._conflict;
    if (!conflict) return null;
    const folder = path.dirname(this._file);
    const ext = path.extname(this._file).slice(1);
    const name = uniqueName(`${this.title} (conflicted copy ${copyStamp(this.now())})`, ext, (candidate) =>
      fsx.exists(path.join(folder, candidate)),
    );
    const copy = path.join(folder, name);
    try {
      fsx.writeAtomic(copy, this._text, { withoutOverwriting: true });
    } catch (error) {
      this._saveError = (error as Error).message;
      this.changed();
      return null;
    }
    this._conflict = null;
    this.adoptDiskText(conflict.diskText);
    this.changed();
    return copy;
  }

  /** Records that the file was renamed or moved (by Holocron). */
  didMove(file: string) {
    this._file = file;
    this.changed();
  }

  /** Replaces the whole text from outside the editor (e.g. links rewritten after a rename) and saves it. */
  replaceContents(text: string) {
    this.replaceText(text);
    this.save();
  }

  /** Stops any pending autosave and detaches callbacks (the document is being dropped). */
  dispose() {
    this.cancelSave();
    this.onTextChange = null;
    this.onExternalTextChange = null;
    this.onStateChange = null;
  }

  // MARK: Helpers

  /** Makes the disk text current and clean. */
  private adoptDiskText(disk: string) {
    this.cancelSave();
    this._savedText = disk;
    this.replaceText(disk);
    this.setDirty(false);
  }

  private replaceText(text: string) {
    if (text === this._text) return;
    const old = this._text;
    this._text = text;
    this._isDirty = text !== this._savedText;
    this.onTextChange?.(text);
    this.onExternalTextChange?.(old, text);
    this.changed();
  }

  private setDirty(dirty: boolean) {
    if (this._isDirty === dirty) return;
    this._isDirty = dirty;
    this.changed();
  }

  private changed() {
    this.onStateChange?.();
  }
}

/** "2026-10-05 1432" (local time) for conflicted copy names. */
function copyStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}
