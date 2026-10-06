import Foundation

/// One entry in a vault's file tree: a folder or a markdown note.
nonisolated struct FileNode: Identifiable, Hashable, Sendable {
    let url: URL
    let isDirectory: Bool
    /// `nil` for notes so `OutlineGroup` shows no disclosure triangle.
    var children: [FileNode]?
    /// Stored only in iCloud: its content downloads when it's opened.
    var isCloudOnly = false

    var id: URL { url }

    /// Display name: folders keep their name, notes drop the extension.
    var name: String {
        isDirectory ? url.lastPathComponent : url.deletingPathExtension().lastPathComponent
    }

    static let noteExtensions: Set<String> = ["md", "markdown"]

    static func isNote(_ url: URL) -> Bool {
        noteExtensions.contains(url.pathExtension.lowercased())
    }

    /// Recursively lists folders and notes under `directory`, folders first,
    /// sorted the way Finder sorts. Hidden entries (`.git`, `.obsidian`, …) are skipped.
    static func scan(_ directory: URL, fileManager: FileManager = .default) -> [FileNode] {
        let keys: [URLResourceKey] = [.isDirectoryKey, .isPackageKey, .ubiquitousItemDownloadingStatusKey]
        guard let entries = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var nodes: [FileNode] = []
        for entry in entries {
            let values = try? entry.resourceValues(forKeys: Set(keys))
            let isDirectory = (values?.isDirectory ?? false) && !(values?.isPackage ?? false)
            // Build child URLs from `directory` itself: the URLs FileManager
            // returns may spell the path differently (e.g. /private/var vs /var).
            let url = directory.appendingPathComponent(entry.lastPathComponent, isDirectory: isDirectory)
            if isDirectory {
                nodes.append(FileNode(url: url, isDirectory: true, children: scan(url, fileManager: fileManager)))
            } else if isNote(url) {
                let isCloudOnly = values?.ubiquitousItemDownloadingStatus == .notDownloaded
                nodes.append(FileNode(url: url, isDirectory: false, children: nil, isCloudOnly: isCloudOnly))
            }
        }
        return nodes.sorted { lhs, rhs in
            if lhs.isDirectory != rhs.isDirectory { return lhs.isDirectory }
            return lhs.url.lastPathComponent.localizedStandardCompare(rhs.url.lastPathComponent) == .orderedAscending
        }
    }

    /// Number of notes in this subtree.
    var noteCount: Int {
        isDirectory ? (children ?? []).reduce(0) { $0 + $1.noteCount } : 1
    }
}
