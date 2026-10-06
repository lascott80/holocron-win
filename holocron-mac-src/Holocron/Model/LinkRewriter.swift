import Foundation

/// Rewrites link targets inside markdown text, leaving everything else
/// byte-for-byte alone. Used to keep links working when notes are renamed
/// or moved. Links inside code blocks and inline code are never touched.
nonisolated enum LinkRewriter {
    /// A link as written: its path part (no #heading / ^block / |alias) and kind.
    struct Target: Equatable {
        let path: String
        let kind: NoteInfo.Link.Kind
    }

    // [[target#heading|alias]] and ![[embed]]: group 2 is the path part.
    nonisolated(unsafe) private static let wiki = try! NSRegularExpression(
        pattern: #"(!?\[\[)([^\[\]\n|#^]*)((?:[#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\])"#
    )
    // [text](path#fragment "title") or [text](<path with spaces>): the
    // destination is group 2 (angle-bracket form) or group 3.
    nonisolated(unsafe) private static let markdown = try! NSRegularExpression(
        pattern: #"(\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"]*")?\))"#
    )

    /// Returns `text` with each link's path replaced by `transform(target)`
    /// (or left alone when it returns nil). For markdown links the path is
    /// percent-decoded before `transform` sees it, and re-encoded the same
    /// way the original was when written back.
    static func rewrite(_ text: String, _ transform: (Target) -> String?) -> String {
        var output: [Substring] = []
        var changed = false
        var fence: Substring?
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.drop { $0 == " " || $0 == "\t" }
            if let open = fence {
                if trimmed.hasPrefix(open) { fence = nil }
                output.append(line)
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                fence = trimmed.prefix(3)
                output.append(line)
                continue
            }
            let rewritten = rewriteLine(String(line), transform)
            if rewritten != String(line) { changed = true }
            output.append(Substring(rewritten))
        }
        return changed ? output.joined(separator: "\n") : text
    }

    private static func rewriteLine(_ line: String, _ transform: (Target) -> String?) -> String {
        guard line.contains("[") else { return line }
        let string = line as NSString
        let codeSpans = inlineCodeRanges(in: line)
        var replacements: [(NSRange, String)] = []

        let whole = NSRange(location: 0, length: string.length)
        for match in wiki.matches(in: line, range: whole) {
            let pathRange = match.range(at: 2)
            guard !codeSpans.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) else { continue }
            let path = string.substring(with: pathRange)
            guard !path.trimmingCharacters(in: .whitespaces).isEmpty,
                  let replacement = transform(Target(path: path.trimmingCharacters(in: .whitespaces), kind: .wiki)),
                  replacement != path else { continue }
            replacements.append((pathRange, replacement))
        }
        for match in markdown.matches(in: line, range: whole) {
            guard !codeSpans.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) else { continue }
            let isAngled = match.range(at: 2).location != NSNotFound
            let destinationRange = match.range(at: isAngled ? 2 : 3)
            let destination = string.substring(with: destinationRange)
            guard !destination.contains(":") else { continue } // http:, mailto: …
            let hashIndex = destination.firstIndex(of: "#")
            let encodedPath = hashIndex.map { String(destination[..<$0]) } ?? destination
            let fragment = hashIndex.map { String(destination[$0...]) } ?? ""
            let path = encodedPath.removingPercentEncoding ?? encodedPath
            guard !path.isEmpty, let replacement = transform(Target(path: path, kind: .markdown)) else { continue }
            // <angle brackets> allow raw spaces; otherwise match the original's escaping.
            let wasEncoded = !isAngled && (encodedPath != path || !path.contains(" "))
            let written = wasEncoded
                ? (replacement.addingPercentEncoding(withAllowedCharacters: .markdownPath) ?? replacement)
                : replacement
            guard written != encodedPath else { continue }
            replacements.append((destinationRange, written + fragment))
        }
        guard !replacements.isEmpty else { return line }

        let result = NSMutableString(string: line)
        for (range, replacement) in replacements.sorted(by: { $0.0.location > $1.0.location }) {
            result.replaceCharacters(in: range, with: replacement)
        }
        return result as String
    }

    private static func inlineCodeRanges(in line: String) -> [NSRange] {
        guard line.contains("`") else { return [] }
        var ranges: [NSRange] = []
        var start: Int?
        for (offset, unit) in line.utf16.enumerated() where unit == 0x60 { // `
            if let open = start {
                ranges.append(NSRange(location: open, length: offset - open + 1))
                start = nil
            } else {
                start = offset
            }
        }
        return ranges
    }

    /// The path from a note in `fromFolder` to `target` (both vault-relative),
    /// e.g. from "Lore/Crystals" to "Orders/Saber.md" → "../../Orders/Saber.md".
    static func relativePath(from fromFolder: String, to target: String) -> String {
        let from = fromFolder.split(separator: "/")
        let to = target.split(separator: "/")
        var common = 0
        while common < from.count, common < to.count - 1, from[common] == to[common] { common += 1 }
        let ups = Array(repeating: "..", count: from.count - common)
        return (ups + to[common...].map(String.init)).joined(separator: "/")
    }
}

private extension CharacterSet {
    /// Path characters that can stay unescaped in a markdown link.
    nonisolated(unsafe) static let markdownPath: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove(charactersIn: "()[]<> ")
        return set
    }()
}
