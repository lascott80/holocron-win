import Foundation
import Testing
@testable import Holocron

@Suite struct TabTests {
    let temp: TemporaryVault
    let vault: Vault
    let a: URL, b: URL, c: URL

    init() throws {
        temp = try TemporaryVault()
        a = try temp.write("A.md", "a\n").standardizedFileURL
        b = try temp.write("Folder/B.md", "b\n").standardizedFileURL
        c = try temp.write("C.md", "c\n").standardizedFileURL
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
    }

    private var tabURLs: [URL?] { vault.tabs.map(\.url) }

    @Test func openingReplacesTheActiveTab() {
        vault.open(a)
        vault.open(b)
        #expect(tabURLs == [b])
        #expect(vault.document?.url == b)
        #expect(vault.selection == b)
    }

    @Test func newTabsOpenAfterTheActiveOne() {
        vault.open(a)
        vault.open(c, inNewTab: true)
        vault.activateTab(vault.tabs[0].id)
        vault.open(b, inNewTab: true)
        #expect(tabURLs == [a, b, c])
        #expect(vault.document?.url == b)
    }

    @Test func openingAnOpenNoteSwitchesToItsTab() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(a)
        #expect(tabURLs == [a, b])
        #expect(vault.activeTab?.url == a)
    }

    @Test func emptyTabsAreReused() {
        vault.newTab()
        #expect(vault.document == nil)
        vault.open(a, inNewTab: true)
        #expect(tabURLs == [a])
    }

    @Test func closingActivatesTheNeighbour() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(c, inNewTab: true)
        vault.activateTab(vault.tabs[1].id)
        vault.closeTab(vault.tabs[1].id)
        #expect(tabURLs == [a, c])
        #expect(vault.activeTab?.url == c)

        vault.closeTab(vault.tabs[1].id)
        vault.closeTab(vault.tabs[0].id)
        #expect(vault.tabs.isEmpty)
        #expect(vault.document == nil)
        #expect(vault.documents.isEmpty)
    }

    @Test func closeOthersAndToTheRight() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(c, inNewTab: true)
        vault.closeTabsToTheRight(of: vault.tabs[0].id)
        #expect(tabURLs == [a])
        vault.open(b, inNewTab: true)
        vault.closeOtherTabs(than: vault.tabs[1].id)
        #expect(tabURLs == [b])
    }

    @Test func backAndForwardWithinATab() {
        vault.open(a)
        vault.open(b)
        vault.open(c)
        vault.goBack()
        #expect(vault.document?.url == b)
        vault.goBack()
        #expect(vault.document?.url == a)
        #expect(!vault.canGoBack)
        vault.goForward()
        #expect(vault.document?.url == b)
        vault.open(c)
        #expect(!vault.canGoForward)
    }

    @Test func backSkipsDeletedNotes() throws {
        vault.open(a)
        vault.open(b)
        vault.open(c)
        try FileManager.default.removeItem(at: b)
        vault.goBack()
        #expect(vault.document?.url == a)
    }

    @Test func switchingTabsSavesEdits() throws {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.activateTab(vault.tabs[0].id)
        vault.document?.text = "a, edited\n"
        vault.activateTab(vault.tabs[1].id)
        #expect(try String(contentsOf: a, encoding: .utf8) == "a, edited\n")
    }

    @Test func notesNoTabShowsAreUnloaded() {
        vault.open(a)
        vault.open(b)
        #expect(Set(vault.documents.keys) == [b])
    }

    @Test func unresolvedConflictIsKeptAsACopyWhenItsTabCloses() throws {
        vault.open(a)
        vault.document?.text = "mine\n"
        try Data("theirs\n".utf8).write(to: a, options: .atomic)
        vault.document?.reconcileWithDisk()
        try #require(vault.document?.conflict != nil)

        vault.closeDocument()

        let copies = try FileManager.default.contentsOfDirectory(atPath: temp.url.path).filter { $0.hasPrefix("A (conflicted copy") }
        #expect(copies.count == 1)
        #expect(try String(contentsOf: temp.url.appendingPathComponent(copies[0]), encoding: .utf8) == "mine\n")
        #expect(try String(contentsOf: a, encoding: .utf8) == "theirs\n")
    }

    @Test func tabsAreRestoredWhenTheVaultReopens() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(c, inNewTab: true)
        vault.activateTab(vault.tabs[1].id)
        vault.close()

        let reopened = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
        #expect(reopened.tabs.map(\.url) == [a, b, c])
        #expect(reopened.document?.url == b)
    }

    @Test func tabNumbersAndCycling() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(c, inNewTab: true)
        vault.selectTab(number: 1)
        #expect(vault.activeTab?.url == a)
        vault.selectTab(number: 9)
        #expect(vault.activeTab?.url == c)
        vault.selectNextTab()
        #expect(vault.activeTab?.url == a)
        vault.selectPreviousTab()
        #expect(vault.activeTab?.url == c)
    }

    @Test func reorderingTabs() {
        vault.open(a)
        vault.open(b, inNewTab: true)
        vault.open(c, inNewTab: true)
        vault.moveTab(vault.tabs[2].id, to: vault.tabs[0].id)
        #expect(tabURLs == [c, a, b])
    }

    @Test func newNotesOpenInANewTab() {
        vault.open(a)
        let created = vault.createNote()
        #expect(tabURLs.count == 2)
        #expect(vault.document?.url == created?.standardizedFileURL)
    }
}
