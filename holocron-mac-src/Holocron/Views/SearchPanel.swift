import SwiftUI

/// The sidebar's Search mode (⇧⌘F): full-text search across the vault.
struct SearchPanel: View {
    let vault: Vault
    @Bindable var search: SearchModel
    @FocusState private var fieldFocused: Bool
    @State private var collapsed: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            field
            summary
            if search.text.trimmingCharacters(in: .whitespaces).isEmpty {
                SearchHelp()
                Spacer()
            } else {
                results
            }
        }
        .onAppear { fieldFocused = true }
        .onChange(of: search.focusRequest) { fieldFocused = true }
        .onChange(of: vault.index.revision) { search.refresh() }
    }

    private var field: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.tertiaryText)
            TextField("Search vault", text: $search.text)
                .textFieldStyle(.plain)
                .focused($fieldFocused)
                .onSubmit { revealFirst() }
            if !search.text.isEmpty {
                Button {
                    search.text = ""
                    fieldFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.tertiaryText)
                .accessibilityLabel("Clear search")
            }
            OptionToggle(label: "Aa", help: "Match case", isOn: $search.matchCase)
            OptionToggle(label: ".*", help: "Regular expression", isOn: $search.useRegex)
        }
        .font(.system(size: 13))
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 7).fill(Theme.chip))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(fieldFocused ? Theme.accent.opacity(0.6) : .clear))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private var summary: some View {
        let outcome = search.outcome
        let text: String? = {
            if let error = outcome.error { return error }
            if search.text.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
            if search.isSearching && outcome.hits.isEmpty { return "Searching…" }
            if outcome.hits.isEmpty { return "No results" }
            let notes = outcome.hits.count == 1 ? "1 note" : "\(outcome.hits.count)\(outcome.truncated ? "+" : "") notes"
            let matches = outcome.totalMatches == 1 ? "1 match" : "\(outcome.totalMatches.formatted()) matches"
            return "\(matches) in \(notes)"
        }()
        if let text {
            HStack {
                Text(text)
                    .foregroundStyle(outcome.error == nil ? Theme.tertiaryText : Theme.warning)
                Spacer()
                if !outcome.hits.isEmpty {
                    Button(collapsed.isEmpty ? "Collapse All" : "Expand All") {
                        collapsed = collapsed.isEmpty ? Set(outcome.hits.map(\.id)) : []
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accentText)
                }
            }
            .font(.system(size: 11))
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
        }
    }

    private var results: some View {
        List {
            ForEach(search.outcome.hits) { hit in
                DisclosureGroup(isExpanded: Binding(
                    get: { !collapsed.contains(hit.id) },
                    set: { expanded in if expanded { collapsed.remove(hit.id) } else { collapsed.insert(hit.id) } }
                )) {
                    ForEach(hit.lines) { line in
                        Button {
                            vault.reveal(line, in: hit.path)
                        } label: {
                            Text(Self.snippet(line))
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Line \(line.line)")
                    }
                    if hit.lines.count < hit.matchCount, hit.lines.count >= 20 {
                        Text("More matches in this note")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.tertiaryText)
                    }
                } label: {
                    Button {
                        if let first = hit.lines.first {
                            vault.reveal(first, in: hit.path)
                        } else {
                            vault.open(vault.url(forRelativePath: hit.path))
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(hit.title)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            if hit.matchCount > 0 {
                                Text(hit.matchCount.formatted())
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.tertiaryText)
                                    .padding(.horizontal, 6)
                                    .background(Capsule().fill(Theme.chip))
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(hit.path)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
    }

    private func revealFirst() {
        guard let hit = search.outcome.hits.first, let line = hit.lines.first else { return }
        vault.reveal(line, in: hit.path)
    }

    /// The matching line, trimmed to start shortly before the first match,
    /// with every match highlighted.
    static func snippet(_ match: VaultSearch.LineMatch) -> AttributedString {
        let line = match.text as NSString
        let lead = 24
        let firstMatch = match.ranges.first?.location ?? 0
        var start = max(0, firstMatch - lead)
        if start > 0 {
            // Begin at the next word boundary so the snippet doesn't start mid-word.
            let space = line.rangeOfCharacter(from: .whitespaces, range: NSRange(location: start, length: firstMatch - start))
            start = space.location != NSNotFound ? space.location + 1 : line.rangeOfComposedCharacterSequence(at: start).location
        }
        let end = min(line.length, start + 240)

        var result = AttributedString(start > 0 ? "…" : "")
        var cursor = start
        for range in match.ranges where range.location >= start && range.location < end {
            if range.location > cursor {
                result += AttributedString(line.substring(with: NSRange(location: cursor, length: range.location - cursor)))
            }
            let length = min(range.length, end - range.location)
            var highlighted = AttributedString(line.substring(with: NSRange(location: range.location, length: length)))
            highlighted.foregroundColor = Theme.text
            highlighted.backgroundColor = Theme.accent.opacity(0.28)
            highlighted.font = .system(size: 12, weight: .semibold)
            result += highlighted
            cursor = range.location + length
        }
        if cursor < end {
            result += AttributedString(line.substring(with: NSRange(location: cursor, length: end - cursor)))
        }
        if end < line.length { result += AttributedString("…") }
        return result
    }
}

private struct OptionToggle: View {
    let label: String
    let help: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .frame(width: 22, height: 18)
                .foregroundStyle(isOn ? .white : Theme.secondaryText)
                .background(RoundedRectangle(cornerRadius: 4).fill(isOn ? Theme.primaryButton : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

private struct SearchHelp: View {
    private let rows: [(String, String)] = [
        ("kyber crystal", "notes with both words"),
        ("\"red shift\"", "an exact phrase"),
        ("-ilum", "leave out a word"),
        ("tag:lore", "notes with a tag"),
        ("path:Daily", "notes in a folder"),
        ("file:log", "notes by name"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(rows, id: \.0) { example, meaning in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(example)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.accentText)
                        .frame(width: 104, alignment: .leading)
                    Text(meaning)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
