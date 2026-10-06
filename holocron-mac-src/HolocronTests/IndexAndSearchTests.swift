import Foundation
import Testing
@testable import Holocron

@Suite struct FuzzyMatchTests {
    @Test func matchesSubsequencesAndReportsIndices() throws {
        let match = try #require(FuzzyMatch.match("kyb", in: "Kyber Crystal Notes"))
        #expect(match.indices == [0, 1, 2])
        #expect(FuzzyMatch.match("kcn", in: "Kyber Crystal Notes")?.indices == [0, 6, 14])
        #expect(FuzzyMatch.match("xyz", in: "Kyber Crystal Notes") == nil)
        #expect(FuzzyMatch.match("kyberz", in: "Kyber") == nil)
    }

    @Test func prefersWordStartsAndRuns() throws {
        let wordStarts = try #require(FuzzyMatch.match("cl", in: "Crystal Log"))
        #expect(wordStarts.indices == [0, 8])
        let prefix = try #require(FuzzyMatch.match("log", in: "Crystal Log"))
        let scattered = try #require(FuzzyMatch.match("log", in: "Lightsaber Orders Guide"))
        #expect(prefix.score > scattered.score || prefix.indices == [8, 9, 10])
    }
}

@Suite struct QuickOpenSearchTests {
    let search = QuickOpenSearch(
        notes: [
            .init(path: "Lore/Crystals/Kyber Crystal Notes.md", aliases: ["Kyber"], tags: ["lore", "crystals"]),
            .init(path: "Projects/Kyber Supply Routes.md", aliases: [], tags: ["projects"]),
            .init(path: "Lore/Crystals/Crystal Log.md", aliases: ["Kyber log"], tags: ["lore/crystals"]),
            .init(path: "Daily/2026-10-05.md", aliases: [], tags: []),
        ],
        recent: ["Daily/2026-10-05.md", "Projects/Kyber Supply Routes.md"]
    )

    @Test func ranksTitleMatches() {
        let hits = search.search("kyb")
        #expect(hits.prefix(2).map(\.path).sorted() == ["Lore/Crystals/Kyber Crystal Notes.md", "Projects/Kyber Supply Routes.md"])
        #expect(hits.contains { $0.path == "Lore/Crystals/Crystal Log.md" && $0.field == .alias("Kyber log") })
    }

    @Test func emptyQueryListsRecentNotes() {
        #expect(search.search("").map(\.path) == ["Daily/2026-10-05.md", "Projects/Kyber Supply Routes.md"])
    }

    @Test func tagQueriesIncludeNestedTags() {
        #expect(search.search("#crystals").map(\.path) == ["Lore/Crystals/Kyber Crystal Notes.md"])
        #expect(Set(search.search("#lore").map(\.path)) == ["Lore/Crystals/Kyber Crystal Notes.md", "Lore/Crystals/Crystal Log.md"])
    }

    @Test func fallsBackToFolderPaths() {
        #expect(search.search("daily").map(\.path) == ["Daily/2026-10-05.md"])
        #expect(search.search("daily").first?.field == .path)
    }
}

