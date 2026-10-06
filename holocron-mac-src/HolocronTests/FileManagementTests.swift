import Foundation
import Testing
@testable import Holocron

@Suite struct FileManagementTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Lore/Crystals/Kyber.md", "# Kyber\nSee [[Ilum]] and [the log](Crystal%20Log.md).\n")
        try temp.write("Lore/Crystals/Crystal Log.md", "# Log\n")
        try temp.write("Lore/Crystals/Ilum.md", "# Ilum\nBack to [[Kyber#Attunement|kyber notes]].\n")
        try temp.write("Orders/Saber.md", "Needs [[Kyber]], [[Lore/Crystals/Kyber]] and [crystal](../Lore/Crystals/Kyber.md).\n")
        try temp.write("Daily/Today.md", "`[[Kyber]]` in code stays. Plain [[Kyber]] changes.\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        // Keep the real Trash clean: "trash" into a folder beside the vault.
        let trash = temp.url.deletingLastPathComponent().appendingPathComponent("Trash-\(UUID().uuidString)")
        vault.trashItem = { url in
            try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
            let target = trash.appendingPathComponent(url.lastPathComponent)
            try FileManager.default.moveItem(at: url, to: target)
            return target
        }
    }

    private func read(_ path: String) throws -> String {
        try String(contentsOf: temp.url.appendingPathComponent(path), encoding: .utf8)
    }

    private func url(_ path: String) -> URL {
        temp.url.appendingPathComponent(path)
    }

    @Test func renamingANoteUpdatesLinksEverywhere() async throws {
        await vault.indexingFinished()
        try vault.rename(url("Lore/Crystals/Kyber.md"), to: "Kyber Crystals")

        #expect(FileManager.default.fileExists(atPath: url("Lore/Crystals/Kyber Crystals.md").path))
        #expect(try read("Lore/Crystals/Ilum.md") == "# Ilum\nBack to [[Kyber Crystals#Attunement|kyber notes]].\n")
        #expect(try read("Orders/Saber.md") == "Needs [[Kyber Crystals]], [[Lore/Crystals/Kyber Crystals]] and [crystal](../Lore/Crystals/Kyber%20Crystals.md).\n")
        #expect(try read("Daily/Today.md") == "`[[Kyber]]` in code stays. Plain [[Kyber Crystals]] changes.\n")
    }

    @Test func movingANoteKeepsNameLinksAndFixesPathLinks() async throws {
        await vault.indexingFinished()
        vault.move([url("Lore/Crystals/Kyber.md")], into: url("Orders"))

        #expect(FileManager.default.fileExists(atPath: url("Orders/Kyber.md").path))
        // Name-based links still resolve, so they're left as they were.
        #expect(try read("Lore/Crystals/Ilum.md").contains("[[Kyber#Attunement|kyber notes]]"))
        #expect(try read("Orders/Saber.md") == "Needs [[Kyber]], [[Orders/Kyber]] and [crystal](Kyber.md).\n")
        // The moved note's own relative markdown link is fixed too.
        #expect(try read("Orders/Kyber.md") == "# Kyber\nSee [[Ilum]] and [the log](../Lore/Crystals/Crystal%20Log.md).\n")
    }

    @Test func renamingAFolderMovesItsNotesAndFixesPathLinks() async throws {
        await vault.indexingFinished()
        try vault.rename(url("Lore/Crystals"), to: "Kyber Crystals")

        #expect(FileManager.default.fileExists(atPath: url("Lore/Kyber Crystals/Kyber.md").path))
        #expect(try read("Orders/Saber.md") == "Needs [[Kyber]], [[Lore/Kyber Crystals/Kyber]] and [crystal](../Lore/Kyber%20Crystals/Kyber.md).\n")
    }

    @Test func renamingWithoutUpdatingLinksLeavesNotesAlone() async throws {
        await vault.indexingFinished()
        vault.updatesLinksOverride = false
        try vault.rename(url("Lore/Crystals/Kyber.md"), to: "Renamed")
        #expect(try read("Orders/Saber.md").contains("[[Kyber]]"))
    }

    @Test func openNotesFollowTheirFile() async throws {
        await vault.indexingFinished()
        vault.open(url("Lore/Crystals/Kyber.md"))
        vault.open(url("Lore/Crystals/Ilum.md"), inNewTab: true)
        vault.activateTab(vault.tabs[0].id)
        vault.document?.text += "Unsaved edit.\n"

        try vault.rename(url("Lore/Crystals/Kyber.md"), to: "Kyber Crystals")

        let renamed = url("Lore/Crystals/Kyber Crystals.md").standardizedFileURL
        #expect(vault.document?.url == renamed)
        #expect(vault.tabs[0].url == renamed)
        #expect(vault.selection == renamed)
        #expect(try read("Lore/Crystals/Kyber Crystals.md").hasSuffix("Unsaved edit.\n"))
        // The other open note's link was rewritten in place.
        #expect(vault.documents[url("Lore/Crystals/Ilum.md").standardizedFileURL]?.text.contains("[[Kyber Crystals#Attunement") == true)
    }

    @Test func caseOnlyRenames() throws {
        try vault.rename(url("Orders/Saber.md"), to: "saber")
        let names = try FileManager.default.contentsOfDirectory(atPath: url("Orders").path)
        #expect(names == ["saber.md"])
    }

    @Test func renameRejectsBadNamesAndCollisions() {
        #expect(throws: Vault.FileError.self) { try vault.rename(url("Orders/Saber.md"), to: "a/b") }
        #expect(throws: Vault.FileError.self) { try vault.rename(url("Orders/Saber.md"), to: ".hidden") }
        #expect(throws: Vault.FileError.self) { try vault.rename(url("Lore/Crystals/Ilum.md"), to: "Kyber") }
    }

    @Test func foldersCantMoveIntoThemselves() {
        vault.move([url("Lore")], into: url("Lore/Crystals"))
        #expect(vault.errorMessage != nil)
        #expect(FileManager.default.fileExists(atPath: url("Lore/Crystals/Kyber.md").path))
    }

    @Test func filesFromOutsideAreCopiedIn() throws {
        let outside = try TemporaryVault()
        let external = try outside.write("Holonet.md", "# Holonet\n")
        vault.move([external], into: url("Orders"))
        #expect(FileManager.default.fileExists(atPath: url("Orders/Holonet.md").path))
        #expect(FileManager.default.fileExists(atPath: external.path))
    }

    @Test func newFoldersAreNumberedAndRenamable() {
        let first = vault.createFolder(in: url("Orders"))
        let second = vault.createFolder(in: url("Orders"))
        #expect(first?.lastPathComponent == "Untitled Folder")
        #expect(second?.lastPathComponent == "Untitled Folder 2")
        #expect(vault.renamingURL == second?.standardizedFileURL)
    }

    @Test func duplicateOpensTheCopy() throws {
        let copy = try #require(vault.duplicate(url("Orders/Saber.md")))
        #expect(copy.lastPathComponent == "Saber copy.md")
        #expect(try read("Orders/Saber copy.md") == read("Orders/Saber.md"))
        #expect(vault.document?.url == copy.standardizedFileURL)
    }

    @Test func deletingClosesTabsWithoutResurrectingFiles() throws {
        vault.open(url("Lore/Crystals/Kyber.md"))
        vault.open(url("Lore/Crystals/Ilum.md"), inNewTab: true)
        vault.document?.text += "Edit that goes with it.\n"

        vault.requestDeletion(of: [url("Lore/Crystals")])
        #expect(vault.pendingDeletion?.count == 1)
        vault.confirmDeletion()

        #expect(!FileManager.default.fileExists(atPath: url("Lore/Crystals").path))
        #expect(vault.tabs.isEmpty)
        #expect(vault.documents.isEmpty)
        #expect(vault.noteCount == 2)
    }

    // MARK: - Toasts & undo

    @Test func movingOffersUndoThatRestoresLinks() async throws {
        await vault.indexingFinished()
        let saber = try read("Orders/Saber.md")
        vault.move([url("Lore/Crystals/Kyber.md")], into: url("Orders"))
        #expect(vault.toast?.message == "Moved “Kyber” to Orders")
        #expect(vault.toast?.canUndo == true)

        vault.undoToast()
        #expect(FileManager.default.fileExists(atPath: url("Lore/Crystals/Kyber.md").path))
        #expect(!FileManager.default.fileExists(atPath: url("Orders/Kyber.md").path))
        #expect(try read("Orders/Saber.md") == saber)
        #expect(vault.toast == nil)
    }

    @Test func renamingOffersUndo() throws {
        try vault.rename(url("Orders/Saber.md"), to: "Lightsaber")
        #expect(vault.toast?.message == "Renamed “Saber” to “Lightsaber”")
        vault.undoToast()
        #expect(FileManager.default.fileExists(atPath: url("Orders/Saber.md").path))
        #expect(!FileManager.default.fileExists(atPath: url("Orders/Lightsaber.md").path))
    }

    @Test func trashingOffersUndo() throws {
        let text = try read("Lore/Crystals/Ilum.md")
        vault.requestDeletion(of: [url("Lore/Crystals/Ilum.md")])
        vault.confirmDeletion()
        #expect(vault.toast?.message == "Moved “Ilum” to the Trash")
        #expect(!FileManager.default.fileExists(atPath: url("Lore/Crystals/Ilum.md").path))

        vault.undoToast()
        #expect(try read("Lore/Crystals/Ilum.md") == text)
    }

    @Test func undoingADuplicateRemovesTheCopy() throws {
        let copy = try #require(vault.duplicate(url("Orders/Saber.md")))
        #expect(vault.toast?.message == "Duplicated “Saber”")
        vault.undoToast()
        #expect(!FileManager.default.fileExists(atPath: copy.path))
        #expect(vault.toast == nil) // undoing doesn't announce a second trash
    }
}

@Suite struct StarterGuideTests {
    @Test func installsBothNotesAndKeepsExistingOnes() throws {
        let temp = try TemporaryVault()
        try temp.write("Linked Note.md", "mine\n")
        let guide = try StarterGuide.install(in: temp.url, today: Date(timeIntervalSince1970: 1_790_000_000))
        let text = try String(contentsOf: guide, encoding: .utf8)
        #expect(text.contains("# Start Here"))
        #expect(text.contains("created: 2026-09-21"))
        #expect(try String(contentsOf: temp.url.appendingPathComponent("Linked Note.md"), encoding: .utf8) == "mine\n")
    }
}
