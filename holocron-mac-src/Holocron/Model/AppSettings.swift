import AppKit
import Observation

/// User preferences, persisted in UserDefaults and shared app-wide.
@Observable
final class AppSettings {
    static let shared = AppSettings()

    enum Appearance: String, CaseIterable, Identifiable {
        case system, dark, light
        var id: Self { self }
        var title: String {
            switch self {
            case .system: "Match System"
            case .dark: "Dark"
            case .light: "Light"
            }
        }
    }

    /// The four crystal colours from the design canvas.
    enum Accent: String, CaseIterable, Identifiable {
        case kyber, sith, jedi, gold
        var id: Self { self }
        var title: String {
            switch self {
            case .kyber: "Kyber Blue"
            case .sith: "Sith Red"
            case .jedi: "Jedi Green"
            case .gold: "Temple Gold"
            }
        }
    }

    enum EditorFont: String, CaseIterable, Identifiable {
        case system, serif, mono
        var id: Self { self }
        var title: String {
            switch self {
            case .system: "System"
            case .serif: "Serif"
            case .mono: "Monospaced"
            }
        }
        /// CSS font stack for the editor.
        var cssFamily: String {
            switch self {
            case .system: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
            case .serif: "ui-serif, 'New York', Georgia, serif"
            case .mono: "ui-monospace, 'SF Mono', Menlo, monospace"
            }
        }
    }

    /// How notes are shown: rendered while you type, raw markdown, or read-only.
    enum EditorMode: String, CaseIterable, Identifiable {
        case livePreview, source, reading
        var id: Self { self }
        var title: String {
            switch self {
            case .livePreview: "Live Preview"
            case .source: "Source Mode"
            case .reading: "Reading View"
            }
        }
        /// The name the editor (Editor/src/main.js) uses.
        var editorName: String {
            switch self {
            case .livePreview: "live"
            case .source: "source"
            case .reading: "reading"
            }
        }
    }

    var appearance: Appearance { didSet { save(appearance.rawValue, Keys.appearance); applyAppearance() } }
    var accent: Accent { didSet { save(accent.rawValue, Keys.accent) } }
    var editorFont: EditorFont { didSet { save(editorFont.rawValue, Keys.editorFont) } }
    var editorFontSize: Double { didSet { save(editorFontSize, Keys.editorFontSize) } }
    /// Maximum width of the text column, in points.
    var editorLineWidth: Double { didSet { save(editorLineWidth, Keys.editorLineWidth) } }
    var reopenLastVault: Bool { didSet { save(reopenLastVault, Keys.reopenLastVault) } }
    /// Merge non-overlapping outside changes into open notes without asking.
    var autoMergeExternalChanges: Bool { didSet { save(autoMergeExternalChanges, Keys.autoMerge) } }
    /// Rewrite links in other notes when a note is renamed or moved.
    var updateLinksOnMove: Bool { didSet { save(updateLinksOnMove, Keys.updateLinks) } }
    /// Name "Untitled" notes from their first line as you type.
    var nameNotesFromFirstLine: Bool { didSet { save(nameNotesFromFirstLine, Keys.nameFromFirstLine) } }
    /// Show the formatting buttons above the editor.
    var showFormattingBar: Bool { didSet { save(showFormattingBar, Keys.formattingBar) } }
    /// Vault-relative folder whose notes are templates.
    var templatesFolder: String { didSet { save(templatesFolder, Keys.templatesFolder) } }
    /// Daily notes: folder, Moment-style date format, optional template note.
    var dailyNoteFolder: String { didSet { save(dailyNoteFolder, Keys.dailyFolder) } }
    var dailyNoteFormat: String { didSet { save(dailyNoteFormat, Keys.dailyFormat) } }
    var dailyNoteTemplate: String { didSet { save(dailyNoteTemplate, Keys.dailyTemplate) } }
    var openDailyNoteOnLaunch: Bool { didSet { save(openDailyNoteOnLaunch, Keys.dailyOnLaunch) } }
    /// Vault-relative folder for pasted and dropped files ("" = vault root).
    var attachmentFolder: String { didSet { save(attachmentFolder, Keys.attachmentFolder) } }
    var editorMode: EditorMode {
        didSet {
            save(editorMode.rawValue, Keys.editorMode)
            if editorMode != .reading { lastEditingMode = editorMode }
        }
    }
    /// The mode reading view toggles back to.
    @ObservationIgnored private(set) var lastEditingMode: EditorMode = .livePreview