@Suite struct VaultIndexTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Lore/Crystals/Kyber Crystal Notes.md", "---\naliases: [Kyber]\n---\n# Kyber Crystal Notes\n\nFound on [[Ilum]]. #lore\n\n## Attunement\n")
        try temp.write("Lore/Crystals/Ilum.md", "# Ilum\n\nMethods in [[Kyber Crystal Notes]].\nAlso [[Kyber Crystal Notes#Attunement]].\n#lore/planets\n")
        try temp.write("Orders/Lightsaber Construction.md", "Step 4 needs an attuned [crystal](../Lore/Crystals/Kyber%20Crystal%20Notes.md). #lore\n")
        try temp.write("Daily/2026-10-02.md", "Attuned the kyber crystal today.\nRead kyber crystal notes again.\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
    }

    @Test func findsBacklinksFromWikiAndMarkdownLinks() async {
        await vault.indexingFinished()
        let backlinks = vault.index.backlinks(to: "Lore/Crystals/Kyber Crystal Notes.md")
        #expect(backlinks.map(\.title) == ["Ilum", "Lightsaber Construction"])
        #expect(backlinks.first?.contexts == ["Methods in [[Kyber Crystal Notes]].", "Also [[Kyber Crystal Notes#Attunement]]."])
    }

    @Test func findsUnlinkedMentionsIncludingAliases() async {
        await vault.indexingFinished()
        let mentions = vault.index.unlinkedMentions(of: "Lore/Crystals/Kyber Crystal Notes.md")
        #expect(mentions.map(\.title) == ["2026-10-02"])
        #expect(mentions.first?.context == "Attuned the kyber crystal today.")
    }

    @Test func countsTags() async {
        await vault.indexingFinished()
        let tags = vault.index.allTags()
        #expect(tags.first == .init(tag: "lore", count: 2))
        #expect(vault.index.notes(taggedWith: "lore").count == 3)
    }

    @Test func outgoingLinksResolve() async {
        await vault.indexingFinished()
        let outgoing = vault.index.outgoingLinks(from: "Lore/Crystals/Kyber Crystal Notes.md")
        #expect(outgoing.map(\.target) == ["Ilum"])
        #expect(outgoing.first?.resolved == "Lore/Crystals/Ilum.md")
    }

    @Test func liveEditsUpdateTheIndex() async throws {
        await vault.indexingFinished()
        vault.index.update(path: "Daily/2026-10-02.md", text: "Linked [[Kyber Crystal Notes]] now.\n")
        #expect(vault.index.backlinks(to: "Lore/Crystals/Kyber Crystal Notes.md").count == 3)
    }

    @Test func diskChangesReindex() async throws {
        await vault.indexingFinished()
        try temp.write("Daily/2026-10-02.md", "See [[Ilum]].\n")
        try temp.write("New.md", "[[Ilum]]\n")
        vault.handleDiskChanges(["Daily/2026-10-02.md", "New.md"])
        await vault.indexingFinished()

        #expect(vault.index.backlinks(to: "Lore/Crystals/Ilum.md").map(\.title) == ["2026-10-02", "Kyber Crystal Notes", "New"])
    }
}

@Suite struct CompletionDataTests {
    @Test func describesNotesAttachmentsAndTags() async throws {
        let temp = try TemporaryVault()
        try temp.write("Lore/Kyber.md", "---\naliases: [Crystal]\n---\n# Kyber\n## Attunement\n#lore\n")
        try temp.write("Ilum.md", "Ice.\n")
        try temp.write("Attachments/hilt.png", "PNG")
        let vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        await vault.indexingFinished()
        vault.open(temp.url.appendingPathComponent("Ilum.md"))

        let data = vault.completionData()
        let notes = try #require(data["notes"] as? [[String: Any]])
        let kyber = try #require(notes.first { $0["title"] as? String == "Kyber" })
        #expect(kyber["path"] as? String == "Lore/Kyber.md")
        #expect(kyber["aliases"] as? [String] == ["Crystal"])
        #expect((kyber["headings"] as? [[String: Any]])?.compactMap { $0["text"] as? String } == ["Kyber", "Attunement"])
        #expect(notes.first { $0["title"] as? String == "Ilum" }?["recent"] as? Int == 10)
        #expect(data["attachments"] as? [String] == ["Attachments/hilt.png"])
        #expect((data["tags"] as? [[String: Any]])?.first?["tag"] as? String == "lore")
    }
}

@Suite struct EmbedContentTests {
    @Test func suppliesTheCurrentTextOfEmbeddedNotes() async throws {
        let temp = try TemporaryVault()
        try temp.write("Lore/Ilum Survey.md", "# Ilum Survey\n")
        let vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)

        let content = try #require(vault.embedContent(target: "ilum survey"))
        #expect(content["title"] as? String == "Ilum Survey")
        #expect(content["path"] as? String == "Lore/Ilum Survey.md")
        #expect(content["text"] as? String == "# Ilum Survey\n")

        // Unsaved edits in an open tab are what the embed shows.
        vault.open(temp.url.appendingPathComponent("Lore/Ilum Survey.md"))
        vault.document?.text = "# Ilum Survey\nUnsaved line.\n"
        #expect(vault.embedContent(target: "Ilum Survey#Caves")?["text"] as? String == "# Ilum Survey\nUnsaved line.\n")

        #expect(vault.embedContent(target: "Dagobah") == nil)
    }
}
