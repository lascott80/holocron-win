import Foundation

/// What Holocron knows about a note's content: its structure and connections.
nonisolated struct NoteInfo: Equatable, Sendable {
    struct Heading: Equatable, Sendable {
        var level: Int
        var text: String
        /// 1-based line number.
        var line: Int
    }

    struct Link: Equatable, Sendable {
        enum Kind: Equatable, Sendable {
            /// `[[Target]]` — resolved by name or vault path.
            case wiki
            /// `[text](relative/path.md)` — resolved relative to the note's folder.
            case markdown
        }

        var target: String
        var kind: Kind
        /// 1-based line number.
        var line: Int
        /// The line the link sits on, for showing in backlinks.
        var context: String
    }

    var headings: [Heading] = []
    var links: [Link] = []
    /// Tags without the leading "#", in first-seen order, no duplicates
    /// (compared case-insensitively). Includes frontmatter `tags:`.
    var tags: [String] = []
    /// Frontmatter `aliases:`.
    var aliases: [String] = []
    /// Every frontmatter field, in order. Lists keep their items; nested
    /// YAML is kept as text.
    var properties: [Property] = []

    struct Property: Equatable, Sendable {
        var key: String
        var values: [String]
    }
    /// Line count, words and characters for the Info panel.
    var wordCount = 0
}

