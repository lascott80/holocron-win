import SwiftUI

/// The main window for an open vault: file tree on the left, note in the
/// middle, inspector (outline, links, info) on the right.
struct VaultView: View {
    let vault: Vault
    let model: AppModel
    @AppStorage("showInspector") private var showInspector = true
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView(vault: vault, model: model)
                .navigationSplitViewColumnWidth(min: 200, ideal: 260, max: 400)
        } detail: {
            VStack(spacing: 0) {
                if !vault.tabs.isEmpty, !vault.isFocusMode {
                    TabBarView(vault: vault)
                }
                if let document = vault.document {
                    EditorView(document: document, vault: vault)
                } else if let url = vault.activeTab?.url, vault.downloadingNotes.contains(url) {
                    DownloadingNoteView(name: url.deletingPathExtension().lastPathComponent)
                } else {
                    EmptyEditorView(vault: vault, model: model)
                }
            }
            .overlay(alignment: .bottom) {
                if let toast = vault.toast {
                    ToastView(vault: vault, toast: toast)
                        .padding(.bottom, 44)
                        .padding(.horizontal, 16)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.3), value: vault.toast)
        }
        .onChange(of: vault.index.revision, initial: true) {
            vault.editor.setVaultData { [weak vault] in vault?.completionData() ?? [:] }
        }
        .onChange(of: vault.isFocusMode) { _, focusing in
            withAnimation(.easeInOut(duration: 0.2)) { columns = focusing ? .detailOnly : .all }
        }
        .toolbar(vault.isFocusMode ? .hidden : .automatic, for: .windowToolbar)
        .inspector(isPresented: Binding(
            get: { showInspector && !vault.isFocusMode },
            set: { if !vault.isFocusMode { showInspector = $0 } }
        )) {
            InspectorView(vault: vault)
                .inspectorColumnWidth(min: 240, ideal: 290, max: 420)
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button {
                    vault.goBack()
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .disabled(!vault.canGoBack)
                .help("Back (⌥⌘←)")
                Button {
                    vault.goForward()
                } label: {
                    Label("Forward", systemImage: "chevron.right")
                }
                .disabled(!vault.canGoForward)
                .help("Forward (⌥⌘→)")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    vault.openDailyNote()
                } label: {
                    Label("Today’s Note", systemImage: "calendar")
                }
                .help("Today’s Note (⇧⌘D)")
                Button {
                    vault.showQuickOpen()
                } label: {
                    Label("Quick Open", systemImage: "magnifyingglass")
                }
                .help("Quick Open (⌘O)")
                Button {
                    vault.createNote()
                } label: {
                    Label("New Note", systemImage: "square.and.pencil")
                }
                .help("New Note (⌘N)")
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }
                .help("Show or hide the inspector (⌥⌘I)")
            }
        }
        .overlay {
            if vault.quickOpenQuery != nil {
                QuickOpenView(vault: vault, commands: commands)
            } else if let mode = vault.templatePicker {
                TemplatePickerView(vault: vault, mode: mode)
            }
        }
        .alert(
            deletionTitle,
            isPresented: Binding(
                get: { vault.pendingDeletion != nil },
                set: { if !$0 { vault.pendingDeletion = nil } }
            )
        ) {
            Button("Move to Trash", role: .destructive) { vault.confirmDeletion() }
            Button("Cancel", role: .cancel) { vault.pendingDeletion = nil }
        } message: {
            Text("You can restore it from the Trash. Unsaved changes in it will be lost.")
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { vault.errorMessage != nil },
                set: { if !$0 { vault.errorMessage = nil } }
            ),
            presenting: vault.errorMessage
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
    }

    private var deletionTitle: String {
        guard let items = vault.pendingDeletion else { return "" }
        if items.count == 1, let item = items.first {
            let name = FileNode.isNote(item) ? item.deletingPathExtension().lastPathComponent : item.lastPathComponent
            return "Move “\(name)” to the Trash?"
        }
        return "Move \(items.count) items to the Trash?"
    }

    private var commands: [QuickCommand] {
        var commands = [
            QuickCommand(id: "new-note", title: "New Note", systemImage: "square.and.pencil", shortcut: "⌘N") {
                vault.createNote()
            },
            QuickCommand(id: "today", title: "Open Today’s Note", systemImage: "calendar", shortcut: "⇧⌘D") {
                vault.openDailyNote()
            },
            QuickCommand(id: "yesterday", title: "Previous Daily Note", systemImage: "chevron.left.circle", shortcut: "⌃⌘←") {
                vault.openAdjacentDailyNote(-1)
            },
            QuickCommand(id: "tomorrow", title: "Next Daily Note", systemImage: "chevron.right.circle", shortcut: "⌃⌘→") {
                vault.openAdjacentDailyNote(1)
            },
            QuickCommand(id: "new-from-template", title: "New Note from Template…", systemImage: "doc.badge.plus", shortcut: "⇧⌘N") {
                vault.templatePicker = .newNote
            },
            QuickCommand(id: "new-tab", title: "New Tab", systemImage: "plus.square.on.square", shortcut: "⌘T") {
                vault.newTab()
            },
            QuickCommand(id: "inspector", title: "Toggle Inspector", systemImage: "sidebar.right", shortcut: "⌥⌘I") {
                showInspector.toggle()
            },
            QuickCommand(id: "search", title: "Search Vault", systemImage: "magnifyingglass", shortcut: "⇧⌘F") {
                vault.showSearch()
            },
            QuickCommand(id: "find", title: "Find in Note", systemImage: "text.magnifyingglass", shortcut: "⌘F") {
                vault.editor.run("find")
            },
            QuickCommand(id: "open-vault", title: "Open Folder as Vault…", systemImage: "folder", shortcut: "⇧⌘O") {
                model.presentOpenPanel()
            },
            QuickCommand(id: "reveal-vault", title: "Show Vault in Finder", systemImage: "folder.badge.gearshape") {
                NSWorkspace.shared.activateFileViewerSelecting([vault.rootURL])
            },
            QuickCommand(id: "close-vault", title: "Close Vault", systemImage: "xmark.square", shortcut: "⇧⌘W") {
                model.closeVault()
            },
        ]
        if vault.document != nil {
            commands.insert(QuickCommand(id: "insert-template", title: "Insert Template…", systemImage: "doc.on.doc", shortcut: "⌥⌘T") {
                vault.templatePicker = .insert
            }, at: 2)
        }
        if let document = vault.document {
            commands.insert(QuickCommand(id: "reveal-note", title: "Show Note in Finder", systemImage: "doc.viewfinder") {
                NSWorkspace.shared.activateFileViewerSelecting([document.url])
            }, at: 3)
        }
        let settings = AppSettings.shared
        commands += AppSettings.Appearance.allCases.filter { $0 != settings.appearance }.map { appearance in
            QuickCommand(id: "appearance-\(appearance.rawValue)", title: "Appearance: \(appearance.title)", systemImage: "circle.lefthalf.filled") {
                settings.appearance = appearance
            }
        }
        commands += AppSettings.Accent.allCases.filter { $0 != settings.accent }.map { accent in
            QuickCommand(id: "accent-\(accent.rawValue)", title: "Accent Colour: \(accent.title)", systemImage: "paintpalette") {
                settings.accent = accent
            }
        }
        // Then everything in the menu bar that isn't already listed.
        let titles = Set(commands.map { $0.title.lowercased() })
        commands += MenuCommands.all().filter { !titles.contains($0.title.lowercased()) }
        return commands
    }
}
