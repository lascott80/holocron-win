import Foundation
import Testing
@testable import Holocron

@Suite struct TemplateRenderingTests {
    let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026, month: 10, day: 5, hour: 9, minute: 15))!

    @Test func separatesFrontmatterAndFillsPlaceholders() {
        let template = "---\ntype: meeting\ncreated: {{date}}\n---\n# {{title}}\n\n{{cursor}}\n"
        let rendered = Templates.render(template, title: "Council", date: date, dateFormat: "YYYY-MM-DD")
        #expect(rendered.frontmatter == "type: meeting\ncreated: 2026-10-05")
        #expect(rendered.body == "# Council\n\n{{cursor}}\n")
    }

    @Test func templatesWithoutFrontmatter() {
        let rendered = Templates.render("Hello {{title}}", title: "There", date: date, dateFormat: "YYYY-MM-DD")
        #expect(rendered.frontmatter == nil)
        #expect(rendered.body == "Hello There")
    }

    @Test func noteTextPlacesTheCursor() {
        let rendered = Templates.Rendered(frontmatter: "type: meeting", body: "# Council\n\n{{cursor}}\n")
        let (text, cursor) = Templates.noteText(from: rendered)
        #expect(text == "---\ntype: meeting\n---\n# Council\n\n\n")
        #expect(cursor == "---\ntype: meeting\n---\n# Council\n\n".utf16.count)

        let plain = Templates.noteText(from: .init(frontmatter: nil, body: "Notes"))
        #expect(plain == ("Notes", 5))
    }
}

@Suite struct VaultTemplateTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Templates/Meeting.md", "---\ntype: meeting\n---\n# {{title}}\n\nAttendees: {{cursor}}\n")
        try temp.write("Templates/Book.md", "# {{title}}\n")
        try temp.write("Lore/Ilum.md", "# Ilum\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        vault.templatesFolderOverride = "Templates"
    }

    @Test func listsTemplatesByName() {
        #expect(vault.templates.map { $0.deletingPathExtension().lastPathComponent } == ["Book", "Meeting"])
    }

    @Test func createsNotesFromTemplates() throws {
        vault.selection = temp.url.appendingPathComponent("Lore/Ilum.md")
        let template = try #require(vault.templates.first { $0.lastPathComponent == "Meeting.md" })
        let url = try #require(vault.createNote(fromTemplate: template, named: "Council: Ilum"))

        #expect(url.lastPathComponent == "Council- Ilum.md")
        #expect(url.deletingLastPathComponent().lastPathComponent == "Lore")
        #expect(try String(contentsOf: url, encoding: .utf8) == "---\ntype: meeting\n---\n# Council- Ilum\n\nAttendees: \n")
        #expect(vault.document?.url == url.standardizedFileURL)
    }

    @Test func newNotesNeverLandInTheTemplatesFolder() throws {
        vault.selection = temp.url.appendingPathComponent("Templates/Book.md")
        let template = try #require(vault.templates.first)
        let url = try #require(vault.createNote(fromTemplate: template, named: "Dune"))
        #expect(url.deletingLastPathComponent().standardizedFileURL == temp.url.standardizedFileURL)
    }

    @Test func existingNamesGetNumbered() throws {
        let template = try #require(vault.templates.first)
        _ = vault.createNote(fromTemplate: template, named: "Dune")
        let second = try #require(vault.createNote(fromTemplate: template, named: "Dune"))
        #expect(second.lastPathComponent == "Dune 2.md")
    }
}
