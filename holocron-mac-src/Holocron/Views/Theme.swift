import SwiftUI

/// Holocron's colours. Every colour has a dark and a light value and follows
/// the window's appearance; accent colours follow the user's chosen crystal.
/// The editor (web view) gets the same values via `Theme.cssVariables`.
enum Theme {
    /// One appearance's colours as hex values.
    struct Palette {
        let editorBackground: UInt32
        let sidebarBackground: UInt32
        let panelBackground: UInt32
        let overlayBackground: UInt32
        let raised: UInt32
        let chip: UInt32
        let border: UInt32
        let strongBorder: UInt32
        let strongText: UInt32
        let text: UInt32
        let bodyText: UInt32
        let emphasizedSecondaryText: UInt32
        let secondaryText: UInt32
        let tertiaryText: UInt32
        let faintText: UInt32
        let codeBackground: UInt32
        let synced: UInt32
        let warning: UInt32

        static let dark = Palette(
            editorBackground: 0x0F1115, sidebarBackground: 0x15181E, panelBackground: 0x13161B,
            overlayBackground: 0x1A1D23, raised: 0x181B21, chip: 0x1E222A,
            border: 0x23272F, strongBorder: 0x343A45,
            strongText: 0xF2F4F7, text: 0xE6E8EC, bodyText: 0xD8DBE0, emphasizedSecondaryText: 0xC9CDD4,
            secondaryText: 0x9AA1AD, tertiaryText: 0x8A919D, faintText: 0x6B7280,
            codeBackground: 0x161A20, synced: 0x3DD68C, warning: 0xE8C15A
        )

        static let light = Palette(
            editorBackground: 0xFFFFFF, sidebarBackground: 0xF4F5F7, panelBackground: 0xF7F8FA,
            overlayBackground: 0xFFFFFF, raised: 0xFFFFFF, chip: 0xEBEDF0,
            border: 0xE3E5E9, strongBorder: 0xCDD1D7,
            strongText: 0x111318, text: 0x1C1F24, bodyText: 0x2A2E35, emphasizedSecondaryText: 0x3A3F47,
            secondaryText: 0x5F6672, tertiaryText: 0x6B7280, faintText: 0x9AA1AD,
            codeBackground: 0xF4F5F7, synced: 0x1F9D5C, warning: 0x9A6B00
        )
    }

    /// An accent's colours in each appearance.
    struct AccentPalette {
        /// Glyphs, links, cursor.
        let dark: UInt32, light: UInt32
        /// Accent-tinted text (tags, current outline item).
        let darkText: UInt32, lightText: UInt32
        /// Filled buttons and selected rows under white text (≥ 4.5:1).
        let fill: UInt32
    }

    static func accentPalette(_ accent: AppSettings.Accent) -> AccentPalette {
        switch accent {
        case .kyber: AccentPalette(dark: 0x5AB4FF, light: 0x1F6FBF, darkText: 0x9CCFFF, lightText: 0x1A5FA6, fill: 0x2A72BD)
        case .sith: AccentPalette(dark: 0xFF6B70, light: 0xC42F35, darkText: 0xFFA3A6, lightText: 0xA8262B, fill: 0xC03A40)
        case .jedi: AccentPalette(dark: 0x7CD992, light: 0x2A7A3B, darkText: 0xA8E8B6, lightText: 0x236A32, fill: 0x2E7D40)
        case .gold: AccentPalette(dark: 0xE8C15A, light: 0x8F6B00, darkText: 0xF1D58C, lightText: 0x7A5B00, fill: 0x86650F)
        }
    }

    // MARK: Surfaces & text

    static let editorBackground = dynamic(\.editorBackground)
    static let sidebarBackground = dynamic(\.sidebarBackground)
    static let panelBackground = dynamic(\.panelBackground)
    static let overlayBackground = dynamic(\.overlayBackground)
    static let raised = dynamic(\.raised)
    static let chip = dynamic(\.chip)
    static let border = dynamic(\.border)
    static let strongBorder = dynamic(\.strongBorder)
    static let text = dynamic(\.text)
    static let bodyText = dynamic(\.bodyText)
    static let emphasizedSecondaryText = dynamic(\.emphasizedSecondaryText)
    static let secondaryText = dynamic(\.secondaryText)
    static let tertiaryText = dynamic(\.tertiaryText)
    static let synced = dynamic(\.synced)
    static let warning = dynamic(\.warning)

    // MARK: Accent (reads settings, so views update when it changes)

    static var accent: Color {
        let palette = accentPalette(AppSettings.shared.accent)
        return Color(nsColor: NSColor(light: palette.light, dark: palette.dark))
    }

    static var accentText: Color {
        let palette = accentPalette(AppSettings.shared.accent)
        return Color(nsColor: NSColor(light: palette.lightText, dark: palette.darkText))
    }

    static var primaryButton: Color {
        Color(hex: accentPalette(AppSettings.shared.accent).fill)
    }

    /// Secondary text on a filled accent row or button.
    static let onPrimarySecondary = Color.white.opacity(0.85)

    enum AppKit {
        static let editorBackground = NSColor(light: Palette.light.editorBackground, dark: Palette.dark.editorBackground)
    }

    // MARK: Editor

    /// CSS custom properties for the editor web view in the given appearance.
    static func cssVariables(isDark: Bool, settings: AppSettings) -> [String: String] {
        let p = isDark ? Palette.dark : Palette.light
        let a = accentPalette(settings.accent)
        let accent = isDark ? a.dark : a.light
        return [
            "--hc-bg": css(p.editorBackground),
            "--hc-text": css(p.bodyText),
            "--hc-strong": css(p.strongText),
            "--hc-muted": css(p.tertiaryText),
            "--hc-faint": css(p.faintText),
            "--hc-quote": css(p.emphasizedSecondaryText),
            "--hc-border": css(p.border),
            "--hc-strong-border": css(p.strongBorder),
            "--hc-raised": css(p.codeBackground),
            "--hc-chip": css(p.chip),
            "--hc-panel": css(p.overlayBackground),
            "--hc-accent": css(accent),
            "--hc-accent-rgb": rgb(accent),
            "--hc-accent-text": css(isDark ? a.darkText : a.lightText),
            "--hc-font": settings.editorFont.cssFamily,
            "--hc-font-size": "\(Int(settings.editorFontSize))px",
            "--hc-line-width": "\(Int(settings.editorLineWidth))px",
        ]
    }

    // MARK: Helpers

    private static func dynamic(_ value: KeyPath<Palette, UInt32>) -> Color {
        Color(nsColor: NSColor(light: Palette.light[keyPath: value], dark: Palette.dark[keyPath: value]))
    }

    private static func css(_ hex: UInt32) -> String {
        String(format: "#%06X", hex)
    }

    private static func rgb(_ hex: UInt32) -> String {
        "\((hex >> 16) & 0xFF), \((hex >> 8) & 0xFF), \(hex & 0xFF)"
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    /// A colour that switches with the appearance it's drawn in.
    convenience init(light: UInt32, dark: UInt32) {
        self.init(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light)
        }
    }
}
