import Foundation
import Observation

/// In-memory index of every note's headings, links, tags and aliases, kept
/// current as files change. Powers backlinks, mentions, tags and quick open.
/// It's rebuilt from the files each launch; nothing is stored on disk.
@Observable
final class VaultIndex {
    struct Backlink: Identifiable, Equatable {
        var id: String { source }
        /// Vault-relative path of the linking note.
        let source: String
        let title: String
        /// The lines containing the links.
        let contexts: [String]
    }

    struct Mention: Identifiable, Equatable {
        var id: String { source }
        let source: String
        let title: String
        let context: String
    }

    struct TagCount: Identifiable, Equatable {
        var id: String { tag.lowercased() }
        let tag: String
        let count: Int
    }

    /// Bumped on every change, so views can observe the index cheaply.
    private(set) var revision = 0
    private(set) var isBuilding = false
    /// Notes iCloud had offloaded, being downloaded so they can be indexed.
    private(set) var downloadingPaths: Set<String> = []

    @ObservationIgnored private(set) var notes: [String: NoteInfo] = [:]
    @ObservationIgnored private var texts: [String: String] = [:]
    @ObservationIgnored private(set) var resolver = LinkResolver(paths: [])
    /// The vault's note paths as of the last sync.
    @ObservationIgnored private var knownPaths: Set<String> = []
    @ObservationIgnored private let rootURL: URL

    init(rootURL: URL) {
        self.rootURL = rootURL
    }

    // MARK: - Updating

    /// Brings the index in line with the vault's notes: drops removed paths
    /// and reads new or changed ones (`reread`) in the background.
    func sync(paths: [String], reread: Set<String> = []) async {
        resolver = LinkResolver(paths: paths)
        let present = Set(paths)
        knownPaths = present
        for path in notes.keys where !present.contains(path) {
            notes[path] = nil
            texts[path] = nil
        }
        let toRead = paths.filter { notes[$0] == nil || reread.contains($0) }
        guard !toRead.isEmpty else {
            revision += 1
            return
        }
        isBuilding = true
        let root = rootURL
        let (parsed, offloaded) = await Task.detached(priority: .utility) {
            var offloaded: [String] = []
            let parsed = toRead.compactMap { path -> (String, String, NoteInfo)? in
                let url = root.appendingPathComponent(path)
                // Reading an offloaded note would stall here while it
                // downloads; fetch those separately instead.
                if CloudFiles.needsDownload(url) {
                    offloaded.append(path)
                    return nil
                }
                guard let data = try? CloudFiles.read(url) else { return nil }
                let text = String(decoding: data, as: UTF8.self)
                return (path, text, NoteParser.parse(text))
            }
            return (parsed, offloaded)
        }.value
        for (path, text, info) in parsed where present.contains(path) {
            notes[path] = info
            texts[path] = text
        }
        isBuilding = false
        revision += 1
        downloadAndIndex(offloaded)
    }

    /// Downloads offloaded notes in the background and indexes each as it
    /// arrives, so search and backlinks don't silently miss them.
    private func downloadAndIndex(_ paths: [String]) {
        let fresh = paths.filter { !downloadingPaths.contains($0) }
        guard !fresh.isEmpty else { return }
        downloadingPaths.formUnion(fresh)
        let root = rootURL
        Task { [weak self] in
            await withTaskGroup(of: (String, String?).self) { group in
                for path in fresh {
                    group.addTask {
                        let url = root.appendingPathComponent(path)
                        try? await CloudFiles.download(url)
                        let data = try? CloudFiles.read(url)
                        return (path, data.map { String(decoding: $0, as: UTF8.self) })
                    }
                }
                for await (path, text) in group {
                    guard let self else { continue }
                    self.downloadingPaths.remove(path)
                    // Skip notes deleted meanwhile, or already indexed from the editor.
                    guard let text, self.knownPaths.contains(path), self.texts[path] == nil else { continue }
                    self.update(path: path, text: text)
                }
            }
        }
    }

    /// Re-parses a note from text in memory (e.g. while it's being edited).
    func update(path: String, text: String) {
        guard texts[path] != text else { return }
        texts[path] = text
        notes[path] = NoteParser.parse(text)
        revision += 1
    }

