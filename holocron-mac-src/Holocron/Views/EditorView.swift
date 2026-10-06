import SwiftUI

/// The note pane: breadcrumb, editor and status bar.
struct EditorView: View {
    let document: NoteDocument
    let vault: Vault
    @Environment(\.colorScheme) private var colorScheme

    /// Everything the editor's look depends on; re-applied when it changes.
    private var appearanceKey: [String] {
        let settings = AppSettings.shared
        return [
            colorScheme == .dark ? "dark" : "light", settings.accent.rawValue, settings.editorFont.rawValue,
            "\(settings.editorFontSize)", "\(settings.editorLineWidth)",
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            if AppSettings.shared.showFormattingBar, AppSettings.shared.editorMode != .reading, !vault.isFocusMode {
                FormattingBar(editor: vault.editor)
            }
            if !vault.isFocusMode {
                breadcrumb
            }
            if document.isMissingOnDisk {
                MissingFileBanner(document: document, vault: vault)
            }
            MarkdownEditorView(controller: vault.editor, document: document)
            if !vault.isFocusMode {
                Divider().overlay(Theme.border)
                StatusBar(document: document, editor: vault.editor, vault: vault)
            }
        }
        .background(Theme.editorBackground)
        .onChange(of: appearanceKey, initial: true) {
            vault.editor.applyAppearance(isDark: colorScheme == .dark)
        }
        .onChange(of: AppSettings.shared.editorMode, initial: true) { _, mode in
            vault.editor.setMode(mode)
        }
        .navigationTitle(document.title)
        .navigationSubtitle(vault.name)
        .sheet(isPresented: Binding(
            get: { document.conflict != nil },
            set: { _ in }
        )) {
            if let conflict = document.conflict {
                ConflictSheet(document: document, conflict: conflict, vault: vault)
            }
        }
    }

    private var breadcrumb: some View {
        HStack(spacing: 6) {
            ForEach(Array(relativeFolders.enumerated()), id: \.offset) { _, folder in
                Text(folder)
                Text("/")
            }
            Text(document.url.lastPathComponent)
                .foregroundStyle(Theme.emphasizedSecondaryText)
            Spacer()
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.tertiaryText)
        .lineLimit(1)
        .padding(.horizontal, 24)
        .frame(height: 36)
    }

    private var relativeFolders: [String] {
        vault.relativePath(of: document.url).split(separator: "/").dropLast().map(String.init)
    }
}

private struct StatusBar: View {
    let document: NoteDocument
    let editor: EditorController
    let vault: Vault

    var body: some View {
        HStack(spacing: 18) {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
                Text(saveStatus)
            }
            .help(saveHelp)
            if let status = vault.cloudStatus {
                CloudStatusView(status: status)
            }
            Spacer()
            WordCountButton(document: document, editor: editor)
            Text("Ln \(editor.cursorLine), Col \(editor.cursorColumn)")
                .monospacedDigit()
            ModeMenu()
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.tertiaryText)
        .padding(.horizontal, 16)
        .frame(height: 28)
    }

    /// Hovering the save status: the error, or when the note was last saved.
    private var saveHelp: String {
        if let error = document.saveError { return error }
        guard let saved = document.lastSaved else { return "Not saved in this session yet" }
        let time = saved.formatted(date: Calendar.current.isDateInToday(saved) ? .omitted : .abbreviated, time: .shortened)
        return "Last saved at \(time)"
    }

    private var statusColor: Color {
        if document.saveError != nil { return .red }
        if document.conflict != nil || document.isMissingOnDisk { return Theme.warning }
        return Theme.synced
    }

    private var saveStatus: String {
        if let error = document.saveError { return "Couldn’t save: \(error)" }
        if document.conflict != nil { return "Changed on disk — choose a version" }
        if document.isMissingOnDisk { return "Not on disk" }
        if document.isDirty { return "Editing…" }
        if let event = document.lastSyncEvent, event.date >= (document.lastSaved ?? .distantPast) {
            return event.kind == .merged ? "Merged changes from disk" : "Updated from disk"
        }
        return "Saved to disk"
    }
}

