import SwiftUI

@main
struct HolocronApp: App {
    @State private var model = AppModel()

    init() {
        _ = NSApplication.shared
        // Markdown needs literal characters: smart dashes turn the "---" of a
        // table's divider row into "—", and smart quotes break properties and
        // links. Off by default for the editor (WebKit reads these keys);
        // Edit › Substitutions can still turn them on.
        UserDefaults.standard.register(defaults: [
            "WebAutomaticDashSubstitutionEnabled": false,
            "WebAutomaticQuoteSubstitutionEnabled": false,
            "WebAutomaticTextReplacementEnabled": false,
            "WebAutomaticSpellingCorrectionEnabled": false,
        ])
        AppSettings.shared.applyAppearance()
        #if DEBUG
        DebugSnapshot.scheduleIfRequested()
        #endif
    }

    var body: some Scene {
        Window("Holocron", id: "main") {
            RootView(model: model)
                .tint(Theme.accent)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
                    model.saveAll()
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    model.saveAll()
                }
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            HolocronCommands(model: model)
        }

        Settings {
            SettingsView()
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @Bindable var model: AppModel
    #if DEBUG
    @Environment(\.openSettings) private var openSettings
    #endif

    var body: some View {
        Group {
            if let vault = model.vault {
                VaultView(vault: vault, model: model)
                    .id(vault.rootURL)
            } else {
                WelcomeView(model: model)
            }
        }
        #if DEBUG
        .onAppear {
            DebugSnapshot.simulateConflictIfRequested(in: model)
            DebugSnapshot.openQuickOpenIfRequested(in: model)
            DebugSnapshot.searchIfRequested(in: model)
            DebugSnapshot.previewSidebarIfRequested(in: model)
            DebugSnapshot.fileActionsIfRequested(in: model)
            DebugSnapshot.templatePickerIfRequested(in: model)
            DebugSnapshot.openSettingsIfRequested(openSettings)
        }
        #endif
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.errorMessage = nil } }
            ),
            presenting: model.errorMessage
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
    }
}