    // MARK: - Queries

    func info(for path: String) -> NoteInfo? { notes[path] }

    /// Every indexed note's text and tags, for searching off the main thread.
    func searchSnapshot() -> [VaultSearch.Note] {
        texts.map { path, text in
            VaultSearch.Note(path: path, text: text, tags: notes[path]?.tags ?? [])
        }
    }

    /// Notes that link to `path`, alphabetically.
    func backlinks(to path: String) -> [Backlink] {
        var result: [Backlink] = []
        for (source, info) in notes where source != path {
            var seen = Set<String>()
            let contexts = info.links
                .filter { resolver.resolve($0, from: source) == path }
                .map(\.context)
                .filter { seen.insert($0).inserted }
            if !contexts.isEmpty {
                result.append(Backlink(source: source, title: Self.title(of: source), contexts: contexts))
            }
        }
        return result.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    /// Notes that mention `path`'s name (or an alias) in plain text without
    /// linking to it.
    func unlinkedMentions(of path: String, limit: Int = 50) -> [Mention] {
        let names = ([Self.title(of: path)] + (notes[path]?.aliases ?? []))
            .filter { $0.count >= 3 }
        guard !names.isEmpty else { return [] }

        var result: [Mention] = []
        for (source, text) in texts where source != path {
            let linkedLines = Set((notes[source]?.links ?? [])
                .filter { resolver.resolve($0, from: source) == path }
                .map(\.line))
            var lineNumber = 0
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                lineNumber += 1
                guard !linkedLines.contains(lineNumber),
                      names.contains(where: { Self.containsWord($0, in: line) }) else { continue }
                result.append(Mention(source: source, title: Self.title(of: source), context: line.trimmingCharacters(in: .whitespaces)))
                break
            }
            if result.count >= limit { break }
        }
        return result.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    /// Notes that `path` links to: (target as written, resolved path or nil).
    func outgoingLinks(from path: String) -> [(target: String, resolved: String?)] {
        var seen = Set<String>()
        return (notes[path]?.links ?? []).compactMap { link in
            let target = LinkResolver.linkPath(link.target)
            guard !target.isEmpty, !Attachments.isAttachmentTarget(target),
                  seen.insert(target.lowercased()).inserted else { return nil }
            return (target, resolver.resolve(link, from: path))
        }
    }

    /// Every tag with the number of notes using it, most used first.
    func allTags() -> [TagCount] {
        var counts: [String: (display: String, count: Int)] = [:]
        for info in notes.values {
            for tag in info.tags {
                let key = tag.lowercased()
                counts[key, default: (tag, 0)].count += 1
            }
        }
        return counts.values
            .map { TagCount(tag: $0.display, count: $0.count) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.tag.localizedStandardCompare($1.tag) == .orderedAscending }
    }

    /// Notes tagged `tag` or a nested tag under it ("lore" matches "lore/crystals").
    func notes(taggedWith tag: String) -> [String] {
        let wanted = tag.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        return notes.compactMap { path, info in
            info.tags.contains { $0.lowercased() == wanted || $0.lowercased().hasPrefix(wanted + "/") } ? path : nil
        }
        .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    // MARK: - Helpers

    nonisolated static func title(of path: String) -> String {
        ((path as NSString).lastPathComponent as NSString).deletingPathExtension
    }

    /// Case-insensitive whole-word search.
    nonisolated static func containsWord(_ word: String, in line: Substring) -> Bool {
        var searchRange = line.startIndex..<line.endIndex
        while let found = line.range(of: word, options: [.caseInsensitive, .diacriticInsensitive], range: searchRange) {
            let before = found.lowerBound == line.startIndex ? nil : line[line.index(before: found.lowerBound)]
            let after = found.upperBound == line.endIndex ? nil : line[found.upperBound]
            let isBoundary: (Character?) -> Bool = { $0 == nil || !($0!.isLetter || $0!.isNumber) }
            if isBoundary(before), isBoundary(after) { return true }
            searchRange = found.upperBound..<line.endIndex
        }
        return false
    }
}
