import Testing
@testable import Holocron

@Suite struct LinkRewriterTests {
    private func rename(_ text: String, _ from: String, _ to: String) -> String {
        LinkRewriter.rewrite(text) { target in
            target.path.caseInsensitiveCompare(from) == .orderedSame ? to : nil
        }
    }

    @Test func rewritesWikiLinksKeepingHeadingsAndAliases() {
        let text = "See [[Ilum]], [[Ilum#Caves]], [[Ilum|the planet]] and ![[Ilum]].\n"
        #expect(rename(text, "Ilum", "Ilum Prime") == "See [[Ilum Prime]], [[Ilum Prime#Caves]], [[Ilum Prime|the planet]] and ![[Ilum Prime]].\n")
    }

    @Test func leavesOtherLinksAndCodeAlone() {
        let text = """
        [[Dagobah]] and `[[Ilum]]` stay.
        ```
        [[Ilum]]
        ```
        But [[Ilum]] changes.
        """
        #expect(rename(text, "Ilum", "Hoth") == """
        [[Dagobah]] and `[[Ilum]]` stay.
        ```
        [[Ilum]]
        ```
        But [[Hoth]] changes.
        """)
    }

    @Test func rewritesMarkdownLinksKeepingEncodingFragmentsAndTitles() {
        let encoded = "[log](Crystal%20Log.md#2026) and [raw](<Crystal Log.md>) [titled](Crystal%20Log.md \"Log\")"
        let result = LinkRewriter.rewrite(encoded) { $0.path == "Crystal Log.md" ? "Archive/Crystal Log.md" : nil }
        #expect(result == "[log](Archive/Crystal%20Log.md#2026) and [raw](<Archive/Crystal Log.md>) [titled](Archive/Crystal%20Log.md \"Log\")")
    }

    @Test func ignoresWebLinks() {
        let text = "[site](https://example.com/Ilum.md)"
        #expect(LinkRewriter.rewrite(text) { _ in "changed" } == text)
    }

    @Test func returnsTheSameTextWhenNothingChanges() {
        let text = "No links here.\r\nOr here.\n"
        #expect(LinkRewriter.rewrite(text) { _ in nil } == text)
    }

    @Test func computesRelativePaths() {
        #expect(LinkRewriter.relativePath(from: "Lore/Crystals", to: "Orders/Saber.md") == "../../Orders/Saber.md")
        #expect(LinkRewriter.relativePath(from: "Lore/Crystals", to: "Lore/Crystals/Ilum.md") == "Ilum.md")
        #expect(LinkRewriter.relativePath(from: "", to: "Lore/Ilum.md") == "Lore/Ilum.md")
        #expect(LinkRewriter.relativePath(from: "Lore", to: "Ilum.md") == "../Ilum.md")
        #expect(LinkRewriter.relativePath(from: "Lore", to: "Lore Extra/Ilum.md") == "../Lore Extra/Ilum.md")
    }
}
