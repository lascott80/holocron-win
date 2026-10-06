import SwiftUI

/// A command the palette can run.
struct QuickCommand: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    var shortcut: String?
    let action: () -> Void
}

/// ⌘O: jump to any note by name, alias, folder or #tag, create a note, or
/// run a command (type ">" to list commands only).
struct QuickOpenView: View {
    @Bindable var vault: Vault
    let commands: [QuickCommand]

    @State private var selected = 0
    @FocusState private var fieldFocused: Bool

    private enum Row: Identifiable {
        case note(QuickOpenSearch.Hit)
        case create(String)
        case command(QuickCommand, indices: [Int])

        var id: String {
            switch self {
            case .note(let hit): "note:" + hit.path
            case .create(let name): "create:" + name
            case .command(let command, _): "command:" + command.id
            }
        }
    }

    private var query: String { vault.quickOpenQuery ?? "" }

    private var sections: (notes: [Row], commands: [Row]) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix(">") {
            let text = trimmed.dropFirst().trimmingCharacters(in: .whitespaces)
            return ([], matchingCommands(String(text), limit: 200))
        }

        let _ = vault.index.revision
        let notes = vault.allNotes.map { url -> QuickOpenSearch.Note in
            let path = vault.relativePath(of: url)
            let info = vault.index.info(for: path)
            return .init(path: path, aliases: info?.aliases ?? [], tags: info?.tags ?? [])
        }
        let hits = QuickOpenSearch(notes: notes, recent: vault.recentNotes).search(trimmed, limit: 30)
        var noteRows = hits.map(Row.note)

