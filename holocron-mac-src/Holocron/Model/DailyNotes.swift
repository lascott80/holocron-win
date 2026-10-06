import Foundation

/// Daily notes, Obsidian-compatible: one note per day at
/// `<folder>/<date in format>.md`, optionally created from a template.
/// Formats use Moment.js tokens (YYYY-MM-DD) like Obsidian; a "/" in the
/// format makes subfolders (YYYY/MM/YYYY-MM-DD).
nonisolated enum DailyNotes {
    /// Converts a Moment.js date format to a DateFormatter (ICU) pattern.
    /// Text in [brackets] is literal, as in Moment.
    static func icuPattern(fromMoment moment: String) -> String {
        let tokens: [(String, String)] = [
            ("YYYY", "yyyy"), ("YY", "yy"),
            ("MMMM", "MMMM"), ("MMM", "MMM"), ("MM", "MM"), ("M", "M"),
            ("DDDD", "DDD"), ("DD", "dd"), ("Do", "d"), ("D", "d"),
            ("dddd", "EEEE"), ("ddd", "EEE"),
            ("HH", "HH"), ("H", "H"), ("hh", "hh"), ("h", "h"),
            ("mm", "mm"), ("m", "m"), ("ss", "ss"), ("s", "s"),
            ("A", "a"), ("a", "a"),
            ("ww", "ww"), ("w", "w"), ("gggg", "YYYY"), ("Q", "Q"),
        ]
        var result = ""
        var literal = ""
        func flushLiteral() {
            guard !literal.isEmpty else { return }
            result += "'" + literal.replacingOccurrences(of: "'", with: "''") + "'"
            literal = ""
        }
        var rest = Substring(moment)
        while !rest.isEmpty {
            if rest.first == "[", let close = rest.firstIndex(of: "]") {
                literal += rest[rest.index(after: rest.startIndex)..<close]
                rest = rest[rest.index(after: close)...]
                continue
            }
            if let (token, icu) = tokens.first(where: { rest.hasPrefix($0.0) }) {
                flushLiteral()
                result += icu
                rest = rest.dropFirst(token.count)
                continue
            }
            let character = rest.removeFirst()
            if character.isLetter {
                literal.append(character)
            } else {
                flushLiteral()
                result.append(character == "'" ? "''" : String(character))
            }
        }
        flushLiteral()
        return result
    }

    static func formatter(moment: String) -> DateFormatter {
        let formatter = DateFormatter()
        // Stable file names regardless of the Mac's language settings.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = icuPattern(fromMoment: moment)
        return formatter
    }

    /// The vault-relative path of the daily note for `date`.
    static func path(for date: Date, folder: String, format: String) -> String {
        let name = formatter(moment: format.isEmpty ? "YYYY-MM-DD" : format).string(from: date)
        let folder = Attachments.normalize(folder)
        return (folder.isEmpty ? "" : folder + "/") + name + ".md"
    }

    /// The day a vault-relative path is the daily note for, if it is one.
    static func date(ofPath path: String, folder: String, format: String) -> Date? {
        let folder = Attachments.normalize(folder)
        var name = (path as NSString).deletingPathExtension
        if !folder.isEmpty {
            guard name.hasPrefix(folder + "/") else { return nil }
            name.removeFirst(folder.count + 1)
        }
        let formatter = formatter(moment: format.isEmpty ? "YYYY-MM-DD" : format)
        formatter.isLenient = false
        guard let date = formatter.date(from: name), formatter.string(from: date) == name else { return nil }
        return Calendar(identifier: .gregorian).startOfDay(for: date)
    }

    /// Fills in a template: {{title}}, {{date}}, {{date:FORMAT}}, {{time}},
    /// {{time:FORMAT}}, {{yesterday}} and {{tomorrow}} (the neighbouring
    /// days' note names, handy for [[links]]).
    static func render(template: String, date: Date, title: String, dateFormat: String) -> String {
        let calendar = Calendar(identifier: .gregorian)
        let dayFormat = dateFormat.isEmpty ? "YYYY-MM-DD" : dateFormat
        let noteName: (Date) -> String = { day in
            (formatter(moment: dayFormat).string(from: day) as NSString).lastPathComponent
        }
        let pattern = /\{\{\s*(title|date|time|yesterday|tomorrow)\s*(?::([^}]*))?\}\}/
        return template.replacing(pattern) { match in
            let format = match.output.2.map { String($0).trimmingCharacters(in: .whitespaces) }
            switch match.output.1 {
            case "title":
                return title
            case "date":
                return format.map { formatter(moment: $0).string(from: date) } ?? noteName(date)
            case "time":
                return formatter(moment: format ?? "HH:mm").string(from: date)
            case "yesterday":
                return noteName(calendar.date(byAdding: .day, value: -1, to: date)!)
            default:
                return noteName(calendar.date(byAdding: .day, value: 1, to: date)!)
            }
        }
    }
}
