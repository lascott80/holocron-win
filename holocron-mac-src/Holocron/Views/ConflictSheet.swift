import SwiftUI

/// Shown when a note changed on disk while it had unsaved edits that overlap
/// the outside change. Nothing is written until the user picks a version.
struct ConflictSheet: View {
    let document: NoteDocument
    let conflict: NoteDocument.Conflict
    @Bindable var vault: Vault

    private var blocks: [DiffBlock] {
        DiffBlock.blocks(mine: document.text, disk: conflict.diskText)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            comparison
            if conflict.isFromDisk {
                Toggle("Merge automatically when changes don’t overlap", isOn: Bindable(AppSettings.shared).autoMergeExternalChanges)
                    .toggleStyle(.checkbox)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
            }
            actions
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 20)
        .frame(width: 740)
        .background(Theme.overlayBackground)
        .tint(Theme.primaryButton) // darker blue keeps white button text readable
        .interactiveDismissDisabled()
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Theme.warning)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.warning.opacity(0.16)))
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(summary)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var title: String {
        switch conflict.origin {
        case .disk: "“\(document.url.lastPathComponent)” changed on disk"
        case .otherDevice: "“\(document.title)” was changed on another device"
        case .duplicate(let url): "“\(url.deletingPathExtension().lastPathComponent)” may be a duplicate of “\(document.title)”"
        }
    }

    private var summary: String {
        let sections = blocks.count == 1 ? "One section differs" : "\(blocks.count) sections differ"
        switch conflict.origin {
        case .disk:
            let overlap = conflict.merge.isClean ? "" : ", and some of your edits overlap the outside change"
            return "Another app or device changed this note while you had unsaved edits. \(sections)\(overlap)."
        case .otherDevice(let name, let date):
            let when = date.map { " (\($0.formatted(date: .abbreviated, time: .shortened)))" } ?? ""
            return "iCloud kept two versions: this Mac’s and \(name ?? "another device")’s\(when). \(sections). Pick one, or keep both."
        case .duplicate:
            return "iCloud sometimes saves a numbered copy when a note changes on two devices at once. \(sections). Keeping either version moves the copy to the Trash."
        }
    }

    private var otherTitle: String {
        switch conflict.origin {
        case .disk: "On disk"
        case .otherDevice(let name, _): name ?? "Other device"
        case .duplicate(let url): url.deletingPathExtension().lastPathComponent
        }
    }

    private var mineTitle: String {
        switch conflict.origin {
        case .disk: "Your edits · unsaved"
        case .otherDevice: "This Mac"
        case .duplicate: document.title
        }
    }

    private var comparison: some View {
        HStack(alignment: .top, spacing: 10) {
            DiffColumn(title: mineTitle, blocks: blocks, side: .mine)
            DiffColumn(title: otherTitle, blocks: blocks, side: .disk)
        }
        .frame(maxHeight: 320)
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: 8) {
            switch conflict.origin {
            case .disk:
                Button("Keep Both as Copies") { vault.resolveConflictKeepingBoth() }
                    .help("Save your version as a separate “conflicted copy” note and show the disk version here")
                Spacer()
                Button("Use Disk Version") { document.resolveUsingDisk() }
                    .help("Discard your unsaved edits")
                Button("Merge Both") { document.resolveMerging() }
                    .disabled(!conflict.merge.isClean)
                    .help(conflict.merge.isClean ? "Combine both sets of changes" : "Your edits and the outside change touch the same lines")
                Button("Keep My Edits") { document.resolveKeepingMine() }
                    .keyboardShortcut(.defaultAction)
                    .help("Overwrite the disk version with yours")
            case .otherDevice:
                Button("Keep Both as Copies") { vault.resolveConflictKeepingBoth() }
                    .help("Keep this Mac’s version here and save the other device’s as a separate “conflicted copy” note")
                Spacer()
                Button("Use \(otherTitle)’s Version") { document.resolveUsingDisk() }
                    .help("Replace this Mac’s version with the other device’s")
                Button("Keep This Mac’s Version") { document.resolveKeepingMine() }
                    .keyboardShortcut(.defaultAction)
                    .help("Keep this Mac’s version and discard the other device’s")
            case .duplicate:
                Button("Keep Both Notes") { vault.resolveConflictKeepingBoth() }
                    .help("Leave both notes as they are")
                Spacer()
                Button("Use “\(otherTitle)”") { document.resolveUsingDisk() }
                    .help("Put the copy’s text in “\(document.title)” and move the copy to the Trash")
                Button("Keep “\(document.title)”") { document.resolveKeepingMine() }
                    .keyboardShortcut(.defaultAction)
                    .help("Move the copy to the Trash")
            }
        }
        .controlSize(.large)
    }
}

/// One differing region, with a line of context above it.
struct DiffBlock: Identifiable {
    let id: Int
    let context: [String]
    let mine: [String]
    let disk: [String]

    enum Side { case mine, disk }

    static func blocks(mine: String, disk: String, limit: Int = 30) -> [DiffBlock] {
        let mineLines = TextMerge.lines(mine)
        let diskLines = TextMerge.lines(disk)
        let clean: (Substring) -> String = { String($0).trimmingCharacters(in: .newlines) }
        return TextMerge.diff(mineLines, diskLines).prefix(limit).enumerated().map { index, hunk in
            let contextStart = max(0, hunk.baseStart - 1)
            return DiffBlock(
                id: index,
                context: mineLines[contextStart..<hunk.baseStart].map(clean),
                mine: mineLines[hunk.baseStart..<hunk.baseEnd].map(clean),
                disk: diskLines[hunk.otherStart..<hunk.otherEnd].map(clean)
            )
        }
    }
}

private struct DiffColumn: View {
    let title: String
    let blocks: [DiffBlock]
    let side: DiffBlock.Side

    private var highlight: Color { side == .mine ? Theme.accent : Theme.warning }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.emphasizedSecondaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.sidebarBackground)
            Divider().overlay(Theme.strongBorder)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(blocks) { block in
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(block.context.enumerated()), id: \.offset) { _, line in
                                DiffLine(text: line, color: Theme.secondaryText, background: .clear)
                            }
                            let lines = side == .mine ? block.mine : block.disk
                            if lines.isEmpty {
                                DiffLine(text: side == .mine ? "(removed)" : "(not present)", color: Theme.tertiaryText, background: .clear)
                                    .italic()
                            }
                            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                                DiffLine(text: line, color: Theme.text, background: highlight.opacity(0.16))
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .background(Theme.editorBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.strongBorder))
    }
}

private struct DiffLine: View {
    let text: String
    let color: Color
    let background: Color

    var body: some View {
        Text(text.isEmpty ? " " : text)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(color)
            .lineLimit(3)
            .padding(.horizontal, 12)
            .padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background)
            .textSelection(.enabled)
    }
}
