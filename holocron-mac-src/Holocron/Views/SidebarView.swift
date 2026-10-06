import SwiftUI

/// Vault switcher plus the folder/note tree.
struct SidebarView: View {
    @Bindable var vault: Vault
    let model: AppModel
    @AppStorage("sidebarTagsExpanded") private var tagsExpanded = true
    /// The row (or the "Files" header) a drag is hovering over.
    @State private var dropHover: DropHover?

    private enum DropHover: Equatable {
        case root
        /// A row, with the folder a drop on it moves into.
        case row(URL, folder: URL)
    }

    /// The folder a drop would land in, highlighted while dragging. Nil
    /// means the top of the vault.
    private var dropFolder: URL?? {
        switch dropHover {
        case nil: return .none
        case .root: return .some(nil)
        case .row(_, let folder):
            let folder = folder.standardizedFileURL
            return .some(folder == vault.rootURL.standardizedFileURL ? nil : folder)
        }
    }

    /// Sets or clears the hovered target; an exit only clears its own target,
    /// so moving between rows doesn't drop the highlight.
    private func setDropHover(_ hover: DropHover, _ targeted: Bool) {
        if targeted { dropHover = hover } else if dropHover == hover { dropHover = nil }
    }

    var body: some View {
        Group {
            switch vault.sidebarMode {
            case .files: fileList
            case .search: SearchPanel(vault: vault, search: vault.search)
            }
        }
        .background(Theme.sidebarBackground)
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 8) {
                VaultSwitcher(vault: vault, model: model)
                Picker("Sidebar", selection: $vault.sidebarMode) {
                    Label("Files", systemImage: "folder").tag(Vault.SidebarMode.files)
                    Label("Search", systemImage: "magnifyingglass").tag(Vault.SidebarMode.search)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Button {
                    vault.createNote()
                } label: {
                    Label("New Note", systemImage: "plus")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                Button {
                    vault.sidebarMode = .files
                    vault.createFolder()
                } label: {
                    Image(systemName: "folder.badge.plus")
                        .contentShape(Rectangle())
                }
                .help("New Folder (⌥⌘N)")
                .accessibilityLabel("New Folder")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Theme.sidebarBackground)
            .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
        }
    }

