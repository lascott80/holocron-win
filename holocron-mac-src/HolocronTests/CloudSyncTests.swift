import Foundation
import Testing
@testable import Holocron

/// iCloud behaviour that can be checked without an iCloud account: file
/// coordination on ordinary folders, duplicate detection, and conflicts
/// raised from (simulated) versions saved on another device.
@Suite struct CloudSyncTests {
    let temp: TemporaryVault
    let vault: Vault
    let trash: URL

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Lore/Kyber.md", "# Kyber\nBlue.\n")
        try temp.write("Lore/Ilum.md", "# Ilum\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        vault.isInICloudOverride = true
        let trash = temp.url.deletingLastPathComponent().appendingPathComponent("Trash-\(UUID().uuidString)")
        self.trash = trash
        vault.trashItem = { url in
            try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
            let target = trash.appendingPathComponent(url.lastPathComponent)
            try FileManager.default.moveItem(at: url, to: target)
            return target
        }
    }

    private func url(_ path: String) -> URL { temp.url.appendingPathComponent(path) }
    private func read(_ path: String) throws -> String { try String(contentsOf: url(path), encoding: .utf8) }

    // MARK: - Coordinated file access

    @Test func coordinatedOperationsWorkOnOrdinaryFolders() throws {
        let file = url("Notes/New.md")
        try CloudFiles.write(Data("one".utf8), to: file)
        #expect(String(decoding: try CloudFiles.read(file), as: UTF8.self) == "one")
        #expect(throws: (any Error).self) { try CloudFiles.write(Data("two".utf8), to: file, options: .withoutOverwriting) }

        let moved = url("Notes/Moved.md")
        try CloudFiles.move(file, to: moved)
        let copy = url("Notes/Copy.md")
        try CloudFiles.copy(moved, to: copy)
        #expect(try read("Notes/Copy.md") == "one")
        #expect(!FileManager.default.fileExists(atPath: file.path))
        #expect(!CloudFiles.needsDownload(moved))
    }

    @Test func localVaultsHaveNoCloudStatus() {
        #expect(!CloudFiles.isInICloudDriveFolder(temp.url))
        #expect(CloudFiles.isInICloudDriveFolder(URL(fileURLWithPath: "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Notes")))
        #expect(CloudFiles.summary(of: [url("Lore/Kyber.md")]) == CloudFiles.Summary())
    }

    // MARK: - Duplicates

    @Test func recognisesNumberedCopies() throws {
        try temp.write("Lore/Kyber 2.md", "x")
        try temp.write("Lore/Holonet 2.md", "x")
        #expect(CloudFiles.originalOfDuplicate(url("Lore/Kyber 2.md"))?.lastPathComponent == "Kyber.md")
        #expect(CloudFiles.originalOfDuplicate(url("Lore/Holonet 2.md")) == nil) // no "Holonet.md"
        #expect(CloudFiles.originalOfDuplicate(url("Lore/Kyber.md")) == nil)
    }

    @Test func aDuplicateFromSyncOffersACompare() throws {
        try temp.write("Lore/Kyber 2.md", "# Kyber\nGreen.\n")
        vault.handleDiskChanges(["Lore/Kyber 2.md"])
        #expect(vault.toast?.message == "“Kyber 2” looks like an iCloud duplicate of “Kyber”")
        #expect(vault.toast?.actionTitle == "Compare")

        vault.runToastAction()
        let document = try #require(vault.document)
        #expect(document.url.lastPathComponent == "Kyber.md")
        let conflict = try #require(document.conflict)
        #expect(conflict.diskText == "# Kyber\nGreen.\n")

        // Keeping the original moves the copy to the Trash (with Undo).
        document.resolveKeepingMine()
        #expect(!FileManager.default.fileExists(atPath: url("Lore/Kyber 2.md").path))
        #expect(try read("Lore/Kyber.md") == "# Kyber\nBlue.\n")
        #expect(vault.toast?.canUndo == true)
    }

    @Test func usingTheDuplicateCopiesItsTextAcross() throws {
        try temp.write("Lore/Kyber 2.md", "# Kyber\nGreen.\n")
        vault.compareDuplicate(url("Lore/Kyber 2.md"), with: url("Lore/Kyber.md"))
        vault.document?.resolveUsingDisk()
        #expect(try read("Lore/Kyber.md") == "# Kyber\nGreen.\n")
        #expect(!FileManager.default.fileExists(atPath: url("Lore/Kyber 2.md").path))
    }

    @Test func holocronsOwnNumberedNotesArentFlagged() throws {
        let own = Vault.uniqueURL(named: "Kyber", extension: "md", in: url("Lore"))
        try Data("mine".utf8).write(to: own)
        vault.handleDiskChanges(["Lore/Kyber 2.md"])
        #expect(vault.toast == nil)
    }

    @Test func noDuplicateChecksOutsideICloud() throws {
        vault.isInICloudOverride = false
        try temp.write("Lore/Kyber 2.md", "x")
        vault.handleDiskChanges(["Lore/Kyber 2.md"])
        #expect(vault.toast == nil)
    }

    // MARK: - Other devices' versions

    private func otherDevice(_ text: String, resolved: @escaping () -> Void = {}) -> (URL) -> [CloudFiles.ConflictVersion] {
        { _ in [CloudFiles.ConflictVersion(text: text, deviceName: "Lukes MacBook", date: .now, resolve: resolved)] }
    }

    @Test func anotherDevicesVersionRaisesAConflict() throws {
        let document = try NoteDocument(url: url("Lore/Kyber.md"))
        var resolved = false
        document.conflictVersions = otherDevice("# Kyber\nRed.\n") { resolved = true }
        document.checkForConflictingVersions()
        let conflict = try #require(document.conflict)
        guard case .otherDevice(let name, _) = conflict.origin else { Issue.record("wrong origin"); return }
        #expect(name == "Lukes MacBook")
        #expect(!conflict.merge.isClean) // no common ancestor: nothing to merge

        document.resolveUsingDisk()
        #expect(document.text == "# Kyber\nRed.\n")
        #expect(try read("Lore/Kyber.md") == "# Kyber\nRed.\n")
        #expect(resolved)
    }

    @Test func keepingBothSavesTheOtherDevicesVersionAsACopy() throws {
        let document = try NoteDocument(url: url("Lore/Kyber.md"))
        document.conflictVersions = otherDevice("# Kyber\nRed.\n")
        document.checkForConflictingVersions()
        let copy = try #require(document.resolveKeepingBoth())
        #expect(try String(contentsOf: copy, encoding: .utf8) == "# Kyber\nRed.\n")
        #expect(try read("Lore/Kyber.md") == "# Kyber\nBlue.\n")
        #expect(document.conflict == nil)
    }

    @Test func anIdenticalVersionIsResolvedQuietly() throws {
        let document = try NoteDocument(url: url("Lore/Kyber.md"))
        var resolved = false
        document.conflictVersions = otherDevice("# Kyber\nBlue.\n") { resolved = true }
        document.checkForConflictingVersions()
        #expect(document.conflict == nil)
        #expect(resolved)
    }

    @Test func conflictsInClosedNotesOfferAReview() throws {
        vault.hasCloudConflicts = { $0.lastPathComponent == "Ilum.md" }
        vault.handleDiskChanges(["Lore/Ilum.md"])
        #expect(vault.toast?.message == "“Ilum” has a version from another device")
        #expect(vault.toast?.actionTitle == "Review")
        vault.runToastAction()
        #expect(vault.document?.url.lastPathComponent == "Ilum.md")
    }
}