    /// Switches reading view on, or back to the mode used before it.
    func toggleReadingView() {
        editorMode = editorMode == .reading ? lastEditingMode : .reading
    }

    /// Switches source mode on, or back to live preview.
    func toggleSourceMode() {
        editorMode = editorMode == .source ? .livePreview : .source
    }

    static let fontSizeRange: ClosedRange<Double> = 13...24
    static let lineWidthRange: ClosedRange<Double> = 560...1100

    @ObservationIgnored private let defaults: UserDefaults

    private enum Keys {
        static let appearance = "appearance"
        static let accent = "accent"
        static let editorFont = "editorFont"
        static let editorFontSize = "editorFontSize"
        static let editorLineWidth = "editorLineWidth"
        static let reopenLastVault = "reopenLastVault"
        static let autoMerge = "autoMergeExternalChanges"
        static let attachmentFolder = "attachmentFolder"
        static let updateLinks = "updateLinksOnMove"
        static let dailyFolder = "dailyNoteFolder"
        static let templatesFolder = "templatesFolder"
        static let formattingBar = "showFormattingBar"
        static let nameFromFirstLine = "nameNotesFromFirstLine"
        static let dailyFormat = "dailyNoteFormat"
        static let dailyTemplate = "dailyNoteTemplate"
        static let dailyOnLaunch = "openDailyNoteOnLaunch"
        static let editorMode = "editorMode"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.register(defaults: [
            Keys.appearance: Appearance.system.rawValue,
            Keys.accent: Accent.kyber.rawValue,
            Keys.editorFont: EditorFont.system.rawValue,
            Keys.editorFontSize: 16.0,
            Keys.editorLineWidth: 720.0,
            Keys.reopenLastVault: true,
            Keys.autoMerge: true,
            Keys.attachmentFolder: "Attachments",
            Keys.updateLinks: true,
            Keys.dailyFolder: "Daily",
            Keys.templatesFolder: "Templates",
            Keys.formattingBar: true,
            Keys.nameFromFirstLine: true,
            Keys.dailyFormat: "YYYY-MM-DD",
            Keys.dailyTemplate: "",
            Keys.dailyOnLaunch: false,
            Keys.editorMode: EditorMode.livePreview.rawValue,
        ])
        appearance = Appearance(rawValue: defaults.string(forKey: Keys.appearance) ?? "") ?? .system
        accent = Accent(rawValue: defaults.string(forKey: Keys.accent) ?? "") ?? .kyber
        editorFont = EditorFont(rawValue: defaults.string(forKey: Keys.editorFont) ?? "") ?? .system
        editorFontSize = defaults.double(forKey: Keys.editorFontSize).clamped(to: Self.fontSizeRange)
        editorLineWidth = defaults.double(forKey: Keys.editorLineWidth).clamped(to: Self.lineWidthRange)
        reopenLastVault = defaults.bool(forKey: Keys.reopenLastVault)
        autoMergeExternalChanges = defaults.bool(forKey: Keys.autoMerge)
        attachmentFolder = defaults.string(forKey: Keys.attachmentFolder) ?? "Attachments"
        updateLinksOnMove = defaults.bool(forKey: Keys.updateLinks)
        dailyNoteFolder = defaults.string(forKey: Keys.dailyFolder) ?? "Daily"
        templatesFolder = defaults.string(forKey: Keys.templatesFolder) ?? "Templates"
        showFormattingBar = defaults.bool(forKey: Keys.formattingBar)
        nameNotesFromFirstLine = defaults.bool(forKey: Keys.nameFromFirstLine)
        dailyNoteFormat = defaults.string(forKey: Keys.dailyFormat) ?? "YYYY-MM-DD"
        dailyNoteTemplate = defaults.string(forKey: Keys.dailyTemplate) ?? ""
        openDailyNoteOnLaunch = defaults.bool(forKey: Keys.dailyOnLaunch)
        editorMode = EditorMode(rawValue: defaults.string(forKey: Keys.editorMode) ?? "") ?? .livePreview
        if editorMode == .source { lastEditingMode = .source }
    }

    /// Sets the app-wide light/dark appearance.
    func applyAppearance() {
        switch appearance {
        case .system: NSApp?.appearance = nil
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        }
    }

    private func save(_ value: Any, _ key: String) {
        defaults.set(value, forKey: key)
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