        let isPlainQuery = !trimmed.isEmpty && !trimmed.hasPrefix("#")
        let exactExists = hits.contains { VaultIndex.title(of: $0.path).caseInsensitiveCompare(trimmed) == .orderedSame }
        if isPlainQuery && !exactExists {
            noteRows.append(.create(trimmed))
        }
        let commandRows = trimmed.isEmpty || trimmed.hasPrefix("#") ? [] : matchingCommands(trimmed, limit: 4)
        return (noteRows, commandRows)
    }

    private func matchingCommands(_ text: String, limit: Int) -> [Row] {
        if text.isEmpty { return commands.prefix(limit).map { .command($0, indices: []) } }
        return commands
            .compactMap { command in FuzzyMatch.match(text, in: command.title).map { (command, $0) } }
            .sorted { $0.1.score > $1.1.score }
            .prefix(limit)
            .map { .command($0.0, indices: $0.1.indices) }
    }

    var body: some View {
        let sections = sections
        let rows = sections.notes + sections.commands

        ZStack(alignment: .top) {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture { close() }
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                searchField(rows: rows)
                Divider().overlay(Theme.strongBorder)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            if !sections.notes.isEmpty {
                                SectionLabel(text: query.trimmingCharacters(in: .whitespaces).isEmpty ? "Recent" : "Notes")
                                ForEach(Array(sections.notes.enumerated()), id: \.element.id) { offset, row in
                                    rowView(row, isSelected: offset == selected)
                                        .id(offset)
                                        .onTapGesture { activate(row) }
                                }
                            }
                            if !sections.commands.isEmpty {
                                SectionLabel(text: "Commands")
                                ForEach(Array(sections.commands.enumerated()), id: \.element.id) { offset, row in
                                    let index = sections.notes.count + offset
                                    rowView(row, isSelected: index == selected)
                                        .id(index)
                                        .onTapGesture { activate(row) }
                                }
                            }
                            if rows.isEmpty {
                                Text(query.hasPrefix("#") ? "No notes with that tag" : "No matches")
                                    .foregroundStyle(Theme.tertiaryText)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 24)
                            }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 420)
                    .onChange(of: selected) { _, index in
                        withAnimation(.easeOut(duration: 0.1)) { proxy.scrollTo(index) }
                    }
                }
                Divider().overlay(Theme.strongBorder)
                footer
            }
            .frame(width: 600)
            .fixedSize(horizontal: false, vertical: true)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.overlayBackground))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.strongBorder))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
            .padding(.top, 80)
        }
        .onAppear { fieldFocused = true }
        .onChange(of: query) { selected = 0 }
    }

    private func searchField(rows: [Row]) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16))
                .foregroundStyle(Theme.secondaryText)
            TextField("Find a note, #tag, or > command", text: Binding(
                get: { vault.quickOpenQuery ?? "" },
                set: { vault.quickOpenQuery = $0 }
            ))
            .textFieldStyle(.plain)
            .font(.system(size: 18))
            .foregroundStyle(Theme.text)
            .focused($fieldFocused)
            .onKeyPress(.downArrow) {
                selected = min(selected + 1, max(rows.count - 1, 0))
                return .handled
            }
            .onKeyPress(.upArrow) {
                selected = max(selected - 1, 0)
                return .handled
            }
            .onKeyPress(.escape) {
                close()
                return .handled
            }
            .onKeyPress(.return, phases: .down) { press in
                if press.modifiers.contains(.shift) {
                    let name = query.trimmingCharacters(in: .whitespaces)
                    if !name.isEmpty, !name.hasPrefix("#"), !name.hasPrefix(">") {
                        close()
                        vault.createNote(named: name)
                    }
                } else if rows.indices.contains(selected) {
                    activate(rows[selected], inNewTab: press.modifiers.contains(.command))
                }
                return .handled
            }
            Text("esc")
                .font(.system(size: 11))
                .foregroundStyle(Theme.tertiaryText)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.strongBorder))
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
    }

    @ViewBuilder
    private func rowView(_ row: Row, isSelected: Bool) -> some View {
        let secondary = isSelected ? Theme.onPrimarySecondary : Theme.secondaryText
        HStack(spacing: 12) {
            switch row {
            case .note(let hit):
                Image(systemName: "doc.text")
                    .foregroundStyle(secondary)
                    .frame(width: 18)
                noteTitle(hit, isSelected: isSelected)
                Spacer(minLength: 12)
                Text(folder(of: hit.path))
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            case .create(let name):
                Image(systemName: "plus")
                    .foregroundStyle(secondary)
                    .frame(width: 18)
                Text("Create note “\(name)”")
                    .foregroundStyle(isSelected ? .white : Theme.emphasizedSecondaryText)
                Spacer()
                Text("⇧↵")
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
            case .command(let command, let indices):
                Image(systemName: command.systemImage)
                    .foregroundStyle(secondary)
                    .frame(width: 18)
                Text(Self.highlighted(command.title, indices: indices, isSelected: isSelected))
                    .foregroundStyle(isSelected ? .white : Theme.emphasizedSecondaryText)
                Spacer()
                if let shortcut = command.shortcut {
                    Text(shortcut)
                        .font(.system(size: 12))
                        .foregroundStyle(secondary)
                }
            }
        }
        .font(.system(size: 14))
        .padding(.horizontal, 10)
        .frame(height: 40)
        .background(RoundedRectangle(cornerRadius: 8).fill(isSelected ? Theme.primaryButton : .clear))
        .contentShape(Rectangle())
    }

    private func noteTitle(_ hit: QuickOpenSearch.Hit, isSelected: Bool) -> some View {
        let title = VaultIndex.title(of: hit.path)
        let main: AttributedString
        var suffix = AttributedString()
        switch hit.field {
        case .title:
            main = Self.highlighted(title, indices: hit.indices, isSelected: isSelected)
        case .alias(let alias):
            main = AttributedString(title)
            suffix = AttributedString(" — alias “")
            suffix.append(Self.highlighted(alias, indices: hit.indices, isSelected: isSelected))
            suffix.append(AttributedString("”"))
            suffix.foregroundColor = isSelected ? Theme.onPrimarySecondary : Theme.secondaryText
        case .path:
            main = AttributedString(title)
        }
        return Text(main + suffix)
            .foregroundStyle(isSelected ? .white : Theme.text)
            .lineLimit(1)
    }

    private static func highlighted(_ text: String, indices: [Int], isSelected: Bool) -> AttributedString {
        var result = AttributedString()
        let marked = Set(indices)
        for (offset, character) in text.enumerated() {
            var piece = AttributedString(String(character))
            if marked.contains(offset) {
                piece.font = .system(size: 14, weight: .bold)
                if !isSelected { piece.foregroundColor = Theme.accentText }
            }
            result.append(piece)
        }
        return result
    }

    private func folder(of path: String) -> String {
        let folder = (path as NSString).deletingLastPathComponent
        return folder.isEmpty ? "" : folder.replacingOccurrences(of: "/", with: " / ")
    }

    private var footer: some View {
        HStack(spacing: 18) {
            Text("↑↓ navigate")
            Text("↵ open")
            Text("⌘↵ new tab")
            Text("⇧↵ create")
            Spacer()
            Text("#tag · > commands")
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.tertiaryText)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func activate(_ row: Row, inNewTab: Bool = false) {
        close()
        switch row {
        case .note(let hit):
            vault.open(vault.url(forRelativePath: hit.path), inNewTab: inNewTab)
            vault.editor.focus()
        case .create(let name):
            vault.createNote(named: name)
        case .command(let command, _):
            command.action()
        }
    }

    private func close() {
        vault.quickOpenQuery = nil
    }
}

private struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 4)
    }
}