    private var fileList: some View {
        List(selection: $vault.selection) {
            Section {
                OutlineGroup(vault.tree, children: \.children) { node in
                    FileRow(node: node, vault: vault, isDropTarget: dropFolder == .some(node.url.standardizedFileURL))
                        .tag(node.url)
                        .contextMenu { contextMenu(for: node) }
                        .draggable(node.url)
                        .dropDestination(for: URL.self) { urls, _ in
                            // Dropping on a note moves into the note's folder.
                            vault.move(urls, into: node.isDirectory ? node.url : node.url.deletingLastPathComponent())
                            return true
                        } isTargeted: {
                            setDropHover(.row(node.url, folder: node.isDirectory ? node.url : node.url.deletingLastPathComponent()), $0)
                        }
                }
            } header: {
                HStack {
                    Text("Files")
                    Spacer()
                    Text(vault.noteCount.formatted())
                        .fontWeight(.regular)
                }
                .contentShape(Rectangle())
                .background(DropHighlight(isActive: dropFolder == .some(nil)).padding(.horizontal, -6))
                .dropDestination(for: URL.self) { urls, _ in
                    vault.move(urls, into: nil)
                    return true
                } isTargeted: { setDropHover(.root, $0) }
                .help("Drop here to move to the top of the vault")
                .contextMenu {
                    Button("New Note") { vault.selection = nil; vault.createNote() }
                    Button("New Folder") { vault.createFolder(in: vault.rootURL) }
                }
            }

            let _ = vault.index.revision
            let tags = vault.index.allTags()
            if !tags.isEmpty {
                Section("Tags", isExpanded: $tagsExpanded) {
                    ForEach(tags.prefix(100)) { tag in
                        Button {
                            vault.showQuickOpen(query: "#" + tag.tag)
                        } label: {
                            HStack {
                                Label(tag.tag, systemImage: "number")
                                Spacer()
                                Text(tag.count.formatted())
                                    .foregroundStyle(Theme.tertiaryText)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .onDeleteCommand {
            if let selection = vault.selection { vault.requestDeletion(of: [selection]) }
        }
        .onKeyPress(.return) {
            // Return renames the selected item, as in Finder.
            guard vault.renamingURL == nil, let selection = vault.selection else { return .ignored }
            vault.renamingURL = selection.standardizedFileURL
            return .handled
        }
    }

    @ViewBuilder
    private func contextMenu(for node: FileNode) -> some View {
        if !node.isDirectory {
            Button("Open in New Tab") { vault.open(node.url, inNewTab: true) }
            Divider()
        }
        Button("Rename") { vault.renamingURL = node.url.standardizedFileURL }
        if !node.isDirectory {
            Button("Duplicate") { vault.duplicate(node.url) }
        }
        Divider()
        if node.isDirectory {
            Button("New Note in Folder") {
                vault.selection = node.url
                vault.createNote()
            }
            Button("New Folder Inside") { vault.createFolder(in: node.url) }
        }
        Button("Show in Finder") {
            NSWorkspace.shared.activateFileViewerSelecting([node.url])
        }
        Divider()
        Button("Move to Trash", role: .destructive) { vault.requestDeletion(of: [node.url]) }
    }
}

private struct FileRow: View {
    let node: FileNode
    let vault: Vault
    var isDropTarget = false
    @State private var draft = ""
    @FocusState private var fieldFocused: Bool

    private var isRenaming: Bool {
        vault.renamingURL == node.url.standardizedFileURL
    }

    var body: some View {
        Label {
            if isRenaming {
                TextField("Name", text: $draft)
                    .textFieldStyle(.plain)
                    .focused($fieldFocused)
                    .onSubmit(commit)
                    .onExitCommand { vault.renamingURL = nil }
                    .onAppear {
                        draft = node.name
                        fieldFocused = true
                    }
                    .onChange(of: fieldFocused) { _, focused in
                        // Clicking away saves, as in Finder.
                        if !focused { commit() }
                    }
            } else {
                HStack(spacing: 6) {
                    Text(node.name).lineLimit(1)
                    if node.isCloudOnly || vault.downloadingNotes.contains(node.url.standardizedFileURL) {
                        Spacer(minLength: 4)
                        Image(systemName: vault.downloadingNotes.contains(node.url.standardizedFileURL) ? "icloud.and.arrow.down.fill" : "icloud.and.arrow.down")
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.tertiaryText)
                            .help("Stored in iCloud — downloads when you open it")
                            .accessibilityLabel("In iCloud")
                    }
                }
            }
        } icon: {
            Image(systemName: node.isDirectory ? "folder" : "doc.text")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DropHighlight(isActive: isDropTarget).padding(.horizontal, -6).padding(.vertical, -2))
    }

    private func commit() {
        guard isRenaming else { return }
        vault.renamingURL = nil
        guard draft != node.name else { return }
        do {
            try vault.rename(node.url, to: draft)
        } catch {
            vault.errorMessage = "Couldn’t rename “\(node.name)”: \(error.localizedDescription)"
        }
    }
}

/// Outline drawn around the folder a dragged item would move into.
private struct DropHighlight: View {
    let isActive: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 5)
            .fill(Theme.accent.opacity(isActive ? 0.18 : 0))
            .strokeBorder(Theme.accent.opacity(isActive ? 0.7 : 0), lineWidth: 1.5)
            .animation(.easeOut(duration: 0.12), value: isActive)
    }
}

private struct VaultSwitcher: View {
    let vault: Vault
    let model: AppModel

    var body: some View {
        Menu {
            ForEach(model.recentVaults.filter { $0.standardizedFileURL != vault.rootURL }, id: \.self) { url in
                Button(url.lastPathComponent) { model.openVault(at: url) }
            }
            if model.recentVaults.count > 1 { Divider() }
            Button("Open Folder as Vault…", action: model.presentOpenPanel)
            Button("Create New Vault…", action: model.presentCreatePanel)
            Divider()
            Button("Show Vault in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([vault.rootURL])
            }
            Button("Close Vault", action: model.closeVault)
        } label: {
            HStack(spacing: 10) {
                HolocronMark()
                    .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(vault.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text(vault.displayPath)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.raised))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.strongBorder))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel("Vault: \(vault.name)")
    }
}
