import Foundation

/// Line-based diff and three-way merge, used to combine edits made in
/// Holocron with changes that arrived on disk from another app or device.
nonisolated enum TextMerge {
    /// A region where `other` differs from `base`: base lines
    /// `baseStart..<baseEnd` became other lines `otherStart..<otherEnd`.
    struct Hunk: Equatable, Sendable {
        var baseStart: Int
        var baseEnd: Int
        var otherStart: Int
        var otherEnd: Int
    }

    struct Conflict: Equatable, Sendable {
        var base: [Substring]
        var mine: [Substring]
        var theirs: [Substring]
    }

    struct Result: Sendable {
        /// The merged text, or `nil` when both sides changed the same lines.
        var mergedText: String?
        var conflicts: [Conflict]

        var isClean: Bool { mergedText != nil }
    }

    /// Splits text into lines, each keeping its line ending, so joining the
    /// pieces gives back the exact original text.
    static func lines(_ text: String) -> [Substring] {
        var result: [Substring] = []
        var start = text.startIndex
        var index = start
        while index < text.endIndex {
            if text[index] == "\n" || text[index] == "\r\n" {
                let next = text.index(after: index)
                result.append(text[start..<next])
                start = next
            }
            index = text.index(after: index)
        }
        if start < text.endIndex { result.append(text[start...]) }
        return result
    }

    /// Three-way merge of `mine` and `theirs`, both edited from `base`.
    static func merge(base: String, mine: String, theirs: String) -> Result {
        if mine == theirs { return Result(mergedText: mine, conflicts: []) }
        if mine == base { return Result(mergedText: theirs, conflicts: []) }
        if theirs == base { return Result(mergedText: mine, conflicts: []) }

        let baseLines = lines(base)
        let mineLines = lines(mine)
        let theirLines = lines(theirs)
        let mineHunks = diff(baseLines, mineLines)
        let theirHunks = diff(baseLines, theirLines)

        // Group hunks from both sides whose base ranges overlap or touch.
        enum Side { case mine, theirs }
        let tagged = (mineHunks.map { ($0, Side.mine) } + theirHunks.map { ($0, Side.theirs) })
            .sorted { ($0.0.baseStart, $0.0.baseEnd) < ($1.0.baseStart, $1.0.baseEnd) }

        var groups: [[(Hunk, Side)]] = []
        var groupEnd = -1
        for item in tagged {
            if let last = groups.indices.last, item.0.baseStart <= groupEnd {
                groups[last].append(item)
                groupEnd = max(groupEnd, item.0.baseEnd)
            } else {
                groups.append([item])
                groupEnd = item.0.baseEnd
            }
        }

        var output: [Substring] = []
        var conflicts: [Conflict] = []
        var basePosition = 0
        var mineDelta = 0 // mine index − base index outside hunks seen so far
        var theirDelta = 0

        for group in groups {
            let low = group.map(\.0.baseStart).min()!
            let high = group.map(\.0.baseEnd).max()!
            output.append(contentsOf: baseLines[basePosition..<low])

            let mineInGroup = group.filter { $0.1 == .mine }.map(\.0)
            let theirsInGroup = group.filter { $0.1 == .theirs }.map(\.0)
            let mineGrowth = mineInGroup.reduce(0) { $0 + ($1.otherEnd - $1.otherStart) - ($1.baseEnd - $1.baseStart) }
            let theirGrowth = theirsInGroup.reduce(0) { $0 + ($1.otherEnd - $1.otherStart) - ($1.baseEnd - $1.baseStart) }

            let mineSlice = Array(mineLines[(low + mineDelta)..<(high + mineDelta + mineGrowth)])
            let theirSlice = Array(theirLines[(low + theirDelta)..<(high + theirDelta + theirGrowth)])

            if theirsInGroup.isEmpty {
                output.append(contentsOf: mineSlice)
            } else if mineInGroup.isEmpty || mineSlice == theirSlice {
                output.append(contentsOf: theirSlice)
            } else {
                conflicts.append(Conflict(base: Array(baseLines[low..<high]), mine: mineSlice, theirs: theirSlice))
                output.append(contentsOf: mineSlice)
            }

            mineDelta += mineGrowth
            theirDelta += theirGrowth
            basePosition = high
        }
        output.append(contentsOf: baseLines[basePosition...])

        return Result(mergedText: conflicts.isEmpty ? output.joined() : nil, conflicts: conflicts)
    }

    /// A text replacement in UTF-16 offsets (what JavaScript strings use).
    struct Edit: Equatable, Sendable {
        var from: Int
        var to: Int
        var insert: String
    }

    /// The line-level replacements that turn `old` into `new`, with offsets
    /// into `old`. Lets the editor apply only what changed, so the cursor and
    /// undo history elsewhere in the note are untouched.
    static func edits(from old: String, to new: String) -> [Edit] {
        let oldLines = lines(old)
        let newLines = lines(new)
        var offsets = [0]
        offsets.reserveCapacity(oldLines.count + 1)
        for line in oldLines { offsets.append(offsets[offsets.count - 1] + line.utf16.count) }
        return diff(oldLines, newLines).map { hunk in
            Edit(
                from: offsets[hunk.baseStart],
                to: offsets[hunk.baseEnd],
                insert: newLines[hunk.otherStart..<hunk.otherEnd].joined()
            )
        }
    }

    /// Myers diff: the regions where `other` differs from `base`.
    static func diff(_ base: [Substring], _ other: [Substring]) -> [Hunk] {
        // Common prefix and suffix are cheap to strip and keep the search small.
        var prefix = 0
        while prefix < base.count, prefix < other.count, base[prefix] == other[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < base.count - prefix, suffix < other.count - prefix,
              base[base.count - 1 - suffix] == other[other.count - 1 - suffix] { suffix += 1 }

        let a = base[prefix..<(base.count - suffix)]
        let b = other[prefix..<(other.count - suffix)]
        let matches = myersMatches(Array(a), Array(b)).map { ($0.0 + prefix, $0.1 + prefix) }

        var hunks: [Hunk] = []
        var i = prefix, j = prefix
        for (x, y) in matches + [(base.count - suffix, other.count - suffix)] {
            if x > i || y > j {
                hunks.append(Hunk(baseStart: i, baseEnd: x, otherStart: j, otherEnd: y))
            }
            i = x + 1
            j = y + 1
        }
        return hunks
    }

    /// Pairs of equal line indices on a shortest edit path, in order.
    private static func myersMatches(_ a: [Substring], _ b: [Substring]) -> [(Int, Int)] {
        let n = a.count, m = b.count
        if n == 0 || m == 0 { return [] }
        let maxD = n + m
        let offset = maxD + 1
        var v = [Int](repeating: 0, count: 2 * maxD + 3)
        var trace: [[Int]] = []

        var finalD = 0
        search: for d in 0...maxD {
            trace.append(v)
            for k in stride(from: -d, through: d, by: 2) {
                var x = (k == -d || (k != d && v[k - 1 + offset] < v[k + 1 + offset]))
                    ? v[k + 1 + offset]
                    : v[k - 1 + offset] + 1
                var y = x - k
                while x < n, y < m, a[x] == b[y] {
                    x += 1
                    y += 1
                }
                v[k + offset] = x
                if x >= n, y >= m {
                    finalD = d
                    break search
                }
            }
        }

        var matches: [(Int, Int)] = []
        var x = n, y = m
        for d in stride(from: finalD, through: 1, by: -1) {
            let previous = trace[d]
            let k = x - y
            let prevK = (k == -d || (k != d && previous[k - 1 + offset] < previous[k + 1 + offset])) ? k + 1 : k - 1
            let prevX = previous[prevK + offset]
            let prevY = prevX - prevK
            while x > prevX, y > prevY {
                x -= 1
                y -= 1
                matches.append((x, y))
            }
            x = prevX
            y = prevY
        }
        while x > 0, y > 0 {
            x -= 1
            y -= 1
            matches.append((x, y))
        }
        return matches.reversed()
    }
}
