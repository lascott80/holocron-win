import Foundation

/// Subsequence fuzzy matching: every query character must appear in order.
/// Matches at word starts and runs of consecutive characters score higher.
nonisolated enum FuzzyMatch {
    struct Result: Equatable, Sendable {
        var score: Int
        /// Character offsets in the candidate that matched, for highlighting.
        var indices: [Int]
    }

    static func match(_ query: String, in candidate: String) -> Result? {
        let needle = Array(query.lowercased().filter { !$0.isWhitespace })
        guard !needle.isEmpty else { return Result(score: 0, indices: []) }
        let original = Array(candidate)
        let haystack = original.map { Character($0.lowercased()) }
        let n = needle.count, m = haystack.count
        guard n <= m else { return nil }

        // Quick reject: not a subsequence at all.
        var probe = 0
        for character in haystack where probe < n && character == needle[probe] { probe += 1 }
        guard probe == n else { return nil }

        func bonus(_ j: Int) -> Int {
            if j == 0 { return 12 }
            let previous = original[j - 1], current = original[j]
            if previous == " " || previous == "-" || previous == "_" || previous == "/" || previous == "." { return 10 }
            if previous.isLowercase && current.isUppercase { return 8 }
            if !previous.isLetter && current.isLetter { return 6 }
            return 0
        }

        let impossible = Int.min / 4
        // best[i][j]: best score with needle[i] matched at haystack[j].
        var best = [[Int]](repeating: [Int](repeating: impossible, count: m), count: n)
        var from = [[Int]](repeating: [Int](repeating: -1, count: m), count: n)

        for j in 0..<m where haystack[j] == needle[0] {
            best[0][j] = 1 + bonus(j) - min(j, 8)
        }
        for i in 1..<n {
            var runningBest = impossible // max of best[i-1][k] for k < j-1
            var runningIndex = -1
            for j in i..<m {
                if j >= 2, best[i - 1][j - 2] > runningBest {
                    runningBest = best[i - 1][j - 2]
                    runningIndex = j - 2
                }
                guard haystack[j] == needle[i] else { continue }
                let consecutive = best[i - 1][j - 1] > impossible ? best[i - 1][j - 1] + 8 : impossible
                let gapped = runningBest > impossible ? runningBest - 2 : impossible
                if consecutive >= gapped, consecutive > impossible {
                    best[i][j] = consecutive + 1 + bonus(j)
                    from[i][j] = j - 1
                } else if gapped > impossible {
                    best[i][j] = gapped + 1 + bonus(j)
                    from[i][j] = runningIndex
                }
            }
        }

        guard let end = (0..<m).max(by: { best[n - 1][$0] < best[n - 1][$1] }),
              best[n - 1][end] > impossible else { return nil }
        var indices = [end]
        var j = end
        for i in stride(from: n - 1, to: 0, by: -1) {
            j = from[i][j]
            indices.append(j)
        }
        // Shorter candidates win ties.
        return Result(score: best[n - 1][end] * 4 - m, indices: indices.reversed())
    }
}

/// Ranks notes for the quick open palette.
nonisolated struct QuickOpenSearch {
    struct Note: Sendable {
        let path: String
        let aliases: [String]
        let tags: [String]
    }

    struct Hit: Equatable, Sendable {
        enum Field: Equatable, Sendable {
            case title
            case alias(String)
            case path
        }

        let path: String
        let field: Field
        let indices: [Int]
        let score: Int
    }

    let notes: [Note]
    /// Recently opened paths, most recent first; they rank higher.
    let recent: [String]

    /// - "kyb" fuzzy-matches titles, then aliases, then folder paths.
    /// - "#tag" lists notes with that tag (or a nested tag under it).
    /// - An empty query lists recent notes.
    func search(_ query: String, limit: Int = 50) -> [Hit] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            let known = Set(notes.map(\.path))
            return recent.filter(known.contains).prefix(limit).map { Hit(path: $0, field: .title, indices: [], score: 0) }
        }
        if trimmed.hasPrefix("#") {
            let tag = trimmed.dropFirst().lowercased()
            return notes
                .filter { note in note.tags.contains { $0.lowercased() == tag || $0.lowercased().hasPrefix(tag + "/") || (tag.isEmpty) } }
                .map { Hit(path: $0.path, field: .title, indices: [], score: recencyBonus($0.path)) }
                .sorted(by: Self.ranked)
                .prefix(limit).map { $0 }
        }

        var hits: [Hit] = []
        for note in notes {
            let title = VaultIndex.title(of: note.path)
            var candidates: [Hit] = []
            if let match = FuzzyMatch.match(trimmed, in: title) {
                candidates.append(Hit(path: note.path, field: .title, indices: match.indices, score: match.score + 40))
            }
            for alias in note.aliases {
                if let match = FuzzyMatch.match(trimmed, in: alias) {
                    candidates.append(Hit(path: note.path, field: .alias(alias), indices: match.indices, score: match.score + 20))
                }
            }
            let pathWithoutExtension = (note.path as NSString).deletingPathExtension
            if candidates.isEmpty, let match = FuzzyMatch.match(trimmed, in: pathWithoutExtension) {
                candidates.append(Hit(path: note.path, field: .path, indices: match.indices, score: match.score))
            }
            if let best = candidates.max(by: { $0.score < $1.score }) {
                hits.append(Hit(path: best.path, field: best.field, indices: best.indices, score: best.score + recencyBonus(note.path)))
            }
        }
        return Array(hits.sorted(by: Self.ranked).prefix(limit))
    }

    private func recencyBonus(_ path: String) -> Int {
        guard let position = recent.firstIndex(of: path) else { return 0 }
        return max(0, 20 - position * 2)
    }

    private static func ranked(_ a: Hit, _ b: Hit) -> Bool {
        if a.score != b.score { return a.score > b.score }
        return a.path.localizedStandardCompare(b.path) == .orderedAscending
    }
}