/// The vault's iCloud state: a cloud icon, with a word when there's
/// something to say (syncing, a problem).
private struct CloudStatusView: View {
    let status: Vault.CloudStatus

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .foregroundStyle(color)
            if let label {
                Text(label)
            }
        }
        .help(help)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(help)
    }

    private var symbol: String {
        switch status {
        case .upToDate: "icloud"
        case .syncing: "arrow.triangle.2.circlepath.icloud"
        case .error: "exclamationmark.icloud"
        case .unavailable: "icloud.slash"
        }
    }

    private var color: Color {
        switch status {
        case .upToDate, .syncing: Theme.tertiaryText
        case .error: .red
        case .unavailable: Theme.warning
        }
    }

    private var label: String? {
        switch status {
        case .upToDate: nil
        case .syncing(let up, let down):
            if up > 0 && down > 0 { "Syncing \(up + down)" } else if up > 0 { "Uploading \(up)" } else { "Downloading \(down)" }
        case .error: "iCloud problem"
        case .unavailable: "Not syncing"
        }
    }

    private var help: String {
        switch status {
        case .upToDate(let offloaded):
            offloaded == 0
                ? "Synced with iCloud"
                : "Synced with iCloud. \(offloaded == 1 ? "1 note is" : "\(offloaded) notes are") stored only in iCloud and will download when opened."
        case .syncing(let up, let down):
            [up > 0 ? "Uploading \(up) to iCloud" : nil, down > 0 ? "Downloading \(down) from iCloud" : nil]
                .compactMap { $0 }.joined(separator: " · ")
        case .error(let message):
            "iCloud couldn’t sync: \(message)"
        case .unavailable:
            "This vault is in the iCloud Drive folder, but iCloud Drive isn’t syncing it. Check that iCloud Drive is on in System Settings › Apple Account › iCloud."
        }
    }
}

/// Shown in place of the editor while a note downloads from iCloud.
struct DownloadingNoteView: View {
    let name: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.small)
            Text("Downloading “\(name)” from iCloud…")
                .foregroundStyle(Theme.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.editorBackground)
    }
}

/// The word count; with a selection, "12 of 340 words". Click for more stats.
private struct WordCountButton: View {
    let document: NoteDocument
    let editor: EditorController
    @State private var showStats = false

    var body: some View {
        Button {
            showStats.toggle()
        } label: {
            Text(label)
                .monospacedDigit()
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Word count — click for characters and reading time")
        .popover(isPresented: $showStats, arrowEdge: .top) {
            NoteStats(text: document.text, words: document.wordCount, editor: editor)
        }
    }

    private var label: String {
        let total = document.wordCount
        if editor.selectedWords > 0 {
            return "\(editor.selectedWords.formatted()) of \(total.formatted()) words"
        }
        return total == 1 ? "1 word" : "\(total.formatted()) words"
    }
}

/// Counts for the open note (and the selection, if any).
private struct NoteStats: View {
    let text: String
    let words: Int
    let editor: EditorController

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
            row("Words", words.formatted())
            row("Characters", text.count.formatted())
            row("Without spaces", text.filter { !$0.isWhitespace }.count.formatted())
            row("Paragraphs", paragraphs.formatted())
            row("Reading time", readingTime)
            if editor.selectedWords > 0 || editor.selectedCharacters > 0 {
                Divider().gridCellUnsizedAxes(.horizontal)
                row("Selected words", editor.selectedWords.formatted())
                row("Selected characters", editor.selectedCharacters.formatted())
            }
        }
        .font(.system(size: 12))
        .padding(14)
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(Theme.secondaryText)
            Text(value).monospacedDigit().foregroundStyle(Theme.text).gridColumnAlignment(.trailing)
        }
    }

    private var paragraphs: Int {
        text.components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
    }

    /// At about 230 words a minute.
    private var readingTime: String {
        let minutes = Double(words) / 230
        return minutes < 1 ? "Under a minute" : "\(Int(minutes.rounded(.up))) min"
    }
}

