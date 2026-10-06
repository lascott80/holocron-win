import Foundation
import Testing
@testable import Holocron

@Suite struct AttachmentResolutionTests {
    let paths = [
        "Attachments/diagram.png",
        "Lore/Crystals/kyber.jpg",
        "Lore/Crystals/img/close-up.png",
        "diagram.png",
        "Docs/report.pdf",
    ]

    @Test func resolvesByNameNearestTheRoot() {
        #expect(Attachments.resolve("diagram.png", from: "Lore/Note.md", in: paths) == "diagram.png")
        #expect(Attachments.resolve("KYBER.JPG", from: "Daily/x.md", in: paths) == "Lore/Crystals/kyber.jpg")
        #expect(Attachments.resolve("report.pdf", from: "x.md", in: paths) == "Docs/report.pdf")
    }

    @Test func resolvesRelativeToTheNoteFirst() {
        #expect(Attachments.resolve("img/close-up.png", from: "Lore/Crystals/Kyber.md", in: paths) == "Lore/Crystals/img/close-up.png")
        #expect(Attachments.resolve("../../Attachments/diagram.png", from: "Lore/Crystals/Kyber.md", in: paths) == "Attachments/diagram.png")
        #expect(Attachments.resolve("Attachments/diagram.png", from: "Lore/Crystals/Kyber.md", in: paths) == "Attachments/diagram.png")
        #expect(Attachments.resolve("/diagram.png", from: "Lore/Crystals/Kyber.md", in: paths) == "diagram.png")
    }

    @Test func neverClimbsOutOfTheVault() {
        #expect(Attachments.normalize("../../../etc/passwd") == "etc/passwd")
        #expect(Attachments.resolve("../../../etc/passwd", from: "a.md", in: paths) == nil)
    }

    @Test func recognisesAttachmentTargets() {
        #expect(Attachments.isAttachmentTarget("photo.png"))
        #expect(Attachments.isAttachmentTarget("Docs/report.pdf#page=2"))
        #expect(!Attachments.isAttachmentTarget("Kyber Crystal Notes"))
        #expect(!Attachments.isAttachmentTarget("notes.md"))
        #expect(!Attachments.isAttachmentTarget("v1.2 notes")) // "2 notes" isn't an extension
    }

    @Test func linkTextUsesNameWhenUnique() {
        #expect(Attachments.linkText(for: "Lore/Crystals/kyber.jpg", among: paths) == "![[kyber.jpg]]")
        #expect(Attachments.linkText(for: "Attachments/diagram.png", among: paths) == "![[Attachments/diagram.png]]")
        #expect(Attachments.linkText(for: "Docs/report.pdf", among: paths) == "[[report.pdf]]")
    }

    @Test func pastedImageNames() {
        let date = Date(timeIntervalSince1970: 1_791_225_322) // 2026-10-05 14:35:22 UTC
        let name = Attachments.pastedImageName(date: date, mimeType: "image/png")
        #expect(name.hasPrefix("Pasted image 2026100"))
        #expect(name.hasSuffix(".png"))
        #expect(Attachments.pastedImageName(mimeType: "image/jpeg").hasSuffix(".jpg"))
    }
}

@Suite struct VaultAttachmentTests {
    let temp: TemporaryVault
    let vault: Vault

    init() throws {
        temp = try TemporaryVault()
        try temp.write("Lore/Kyber.md", "![[crystal.png]]\n")
        try temp.write("Lore/crystal.png", "PNG")
        vault = Vault(rootURL: temp.url, watchForChanges: false, defaults: temp.defaults)
    }

    @Test func scansAttachmentsButNotNotes() {
        #expect(vault.attachments == ["Lore/crystal.png"])
        #expect(vault.noteCount == 1)
    }

    @Test func resolvesAssetsForTheEditor() throws {
        let note = temp.url.appendingPathComponent("Lore/Kyber.md")
        let url = try #require(vault.resolveAsset(kind: "embed", target: "crystal.png", fromNote: note))
        #expect(url.lastPathComponent == "crystal.png")
        #expect(vault.resolveAsset(kind: "relative", target: "https://example.com/a.png", fromNote: note) == nil)
        #expect(vault.resolveAsset(kind: "embed", target: "missing.png", fromNote: note) == nil)
    }

    @Test func savesPastedImagesInTheAttachmentFolder() throws {
        let text = try vault.saveAttachment(Data("PNG".utf8), named: "Pasted image 1.png")
        #expect(text == "![[Pasted image 1.png]]")
        #expect(FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("Attachments/Pasted image 1.png").path))

        let second = try vault.saveAttachment(Data("PNG".utf8), named: "Pasted image 1.png")
        #expect(second == "![[Pasted image 1 2.png]]")
    }

    @Test func importsFilesFromOutsideByCopying() throws {
        let outside = try TemporaryVault()
        let photo = try outside.write("photo.jpg", "JPG")
        let doc = try outside.write("report.pdf", "PDF")

        #expect(vault.importFiles([photo, doc]) == ["![[photo.jpg]]", "[[report.pdf]]"])
        #expect(FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("Attachments/photo.jpg").path))
        #expect(FileManager.default.fileExists(atPath: photo.path), "the original is left alone")
    }

    @Test func linksFilesAlreadyInTheVaultWithoutCopying() throws {
        let existing = temp.url.appendingPathComponent("Lore/crystal.png")
        let note = temp.url.appendingPathComponent("Lore/Kyber.md")
        #expect(vault.importFiles([existing, note]) == ["![[crystal.png]]", "[[Lore/Kyber]]"])
        #expect(!FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("Attachments").path))
    }

    @Test func attachmentLinksNeverCreateNotes() {
        vault.openLink("missing.pdf")
        #expect(!FileManager.default.fileExists(atPath: temp.url.appendingPathComponent("missing.pdf.md").path))
        #expect(vault.errorMessage != nil)
    }

    @Test func outgoingLinksSkipAttachments() async {
        await vault.indexingFinished()
        #expect(vault.index.outgoingLinks(from: "Lore/Kyber.md").isEmpty)
    }
}
