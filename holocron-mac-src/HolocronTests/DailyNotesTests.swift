import Foundation
import Testing
@testable import Holocron

@Suite struct DailyNoteFormatTests {
    /// Oct 5 2026, 14:30 local time.
    let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: 2026, month: 10, day: 5, hour: 14, minute: 30))!

    @Test func convertsMomentFormats() {
        #expect(DailyNotes.icuPattern(fromMoment: "YYYY-MM-DD") == "yyyy-MM-dd")
        #expect(DailyNotes.icuPattern(fromMoment: "dddd, MMMM D YYYY") == "EEEE, MMMM d yyyy")
        #expect(DailyNotes.icuPattern(fromMoment: "[Week] ww") == "'Week' ww")
    }

    @Test func buildsPaths() {
        #expect(DailyNotes.path(for: date, folder: "Daily", format: "YYYY-MM-DD") == "Daily/2026-10-05.md")
        #expect(DailyNotes.path(for: date, folder: "", format: "YYYY-MM-DD") == "2026-10-05.md")
        #expect(DailyNotes.path(for: date, folder: "Journal/", format: "YYYY/MM/YYYY-MM-DD dddd") == "Journal/2026/10/2026-10-05 Monday.md")
    }

    @Test func recognisesDailyNotePaths() {
        let parsed = DailyNotes.date(ofPath: "Daily/2026-10-05.md", folder: "Daily", format: "YYYY-MM-DD")
        #expect(parsed == Calendar(identifier: .gregorian).startOfDay(for: date))
        #expect(DailyNotes.date(ofPath: "Daily/Meeting notes.md", folder: "Daily", format: "YYYY-MM-DD") == nil)
        #expect(DailyNotes.date(ofPath: "Other/2026-10-05.md", folder: "Daily", format: "YYYY-MM-DD") == nil)
        #expect(DailyNotes.date(ofPath: "Daily/2026-13-45.md", folder: "Daily", format: "YYYY-MM-DD") == nil)
        #expect(DailyNotes.date(ofPath: "Journal/2026/10/2026-10-05.md", folder: "Journal", format: "YYYY/MM/YYYY-MM-DD") != nil)
    }

    @Test func rendersTemplates() {
        let template = "# {{title}}\nWritten {{date:dddd, MMMM D}} at {{time}}.\n← [[{{yesterday}}]] | [[{{tomorrow}}]] →\n{{ date }}\n"
        let rendered = DailyNotes.render(template: template, date: date, title: "2026-10-05", dateFormat: "YYYY-MM-DD")
        #expect(rendered == "# 2026-10-05\nWritten Monday, October 5 at 14:30.\n← [[2026-10-04]] | [[2026-10-06]] →\n2026-10-05\n")
    }

    @Test func leavesOtherBracesAlone() {
        #expect(DailyNotes.render(template: "{{weather}} {{date}}", date: date, title: "x", dateFormat: "YYYY-MM-DD") == "{{weather}} 2026-10-05")
    }
}

@Suite struct VaultDailyNoteTests {
    let temp: TemporaryVault
    let vault: Vault
    let calendar = Calendar(identifier: .gregorian)

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Templates/Daily.md", "# {{title}}\n\n← [[{{yesterday}}]] · [[{{tomorrow}}]] →\n\n## Notes\n")
        try temp.write("Daily/2026-10-01.md", "Oct 1\n")
        try temp.write("Daily/2026-10-03.md", "Oct 3\n")
        try temp.write("Daily/Meeting.md", "Not a daily note\n")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        vault.dailyNoteSettingsOverride = .init(folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily")
    }

    private func day(_ d: Int) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: d, hour: 9))!
    }

    @Test func createsTodaysNoteFromTheTemplate() throws {
        let url = try #require(vault.openDailyNote(for: day(5)))
        #expect(url.lastPathComponent == "2026-10-05.md")
        #expect(try String(contentsOf: url, encoding: .utf8) == "# 2026-10-05\n\n← [[2026-10-04]] · [[2026-10-06]] →\n\n## Notes\n")
        #expect(vault.document?.url == url)
    }

    @Test func opensAnExistingNoteWithoutTouchingIt() throws {
        let url = try #require(vault.openDailyNote(for: day(3)))
        #expect(try String(contentsOf: url, encoding: .utf8) == "Oct 3\n")
    }

    @Test func missingTemplateStillCreatesTheNote() throws {
        vault.dailyNoteSettingsOverride?.template = "Nope"
        let url = try #require(vault.openDailyNote(for: day(7)))
        #expect(try String(contentsOf: url, encoding: .utf8) == "")
        #expect(vault.errorMessage != nil)
    }

    @Test func stepsBetweenExistingDailyNotes() {
        vault.openDailyNote(for: day(3))
        vault.openAdjacentDailyNote(-1)
        #expect(vault.document?.url.lastPathComponent == "2026-10-01.md")
        vault.openAdjacentDailyNote(1)
        #expect(vault.document?.url.lastPathComponent == "2026-10-03.md")
        vault.openAdjacentDailyNote(1) // nothing later than Oct 3 except notes yet to be written
        #expect(vault.document?.url.lastPathComponent == "2026-10-03.md")
    }

    @Test func subfolderFormats() throws {
        vault.dailyNoteSettingsOverride = .init(folder: "Journal", format: "YYYY/MM/YYYY-MM-DD", template: "")
        let url = try #require(vault.openDailyNote(for: day(5)))
        #expect(url.path.hasSuffix("Journal/2026/10/2026-10-05.md"))
    }
}
