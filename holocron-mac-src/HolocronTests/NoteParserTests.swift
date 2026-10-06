import Testing
@testable import Holocron

@Suite struct NoteParserTests {
    let sample = """
    ---
    tags: [lore, crystals]
    aliases:
      - Kyber
      - "Living crystal"
    ---

    # Kyber Crystal Notes

    Gathered on [[Ilum]] — see [[Lightsaber Construction|the checklist]] and [[Ilum#Caves]].
    Also [the log](Crystal%20Log.md) and [web](https://example.com/a.md). Tagged #mentor, #lore again.

    ## Attunement **steps** ##

    ```swift
    // [[Not a link]] #notatag
    # Not a heading
    ```

    Inline `[[code link]] #codetag` is ignored. Issue #42 isn't a tag but #2026/q4 is.
    ![[diagram.png]] and ![image](pic.md)
    """

    @Test func parsesFrontmatter() {
        let info = NoteParser.parse(sample)
        #expect(info.aliases == ["Kyber", "Living crystal"])
        #expect(info.tags.prefix(2) == ["lore", "crystals"])
    }

    @Test func parsesHeadingsOutsideCode() {
        let info = NoteParser.parse(sample)
        #expect(info.headings.map(\.text) == ["Kyber Crystal Notes", "Attunement steps"])
        #expect(info.headings.map(\.level) == [1, 2])
        #expect(info.headings.first?.line == 8)
    }

    @Test func parsesLinksOutsideCode() {
        let info = NoteParser.parse(sample)
        #expect(info.links.map(\.target) == ["Ilum", "Lightsaber Construction", "Ilum#Caves", "Crystal Log.md", "diagram.png"])
        #expect(info.links.map(\.kind) == [.wiki, .wiki, .wiki, .markdown, .wiki])
        #expect(info.links.first?.line == 10)
        #expect(info.links.first?.context.hasPrefix("Gathered on [[Ilum]]") == true)
    }

    @Test func parsesTagsOutsideCode() {
        let info = NoteParser.parse(sample)
        #expect(info.tags == ["lore", "crystals", "mentor", "2026/q4"])
    }

    @Test func plainTextStripsInlineMarkdown() {
        #expect(NoteParser.plainText("**Bold** [[Ilum|planet]] and [link](x.md) `code`") == "Bold planet and link code")
    }
}

@Suite struct LinkResolverTests {
    let resolver = LinkResolver(paths: [
        "Ilum.md",
        "Lore/Crystals/Ilum.md",
        "Lore/Crystals/Kyber Crystal Notes.md",
        "Lore/Crystals/Crystal Log.md",
        "Specs/v1.2 notes.markdown",
    ])

    @Test func resolvesWikiLinks() {
        #expect(resolver.resolve(wikiTarget: "ilum") == "Ilum.md")
        #expect(resolver.resolve(wikiTarget: "Lore/Crystals/Ilum") == "Lore/Crystals/Ilum.md")
        #expect(resolver.resolve(wikiTarget: "Kyber Crystal Notes#Attunement") == "Lore/Crystals/Kyber Crystal Notes.md")
        #expect(resolver.resolve(wikiTarget: "v1.2 notes") == "Specs/v1.2 notes.markdown")
        #expect(resolver.resolve(wikiTarget: "#Heading only") == nil)
        #expect(resolver.resolve(wikiTarget: "Dagobah") == nil)
    }

    @Test func resolvesRelativeMarkdownLinks() {
        let source = "Lore/Crystals/Kyber Crystal Notes.md"
        #expect(resolver.resolve(markdownTarget: "Crystal Log.md", from: source) == "Lore/Crystals/Crystal Log.md")
        #expect(resolver.resolve(markdownTarget: "../../Ilum.md", from: source) == "Ilum.md")
        #expect(resolver.resolve(markdownTarget: "./Ilum.md#Caves", from: source) == "Lore/Crystals/Ilum.md")
        #expect(resolver.resolve(markdownTarget: "/Ilum.md", from: source) == "Ilum.md")
        #expect(resolver.resolve(markdownTarget: "Missing.md", from: source) == nil)
    }
}

@Suite struct PropertyParsingTests {
    @Test func readsEveryFrontmatterField() {
        let info = NoteParser.parse("""
        ---
        tags: [lore, crystals]
        created: 2026-09-28
        source: "[[Ilum]]"
        attuned: true
        mentors:
          - Master Ilia
          - 'Kael Voss'
        status:
        location:
          planet: Ilum
          region: north
        ---
        # Body
        """)
        #expect(info.properties.map(\.key) == ["tags", "created", "source", "attuned", "mentors", "status", "location"])
        #expect(info.properties[0].values == ["lore", "crystals"])
        #expect(info.properties[2].values == ["[[Ilum]]"])
        #expect(info.properties[3].values == ["true"])
        #expect(info.properties[4].values == ["Master Ilia", "Kael Voss"])
        #expect(info.properties[5].values.isEmpty)
        #expect(info.properties[6].values == ["planet: Ilum, region: north"])
    }

    @Test func notesWithoutFrontmatterHaveNoProperties() {
        #expect(NoteParser.parse("# Just a note\n").properties.isEmpty)
        #expect(NoteParser.parse("---\nnot closed\n").properties.isEmpty)
    }
}

@Suite struct AngleBracketLinkTests {
    @Test func parsesMarkdownLinksWithSpacesInAngleBrackets() {
        let info = NoteParser.parse("See [the log](<Crystal Log.md>) and [x](Ilum.md \"Planet\").\n")
        #expect(info.links.map(\.target) == ["Crystal Log.md", "Ilum.md"])
    }
}
