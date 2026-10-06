import Foundation
import Testing
@testable import Holocron

/// Remembers vault state in memory, so tests never touch real preferences.
final class InMemoryStateStore: VaultStateStore {
    private var values: [String: Any] = [:]
    func stringArray(forKey key: String) -> [String]? { values[key] as? [String] }
    func integer(forKey key: String) -> Int { values[key] as? Int ?? 0 }
    func set(_ value: Any?, forKey key: String) { values[key] = value }
}

/// A throwaway folder for each test, removed afterwards.
final class TemporaryVault {
    let url: URL
    /// Vault state for this test only (shared if a test reopens the vault).
    let defaults = InMemoryStateStore()

    init() throws {
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("HolocronTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }

    @discardableResult
    func write(_ relativePath: String, _ contents: String = "") throws -> URL {
        let file = url.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(contents.utf8).write(to: file)
        return file
    }
}

@Suite struct FileTreeTests {
    @Test func scansNotesAndFoldersOnly() throws {
        let temp = try TemporaryVault()
        try temp.write("Ilum.md")
        try temp.write("Lore/Crystals/Kyber Crystal Notes.md")
        try temp.write("Lore/map.png")
        try temp.write(".obsidian/workspace.json")
        try temp.write("README.markdown")

        let tree = FileNode.scan(temp.url)

        #expect(tree.map(\.name) == ["Lore", "Ilum", "README"])
        let lore = try #require(tree.first)
        #expect(lore.isDirectory)
        #expect(lore.children?.first?.children?.map(\.name) == ["Kyber Crystal Notes"])
        #expect(tree.reduce(0) { $0 + $1.noteCount } == 3)
    }

    @Test func sortsLikeFinder() throws {
        let temp = try TemporaryVault()
        for name in ["Note 10.md", "note 2.md", "Note 1.md"] { try temp.write(name) }

        #expect(FileNode.scan(temp.url).map(\.name) == ["Note 1", "note 2", "Note 10"])
    }
}

@Suite struct NoteDocumentTests {
    @Test func loadsAndSavesAtomically() throws {
        let temp = try TemporaryVault()
        let file = try temp.write("Kyber.md", "# Kyber\n")

        let document = try NoteDocument(url: file, saveDelay: .seconds(60))
        #expect(document.text == "# Kyber\n")
        #expect(!document.isDirty)

        document.text += "Attuned on Ilum.\n"
        #expect(document.isDirty)

        document.save()
        #expect(!document.isDirty)
        #expect(document.saveError == nil)
        #expect(try String(contentsOf: file, encoding: .utf8) == "# Kyber\nAttuned on Ilum.\n")
    }

    @Test func autosavesAfterTypingStops() async throws {
        let temp = try TemporaryVault()
        let file = try temp.write("Daily.md", "")

        let document = try NoteDocument(url: file, saveDelay: .milliseconds(50))
        document.text = "Hello"
        try await Task.sleep(for: .milliseconds(400))

        #expect(!document.isDirty)
        #expect(try String(contentsOf: file, encoding: .utf8) == "Hello")
    }

    @Test func revertingEditsClearsDirtyFlag() throws {
        let temp = try TemporaryVault()
        let file = try temp.write("Note.md", "abc")

        let document = try NoteDocument(url: file, saveDelay: .seconds(60))
        document.text = "abcd"
        document.text = "abc"
        #expect(!document.isDirty)
    }
}

@Suite struct VaultTests {
    @Test func createsUniquelyNamedNotesInSelectedFolder() throws {
        let temp = try TemporaryVault()
        try temp.write("Lore/Untitled.md")
        let vault = Vault(rootURL: temp.url, defaults: temp.defaults)

        vault.selection = temp.url.appendingPathComponent("Lore")
        let created = try #require(vault.createNote())

        #expect(created.lastPathComponent == "Untitled 2.md")
        #expect(created.deletingLastPathComponent().lastPathComponent == "Lore")
        #expect(vault.document?.url == created)
        #expect(vault.noteCount == 2)
    }

    @Test func switchingNotesSavesThePreviousOne() throws {
        let temp = try TemporaryVault()
        let first = try temp.write("A.md", "a")
        let second = try temp.write("B.md", "b")
        let vault = Vault(rootURL: temp.url, defaults: temp.defaults)

        vault.selection = first
        vault.document?.text = "a, edited"
        vault.selection = second

        #expect(vault.document?.url == second)
        #expect(try String(contentsOf: first, encoding: .utf8) == "a, edited")
    }
}