/// The status bar's view mode switcher.
private struct ModeMenu: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Menu {
            Picker("View Mode", selection: $settings.editorMode) {
                ForEach(AppSettings.EditorMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            Text(settings.editorMode.title)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Switch between live preview, source mode and reading view")
    }
}

/// Shown above the editor when the open note was deleted or moved by
/// another app while it had unsaved edits.
private struct MissingFileBanner: View {
    let document: NoteDocument
    let vault: Vault

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(Theme.warning)
            Text("This note was deleted or moved outside Holocron. Your unsaved edits are still here.")
                .foregroundStyle(Theme.text)
            Spacer()
            Button("Discard Edits") { vault.closeDocument() }
            Button("Restore") {
                document.save()
                vault.reload()
            }
            .keyboardShortcut(.defaultAction)
        }
        .font(.system(size: 12))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.warning.opacity(0.12))
        .overlay(alignment: .bottom) { Divider().overlay(Theme.warning.opacity(0.3)) }
    }
}

/// Shown in the detail pane when no note is open: quick ways in, recent
/// notes and a few shortcuts worth knowing.
struct EmptyEditorView: View {
    let vault: Vault
    let model: AppModel

    private var recent: [String] {
        let existing = Set(vault.allNotes.map { vault.relativePath(of: $0) })
        return vault.recentNotes.filter(existing.contains).prefix(6).map { $0 }
    }

    var body: some View {
        VStack(spacing: 28) {
            VStack(spacing: 12) {
                HolocronMark(color: Theme.secondaryText.opacity(0.6), lineWidth: 1.5)
                    .frame(width: 48, height: 48)
                Text(vault.noteCount == 0 ? "This vault is empty" : (vault.tabs.isEmpty ? "No note open" : "New tab"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.text)
                if vault.noteCount == 0 {
                    Text("Create a note, add .md files to the folder in Finder, or add a short guide to get started.")
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }

            HStack(spacing: 10) {
                ActionTile(title: "New Note", symbol: "square.and.pencil", shortcut: "⌘N") { vault.createNote() }
                ActionTile(title: "Today’s Note", symbol: "calendar", shortcut: "⇧⌘D") { vault.openDailyNote() }
                if vault.noteCount == 0 {
                    ActionTile(title: "Start Here Guide", symbol: "book", shortcut: nil) { model.addStarterGuide() }
                } else {
                    ActionTile(title: "Quick Open", symbol: "magnifyingglass", shortcut: "⌘O") { vault.showQuickOpen() }
                }
            }

            if !recent.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Recent")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.tertiaryText)
                        .textCase(.uppercase)
                        .padding(.horizontal, 10)
                        .padding(.bottom, 4)
                    ForEach(recent, id: \.self) { path in
                        RecentRow(path: path) { vault.open(vault.url(forRelativePath: path)) }
                    }
                }
                .frame(width: 380)
            }

            HStack(spacing: 18) {
                hint("⇧⌘P", "Commands")
                hint("⇧⌘F", "Search")
                hint("⌥⌘F", "Focus")
            }
            .font(.system(size: 11))
            .foregroundStyle(Theme.tertiaryText)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.editorBackground)
    }

    private func hint(_ keys: String, _ label: String) -> some View {
        HStack(spacing: 5) {
            Text(keys)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Theme.chip, in: RoundedRectangle(cornerRadius: 4))
            Text(label)
        }
    }
}

/// A large button on the empty editor.
private struct ActionTile: View {
    let title: String
    let symbol: String
    let shortcut: String?
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.accentText)
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.text)
                Text(shortcut ?? " ")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.tertiaryText)
            }
            .frame(width: 120, height: 84)
            .background(isHovered ? Theme.chip : Theme.raised, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(isHovered ? Theme.strongBorder : Theme.border))
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(shortcut.map { "\(title), \($0)" } ?? title)
    }
}

/// A recently opened note on the empty editor.
private struct RecentRow: View {
    let path: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "doc.text")
                    .foregroundStyle(Theme.tertiaryText)
                Text(VaultIndex.title(of: path))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer(minLength: 12)
                Text(folder)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            .font(.system(size: 13))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isHovered ? Theme.chip : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private var folder: String {
        let parts = path.split(separator: "/").dropLast()
        return parts.joined(separator: " / ")
    }
}
