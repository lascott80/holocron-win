import Foundation
import Observation

/// An open markdown note. Edits are written back to disk shortly after typing
/// stops, always atomically so sync tools never see a half-written file.
///
/// The file on disk can also change underneath us (Dropbox, iCloud, another
/// editor). `reconcileWithDisk()` handles that: clean notes reload, edits that
/// don't overlap are merged, and overlapping edits raise a `conflict` for the
/// user to resolve. Nothing is written while a conflict is open.
@Observable
final class NoteDocument {
    /// What happened the last time the file changed on disk.
    enum SyncEvent: Equatable {
        case reloaded
        case merged
    }

    /// Two versions of the note to choose between: Holocron's (`text`) and
    /// another (`diskText`).
    struct Conflict {
        /// Where the other version came from.
        enum Origin {
            /// The file changed on disk while there were unsaved edits.
            case disk
            /// iCloud kept a version saved on another device at the same time.
            case otherDevice(name: String?, date: Date?)
            /// A numbered copy ("Kyber 2.md") that may be an iCloud duplicate.
            case duplicate(URL)
        }

        /// How the user resolved it, for cleaning up afterwards.
        enum Resolution {
            case mine, theirs, both
        }

        let diskText: String
        let merge: TextMerge.Result
        /// The text both versions started from.
        let baseText: String
        var origin: Origin = .disk
        /// Runs once the conflict is resolved (e.g. marks iCloud's version
        /// handled, or trashes a duplicate).
        var onResolve: ((Resolution) -> Void)?

        var isFromDisk: Bool {
            if case .disk = origin { return true }
            return false
        }
    }

    /// Finds conflicting iCloud versions of a file (replaceable in tests).
    @ObservationIgnored var conflictVersions: (URL) -> [CloudFiles.ConflictVersion] = CloudFiles.conflictVersions(of:)

    private(set) var url: URL

    var text: String {
        didSet {
            guard text != oldValue else { return }
            isDirty = text != savedText
            if isDirty { scheduleSave() }
            onTextChange?(text)
        }
    }

    /// Called after every change to `text`, from any source.
    @ObservationIgnored var onTextChange: ((String) -> Void)?

    private(set) var isDirty = false
    private(set) var lastSaved: Date?
    private(set) var saveError: String?
    private(set) var conflict: Conflict?
    private(set) var isMissingOnDisk = false
    private(set) var lastSyncEvent: (kind: SyncEvent, date: Date)?

    /// Merge non-overlapping outside changes without asking. Follows the
    /// app setting unless set explicitly (as tests do).
    var autoMergeExternalChanges: Bool {
        get { autoMergeOverride ?? AppSettings.shared.autoMergeExternalChanges }
        set { autoMergeOverride = newValue }
    }
    @ObservationIgnored private var autoMergeOverride: Bool?

    /// Called with (old, new) when the text was replaced from outside the
    /// editor (a reload or merge), so the editor can update in place.
    @ObservationIgnored var onExternalTextChange: ((String, String) -> Void)?

    /// The text as last read from or written to disk — the common ancestor
    /// for merging outside changes with ours.
    @ObservationIgnored private(set) var savedText: String
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let saveDelay: Duration

    var title: String { url.deletingPathExtension().lastPathComponent }

    var wordCount: Int {
        text.split { $0.isWhitespace || $0.isNewline }.count
    }

    init(url: URL, saveDelay: Duration = .seconds(1)) throws {
        self.url = url
        self.saveDelay = saveDelay
        let contents = try Self.read(url)
        self.text = contents
        self.savedText = contents
    }

    // MARK: - Saving

    /// Writes pending edits immediately. Safe to call when nothing changed.
    /// If the file changed on disk since we last looked, reconciles first
    /// instead of overwriting.
    func save() {
        saveTask?.cancel()
        saveTask = nil
        guard conflict == nil else { return }
        guard text != savedText || isMissingOnDisk else {
            isDirty = false
            return
        }
        if !isMissingOnDisk, let disk = try? Self.read(url), disk != savedText {
            reconcileWithDisk()
            // Reconciling may have merged (and scheduled another save) or
            // raised a conflict; either way don't write the old text now.
            return
        }
        write(text)
    }

    private func write(_ contents: String) {
        do {
            try CloudFiles.write(Data(contents.utf8), to: url)
            savedText = contents
            isDirty = text != savedText
            isMissingOnDisk = false
            saveError = nil
            lastSaved = .now
        } catch {
            saveError = error.localizedDescription
        }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self, saveDelay] in
            try? await Task.sleep(for: saveDelay)
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    // MARK: - Changes on disk

    /// Compares the file on disk with what we last read or wrote, and folds
    /// in any outside change. Called when the folder watcher reports this
    /// file, and before every save.
    func reconcileWithDisk() {
        guard FileManager.default.fileExists(atPath: url.path) else {
            isMissingOnDisk = true
            return
        }
        isMissingOnDisk = false
        guard let disk = try? Self.read(url) else { return }

        if conflict == nil, raiseOtherDeviceConflict() { return }

        if let conflict {
            guard conflict.isFromDisk else { return }
            // Still unresolved; keep the sheet in step with the latest disk text.
            if disk != conflict.diskText {
                self.conflict = Conflict(
                    diskText: disk,
                    merge: TextMerge.merge(base: conflict.baseText, mine: text, theirs: disk),
                    baseText: conflict.baseText
                )
            }
            return
        }

        guard disk != savedText else { return } // our own write, or no real change
        guard disk != text else {
            // The outside change matches our unsaved edits exactly.
            adoptDiskText(disk)
            return
        }

        if !isDirty {
            adoptDiskText(disk)
            lastSyncEvent = (.reloaded, .now)
            return
        }

        let merge = TextMerge.merge(base: savedText, mine: text, theirs: disk)
        if autoMergeExternalChanges, let merged = merge.mergedText {
            let base = disk
            savedText = base
            replaceText(merged)
            lastSyncEvent = (.merged, .now)
            if text != savedText { scheduleSave() }
        } else {
            saveTask?.cancel()
            conflict = Conflict(diskText: disk, merge: merge, baseText: savedText)
        }
    }

