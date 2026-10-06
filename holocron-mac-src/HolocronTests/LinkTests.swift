import Foundation
import Testing
@testable import Holocron

@Suite struct LinkResolutionTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Ilum.md")
        try temp.write("Lore/Crystals/Kyber Crystal Notes.md")
        try temp.write("Lore/Crystals/Ilum.md")
        try temp.write("Daily/2026-10-05.md")
        try temp.write("Specs/v1.2 notes.markdown")
        vault = Vault(rootURL: temp.url, defaults: temp.defaults)
    }

    @Test func resolvesBareNamesIgnoringCase() throws {
        #expect(vault.resolveLink("kyber crystal notes")?.lastPathComponent == "Kyber Crystal Notes.md")
        #expect(vault.resolveLink("2026-10-05")?.lastPathComponent == "2026-10-05.md")
    }

    @Test func prefersTheNoteNearestTheRoot() throws {
        #expect(vault.resolveLink("Ilum")?.standardizedFileURL == temp.url.appendingPathComponent("Ilum.md").standardizedFileURL)
    }

    @Test func resolvesPathsHeadingsAndExtensions() throws {
        #expect(vault.resolveLink("Lore/Crystals/Ilum").map(vault.relativePath(of:)) == "Lore/Crystals/Ilum.md")
        #expect(vault.resolveLink("Kyber Crystal Notes#Attunement")?.lastPathComponent == "Kyber Crystal Notes.md")
        #expect(vault.resolveLink("Kyber Crystal Notes^abc123")?.lastPathComponent == "Kyber Crystal Notes.md")
        #expect(vault.resolveLink("Ilum.md") != nil)
        #expect(vault.resolveLink("v1.2 notes")?.lastPathComponent == "v1.2 notes.markdown")
    }

    @Test func unknownTargetsDoNotResolve() throws {
        #expect(vault.resolveLink("Dagobah") == nil)
        #expect(vault.resolveLink("Nowhere/Ilum") == nil)
    }

    @Test func openingAMissingLinkCreatesTheNote() throws {
        vault.openLink("Dagobah#Swamps")

        let created = temp.url.appendingPathComponent("Dagobah.md")
        #expect(FileManager.default.fileExists(atPath: created.path))
        #expect(vault.document?.url.lastPathComponent == "Dagobah.md")
        #expect(vault.resolveLink("Dagobah") != nil)
    }

    @Test func missingLinkWithPathCreatesFolders() throws {
        vault.openLink("Planets/Hoth")
        #expect(FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("Planets/Hoth.md").path))
    }

    @Test func linkPathsCannotEscapeTheVault() throws {
        vault.openLink("../../Escaped")
        #expect(!FileManager.default.fileExists(atPath: temp.url.deletingLastPathComponent().appendingPathComponent("Escaped.md").path))
        #expect(FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("Escaped.md").path))
    }
}

@Suite struct LinkFragmentTests {
    let text = """
    # Kyber Crystal Notes

    Intro paragraph. ^intro

    ## **Attunement** steps

    - Clear the mind ^step-one
    - Record the frequency

    A paragraph whose id follows it.

    ^after
    """

    @Test func extractsFragments() {
        #expect(Vault.linkFragment("Kyber#Attunement") == "Attunement")
        #expect(Vault.linkFragment("#Attunement") == "Attunement")
        #expect(Vault.linkFragment("Kyber#^intro") == "^intro")
        #expect(Vault.linkFragment("Kyber") == nil)
        #expect(Vault.linkFragment("Kyber#") == nil)
    }

    @Test func findsHeadingsLikeObsidian() {
        #expect(Vault.line(of: "attunement steps", in: text) == 5)
        #expect(Vault.line(of: "Kyber Crystal Notes#Attunement steps", in: text) == 5)
        #expect(Vault.line(of: "Missing", in: text) == nil)
    }

    @Test func findsBlocks() {
        #expect(Vault.line(of: "^intro", in: text) == 3)
        #expect(Vault.line(of: "^step-one", in: text) == 7)
        #expect(Vault.line(of: "^after", in: text) == 10)
        #expect(Vault.line(of: "^nope", in: text) == nil)
    }
}
