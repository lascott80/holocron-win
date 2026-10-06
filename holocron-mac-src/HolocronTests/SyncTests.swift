import Foundation
import Testing
@testable import Holocron

/// Simulates another app or device changing a note on disk.
private func changeOnDisk(_ url: URL, _ text: String) throws {
    try Data(text.utf8).write(to: url, options: .atomic)
}

private func readDisk(_ url: URL) throws -> String {
    try String(contentsOf: url, encoding: .utf8)
}

@Suite struct ExternalChangeTests {
    let temp: TemporaryVault
    let file: URL
    let document: NoteDocument

    init() throws {
        temp = try TemporaryVault()
        file = try temp.write("Kyber.md", "# Kyber\n\nIntro.\n\n- [ ] Map caves\n")
        document = try NoteDocument(url: file, saveDelay: .seconds(60))
    }

    @Test func cleanNoteReloadsQuietly() throws {
        var editorUpdates: [String] = []
        document.onExternalTextChange = { _, new in editorUpdates.append(new) }

        try changeOnDisk(file, "# Kyber\n\nIntro from my phone.\n")
        document.reconcileWithDisk()

        #expect(document.text == "# Kyber\n\nIntro from my phone.\n")
        #expect(!document.isDirty)
        #expect(document.conflict == nil)
        #expect(document.lastSyncEvent?.kind == .reloaded)
        #expect(editorUpdates == ["# Kyber\n\nIntro from my phone.\n"])
    }

    @Test func ourOwnSaveIsNotTreatedAsAnOutsideChange() throws {
        var editorUpdates = 0
        document.onExternalTextChange = { _, _ in editorUpdates += 1 }
        document.text += "More.\n"
        document.save()
        document.reconcileWithDisk()

        #expect(editorUpdates == 0)
        #expect(document.lastSyncEvent == nil)
    }

    @Test func nonOverlappingEditsMerge() throws {
        document.text = "# Kyber\n\nIntro, expanded.\n\n- [ ] Map caves\n"
        try changeOnDisk(file, "# Kyber\n\nIntro.\n\n- [x] Map caves\n")
        document.reconcileWithDisk()

        #expect(document.conflict == nil)
        #expect(document.text == "# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n")
        #expect(document.lastSyncEvent?.kind == .merged)

        document.save()
        #expect(try readDisk(file) == "# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n")
    }

    @Test func overlappingEditsRaiseAConflictAndBlockSaving() throws {
        document.text = "# Kyber\n\nMy intro.\n\n- [ ] Map caves\n"
        try changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n")
        document.reconcileWithDisk()

        let conflict = try #require(document.conflict)
        #expect(!conflict.merge.isClean)
        #expect(conflict.diskText.contains("Their intro."))

        document.save()
        #expect(try readDisk(file).contains("Their intro."), "must not overwrite while a conflict is open")
    }

    @Test func autoMergeOffAlwaysAsks() throws {
        document.autoMergeExternalChanges = false
        document.text = "# Kyber\n\nIntro, expanded.\n\n- [ ] Map caves\n"
        try changeOnDisk(file, "# Kyber\n\nIntro.\n\n- [x] Map caves\n")
        document.reconcileWithDisk()

        let conflict = try #require(document.conflict)
        #expect(conflict.merge.isClean)

        document.resolveMerging()
        #expect(document.conflict == nil)
        #expect(try readDisk(file) == "# Kyber\n\nIntro, expanded.\n\n- [x] Map caves\n")
    }

    @Test func saveChecksDiskFirst() throws {
        // The watcher hasn't reported the outside change yet when we save.
        document.text = "# Kyber\n\nMy intro.\n\n- [ ] Map caves\n"
        try changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n")
        document.save()

        #expect(document.conflict != nil)
        #expect(try readDisk(file).contains("Their intro."))
    }

    @Test func resolvingKeepsMine() throws {
        try makeConflict()
        document.resolveKeepingMine()
        #expect(document.conflict == nil)
        #expect(!document.isDirty)
        #expect(try readDisk(file).contains("My intro."))
    }

    @Test func resolvingUsesDisk() throws {
        try makeConflict()
        document.resolveUsingDisk()
        #expect(document.conflict == nil)
        #expect(!document.isDirty)
        #expect(document.text.contains("Their intro."))
        #expect(try readDisk(file).contains("Their intro."))
    }

