import Foundation

/// Note templates: notes in the templates folder whose text is copied into
/// new or existing notes, with {{placeholders}} filled in.
nonisolated enum Templates {
    static let cursorMarker = "{{cursor}}"

    struct Rendered: Equatable {
        /// The template's frontmatter YAML (without --- lines), if any.
        var frontmatter: String?
        /// Everything after the frontmatter, placeholders filled in. May
        /// still contain {{cursor}}, which callers turn into the cursor.
        var body: String
    }

    /// Fills in placeholders and separates the frontmatter from the body.
    static func render(_ template: String, title: String, date: Date = .now, dateFormat: String) -> Rendered {
        let filled = DailyNotes.render(template: template, date: date, title: title, dateFormat: dateFormat)
        let lines = filled.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---",
              let close = lines.dropFirst().firstIndex(where: { ["---", "..."].contains($0.trimmingCharacters(in: .whitespaces)) }) else {
            return Rendered(frontmatter: nil, body: filled)
        }
        let yaml = lines[1..<close].joined(separator: "\n")
        var body = lines[(close + 1)...].joined(separator: "\n")
        if body.hasPrefix("\n") { body.removeFirst() }
        return Rendered(frontmatter: yaml.isEmpty ? nil : yaml, body: body)
    }

    /// A complete new note from a rendered template, and where the cursor
    /// should go (UTF-16 offset), taken from {{cursor}} or the end.
    static func noteText(from rendered: Rendered) -> (text: String, cursor: Int) {
        var text = ""
        if let frontmatter = rendered.frontmatter {
            text = "---\n" + frontmatter + "\n---\n"
        }
        let body = rendered.body
        if let marker = body.range(of: cursorMarker) {
            let cursor = (text + body[..<marker.lowerBound]).utf16.count
            return (text + body.replacingOccurrences(of: cursorMarker, with: ""), cursor)
        }
        text += body
        return (text, text.utf16.count)
    }
}
