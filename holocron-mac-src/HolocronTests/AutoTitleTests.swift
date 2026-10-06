import Foundation
import Testing
@testable import Holocron

@Suite struct TitleFromContentTests {
    @Test func usesTheFirstLineWithoutMarkdown() {
        #expect(Vault.title(fromContent: "# Council of **Ilum**\n\nBody") == "Council of Ilum")
        #expect(Vault.title(fromContent: "\n\n  Plain first line  \nmore") == "Plain first line")
        #expect(Vault.title(fromContent: "- [ ] Buy [[Kyber]] crystals ^task") == "Buy Kyber crystals")
    }

    @Test func skipsPropertiesAndEmptyNotes() {
        #expect(Vault.title(fromContent: "---\ntags: [x]\n---\n## Meeting notes\n") == "Meeting notes")
        #expect(Vault.title(fromContent: "") == nil)
        #expect(Vault.title(fromContent: "#\n   \n") == nil)
    }

    @Test func removesCharactersFileNamesCantHave() {
        #expect(Vault.title(fromContent: "Q3: plan/review? <draft> | v2") == "Q3 planreview draft v2")
        #expect(Vault.title(fromContent: "...dots trimmed...") == "dots trimmed")
    }

    @Test func shortensLongLinesAtAWord() throws {
        let title = try #require(Vault.title(fromContent: String(repeating: "lightsaber ", count: 20)))
        #expect(title.count <= 80)
        #expect(title.hasSuffix("lightsaber"))
    }

    @Test func recognisesPlaceholderNames() {
        #expect(Vault.isPlaceholderName(URL(fileURLWithPath: "/v/Untitled.md")))
        #expect(Vault.isPlaceholderName(URL(fileURLWithPath: "/v/Untitled 12.md")))
        #expect(!Vault.isPlaceholderName(URL(fileURLWithPath: "/v/Untitled plans.md")))
        #expect(!Vault.isPlaceholderName(URL(fileURLWithPath: "/v/Ilum.md")))
    }
}

@Suite struct AutoTitleTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Ilum.md", "# Ilum\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        vault.namesFromFirstLineOverride = true
    }

    private var names: [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: temp.url.path)) ?? []).sorted()
    }

    @Test func newNotesTakeTheirFirstLineAsTheName() throws {
        vault.createNote()
        let document = try #require(vault.document)
        document.text = "# Council of Ilum\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Council of Ilum.md", "Ilum.md"])
        #expect(vault.document?.url.lastPathComponent == "Council of Ilum.md")

        // Still following the first line while the note stays open.
        document.text = "# Council of Ilum, day two\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Council of Ilum, day two.md", "Ilum.md"])
        #expect(try String(contentsOf: document.url, encoding: .utf8) == "# Council of Ilum, day two\n")
    }

    @Test func clashingNamesAreNumbered() throws {
        vault.createNote()
        let document = try #require(vault.document)
        document.text = "# Ilum\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Ilum 2.md", "Ilum.md"])
    }

    @Test func namedNotesAreNeverRenamed() throws {
        vault.open(temp.url.appendingPathComponent("Ilum.md"))
        let document = try #require(vault.document)
        document.text = "# Something else entirely\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Ilum.md"])
    }

    @Test func leavingTheNoteStopsFollowing() throws {
        vault.createNote()
        let document = try #require(vault.document)
        document.text = "# First idea\n"
        vault.open(temp.url.appendingPathComponent("Ilum.md")) // switching away finishes the name
        #expect(names == ["First idea.md", "Ilum.md"])

        vault.open(temp.url.appendingPathComponent("First idea.md"))
        vault.document?.text = "# Changed my mind\n"
        if let reopened = vault.document { vault.applyAutoTitle(to: reopened) }
        #expect(names == ["First idea.md", "Ilum.md"])
    }

    @Test func renamingByHandStopsFollowing() throws {
        vault.createNote()
        let document = try #require(vault.document)
        try vault.rename(document.url, to: "My name")
        document.text = "# Another title\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Ilum.md", "My name.md"])
    }

    @Test func namesTheNoteAfterTypingPauses() async throws {
        vault.createNote()
        let document = try #require(vault.document)
        document.text = "# Typed then paused\n"
        for _ in 0..<30 where !names.contains("Typed then paused.md") {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(names == ["Ilum.md", "Typed then paused.md"])
    }

    @Test func respectsTheSetting() throws {
        vault.namesFromFirstLineOverride = false
        vault.createNote()
        let document = try #require(vault.document)
        document.text = "# Should stay untitled\n"
        vault.applyAutoTitle(to: document)
        #expect(names == ["Ilum.md", "Untitled.md"])
    }
}
