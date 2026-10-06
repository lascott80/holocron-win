import CoreServices
import Foundation

/// Watches a vault folder (recursively) with FSEvents and reports the paths
/// of files that changed, in batches, on the main thread.
///
/// Not main-actor isolated so `deinit` can stop the stream; the stream itself
/// only ever runs on the main queue.
nonisolated final class VaultWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    /// The root as FSEvents spells it (fully resolved, e.g. /private/var/…).
    private let rootPath: String
    /// The root as the vault spells it, in case the two differ.
    private let displayRootPath: String
    private let latency: TimeInterval
    private let onChange: @MainActor ([String]) -> Void

    /// - Parameter onChange: Receives vault-relative paths ("Lore/Ilum.md").
    ///   Hidden files and folders (.git, .obsidian, .DS_Store…) are filtered out.
    init(root: URL, latency: TimeInterval = 0.2, onChange: @escaping @MainActor ([String]) -> Void) {
        // FSEvents reports real paths (/private/var/…). realpath(3) gives the
        // same spelling; NSString's symlink resolution doesn't (it strips
        // /private, but only for files that still exist).
        let path = root.standardizedFileURL.path
        self.displayRootPath = path
        self.rootPath = realpath(path, nil).map { pointer in
            defer { free(pointer) }
            return String(cString: pointer)
        } ?? path
        self.latency = latency
        self.onChange = onChange
    }

    func start() {
        guard stream == nil else { return }
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, count, paths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<VaultWatcher>.fromOpaque(info).takeUnretainedValue()
            let changed = (unsafeBitCast(paths, to: NSArray.self) as? [String]) ?? []
            MainActor.assumeIsolated {
                watcher.deliver(Array(changed.prefix(count)))
            }
        }
        let flags = UInt32(
            kFSEventStreamCreateFlagUseCFTypes
                | kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer
                | kFSEventStreamCreateFlagWatchRoot
        )
        guard let stream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            [rootPath] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            latency,
            flags
        ) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        self.stream = stream
    }

    deinit {
        stop()
    }

    func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    @MainActor private func deliver(_ paths: [String]) {
        var relative: [String] = []
        for path in paths {
            guard let rel = relativePath(path) else { continue }
            if rel.split(separator: "/").contains(where: { $0.hasPrefix(".") }) { continue }
            relative.append(rel)
        }
        if !relative.isEmpty { onChange(relative) }
    }

    /// The vault-relative path for an event path; "" for the root itself.
    private func relativePath(_ path: String) -> String? {
        for root in [rootPath, displayRootPath] {
            if path == root { return "" }
            let prefix = root.hasSuffix("/") ? root : root + "/"
            if path.hasPrefix(prefix) { return String(path.dropFirst(prefix.count)) }
        }
        return nil
    }
}
