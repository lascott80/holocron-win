import Foundation
import UniformTypeIdentifiers

/// Non-note files in a vault (images, PDFs…): finding them for embeds and
/// links, and adding new ones from paste or drag and drop.
nonisolated enum Attachments {
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "avif"]

    static func isImage(_ path: String) -> Bool {
        imageExtensions.contains((path as NSString).pathExtension.lowercased())
    }

    /// Whether a link target names a file rather than a note: it has an
    /// extension that isn't markdown ("photo.png", "report.pdf").
    static func isAttachmentTarget(_ target: String) -> Bool {
        let ext = (LinkResolver.linkPath(target) as NSString).pathExtension.lowercased()
        return !ext.isEmpty && !FileNode.noteExtensions.contains(ext) && ext.allSatisfy { $0.isLetter || $0.isNumber }
    }

    /// Vault-relative paths of every non-note, non-hidden file.
    static func scan(_ root: URL) -> [String] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }
        // The enumerator may spell the root differently (/private/var vs
        // /var); every file here exists, so resolving symlinks on both sides
        // gives matching prefixes.
        let rootComponents = root.resolvingSymlinksInPath().pathComponents
        var paths: [String] = []
        for case let url as URL in enumerator {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
                  !FileNode.isNote(url) else { continue }
            let components = url.resolvingSymlinksInPath().pathComponents
            guard components.starts(with: rootComponents) else { continue }
            paths.append(components.dropFirst(rootComponents.count).joined(separator: "/"))
        }
        return paths.sorted()
    }

    /// Finds an attachment for an embed or link target, Obsidian-style:
    /// a path relative to the linking note, a vault path, or just a file
    /// name anywhere in the vault (nearest the root wins).
    static func resolve(_ rawTarget: String, from notePath: String, in paths: [String]) -> String? {
        let target = LinkResolver.linkPath(rawTarget).replacingOccurrences(of: "\\", with: "/")
        guard !target.isEmpty else { return nil }
        let lowered = Dictionary(paths.map { ($0.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })

        if target.hasPrefix("/") {
            return lowered[normalize(String(target.dropFirst())).lowercased()]
        }
        let noteFolder = (notePath as NSString).deletingLastPathComponent
        let relative = normalize(noteFolder.isEmpty ? target : noteFolder + "/" + target)
        if let match = lowered[relative.lowercased()] { return match }
        if let match = lowered[normalize(target).lowercased()] { return match }
        guard !target.contains("/") else { return nil }
        let name = target.lowercased()
        return paths
            .filter { ($0 as NSString).lastPathComponent.lowercased() == name }
            .min { $0.split(separator: "/").count < $1.split(separator: "/").count }
    }

    /// Resolves "." and ".." segments; never climbs above the vault root.
    static func normalize(_ path: String) -> String {
        var parts: [Substring] = []
        for part in path.split(separator: "/") {
            switch part {
            case ".": continue
            case "..": if !parts.isEmpty { parts.removeLast() }
            default: parts.append(part)
            }
        }
        return parts.joined(separator: "/")
    }

    /// The file name for a pasted image: "Pasted image 20261005143522.png".
    static func pastedImageName(date: Date = .now, mimeType: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMddHHmmss"
        let ext = UTType(mimeType: mimeType)?.preferredFilenameExtension ?? "png"
        return "Pasted image \(formatter.string(from: date)).\(ext == "jpeg" ? "jpg" : ext)"
    }

    /// The text to insert for an attachment: an embed for images, a link
    /// otherwise; by name when the name is unique in the vault.
    static func linkText(for path: String, among paths: [String]) -> String {
        let name = (path as NSString).lastPathComponent
        let unique = paths.filter { ($0 as NSString).lastPathComponent.caseInsensitiveCompare(name) == .orderedSame }.count <= 1
        let target = unique ? name : path
        return isImage(path) ? "![[\(target)]]" : "[[\(target)]]"
    }
}
