import Foundation
import Testing
@testable import Holocron

@Suite struct SearchQueryTests {
    @Test func parsesWordsPhrasesExclusionsAndFilters() {
        let query = VaultSearch.parse(#"kyber "red shift" -ilum tag:#lore path:Lore/Crystals file:log"#)
        #expect(query.terms == ["kyber", "red shift"])
        #expect(query.excluded == ["ilum"])
        #expect(query.tags == ["lore"])
        #expect(query.paths == ["Lore/Crystals"])
        #expect(query.files == ["log"])
    }

    @Test func quotedFilterValuesKeepSpaces() {
        let query = VaultSearch.parse(#"path:"Jedi Orders" saber"#)
        #expect(query.paths == ["Jedi Orders"])
        #expect(query.terms == ["saber"])
    }

    @Test func regexModeTakesTheWholeQuery() {
        let query = VaultSearch.parse(#"kyb(er)? -x"#, useRegex: true)
        #expect(query.regex == "kyb(er)? -x")
        #expect(query.terms.isEmpty)
    }
}

@Suite struct VaultSearchTests {
    let notes: [VaultSearch.Note] = [
        .init(path: "Lore/Crystals/Kyber Crystal Notes.md",
              text: "# Kyber Crystal Notes\n\nCrystals are gathered on Ilum.\nA red shift means the crystal was bled.\n",
              tags: ["lore", "crystals"]),
        .init(path: "Lore/Crystals/Ilum.md", text: "# Ilum\n\nPrimary source of kyber.\n", tags: ["lore/planets"]),
        .init(path: "Daily/2026-10-05.md", text: "Started Holocron.\nCafé meeting about the KYBER log.\n", tags: []),
        .init(path: "Orders/Lightsaber Construction.md", text: "Step 4 needs an attuned crystal.\n", tags: ["lore"]),
    ]

    private func search(_ text: String, matchCase: Bool = false, regex: Bool = false) -> VaultSearch.Outcome {
        VaultSearch.run(VaultSearch.parse(text, matchCase: matchCase, useRegex: regex), over: notes)
    }

    @Test func findsAllWordsAnywhereInANote() {
        let outcome = search("crystal ilum")
        #expect(outcome.hits.map(\.title) == ["Kyber Crystal Notes"])
    }

    @Test func reportsLinesAndUTF16Ranges() throws {
        let hit = try #require(search("kyber").hits.first { $0.title == "2026-10-05" })
        #expect(hit.lines.map(\.line) == [2])
        let line = try #require(hit.lines.first)
        #expect((line.text as NSString).substring(with: line.ranges[0]) == "KYBER")
    }

    @Test func titleMatchesRankFirst() {
        #expect(search("kyber").hits.first?.title == "Kyber Crystal Notes")
    }

    @Test func phrasesExclusionsAndCase() {
        #expect(search(#""red shift""#).hits.map(\.title) == ["Kyber Crystal Notes"])
        #expect(search("crystal -ilum").hits.map(\.title) == ["Lightsaber Construction"]) // Kyber note mentions Ilum
        #expect(search("KYBER", matchCase: true).hits.map(\.title) == ["2026-10-05"])
        #expect(search("cafe").hits.map(\.title) == ["2026-10-05"]) // ignores accents
    }

    @Test func filtersByTagPathAndFile() {
        #expect(Set(search("tag:lore").hits.map(\.title)) == ["Kyber Crystal Notes", "Ilum", "Lightsaber Construction"])
        #expect(search("crystal path:orders").hits.map(\.title) == ["Lightsaber Construction"])
        #expect(search("file:ilum").hits.map(\.title) == ["Ilum"])
    }

    @Test func regexSearch() {
        #expect(Set(search("^#\\s", regex: true).hits.map(\.title)) == ["Kyber Crystal Notes", "Ilum"])
        #expect(search("(", regex: true).error != nil)
    }

    @Test func countsEveryMatch() throws {
        let hit = try #require(search("crystal").hits.first { $0.title == "Kyber Crystal Notes" })
        #expect(hit.matchCount == 3) // heading, "Crystals", "crystal"
        #expect(search("").hits.isEmpty)
    }

    @Test func overlappingTermsMerge() throws {
        let hit = try #require(search(#"kyber "kyber crystal""#).hits.first { $0.title == "Kyber Crystal Notes" })
        let heading = try #require(hit.lines.first)
        #expect(heading.ranges.count == 1)
        #expect((heading.text as NSString).substring(with: heading.ranges[0]) == "Kyber Crystal")
    }
}

@Suite struct SearchModelTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Lore/Kyber.md", "# Kyber\n\nAttuned on Ilum.\nThe crystal hums.\n")
        try temp.write("Ilum.md", "Ice planet.\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
    }

    @Test func searchesTheIndexedVault() async {
        await vault.indexingFinished()
        vault.search.text = "ilum"
        await vault.search.searchFinished()
        #expect(vault.search.outcome.hits.map(\.title) == ["Ilum", "Kyber"])
    }

    @Test func revealOpensTheNote() async throws {
        await vault.indexingFinished()
        vault.search.text = "hums"
        await vault.search.searchFinished()
        let hit = try #require(vault.search.outcome.hits.first)
        vault.reveal(hit.lines[0], in: hit.path)
        #expect(vault.document?.url.lastPathComponent == "Kyber.md")
    }

    @Test func showSearchSwitchesTheSidebar() {
        vault.showSearch(for: "crystal")
        #expect(vault.sidebarMode == .search)
        #expect(vault.search.text == "crystal")
    }
}