    @Test func resolvingKeepsBothAsCopies() throws {
        try makeConflict()
        let copy = try #require(document.resolveKeepingBoth())

        #expect(copy.lastPathComponent.hasPrefix("Kyber (conflicted copy "))
        #expect(try readDisk(copy).contains("My intro."))
        #expect(document.text.contains("Their intro."))
        #expect(try readDisk(file).contains("Their intro."))
    }

    @Test func deletedFileIsReportedMissingAndCanBeRestored() throws {
        try FileManager.default.removeItem(at: file)
        document.reconcileWithDisk()
        #expect(document.isMissingOnDisk)
        #expect(document.canBeClosedSafely)

        document.text += "Unsaved.\n"
        #expect(!document.canBeClosedSafely)
        document.save()
        #expect(!document.isMissingOnDisk)
        #expect(try readDisk(file).hasSuffix("Unsaved.\n"))
    }

    private func makeConflict() throws {
        document.text = "# Kyber\n\nMy intro.\n\n- [ ] Map caves\n"
        try changeOnDisk(file, "# Kyber\n\nTheir intro.\n\n- [ ] Map caves\n")
        document.reconcileWithDisk()
        try #require(document.conflict != nil)
    }
}

@Suite struct EditOperationTests {
    @Test func producesTargetedLineEdits() {
        let old = "# Title\nkeep\nchange me\nkeep\n"
        let new = "# Title\nkeep\nchanged\nkeep\nadded\n"
        let edits = TextMerge.edits(from: old, to: new)
        #expect(edits == [
            .init(from: 13, to: 23, insert: "changed\n"),
            .init(from: 28, to: 28, insert: "added\n"),
        ])
    }

    @Test func offsetsAreUTF16() {
        let edits = TextMerge.edits(from: "🪐 one\ntwo\n", to: "🪐 one\n2\n")
        #expect(edits == [.init(from: 7, to: 11, insert: "2\n")]) // 🪐 is two UTF-16 units
    }
}

@Suite(.serialized) struct VaultWatcherTests {
    @Test func reportsChangedFilesAsRelativePaths() async throws {
        let temp = try TemporaryVault()
        try temp.write("Lore/Ilum.md", "a")

        var batches: [[String]] = []
        let watcher = VaultWatcher(root: temp.url, latency: 0.05) { batches.append($0) }
        watcher.start()
        defer { watcher.stop() }
        try await Task.sleep(for: .milliseconds(300))

        try changeOnDisk(temp.url.appendingPathComponent("Lore/Ilum.md"), "b")
        try temp.write(".obsidian/workspace.json", "{}")

        for _ in 0..<40 where !batches.joined().contains("Lore/Ilum.md") {
            try await Task.sleep(for: .milliseconds(50))
        }
        let reported = Set(batches.joined())
        #expect(reported.contains("Lore/Ilum.md"))
        #expect(!reported.contains { $0.hasPrefix(".obsidian") })
    }

    @Test func vaultPicksUpChangesFromOtherApps() async throws {
        let temp = try TemporaryVault()
        let file = try temp.write("Kyber.md", "Original\n")
        let vault = Vault(rootURL: temp.url, defaults: temp.defaults)
        defer { vault.close() }
        vault.selection = vault.allNotes.first
        try await Task.sleep(for: .milliseconds(300))

        try changeOnDisk(file, "From another device\n")
        try temp.write("New Note.md", "")

        for _ in 0..<40 where vault.document?.text != "From another device\n" || vault.noteCount < 2 {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(vault.document?.text == "From another device\n")
        #expect(vault.noteCount == 2)
    }

    @Test func vaultClosesNotesDeletedElsewhere() async throws {
        let temp = try TemporaryVault()
        let file = try temp.write("Doomed.md", "Bye\n")
        let vault = Vault(rootURL: temp.url, defaults: temp.defaults)
        defer { vault.close() }
        vault.selection = vault.allNotes.first
        try await Task.sleep(for: .milliseconds(300))

        try FileManager.default.removeItem(at: file)
        for _ in 0..<60 where vault.document != nil {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(vault.document == nil)
        #expect(vault.noteCount == 0)
    }
}