/// Extracts headings, links, tags and aliases from markdown text. Content in
/// code blocks and inline code is ignored.
nonisolated enum NoteParser {
    static func parse(_ text: String) -> NoteInfo {
        var info = NoteInfo()
        var seenTags = Set<String>()
        func addTag(_ tag: String) {
            let trimmed = tag.trimmingCharacters(in: CharacterSet(charactersIn: "# ").union(.whitespaces))
            guard !trimmed.isEmpty, seenTags.insert(trimmed.lowercased()).inserted else { return }
            info.tags.append(trimmed)
        }

        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        var index = 0

        // Frontmatter
        if lines.first.map({ $0.trimmingCharacters(in: .whitespaces) }) == "---" {
            var end = 1
            while end < lines.count {
                let trimmed = lines[end].trimmingCharacters(in: .whitespaces)
                if trimmed == "---" || trimmed == "..." { break }
                end += 1
            }
            if end < lines.count {
                let yaml = lines[1..<end].map(String.init)
                for tag in frontmatterList("tags", in: yaml) + frontmatterList("tag", in: yaml) { addTag(tag) }
                info.aliases = frontmatterList("aliases", in: yaml) + frontmatterList("alias", in: yaml)
                info.properties = frontmatterProperties(yaml)
                index = end + 1
            }
        }

        var fence: Substring?
        while index < lines.count {
            let rawLine = lines[index]
            let lineNumber = index + 1
            index += 1
            let line = rawLine.hasSuffix("\r") ? rawLine.dropLast() : rawLine
            let trimmed = line.drop { $0 == " " || $0 == "\t" }

            // Fenced code blocks
            if let open = fence {
                if trimmed.hasPrefix(open) { fence = nil }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = trimmed.prefix(3)
                continue
            }

            info.wordCount += line.split { $0.isWhitespace }.count
            let content = String(removingInlineCode(from: line))

            if let heading = heading(in: content, line: lineNumber) {
                info.headings.append(heading)
            }

            let context = line.trimmingCharacters(in: .whitespaces)
            for match in content.matches(of: wikiLinkPattern) {
                let target = String(match.output.1).trimmingCharacters(in: .whitespaces)
                if !target.isEmpty || match.output.2 != nil {
                    info.links.append(.init(target: target + (match.output.2.map(String.init) ?? ""), kind: .wiki, line: lineNumber, context: context))
                }
            }
            for match in content.matches(of: markdownLinkPattern) where match.output.1.isEmpty {
                let destination = String(match.output.2 ?? match.output.3 ?? "")
                guard !destination.contains(":"),
                      let decoded = destination.removingPercentEncoding,
                      FileNode.isNote(URL(fileURLWithPath: decoded.components(separatedBy: "#")[0])) else { continue }
                info.links.append(.init(target: decoded, kind: .markdown, line: lineNumber, context: context))
            }
            for match in content.matches(of: tagPattern) {
                let tag = String(match.output.2)
                if tag.contains(where: { !$0.isNumber && $0 != "/" }) { addTag(tag) }
            }
        }
        return info
    }

    // MARK: - Pieces

    // Regex values are immutable once built; sharing them is safe.
    nonisolated(unsafe) private static let wikiLinkPattern = /!?\[\[([^\[\]\n|#^]*)([#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/
    /// Group 1 is "!" for images, which aren't links; the destination is
    /// group 2 for the <angle bracket> form (spaces allowed), else group 3.
    nonisolated(unsafe) private static let markdownLinkPattern = /(!?)\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/
    /// Group 1 is the start of line or the whitespace before the tag.
    nonisolated(unsafe) private static let tagPattern = /(^|\s)#([\p{L}\p{N}_\-\/]+)/

    private static func heading(in line: String, line number: Int) -> NoteInfo.Heading? {
        guard line.hasPrefix("#") else { return nil }
        let level = line.prefix { $0 == "#" }.count
        guard level <= 6 else { return nil }
        let rest = line.dropFirst(level)
        guard rest.isEmpty || rest.first == " " || rest.first == "\t" else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // Optional closing #s
        while text.hasSuffix("#") { text.removeLast() }
        text = text.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return .init(level: level, text: plainText(text), line: number)
    }

    /// Strips the markdown most likely to appear in a heading so it reads
    /// cleanly in the outline: [[a|b]] → b, [a](x) → a, **b** → b.
    static func plainText(_ markdown: String) -> String {
        var text = markdown
        text = text.replacing(/\[\[([^\]|]*)\|([^\]]*)\]\]/) { String($0.output.2) }
        text = text.replacing(/\[\[([^\]]*)\]\]/) { String($0.output.1) }
        text = text.replacing(/\[([^\]]*)\]\([^)]*\)/) { String($0.output.1) }
        text = text.replacing(/(\*\*|__|~~|==|\*|_|`)/, with: "")
        return text
    }

    /// Replaces `code spans` with spaces so their content isn't parsed.
    private static func removingInlineCode(from line: Substring) -> Substring {
        guard line.contains("`") else { return line }
        var result = ""
        var inCode = false
        for character in line {
            if character == "`" {
                inCode.toggle()
                result.append(" ")
            } else {
                result.append(inCode ? " " : character)
            }
        }
        return Substring(result)
    }

    /// Every top-level `key: value` in the frontmatter, matching what the
    /// editor's properties panel shows.
    static func frontmatterProperties(_ yaml: [String]) -> [NoteInfo.Property] {
        func clean(_ item: some StringProtocol) -> String {
            item.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        var properties: [NoteInfo.Property] = []
        var index = 0
        while index < yaml.count {
            let line = yaml[index]
            index += 1
            guard let first = line.first, !first.isWhitespace, first != "#",
                  let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            let raw = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            var values: [String] = []
            if raw.isEmpty {
                var nested: [String] = []
                while index < yaml.count, yaml[index].first?.isWhitespace == true || yaml[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    let next = yaml[index].trimmingCharacters(in: .whitespaces)
                    index += 1
                    if next.hasPrefix("- ") { values.append(clean(next.dropFirst(2))) } else if !next.isEmpty { nested.append(next) }
                }
                if values.isEmpty, !nested.isEmpty { values = [nested.joined(separator: ", ")] }
            } else if raw.hasPrefix("["), raw.hasSuffix("]") {
                values = raw.dropFirst().dropLast().split(separator: ",").map(clean).filter { !$0.isEmpty }
            } else {
                values = [clean(raw)]
            }
            properties.append(.init(key: key, values: values))
        }
        return properties
    }

    /// Reads `key: [a, b]`, `key: a, b`, `key: a` or a `- a` block list.
    private static func frontmatterList(_ key: String, in yaml: [String]) -> [String] {
        guard let start = yaml.firstIndex(where: { $0.lowercased().hasPrefix(key + ":") }) else { return [] }
        let value = yaml[start].dropFirst(key.count + 1).trimmingCharacters(in: .whitespaces)
        func clean(_ item: some StringProtocol) -> String {
            item.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        if !value.isEmpty {
            let inner = value.hasPrefix("[") && value.hasSuffix("]") ? String(value.dropFirst().dropLast()) : value
            return inner.split(separator: ",").map(clean).filter { !$0.isEmpty }
        }
        var items: [String] = []
        for line in yaml[(start + 1)...] {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("- ") else { break }
            items.append(clean(trimmed.dropFirst(2)))
        }
        return items.filter { !$0.isEmpty }
    }
}

/// Resolves link targets to notes, the same way for the editor, backlinks
/// and quick open. Works on vault-relative paths ("Lore/Ilum.md").
nonisolated struct LinkResolver: Sendable {
    private let paths: Set<String>
    private let lowercasedPaths: [String: String]
    /// Lowercased note name → paths with that name, nearest the root first.
    private let byName: [String: [String]]

    init(paths: some Sequence<String>) {
        let all = Array(paths)
        self.paths = Set(all)
        var lowered: [String: String] = [:]
        var names: [String: [String]] = [:]
        for path in all {
            lowered[path.lowercased()] = path
            let name = ((path as NSString).lastPathComponent as NSString).deletingPathExtension.lowercased()
            names[name, default: []].append(path)
        }
        for key in names.keys {
            names[key]!.sort {
                let depth0 = $0.split(separator: "/").count, depth1 = $1.split(separator: "/").count
                return depth0 != depth1 ? depth0 < depth1 : $0 < $1
            }
        }
        self.lowercasedPaths = lowered
        self.byName = names
    }

    /// The path part of a link target: drops "#Heading", "^block" and
    /// surrounding whitespace.
    static func linkPath(_ target: String) -> String {
        var path = Substring(target)
        if let cut = path.firstIndex(where: { $0 == "#" || $0 == "^" }) {
            path = path[..<cut]
        }
        return path.trimmingCharacters(in: .whitespaces)
    }

    /// Resolves a `[[wikilink]]` target. Returns nil for links to a heading
    /// in the same note ("#Heading") and for missing notes.
    func resolve(wikiTarget rawTarget: String) -> String? {
        let target = Self.linkPath(rawTarget)
        guard !target.isEmpty else { return nil }
        let lowered = target.lowercased()
        let withExtension = FileNode.isNote(URL(fileURLWithPath: lowered)) ? lowered : lowered + ".md"
        if lowered.contains("/") {
            let relative = withExtension.hasPrefix("/") ? String(withExtension.dropFirst()) : withExtension
            return lowercasedPaths[relative]
        }
        return byName[(withExtension as NSString).deletingPathExtension]?.first
    }

    /// Resolves a `[text](path.md)` link written in the note at `sourcePath`.
    func resolve(markdownTarget rawTarget: String, from sourcePath: String) -> String? {
        let target = Self.linkPath(rawTarget)
        guard !target.isEmpty else { return nil }
        var components = target.hasPrefix("/")
            ? []
            : sourcePath.split(separator: "/").dropLast().map(String.init)
        for part in target.split(separator: "/") {
            switch part {
            case ".": continue
            case "..": if !components.isEmpty { components.removeLast() }
            default: components.append(String(part))
            }
        }
        let joined = components.joined(separator: "/")
        return paths.contains(joined) ? joined : lowercasedPaths[joined.lowercased()]
    }

    func resolve(_ link: NoteInfo.Link, from sourcePath: String) -> String? {
        switch link.kind {
        case .wiki: resolve(wikiTarget: link.target)
        case .markdown: resolve(markdownTarget: link.target, from: sourcePath)
        }
    }
}
