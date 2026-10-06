import SwiftUI

/// Choose a template to insert (⌥⌘T) or to start a new note from (⇧⌘N).
/// For a new note, a second step asks for its name.
struct TemplatePickerView: View {
    @Bindable var vault: Vault
    let mode: Vault.TemplatePickerMode

    @State private var query = ""
    @State private var selected = 0
    @State private var chosen: URL?
    @State private var noteName = ""
    @FocusState private var fieldFocused: Bool

    private var matches: [(url: URL, indices: [Int])] {
        let templates = vault.templates
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return templates.map { ($0, []) } }
        return templates
            .compactMap { url in FuzzyMatch.match(trimmed, in: name(of: url)).map { (url, $0) } }
            .sorted { $0.1.score > $1.1.score }
            .map { ($0.0, $0.1.indices) }
    }

    var body: some View {
        let matches = matches
        ZStack(alignment: .top) {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture { close() }
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                if let chosen {
                    nameStep(for: chosen)
                } else {
                    field(matches: matches)
                    Divider().overlay(Theme.strongBorder)
                    list(matches)
                }
            }
            .frame(width: 520)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.overlayBackground))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.strongBorder))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
            .padding(.top, 80)
        }
        .onAppear { fieldFocused = true }
        .onChange(of: query) { selected = 0 }
    }

    private var title: String {
        mode == .insert ? "Insert template" : "New note from template"
    }

    private func field(matches: [(url: URL, indices: [Int])]) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.on.doc")
                .foregroundStyle(Theme.secondaryText)
            TextField(title, text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .focused($fieldFocused)
                .onKeyPress(.downArrow) {
                    selected = min(selected + 1, max(matches.count - 1, 0))
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
                .onSubmit {
                    if matches.indices.contains(selected) { pick(matches[selected].url) }
                }
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
    }

    @ViewBuilder
    private func list(_ matches: [(url: URL, indices: [Int])]) -> some View {
        if vault.templates.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("No templates yet")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Add notes to the “\(vault.templatesFolder.isEmpty ? "Templates" : vault.templatesFolder)” folder and they’ll appear here. Templates can use {{title}}, {{date}}, {{time}} and {{cursor}}. Change the folder in Settings › Templates.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if matches.isEmpty {
            Text("No matching templates")
                .foregroundStyle(Theme.tertiaryText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(matches.enumerated()), id: \.element.url) { index, match in
                        row(match.url, indices: match.indices, isSelected: index == selected)
                            .onTapGesture { pick(match.url) }
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ url: URL, indices: [Int], isSelected: Bool) -> some View {
        // Only show subfolders within the templates folder.
        var folder = (vault.relativePath(of: url) as NSString).deletingLastPathComponent
        let root = vault.templatesFolder
        if folder == root { folder = "" } else if folder.hasPrefix(root + "/") { folder.removeFirst(root.count + 1) }
        var label = AttributedString()
        for (offset, character) in name(of: url).enumerated() {
            var piece = AttributedString(String(character))
            if indices.contains(offset) { piece.font = .system(size: 14, weight: .bold) }
            label.append(piece)
        }
        return HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(isSelected ? .white : Theme.text)
            Spacer()
            Text(folder)
                .font(.system(size: 12))
                .foregroundStyle(isSelected ? Theme.onPrimarySecondary : Theme.tertiaryText)
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(RoundedRectangle(cornerRadius: 7).fill(isSelected ? Theme.primaryButton : .clear))
        .contentShape(Rectangle())
    }

    private func nameStep(for template: URL) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("New note from “\(name(of: template))”")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.tertiaryText)
            TextField("Note name", text: $noteName)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .focused($fieldFocused)
                .onSubmit { create(from: template) }
                .onKeyPress(.escape) {
                    close()
                    return .handled
                }
            Text("↵ create · esc cancel")
                .font(.system(size: 11))
                .foregroundStyle(Theme.tertiaryText)
        }
        .padding(16)
    }

    private func name(of url: URL) -> String {
        url.deletingPathExtension().lastPathComponent
    }

    private func pick(_ template: URL) {
        switch mode {
        case .insert:
            close()
            vault.insertTemplate(template)
        case .newNote:
            chosen = template
            noteName = ""
            fieldFocused = true
        }
    }

    private func create(from template: URL) {
        let name = noteName
        close()
        vault.createNote(fromTemplate: template, named: name)
    }

    private func close() {
        vault.templatePicker = nil
    }
}