struct HolocronCommands: Commands {
    let model: AppModel
    @AppStorage("showInspector") private var showInspector = true

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Note") { model.vault?.createNote() }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(model.vault == nil)
            Button("New Note from Template…") { model.vault?.templatePicker = .newNote }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(model.vault == nil)
            Button("New Folder") { model.vault?.createFolder() }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(model.vault == nil)
            Button("New Tab") { model.vault?.newTab() }
                .keyboardShortcut("t", modifiers: .command)
                .disabled(model.vault == nil)
            Button("Quick Open…") { model.vault?.showQuickOpen() }
                .keyboardShortcut("o", modifiers: .command)
                .disabled(model.vault == nil)
            Button("Command Palette…") { model.vault?.showQuickOpen(query: "> ") }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(model.vault == nil)
            Divider()
            Button("Open Folder as Vault…", action: model.presentOpenPanel)
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Button("Create New Vault…", action: model.presentCreatePanel)
            Menu("Open Recent Vault") {
                ForEach(model.recentVaults, id: \.self) { url in
                    Button(url.lastPathComponent) { model.openVault(at: url) }
                }
            }
            .disabled(model.recentVaults.isEmpty)
        }
        CommandGroup(after: .sidebar) {
            Button(showInspector ? "Hide Inspector" : "Show Inspector") { showInspector.toggle() }
                .keyboardShortcut("i", modifiers: [.command, .option])
            Button(AppSettings.shared.showFormattingBar ? "Hide Formatting Bar" : "Show Formatting Bar") {
                AppSettings.shared.showFormattingBar.toggle()
            }
            Divider()
            Picker("View Mode", selection: Bindable(AppSettings.shared).editorMode) {
                ForEach(AppSettings.EditorMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.inline)
            Button(AppSettings.shared.editorMode == .reading ? "Back to Editing" : "Toggle Reading View") {
                AppSettings.shared.toggleReadingView()
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
            Button("Toggle Source Mode") { AppSettings.shared.toggleSourceMode() }
                .keyboardShortcut("e", modifiers: [.command, .option])
            Button(model.vault?.isFocusMode == true ? "Exit Focus Mode" : "Enter Focus Mode") {
                model.vault?.isFocusMode.toggle()
            }
            .keyboardShortcut("f", modifiers: [.command, .option])
            .disabled(model.vault?.document == nil && model.vault?.isFocusMode != true)
            Divider()
        }
        CommandGroup(replacing: .undoRedo) {
            Button("Undo") { model.undo() }
                .keyboardShortcut("z", modifiers: .command)
            Button("Redo") { model.redo() }
                .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find in Note…") { model.vault?.editor.run("find") }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(model.vault?.document == nil)
            Button("Search Vault…") { model.vault?.showSearch() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                .disabled(model.vault == nil)
        }
        CommandMenu("Go") {
            Button("Today’s Note") { model.vault?.openDailyNote() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(model.vault == nil)
            Button("Previous Daily Note") { model.vault?.openAdjacentDailyNote(-1) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .control])
                .disabled(model.vault == nil)
            Button("Next Daily Note") { model.vault?.openAdjacentDailyNote(1) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .control])
                .disabled(model.vault == nil)
            Divider()
            Button("Back") { model.vault?.goBack() }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
                .disabled(!(model.vault?.canGoBack ?? false))
            Button("Forward") { model.vault?.goForward() }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                .disabled(!(model.vault?.canGoForward ?? false))
            Divider()
            Button("Show Next Tab") { model.vault?.selectNextTab() }
                .keyboardShortcut(.tab, modifiers: .control)
            Button("Show Previous Tab") { model.vault?.selectPreviousTab() }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
            Divider()
            ForEach(1..<10) { number in
                Button(number == 9 ? "Last Tab" : "Tab \(number)") { model.vault?.selectTab(number: number) }
                    .keyboardShortcut(KeyEquivalent(Character("\(number)")), modifiers: .command)
            }
        }
        CommandMenu("Format") {
            Button("Insert Template…") { model.vault?.templatePicker = .insert }
                .keyboardShortcut("t", modifiers: [.command, .option])
                .disabled(!canFormat)
            Divider()
            editorCommand("Bold", "bold", key: "b")
            editorCommand("Italic", "italic", key: "i")
            editorCommand("Strikethrough", "strikethrough", key: "x", modifiers: [.command, .shift])
            editorCommand("Highlight", "highlight", key: "h", modifiers: [.command, .shift])
            editorCommand("Inline Code", "code", key: "e")
            Divider()
            editorCommand("Insert Link", "link", key: "k")
            editorCommand("Toggle Checklist Item", "task", key: "l")
            Button("Bulleted List") { model.vault?.editor.run("bulletList") }
                .disabled(!canFormat)
            Button("Numbered List") { model.vault?.editor.run("numberedList") }
                .disabled(!canFormat)
            Button("Quote") { model.vault?.editor.run("quote") }
                .disabled(!canFormat)
            Divider()
            Button("Code Block") { model.vault?.editor.run("codeBlock") }
                .disabled(!canFormat)
            Button("Callout") { model.vault?.editor.run("callout") }
                .disabled(!canFormat)
            Button("Divider") { model.vault?.editor.run("divider") }
                .disabled(!canFormat)
            Menu("Table") {
                Button("Insert Table") { model.vault?.editor.run("table") }
                Button("Convert Selection to Table") { model.vault?.editor.run("convertToTable") }
                Divider()
                tableCommand("Insert Row Above", "tableInsertRowAbove", .upArrow, shift: true)
                tableCommand("Insert Row Below", "tableInsertRowBelow", .downArrow, shift: true)
                tableCommand("Insert Column Left", "tableInsertColumnLeft", .leftArrow, shift: true)
                tableCommand("Insert Column Right", "tableInsertColumnRight", .rightArrow, shift: true)
                Divider()
                tableCommand("Move Row Up", "tableMoveRowUp", .upArrow)
                tableCommand("Move Row Down", "tableMoveRowDown", .downArrow)
                tableCommand("Move Column Left", "tableMoveColumnLeft", .leftArrow)
                tableCommand("Move Column Right", "tableMoveColumnRight", .rightArrow)
                Divider()
                tableCommand("Delete Row", "tableDeleteRow", .delete)
                tableCommand("Delete Column", "tableDeleteColumn", .delete, shift: true)
            }
            .disabled(!canFormat)
            Divider()
            editorCommand("Heading 1", "heading1", key: "1", modifiers: [.command, .option])
            editorCommand("Heading 2", "heading2", key: "2", modifiers: [.command, .option])
            editorCommand("Heading 3", "heading3", key: "3", modifiers: [.command, .option])
            editorCommand("Body Text", "heading0", key: "0", modifiers: [.command, .option])
        }
        CommandGroup(after: .help) {
            Button("Add Start Here Guide to Vault") { model.addStarterGuide() }
                .disabled(model.vault == nil)
        }
        CommandGroup(replacing: .saveItem) {
            Button("Save") { model.saveAll() }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(model.vault?.document == nil)
            Divider()
            Button("Close Tab") { model.vault.map { vault in vault.activeTabID.map(vault.closeTab) } }
                .keyboardShortcut("w", modifiers: .command)
                .disabled(model.vault?.activeTabID == nil)
            Button("Close Vault", action: model.closeVault)
                .keyboardShortcut("w", modifiers: [.command, .shift])
                .disabled(model.vault == nil)
        }
    }

    /// A Table menu item; the shortcuts are ⌃⌥ plus an arrow or ⌫ (with ⇧ to insert).
    private func tableCommand(_ title: String, _ command: String, _ key: KeyEquivalent, shift: Bool = false) -> some View {
        Button(title) { model.vault?.editor.run(command) }
            .keyboardShortcut(key, modifiers: shift ? [.control, .option, .shift] : [.control, .option])
    }

    /// Formatting needs an open note that isn't in reading view.
    private var canFormat: Bool {
        model.vault?.document != nil && AppSettings.shared.editorMode != .reading
    }

    /// A Format menu item. The editor's own keymap handles the shortcut while
    /// typing; the menu item makes it discoverable and clickable.
    private func editorCommand(
        _ title: String,
        _ command: String,
        key: KeyEquivalent,
        modifiers: EventModifiers = .command
    ) -> some View {
        Button(title) { model.vault?.editor.run(command) }
            .keyboardShortcut(key, modifiers: modifiers)
            .disabled(!canFormat)
    }
}
