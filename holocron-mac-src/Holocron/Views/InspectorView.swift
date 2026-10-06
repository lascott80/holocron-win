import SwiftUI

/// The right-hand panel: the open note's outline, its links, and file info.
struct InspectorView: View {
    let vault: Vault
    @AppStorage("inspectorTab") private var tab: Tab = .outline

    enum Tab: String, CaseIterable, Identifiable {
        case outline = "Outline"
        case links = "Links"
        case info = "Info"
        var id: Self { self }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $tab) {
                ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            if let document = vault.document {
                let path = vault.relativePath(of: document.url)
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        switch tab {
                        case .outline: OutlineSection(vault: vault, path: path)
                        case .links: LinksSection(vault: vault, path: path)
                        case .info: InfoSection(vault: vault, document: document, path: path)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text("No note open")
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.panelBackground)
    }
}

// MARK: - Outline

private struct OutlineSection: View {
    let vault: Vault
    let path: String

    var body: some View {
        let _ = vault.index.revision
        let headings = vault.index.info(for: path)?.headings ?? []
        let current = headings.last { $0.line <= vault.editor.cursorLine }

        if headings.isEmpty {
            EmptyNote(text: "Headings in this note appear here.")
        } else {
            let minLevel = headings.map(\.level).min() ?? 1
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(headings.enumerated()), id: \.offset) { _, heading in
                    let isCurrent = heading == current
                    Button {
                        vault.editor.scrollToLine(heading.line)
                    } label: {
                        Text(heading.text)
                            .font(.system(size: 13, weight: heading.level == minLevel ? .medium : .regular))
                            .foregroundStyle(isCurrent ? Theme.accentText : (heading.level == minLevel ? Theme.emphasizedSecondaryText : Theme.secondaryText))
                            .lineLimit(2)
                            .padding(.leading, CGFloat(heading.level - minLevel) * 12 + 8)
                            .padding(.trailing, 8)
                            .padding(.vertical, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 5).fill(isCurrent ? Theme.accent.opacity(0.14) : .clear))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Links

private struct LinksSection: View {
    let vault: Vault
    let path: String

    var body: some View {
        let _ = vault.index.revision
        let backlinks = vault.index.backlinks(to: path)
        let mentions = vault.index.unlinkedMentions(of: path)
        let outgoing = vault.index.outgoingLinks(from: path)

        SectionHeader(title: "Backlinks", count: backlinks.count)
        if backlinks.isEmpty {
            EmptyNote(text: "No other notes link here yet.")
        }
        ForEach(backlinks) { backlink in
            Button {
                vault.open(vault.url(forRelativePath: backlink.source))
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(backlink.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    ForEach(backlink.contexts.prefix(3), id: \.self) { context in
                        Text(NoteParser.plainText(context))
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(3)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border))
                .contentShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }

        if !mentions.isEmpty {
            SectionHeader(title: "Unlinked mentions", count: mentions.count)
            ForEach(mentions) { mention in
                LinkRow(title: mention.title, detail: NoteParser.plainText(mention.context)) {
                    vault.open(vault.url(forRelativePath: mention.source))
                }
            }
        }

        if !outgoing.isEmpty {
            SectionHeader(title: "Links from this note", count: outgoing.count)
            ForEach(outgoing, id: \.target) { link in
                LinkRow(title: link.target, detail: link.resolved == nil ? "Not created yet" : nil, dimmed: link.resolved == nil) {
                    vault.openLink(link.target)
                }
            }
        }
    }
}

private struct LinkRow: View {
    let title: String
    var detail: String?
    var dimmed = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13))
                    .foregroundStyle(dimmed ? Theme.tertiaryText : Theme.accentText)
                if let detail {
                    Text(detail)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Info

private struct InfoSection: View {
    let vault: Vault
    let document: NoteDocument
    let path: String

    var body: some View {
        let _ = vault.index.revision
        let info = vault.index.info(for: path)
        let attributes = try? FileManager.default.attributesOfItem(atPath: document.url.path)

        VStack(alignment: .leading, spacing: 10) {
            InfoRow(label: "Location", value: (path as NSString).deletingLastPathComponent.isEmpty ? "Vault root" : (path as NSString).deletingLastPathComponent)
            InfoRow(label: "Words", value: document.wordCount.formatted())
            InfoRow(label: "Characters", value: document.text.count.formatted())
            if let created = attributes?[.creationDate] as? Date {
                InfoRow(label: "Created", value: created.formatted(date: .abbreviated, time: .shortened))
            }
            if let modified = attributes?[.modificationDate] as? Date {
                InfoRow(label: "Modified", value: modified.formatted(date: .abbreviated, time: .shortened))
            }
            if let aliases = info?.aliases, !aliases.isEmpty {
                InfoRow(label: "Aliases", value: aliases.joined(separator: ", "))
            }
        }

        let properties = (info?.properties ?? []).filter { !["tags", "tag", "aliases", "alias"].contains($0.key.lowercased()) }
        if !properties.isEmpty {
            SectionHeader(title: "Properties", count: properties.count)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(properties.enumerated()), id: \.offset) { _, property in
                    InfoRow(
                        label: property.key,
                        value: property.values.isEmpty ? "—" : property.values.map(NoteParser.plainText).joined(separator: ", ")
                    )
                }
            }
        }

        if let tags = info?.tags, !tags.isEmpty {
            SectionHeader(title: "Tags", count: tags.count)
            FlowLayout(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Button("#\(tag)") { vault.showQuickOpen(query: "#" + tag) }
                        .buttonStyle(TagPillStyle())
                }
            }
        }

        Button("Show in Finder") {
            NSWorkspace.shared.activateFileViewerSelecting([document.url])
        }
        .padding(.top, 6)
    }
}

private struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(Theme.tertiaryText)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .foregroundStyle(Theme.emphasizedSecondaryText)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .font(.system(size: 12))
    }
}

// MARK: - Shared pieces

private struct SectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .textCase(.uppercase)
            Spacer()
            Text(count.formatted())
                .font(.system(size: 11))
                .padding(.horizontal, 7)
                .padding(.vertical, 1)
                .background(Capsule().fill(Theme.chip))
        }
        .foregroundStyle(Theme.tertiaryText)
        .padding(.top, 4)
    }
}

private struct EmptyNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 8)
    }
}

struct TagPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12))
            .foregroundStyle(Theme.accentText)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(Theme.accent.opacity(configuration.isPressed ? 0.26 : 0.14)))
    }
}

/// Lays children out left to right, wrapping onto new rows.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews: subviews, width: proposal.width ?? .infinity)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > width {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            let gap = rows[rows.count - 1].indices.isEmpty ? 0 : spacing
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
