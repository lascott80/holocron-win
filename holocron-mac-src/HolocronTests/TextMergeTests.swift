import Testing
@testable import Holocron

@Suite struct TextMergeTests {
    @Test func splitsLinesKeepingEndings() {
        #expect(TextMerge.lines("a\nb\n") == ["a\n", "b\n"])
        #expect(TextMerge.lines("a\nb") == ["a\n", "b"])
        #expect(TextMerge.lines("") == [])
        #expect(TextMerge.lines("a\r\nb").joined() == "a\r\nb")
    }

    @Test func diffFindsChangedRegions() {
        let base = TextMerge.lines("one\ntwo\nthree\nfour\n")
        let other = TextMerge.lines("one\n2\nthree\nfour\nfive\n")
        #expect(TextMerge.diff(base, other) == [
            .init(baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 2),
            .init(baseStart: 4, baseEnd: 4, otherStart: 4, otherEnd: 5),
        ])
        #expect(TextMerge.diff(base, base).isEmpty)
    }

    @Test func mergesEditsToDifferentLines() {
        let base = "# Kyber\n\nIntro line.\n\n- [ ] Map caves\n- [ ] Log results\n"
        let mine = "# Kyber\n\nIntro line, expanded.\n\n- [ ] Map caves\n- [ ] Log results\n"
        let theirs = "# Kyber\n\nIntro line.\n\n- [x] Map caves\n- [ ] Log results\n"
        let result = TextMerge.merge(base: base, mine: mine, theirs: theirs)
        #expect(result.mergedText == "# Kyber\n\nIntro line, expanded.\n\n- [x] Map caves\n- [ ] Log results\n")
    }

    @Test func mergesInsertionsAtBothEnds() {
        let result = TextMerge.merge(base: "b\nc\n", mine: "a\nb\nc\n", theirs: "b\nc\nd\n")
        #expect(result.mergedText == "a\nb\nc\nd\n")
    }

    @Test func identicalEditsAreNotAConflict() {
        let result = TextMerge.merge(base: "a\nb\nc\n", mine: "a\nB\nc\nx\n", theirs: "a\nB\nc\ny\n")
        #expect(result.mergedText == nil) // x vs y at the end conflicts…
        #expect(result.conflicts.count == 1)
        #expect(result.conflicts.first?.mine == ["x\n"])

        let same = TextMerge.merge(base: "a\nb\nc\n", mine: "a\nB\nc\n", theirs: "a\nB\nc\nd\n")
        #expect(same.mergedText == "a\nB\nc\nd\n") // …but the shared B edit is fine
    }

    @Test func overlappingEditsConflict() {
        let result = TextMerge.merge(base: "a\nb\nc\n", mine: "a\nmine\nc\n", theirs: "a\ntheirs\nc\n")
        #expect(!result.isClean)
        #expect(result.conflicts == [.init(base: ["b\n"], mine: ["mine\n"], theirs: ["theirs\n"])])
    }

    @Test func oneSidedChangesTakeThatSide() {
        #expect(TextMerge.merge(base: "a\n", mine: "a\n", theirs: "b\n").mergedText == "b\n")
        #expect(TextMerge.merge(base: "a\n", mine: "b\n", theirs: "a\n").mergedText == "b\n")
        #expect(TextMerge.merge(base: "", mine: "new\n", theirs: "").mergedText == "new\n")
    }

    @Test func deletionsMergeWithEditsElsewhere() {
        let base = "1\n2\n3\n4\n5\n6\n"
        let mine = "1\n3\n4\n5\n6\n"        // deleted line 2
        let theirs = "1\n2\n3\n4\n5\nsix\n" // edited line 6
        #expect(TextMerge.merge(base: base, mine: mine, theirs: theirs).mergedText == "1\n3\n4\n5\nsix\n")
    }

    @Test func handlesLargerDocuments() {
        let base = (0..<2000).map { "line \($0)\n" }.joined()
        var mineLines = TextMerge.lines(base)
        mineLines[10] = "mine 10\n"
        var theirLines = TextMerge.lines(base)
        theirLines[1990] = "theirs 1990\n"
        theirLines.insert("inserted\n", at: 500)
        let result = TextMerge.merge(base: base, mine: mineLines.joined(), theirs: theirLines.joined())
        let merged = try! #require(result.mergedText)
        #expect(merged.contains("mine 10\n"))
        #expect(merged.contains("theirs 1990\n"))
        #expect(merged.contains("line 499\ninserted\nline 500\n"))
    }
}
