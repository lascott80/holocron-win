import SwiftUI

/// Holocron ▸ Settings… (⌘,)
struct SettingsView: View {
    /// Remembers the last tab, like most Mac apps' settings.
    @AppStorage("settingsTab") private var tab = "general"

    var body: some View {
        TabView(selection: $tab) {
            Tab("General", systemImage: "gearshape", value: "general") { GeneralSettings() }
            Tab("Appearance", systemImage: "paintpalette", value: "appearance") { AppearanceSettings() }
            Tab("Editor", systemImage: "textformat", value: "editor") { EditorSettings() }
            Tab("Templates", systemImage: "doc.on.doc", value: "templates") { DailyNoteSettingsView() }
        }
        .frame(width: 520)
        .onAppear {
            // Tabs get renamed over time; fall back to General for unknown ones.
            if tab == "daily" { tab = "templates" }
            if !["general", "appearance", "editor", "templates"].contains(tab) { tab = "general" }
        }
    }
}

private struct GeneralSettings: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            Section {
                Toggle("Reopen the last vault when Holocron starts", isOn: $settings.reopenLastVault)
            }
            Section {
                Toggle("Update links when renaming or moving notes", isOn: $settings.updateLinksOnMove)
                Toggle("Name new notes from their first line", isOn: $settings.nameNotesFromFirstLine)
            } header: {
                Text("Files")
            }
            Section {
                Toggle("Merge outside changes automatically when they don’t overlap", isOn: $settings.autoMergeExternalChanges)
                Text("When another app or device changes a note you’re editing, Holocron combines both sets of changes if they touch different lines. Overlapping changes always ask first.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Sync")
            }
        }
        .formStyle(.grouped)
    }
}

private struct AppearanceSettings: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            Picker("Appearance", selection: $settings.appearance) {
                ForEach(AppSettings.Appearance.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)

            LabeledContent("Crystal") {
                HStack(spacing: 14) {
                    ForEach(AppSettings.Accent.allCases) { accent in
                        AccentSwatch(accent: accent, isSelected: settings.accent == accent) {
                            settings.accent = accent
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct AccentSwatch: View {
    let accent: AppSettings.Accent
    let isSelected: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let palette = Theme.accentPalette(accent)
        Button(action: action) {
            VStack(spacing: 6) {
                Circle()
                    .fill(Color(hex: colorScheme == .dark ? palette.dark : palette.light))
                    .frame(width: 22, height: 22)
                    .overlay(Circle().strokeBorder(.primary.opacity(isSelected ? 0.9 : 0), lineWidth: 2).padding(-4))
                Text(accent.title)
                    .font(.caption)
                    .foregroundStyle(isSelected ? .primary : .secondary)
            }
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accent.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct DailyNoteSettingsView: View {
    @Bindable private var settings = AppSettings.shared

    private var example: String {
        DailyNotes.path(for: .now, folder: settings.dailyNoteFolder, format: settings.dailyNoteFormat)
    }

    var body: some View {
        Form {
            Section {
                TextField("Templates folder", text: $settings.templatesFolder, prompt: Text("Templates"))
                Text("Notes in this folder are offered by Insert Template… (⌥⌘T) and New Note from Template… (⇧⌘N). They can use {{title}}, {{date}}, {{date:dddd, MMMM D}}, {{time}} and {{cursor}} — where the cursor goes. A template’s properties are merged into the note’s.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Templates")
            }
            Section {
                TextField("Folder", text: $settings.dailyNoteFolder, prompt: Text("Vault root"))
                TextField("Date format", text: $settings.dailyNoteFormat, prompt: Text("YYYY-MM-DD"))
                LabeledContent("Today’s note") {
                    Text(example).foregroundStyle(.secondary).textSelection(.enabled)
                }
                Text("Uses Obsidian’s date format: YYYY year, MM month, DD day, dddd weekday. A “/” makes subfolders, e.g. YYYY/MM/YYYY-MM-DD.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Daily notes")
            }
            Section {
                TextField("Daily note template", text: $settings.dailyNoteTemplate, prompt: Text("None"))
                Text("A note to copy into each new daily note, e.g. Templates/Daily. It can use {{date}}, {{date:dddd, MMMM D}}, {{time}}, {{title}}, {{yesterday}} and {{tomorrow}}.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Open today’s note when Holocron starts", isOn: $settings.openDailyNoteOnLaunch)
            }
        }
        .formStyle(.grouped)
    }
}

private struct EditorSettings: View {
    @Bindable private var settings = AppSettings.shared

    var body: some View {
        Form {
            Toggle("Show the formatting bar above notes", isOn: $settings.showFormattingBar)
            Picker("Font", selection: $settings.editorFont) {
                ForEach(AppSettings.EditorFont.allCases) { Text($0.title).tag($0) }
            }
            LabeledContent("Text size") {
                HStack {
                    Slider(value: $settings.editorFontSize, in: AppSettings.fontSizeRange, step: 1)
                    Text("\(Int(settings.editorFontSize)) pt")
                        .monospacedDigit()
                        .frame(width: 44, alignment: .trailing)
                }
            }
            LabeledContent("Line width") {
                HStack {
                    Slider(value: $settings.editorLineWidth, in: AppSettings.lineWidthRange, step: 20)
                    Text("\(Int(settings.editorLineWidth)) pt")
                        .monospacedDigit()
                        .frame(width: 56, alignment: .trailing)
                }
            }
            Section {
                TextField("Attachment folder", text: $settings.attachmentFolder, prompt: Text("Vault root"))
                Text("Pasted images and files dropped in from outside the vault are saved here, relative to the vault. Leave it empty to use the vault root.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}
