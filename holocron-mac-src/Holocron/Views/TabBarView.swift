import SwiftUI

/// The strip of open tabs above the editor.
struct TabBarView: View {
    let vault: Vault

    var body: some View {
        HStack(spacing: 0) {
            GeometryReader { geometry in
                let width = tabWidth(available: geometry.size.width)
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 2) {
                            ForEach(vault.tabs) { tab in
                                TabItem(vault: vault, tab: tab, isActive: tab.id == vault.activeTabID)
                                    .frame(width: width)
                                    .id(tab.id)
                            }
                        }
                        .padding(.horizontal, 6)
                        .frame(height: geometry.size.height, alignment: .bottom)
                    }
                    .onChange(of: vault.activeTabID) { _, id in
                        if let id { withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id) } }
                    }
                }
            }
            Button {
                vault.newTab()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 28, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.secondaryText)
            .help("New Tab (⌘T)")
            .padding(.trailing, 8)
        }
        .frame(height: 36)
        .background(Theme.sidebarBackground)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
    }

    /// Tabs share the width evenly, between 120 and 240 points, scrolling
    /// when there are too many to fit.
    private func tabWidth(available: CGFloat) -> CGFloat {
        let count = CGFloat(max(vault.tabs.count, 1))
        return min(240, max(120, (available - 12) / count - 2))
    }
}

private struct TabItem: View {
    let vault: Vault
    let tab: EditorTab
    let isActive: Bool
    @State private var isHovered = false
    @State private var isDropTarget = false

    private var title: String {
        tab.url.map { $0.deletingPathExtension().lastPathComponent } ?? "New Tab"
    }

    var body: some View {
        let document = vault.document(for: tab)
        HStack(spacing: 6) {
            if tab.url == nil {
                Image(systemName: "plus.square.dashed")
                    .font(.system(size: 11))
                    .foregroundStyle(isActive ? Theme.secondaryText : Theme.tertiaryText)
            }
            Text(title)
                .font(.system(size: 12, weight: isActive ? .medium : .regular))
                .foregroundStyle(isActive ? Theme.text : Theme.secondaryText)
                .lineLimit(1)
                .truncationMode(.middle)
                .layoutPriority(1)
            Spacer(minLength: 0)
            trailingControl(document)
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .frame(height: 30)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 7, topTrailingRadius: 7)
                .fill(isActive ? Theme.editorBackground : (isHovered ? Theme.chip : .clear))
        )
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: 7, topTrailingRadius: 7)
                .strokeBorder(isActive ? Theme.border : .clear)
                .padding(.bottom, -1)
        )
        .overlay(alignment: .leading) {
            if isDropTarget { Rectangle().fill(Theme.accent).frame(width: 2) }
        }
        .contentShape(Rectangle())
        .onTapGesture { vault.activateTab(tab.id) }
        .onHover { isHovered = $0 }
        .help(tab.url.map { vault.relativePath(of: $0) } ?? "")
        .draggable(tab.id.uuidString) {
            Text(title).padding(6).background(Theme.raised, in: RoundedRectangle(cornerRadius: 6))
        }
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first.flatMap(UUID.init(uuidString:)) else { return false }
            vault.moveTab(id, to: tab.id)
            return true
        } isTargeted: { isDropTarget = $0 }
        .contextMenu {
            Button("Close Tab") { vault.closeTab(tab.id) }
            Button("Close Other Tabs") { vault.closeOtherTabs(than: tab.id) }
                .disabled(vault.tabs.count < 2)
            Button("Close Tabs to the Right") { vault.closeTabsToTheRight(of: tab.id) }
                .disabled(vault.tabs.last?.id == tab.id)
            if let url = tab.url {
                Divider()
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    /// A close button on hover or for the active tab; otherwise a dot for
    /// unsaved edits or a warning for conflicts and missing files.
    @ViewBuilder
    private func trailingControl(_ document: NoteDocument?) -> some View {
        let needsAttention = document?.conflict != nil || document?.isMissingOnDisk == true
        if isHovered || isActive {
            Button {
                vault.closeTab(tab.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(isHovered ? Theme.chip : .clear))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityLabel("Close \(title)")
        } else if needsAttention {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Theme.warning)
                .frame(width: 18, height: 18)
        } else if document?.isDirty == true {
            Circle().fill(Theme.accent).frame(width: 6, height: 6).frame(width: 18, height: 18)
        } else {
            Color.clear.frame(width: 18, height: 18)
        }
    }
}
