import Foundation

/// Full-text search across a vault's notes. Pure functions over a snapshot
/// of the notes, so it can run off the main thread.
///
/// Query syntax (Obsidian-style):
/// - `kyber crystal` — notes containing every word, anywhere
/// - `"kyber crystal"` — the exact phrase
/// - `-ilum` — leave out notes containing the word
/// - `tag:lore`, `path:Lore/Crystals`, `file:log` — filters
/// With "regular expression" on, the whole query is one pattern.
nonisolated enum VaultSearch {
    struct Note: Sendable {
        let path: String
        let text: String
        let tags: [String]
    }

    struct Query: Equatable, Sendable {
        var terms: [String] = []
        var excluded: [String] = []
        var tags: [String] = []
        var paths: [String] = []
        var files: [String] = []
        var matchCase = false
        var regex: String?

        var isEmpty: Bool {
            terms.isEmpty && excluded.isEmpty && tags.isEmpty && paths.isEmpty && files.isEmpty && (regex ?? "").isEmpty
        }
    }

    struct LineMatch: Equatable, Sendable, Identifiable {
        var id: Int { line }
        /// 1-based line number.
        let line: Int
        let text: String
        /// Matches within `text`, as UTF-16 ranges (what NSString and the
        /// editor's JavaScript use).
        let ranges: [NSRange]
    }

    struct Hit: Equatable, Sendable, Identifiable {
        var id: String { path }
        let path: String
        let title: String
        /// Total matches in the note (lines may hold several).
        let matchCount: Int
        let lines: [LineMatch]
        let titleMatches: Bool
    }

    struct Outcome: Equatable, Sendable {
        var hits: [Hit] = []
        var totalMatches = 0
        /// More notes matched than are listed.
        var truncated = false
        var error: String?
    }

    // MARK: - Parsing

    static func parse(_ input: String, matchCase: Bool = false, useRegex: Bool = false) -> Query {
        var query = Query(matchCase: matchCase)
        if useRegex {
            query.regex = input.trimmingCharacters(in: .whitespaces)
            return query
        }
        for token in tokenize(input) {
            let (text, quoted) = token
            if quoted {
                if !text.isEmpty { query.terms.append(text) }
                continue
            }
            if text.hasPrefix("-"), text.count > 1 {
                query.excluded.append(String(text.dropFirst()))
            } else if let value = value(of: "tag:", in: text) {
                query.tags.append(value.hasPrefix("#") ? String(value.dropFirst()) : value)
            } else if let value = value(of: "path:", in: text) {
                query.paths.append(value)
            } else if let value = value(of: "file:", in: text) {
                query.files.append(value)
            } else {
                query.terms.append(text)
            }
        }
        return query
    }

    /// Splits on spaces, keeping "quoted phrases" (and `path:"a b"`) together.
    private static func tokenize(_ input: String) -> [(String, Bool)] {
        var tokens: [(String, Bool)] = []
        var current = ""
        var inQuotes = false
        var wasQuoted = false
        for character in input {
            if character == "\"" {
                inQuotes.toggle()
                wasQuoted = true
            } else if character.isWhitespace, !inQuotes {
                if !current.isEmpty || wasQuoted { tokens.append((current, wasQuoted && !current.contains(":"))) }
                current = ""
                wasQuoted = false
            } else {
                current.append(character)
            }
        }
        if !current.isEmpty || wasQuoted { tokens.append((current, wasQuoted && !current.contains(":"))) }
        return tokens
    }

    private static func value(of prefix: String, in token: String) -> String? {
        guard token.lowercased().hasPrefix(prefix), token.count > prefix.count else { return nil }
        return String(token.dropFirst(prefix.count))
    }

    // MARK: - Running

    static func run(_ query: Query, over notes: [Note], maxNotes: Int = 200, maxLinesPerNote: Int = 20) -> Outcome {
        guard !query.isEmpty else { return Outcome() }

        var regex: NSRegularExpression?
        if let pattern = query.regex, !pattern.isEmpty {
            do {
                regex = try NSRegularExpression(
                    pattern: pattern,
                    options: query.matchCase ? [.anchorsMatchLines] : [.caseInsensitive, .anchorsMatchLines]
                )
            } catch {
                return Outcome(error: "That isn’t a valid regular expression.")
            }
        }
        let options: NSString.CompareOptions = query.matchCase ? [] : [.caseInsensitive, .diacriticInsensitive]

        var outcome = Outcome()
        for note in notes {
            guard passesFilters(note, query) else { continue }
            let title = VaultIndex.title(of: note.path)
            let text = note.text as NSString

            if query.excluded.contains(where: { text.range(of: $0, options: options).location != NSNotFound }) {
                continue
            }
            let titleMatches: Bool
            if let regex {
                titleMatches = regex.firstMatch(in: title, range: NSRange(location: 0, length: (title as NSString).length)) != nil
                guard titleMatches || regex.firstMatch(in: note.text, range: NSRange(location: 0, length: text.length)) != nil else { continue }
            } else {
                // Every term must appear in the note's text or its name.
                let missing = query.terms.contains { term in
                    text.range(of: term, options: options).location == NSNotFound
                        && (title as NSString).range(of: term, options: options).location == NSNotFound
                }
                guard !missing else { continue }
                titleMatches = !query.terms.isEmpty && query.terms.allSatisfy {
                    (title as NSString).range(of: $0, options: options).location != NSNotFound
                }
            }

            var lines: [LineMatch] = []
            var matchCount = 0
            var lineNumber = 0
            note.text.enumerateLines { line, _ in
                lineNumber += 1
                let ranges = matches(in: line, terms: query.terms, regex: regex, options: options)
                guard !ranges.isEmpty else { return }
                matchCount += ranges.count
                if lines.count < maxLinesPerNote {
                    lines.append(LineMatch(line: lineNumber, text: line, ranges: ranges))
                }
            }
            // Filter-only queries (e.g. "tag:lore") list notes without lines.
            let hasTextQuery = regex != nil || !query.terms.isEmpty
            guard !hasTextQuery || matchCount > 0 || titleMatches else { continue }

            outcome.totalMatches += matchCount
            if outcome.hits.count < maxNotes {
                outcome.hits.append(Hit(path: note.path, title: title, matchCount: matchCount, lines: lines, titleMatches: titleMatches))
            } else {
                outcome.truncated = true
            }
        }
        outcome.hits.sort { a, b in
            if a.titleMatches != b.titleMatches { return a.titleMatches }
            if a.matchCount != b.matchCount { return a.matchCount > b.matchCount }
            return a.path.localizedStandardCompare(b.path) == .orderedAscending
        }
        return outcome
    }

    private static func passesFilters(_ note: Note, _ query: Query) -> Bool {
        let path = note.path.lowercased()
        let file = (note.path as NSString).lastPathComponent.lowercased()
        for filter in query.paths where !path.contains(filter.lowercased()) { return false }
        for filter in query.files where !file.contains(filter.lowercased()) { return false }
        for tag in query.tags {
            let wanted = tag.lowercased()
            guard note.tags.contains(where: { $0.lowercased() == wanted || $0.lowercased().hasPrefix(wanted + "/") }) else { return false }
        }
        return true
    }

    /// All non-overlapping matches of any term in `line`, in order.
    private static func matches(in line: String, terms: [String], regex: NSRegularExpression?, options: NSString.CompareOptions) -> [NSRange] {
        let string = line as NSString
        if let regex {
            return regex.matches(in: line, range: NSRange(location: 0, length: string.length))
                .map(\.range)
                .filter { $0.length > 0 }
        }
        var ranges: [NSRange] = []
        for term in terms where !term.isEmpty {
            var searchRange = NSRange(location: 0, length: string.length)
            while true {
                let found = string.range(of: term, options: options, range: searchRange)
                guard found.location != NSNotFound, found.length > 0 else { break }
                ranges.append(found)
                let next = found.location + found.length
                searchRange = NSRange(location: next, length: string.length - next)
            }
        }
        // Merge overlaps (e.g. "kyber" and "kyber crystal").
        let sorted = ranges.sorted { $0.location < $1.location }
        var merged: [NSRange] = []
        for range in sorted {
            if let last = merged.last, range.location <= last.location + last.length {
                merged[merged.count - 1] = NSUnionRange(last, range)
            } else {
                merged.append(range)
            }
        }
        return merged
    }
}
