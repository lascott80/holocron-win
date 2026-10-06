import Foundation

/// File access that plays well with iCloud Drive (and other File Provider
/// services such as Dropbox): reads and writes are coordinated with the sync
/// process, notes iCloud has offloaded are downloaded on request, and
/// conflicting versions from other devices can be found and resolved.
///
/// Coordination costs next to nothing for ordinary local folders, so every
/// vault goes through here.
nonisolated enum CloudFiles {
    // MARK: - Status

    /// Whether `url` is in iCloud Drive and its content isn't on this Mac
    /// (reading it would have to download it first).
    static func needsDownload(_ url: URL) -> Bool {
        let values = freshValues(url, [.ubiquitousItemDownloadingStatusKey])
        return values?.ubiquitousItemDownloadingStatus == .notDownloaded
    }

    /// Whether `url` is synced by iCloud Drive.
    static func isInICloud(_ url: URL) -> Bool {
        freshValues(url, [.isUbiquitousItemKey])?.isUbiquitousItem ?? false
    }

    /// Whether the path is inside the iCloud Drive folder, synced or not
    /// (if iCloud Drive is turned off, the folder stays but stops syncing).
    static func isInICloudDriveFolder(_ url: URL) -> Bool {
        url.standardizedFileURL.path.contains("/Library/Mobile Documents/")
    }

    /// iCloud's view of a set of files.
    struct Summary: Equatable, Sendable {
        var uploading = 0
        var downloading = 0
        /// Stored only in iCloud; downloaded when opened.
        var notDownloaded = 0
        var errors: [String] = []
    }

    static func summary(of urls: [URL]) -> Summary {
        var summary = Summary()
        let keys: Set<URLResourceKey> = [
            .ubiquitousItemDownloadingStatusKey, .ubiquitousItemIsDownloadingKey,
            .ubiquitousItemIsUploadingKey, .ubiquitousItemIsUploadedKey,
            .ubiquitousItemUploadingErrorKey, .ubiquitousItemDownloadingErrorKey,
        ]
        for url in urls {
            guard let values = freshValues(url, keys) else { continue }
            if values.ubiquitousItemIsUploading == true || values.ubiquitousItemIsUploaded == false { summary.uploading += 1 }
            if values.ubiquitousItemIsDownloading == true { summary.downloading += 1 }
            if values.ubiquitousItemDownloadingStatus == .notDownloaded { summary.notDownloaded += 1 }
            for error in [values.ubiquitousItemUploadingError, values.ubiquitousItemDownloadingError].compactMap({ $0 }) {
                summary.errors.append(error.localizedDescription)
            }
        }
        return summary
    }

    /// Resource values read from disk now, not from the URL's cache.
    private static func freshValues(_ url: URL, _ keys: Set<URLResourceKey>) -> URLResourceValues? {
        var url = url
        url.removeAllCachedResourceValues()
        return try? url.resourceValues(forKeys: keys)
    }

    // MARK: - Downloading

    private static let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "Holocron.CloudFiles"
        queue.maxConcurrentOperationCount = 4
        return queue
    }()

    /// Makes sure the file's content is on this Mac, downloading it if
    /// needed, without blocking the calling thread.
    static func download(_ url: URL) async throws {
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // A coordinated read makes the sync service provide the file
            // first; the accessor runs once it's here.
            NSFileCoordinator().coordinate(with: [.readingIntent(with: url)], queue: queue) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    // MARK: - Coordinated reads & writes

    static func read(_ url: URL) throws -> Data {
        try coordinate { coordinator, error in
            var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
            coordinator.coordinate(readingItemAt: url, options: [], error: &error) { url in
                result = Result { try Data(contentsOf: url) }
            }
            return result
        }
    }

    /// Writes `data` to `url`; `.atomic` replaces any existing file in one step.
    static func write(_ data: Data, to url: URL, options: Data.WritingOptions = .atomic) throws {
        try coordinate { coordinator, error in
            var result: Result<Void, Error> = .success(())
            coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &error) { url in
                result = Result {
                    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try data.write(to: url, options: options)
                }
            }
            return result
        }
    }

    static func move(_ source: URL, to destination: URL) throws {
        try coordinate { coordinator, error in
            var result: Result<Void, Error> = .success(())
            coordinator.coordinate(
                writingItemAt: source, options: .forMoving,
                writingItemAt: destination, options: .forReplacing,
                error: &error
            ) { source, destination in
                result = Result {
                    coordinator.item(at: source, willMoveTo: destination)
                    try FileManager.default.moveItem(at: source, to: destination)
                    coordinator.item(at: source, didMoveTo: destination)
                }
            }
            return result
        }
    }

    static func copy(_ source: URL, to destination: URL) throws {
        try coordinate { coordinator, error in
            var result: Result<Void, Error> = .success(())
            coordinator.coordinate(
                readingItemAt: source, options: [],
                writingItemAt: destination, options: .forReplacing,
                error: &error
            ) { source, destination in
                result = Result { try FileManager.default.copyItem(at: source, to: destination) }
            }
            return result
        }
    }

    /// Moves `url` to the Trash and returns where it ended up.
    static func trash(_ url: URL) throws -> URL? {
        try coordinate { coordinator, error in
            var result: Result<URL?, Error> = .success(nil)
            coordinator.coordinate(writingItemAt: url, options: .forDeleting, error: &error) { url in
                result = Result {
                    var trashed: NSURL?
                    try FileManager.default.trashItem(at: url, resultingItemURL: &trashed)
                    return trashed as URL?
                }
            }
            return result
        }
    }

    /// Runs a coordination, turning both kinds of failure (coordination
    /// itself, and the work inside it) into a thrown error.
    private static func coordinate<T>(_ body: (NSFileCoordinator, inout NSError?) -> Result<T, Error>) throws -> T {
        var coordinationError: NSError?
        let result = body(NSFileCoordinator(), &coordinationError)
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    // MARK: - Conflicts

    /// A version of a note that iCloud kept because another device changed
    /// it at the same time.
    struct ConflictVersion {
        let text: String
        let deviceName: String?
        let date: Date?
        /// Marks this version handled, so iCloud stops offering it.
        let resolve: () -> Void
    }

    /// The other devices' versions of `url`, newest first.
    static func conflictVersions(of url: URL) -> [ConflictVersion] {
        guard let versions = NSFileVersion.unresolvedConflictVersionsOfItem(at: url), !versions.isEmpty else { return [] }
        return versions
            .sorted { ($0.modificationDate ?? .distantPast) > ($1.modificationDate ?? .distantPast) }
            .compactMap { version in
                guard let data = try? read(version.url) else { return nil }
                return ConflictVersion(
                    text: String(decoding: data, as: UTF8.self),
                    deviceName: version.localizedNameOfSavingComputer,
                    date: version.modificationDate,
                    resolve: {
                        version.isResolved = true
                        try? NSFileVersion.removeOtherVersionsOfItem(at: url)
                    }
                )
            }
    }

    // MARK: - Duplicates

    /// For "Kyber 2.md" next to "Kyber.md", the original's URL. iCloud
    /// sometimes saves a numbered second copy when a note changes on two
    /// devices at once.
    static func originalOfDuplicate(_ url: URL) -> URL? {
        let name = url.deletingPathExtension().lastPathComponent
        guard let match = name.wholeMatch(of: /(.+) ([2-9])/) else { return nil }
        let original = url.deletingLastPathComponent()
            .appendingPathComponent(String(match.1))
            .appendingPathExtension(url.pathExtension)
        return FileManager.default.fileExists(atPath: original.path) ? original : nil
    }
}