    /// If iCloud kept another device's version of this note, asks which to
    /// keep (or quietly resolves it when both say the same). Returns true if
    /// a conflict is now showing.
    private func raiseOtherDeviceConflict() -> Bool {
        let versions = conflictVersions(url)
        guard let newest = versions.first else { return false }
        let resolveAll = { versions.forEach { $0.resolve() } }
        if newest.text == text {
            resolveAll()
            return false
        }
        saveTask?.cancel()
        conflict = Conflict(
            diskText: newest.text,
            merge: TextMerge.merge(base: "", mine: text, theirs: newest.text),
            baseText: savedText,
            origin: .otherDevice(name: newest.deviceName, date: newest.date),
            onResolve: { _ in resolveAll() }
        )
        return true
    }

    /// Asks which version to keep if iCloud kept another device's version.
    func checkForConflictingVersions() {
        if conflict == nil { _ = raiseOtherDeviceConflict() }
    }

    /// Shows this note side by side with a possible duplicate of it.
    /// `onResolve` tidies up the duplicate afterwards.
    func compare(withDuplicate duplicate: URL, onResolve: @escaping (Conflict.Resolution) -> Void) {
        guard conflict == nil, let other = try? Self.read(duplicate) else { return }
        save()
        conflict = Conflict(
            diskText: other,
            merge: TextMerge.merge(base: "", mine: text, theirs: other),
            baseText: savedText,
            origin: .duplicate(duplicate),
            onResolve: onResolve
        )
    }

    /// The file vanished from disk (deleted, or renamed by another app).
    var canBeClosedSafely: Bool { isMissingOnDisk && !isDirty && conflict == nil }

    // MARK: - Resolving a conflict

    /// Overwrites the disk version with the text in Holocron.
    func resolveKeepingMine() {
        guard let conflict else { return }
        self.conflict = nil
        write(text)
        conflict.onResolve?(.mine)
    }

    /// Discards the edits made in Holocron and shows the other version.
    func resolveUsingDisk() {
        guard let conflict else { return }
        self.conflict = nil
        adoptDiskText(conflict.diskText)
        // A disk change is already in the file; the others aren't.
        if !conflict.isFromDisk { write(conflict.diskText) }
        lastSyncEvent = (.reloaded, .now)
        conflict.onResolve?(.theirs)
    }

    /// Applies the clean three-way merge (only possible when the two sets of
    /// changes don't overlap).
    func resolveMerging() {
        guard let conflict, conflict.isFromDisk, let merged = conflict.merge.mergedText else { return }
        self.conflict = nil
        savedText = conflict.diskText
        replaceText(merged)
        lastSyncEvent = (.merged, .now)
        write(merged)
        conflict.onResolve?(.both)
    }

    /// Saves Holocron's text as a separate "conflicted copy" note beside this
    /// one, then shows the disk version here. Returns the copy's URL.
    ///
    /// For another device's version it's the other way round: this Mac's
    /// version stays here and the other device's is saved as the copy. A
    /// duplicate is simply left as its own note.
    @discardableResult
    func resolveKeepingBoth() -> URL? {
        guard let conflict else { return nil }
        if case .duplicate(let duplicate) = conflict.origin {
            self.conflict = nil
            write(text)
            conflict.onResolve?(.both)
            return duplicate
        }
        let folder = url.deletingLastPathComponent()
        let stamp = Self.copyStampFormatter.string(from: .now)
        let copy = Vault.uniqueURL(named: "\(title) (conflicted copy \(stamp))", extension: url.pathExtension, in: folder)
        let copyText = conflict.isFromDisk ? text : conflict.diskText
        do {
            try CloudFiles.write(Data(copyText.utf8), to: copy, options: .withoutOverwriting)
        } catch {
            saveError = error.localizedDescription
            return nil
        }
        self.conflict = nil
        if conflict.isFromDisk {
            adoptDiskText(conflict.diskText)
        } else {
            write(text)
        }
        conflict.onResolve?(.both)
        return copy
    }

    /// Records that the file was renamed or moved (by Holocron).
    func didMove(to newURL: URL) {
        url = newURL
    }

    /// Replaces the whole text from outside the editor (e.g. links rewritten
    /// after another note was renamed) and saves it.
    func replaceContents(_ newText: String) {
        replaceText(newText)
        save()
    }

    // MARK: - Helpers

    /// Makes the disk text current and clean.
    private func adoptDiskText(_ disk: String) {
        saveTask?.cancel()
        savedText = disk
        replaceText(disk)
        isDirty = false
    }

    private func replaceText(_ newText: String) {
        guard newText != text else { return }
        let oldText = text
        text = newText
        onExternalTextChange?(oldText, newText)
    }

    private static func read(_ url: URL) throws -> String {
        String(decoding: try CloudFiles.read(url), as: UTF8.self)
    }

    private static let copyStampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HHmm"
        return formatter
    }()
}
