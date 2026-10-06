import AppKit
import Observation

/// Somewhere to remember per-vault state. `UserDefaults` in the app; tests
/// use an in-memory store so they never touch real preferences.
protocol VaultStateStore: AnyObject {
    func stringArray(forKey key: String) -> [String]?
    func integer(forKey key: String) -> Int
    func set(_ value: Any?, forKey key: String)
}

extension UserDefaults: VaultStateStore {}

/// A folder of markdown notes opened in Holocron. The folder on disk is the
/// only source of truth; Holocron keeps no database alongside it.
@Observable
final class Vault {
    let rootURL: URL

    private(set) var tree: [FileNode] = []
    private(set) var noteCount = 0
    var errorMessage: String?

    /// Open tabs, left to right.
    private(set) var tabs: [EditorTab] = []
    private(set) var activeTabID: EditorTab.ID?
    /// Loaded notes, one per file, shared by every tab showing that file.
    private(set) var documents: [URL: NoteDocument] = [:]

    var activeTab: EditorTab? { tabs.first { $0.id == activeTabID } }

    /// The note in the active tab.
    var document: NoteDocument? { activeTab?.url.flatMap { documents[$0] } }

    func document(for tab: EditorTab) -> NoteDocument? {
        tab.url.flatMap { documents[$0] }
    }

    /// Every note in the vault, used to resolve links.
    @ObservationIgnored private(set) var allNotes: [URL] = []
    /// Vault-relative paths of every other file (images, PDFs…).
    @ObservationIgnored private(set) var attachments: [String] = []

    /// Headings, links and tags of every note.
    @ObservationIgnored let index: VaultIndex
    @ObservationIgnored private var resolver = LinkResolver(paths: [])
    @ObservationIgnored private var indexTask: Task<Void, Never>?
    @ObservationIgnored private var liveIndexTask: Task<Void, Never>?

    /// Recently opened notes (vault-relative paths), most recent first.
    private(set) var recentNotes: [String] = []

    /// The quick open palette's query; `nil` when it's closed.
    var quickOpenQuery: String?

    /// Focus mode: only the note, with everything but the current paragraph
    /// dimmed and the cursor line kept centred.
    var isFocusMode = false {
        didSet { editor.setFocusMode(isFocusMode) }
    }

    enum SidebarMode: String { case files, search }
    /// What the sidebar shows.
    var sidebarMode: SidebarMode = .files

    /// Full-text search across the vault.
    @ObservationIgnored private(set) lazy var search = SearchModel(index: index)

    /// The window's editor. Its web view is created lazily on first display.
    @ObservationIgnored let editor = EditorController()

    /// The sidebar selection: a note or a folder.
    var selection: URL? {
        didSet {
            guard selection != oldValue else { return }
            if let selection, FileNode.isNote(selection) {
                open(selection)
            }
        }
    }

    var name: String { rootURL.lastPathComponent }

    /// The vault path with the home folder shortened to `~`.
    var displayPath: String {
        (rootURL.path as NSString).abbreviatingWithTildeInPath
    }

    @ObservationIgnored private var watcher: VaultWatcher?
    /// Where per-vault state (open tabs, recent notes) is remembered.
    @ObservationIgnored private let defaults: any VaultStateStore

    init(rootURL: URL, watchForChanges: Bool = true, defaults: any VaultStateStore = UserDefaults.standard) {
        self.rootURL = rootURL.standardizedFileURL
        self.defaults = defaults
        self.index = VaultIndex(rootURL: self.rootURL)
        self.recentNotes = defaults.stringArray(forKey: "recentNotes:" + self.rootURL.path) ?? []
        reload()
        restoreTabs()
        editor.onOpenLink = { [weak self] target, newTab in
            self?.openLink(target, inNewTab: newTab)
        }
        editor.onOpenTag = { [weak self] tag in
            self?.showQuickOpen(query: "#" + tag)
        }
        editor.assets.resolve = { [weak self] kind, target, note in
            self?.resolveAsset(kind: kind, target: target, fromNote: note)
        }
        editor.onPasteImage = { [weak self] data, mimeType in
            guard let self else { return nil }
            do {
                return try self.saveAttachment(data, named: Attachments.pastedImageName(mimeType: mimeType))
            } catch {
                self.errorMessage = "Couldn’t save the pasted image: \(error.localizedDescription)"
                return nil
            }
        }
        editor.onDropFiles = { [weak self] urls in
            self?.importFiles(urls) ?? []
        }
        editor.onEmbedRequest = { [weak self] target in
            self?.embedContent(target: target)
        }
        if watchForChanges {
            let watcher = VaultWatcher(root: self.rootURL) { [weak self] paths in
                self?.handleDiskChanges(paths)
            }
            watcher.start()
            self.watcher = watcher
            startCloudStatusUpdates()
        }
    }

    /// Saves open notes and stops watching the folder.
    func close() {
        saveAll()
        watcher?.stop()
        watcher = nil
        cloudStatusTask?.cancel()
    }

    /// Rescans the folder. Only touches observed state when something changed,
    /// so frequent rescans don't churn the sidebar. Re-reads `changedPaths`
    /// into the index even if the tree's shape didn't change.
    func reload(changedPaths: Set<String> = []) {
        attachments = Attachments.scan(rootURL)
        let newTree = FileNode.scan(rootURL)
        let treeChanged = newTree != tree
        if treeChanged {
            tree = newTree
            noteCount = newTree.reduce(0) { $0 + $1.noteCount }
            allNotes = Self.flatten(newTree)
            resolver = LinkResolver(paths: allNotes.map(relativePath(of:)))
            recentNotes.removeAll { !FileManager.default.fileExists(atPath: rootURL.appendingPathComponent($0).path) }
        }
        if treeChanged || !changedPaths.isEmpty {
            scheduleIndexSync(reread: changedPaths)
        }
    }

    /// Queues an index update after any update already running.
    private func scheduleIndexSync(reread: Set<String>) {
        let paths = allNotes.map(relativePath(of:))
        let previous = indexTask
        indexTask = Task { [index] in
            await previous?.value
            await index.sync(paths: paths, reread: reread)
        }
    }

    /// Waits until queued index updates have finished (for tests).
    func indexingFinished() async {
        await indexTask?.value
    }

    // MARK: - Outside changes

    /// Called by the watcher with vault-relative paths that changed on disk.
    func handleDiskChanges(_ paths: [String]) {
        let notesBefore = Set(allNotes.map(relativePath(of:)))
        let changedNotes = paths.filter { FileNode.isNote(URL(fileURLWithPath: $0)) }
        reload(changedPaths: Set(changedNotes))
        if isInICloud {
            reviewCloudChanges(changed: changedNotes, new: changedNotes.filter { !notesBefore.contains($0) })
            refreshCloudStatus()
        }
        for (url, document) in documents {
            let path = relativePath(of: url)
            let affected = paths.contains { changed in
                changed.isEmpty || changed == path || path.hasPrefix(changed + "/")
            }
            guard affected else { continue }
            document.reconcileWithDisk()
            if document.canBeClosedSafely {
                // Some sync tools delete a file and write its replacement a
                // moment later; only close if it's still gone after a short wait.
                Task { [weak self, weak document] in
                    try? await Task.sleep(for: Self.missingFileGracePeriod)
                    guard let self, let document, self.documents[url] === document else { return }
                    document.reconcileWithDisk()
                    if document.canBeClosedSafely { self.closeTabs(showing: url) }
                }
            }
        }
    }

    static let missingFileGracePeriod: Duration = .milliseconds(1500)

    // MARK: - iCloud

    /// Whether the vault lives in iCloud Drive (overridable in tests).
    var isInICloud: Bool { isInICloudOverride ?? CloudFiles.isInICloudDriveFolder(rootURL) }
    @ObservationIgnored var isInICloudOverride: Bool?

    /// Whether iCloud kept another device's version of a file (replaceable in tests).
    @ObservationIgnored var hasCloudConflicts: (URL) -> Bool = { url in
        !(NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).isEmpty
    }

    /// Notes being downloaded from iCloud before they can be shown.
    private(set) var downloadingNotes: Set<URL> = []

    /// Fetches a note iCloud has offloaded, then shows it if a tab wants it.
    private func beginDownload(_ url: URL) {
        guard downloadingNotes.insert(url).inserted else { return }
        Task { [weak self] in
            var failure: Error?
            do { try await CloudFiles.download(url) } catch { failure = error }
            guard let self else { return }
            self.downloadingNotes.remove(url)
            if let failure {
                self.errorMessage = "Couldn’t download “\(url.deletingPathExtension().lastPathComponent)” from iCloud: \(failure.localizedDescription)"
            } else if self.tabs.contains(where: { $0.url == url }), !CloudFiles.needsDownload(url) {
                _ = self.loadDocument(url)
            }
        }
    }

    /// After a sync: points out numbered copies iCloud may have made
    /// ("Kyber 2" beside "Kyber") and other devices' versions of notes that
    /// aren't open (open ones show the conflict sheet themselves).
    private func reviewCloudChanges(changed: [String], new: [String]) {
        for path in new {
            let url = url(forRelativePath: path).standardizedFileURL
            guard !Self.namedByHolocron.contains(url.path), let original = CloudFiles.originalOfDuplicate(url) else { continue }
            showToast(
                "“\(VaultIndex.title(of: path))” looks like an iCloud duplicate of “\(original.deletingPathExtension().lastPathComponent)”",
                actionTitle: "Compare",
                isWarning: true
            ) { [weak self] in self?.compareDuplicate(url, with: original) }
            return
        }
        for path in changed {
            let url = url(forRelativePath: path).standardizedFileURL
            guard documents[url] == nil, hasCloudConflicts(url) else { continue }
            showToast(
                "“\(VaultIndex.title(of: path))” has a version from another device",
                actionTitle: "Review",
                isWarning: true
            ) { [weak self] in self?.open(url) }
            return
        }
    }

    /// Opens `original` beside its possible duplicate in the conflict sheet;
    /// keeping either version moves the duplicate to the Trash.
    func compareDuplicate(_ duplicate: URL, with original: URL) {
        open(original)
        guard let document = documents[original.standardizedFileURL] else { return }
        document.compare(withDuplicate: duplicate) { [weak self] resolution in
            guard let self, resolution != .both else { return }
            self.delete([duplicate])
        }
    }

    /// How the vault's notes stand with iCloud, for the status bar.
    enum CloudStatus: Equatable {
        case upToDate(offloaded: Int)
        case syncing(uploading: Int, downloading: Int)
        case error(String)
        /// In the iCloud Drive folder, but iCloud Drive isn't syncing it.
        case unavailable
    }

    /// `nil` when the vault isn't in iCloud Drive.
    private(set) var cloudStatus: CloudStatus?
    @ObservationIgnored private var cloudStatusTask: Task<Void, Never>?

    /// Checks iCloud's status now: often while things are syncing, rarely otherwise.
    private func startCloudStatusUpdates() {
        guard isInICloud else { return }
        cloudStatusTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.updateCloudStatus()
                let syncing: Bool
                if case .syncing = self?.cloudStatus { syncing = true } else { syncing = false }
                try? await Task.sleep(for: .seconds(syncing ? 3 : 30))
            }
        }
    }

    func refreshCloudStatus() {
        Task { await updateCloudStatus() }
    }

    private func updateCloudStatus() async {
        guard isInICloud else {
            cloudStatus = nil
            return
        }
        let root = rootURL
        let notes = allNotes
        let downloading = downloadingNotes.count + index.downloadingPaths.count
        let status = await Task.detached(priority: .utility) { () -> CloudStatus in
            guard CloudFiles.isInICloud(root) else { return .unavailable }
            let summary = CloudFiles.summary(of: notes)
            if let error = summary.errors.first { return .error(error) }
            let down = max(summary.downloading, downloading)
            if summary.uploading > 0 || down > 0 { return .syncing(uploading: summary.uploading, downloading: down) }
            return .upToDate(offloaded: summary.notDownloaded)
        }.value
        if status != cloudStatus { cloudStatus = status }
    }

    /// Closes the active tab (saving first unless the note no longer exists).
    func closeDocument() {
        if let activeTabID { closeTab(activeTabID) }
    }

    /// Resolves an open conflict by saving Holocron's version as a separate
    /// copy and showing the disk version.
    func resolveConflictKeepingBoth() {
        guard document?.resolveKeepingBoth() != nil else { return }
        reload()
    }

    // MARK: - Links

    /// Finds the note a `[[target]]` link points to. Accepts a bare name
    /// ("Ilum"), a vault-relative path ("Lore/Ilum"), an optional extension,
    /// and a trailing "#Heading" or "^block". Matching ignores case; when
    /// several notes share a name, the one nearest the vault root wins.
    func resolveLink(_ rawTarget: String) -> URL? {
        if LinkResolver.linkPath(rawTarget).isEmpty { return document?.url }
        return resolver.resolve(wikiTarget: rawTarget).map(url(forRelativePath:))
    }

    func url(forRelativePath path: String) -> URL {
        rootURL.appendingPathComponent(path)
    }

    /// Opens the note a link points to, creating it at the vault root (or at
    /// the linked path) when it doesn't exist yet, as Obsidian does.
    func openLink(_ rawTarget: String, inNewTab: Bool = false) {
        if Attachments.isAttachmentTarget(rawTarget) {
            // [[report.pdf]] opens the file, never creates "report.pdf.md".
            let from = document.map { relativePath(of: $0.url) } ?? ""
            if let path = Attachments.resolve(rawTarget, from: from, in: attachments) {
                NSWorkspace.shared.open(url(forRelativePath: path))
            } else {
                errorMessage = "“\(LinkResolver.linkPath(rawTarget))” isn’t in this vault."
            }
            return
        }
        if let url = resolveLink(rawTarget) {
            open(url, inNewTab: inNewTab)
            editor.focus()
            revealFragment(of: rawTarget)
            return
        }
        let target = LinkResolver.linkPath(rawTarget)
        let safe = target
            .split(separator: "/")
            .map { $0.replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
        guard !safe.isEmpty else { return }

        var url = safe.dropLast().reduce(rootURL) { $0.appendingPathComponent($1, isDirectory: true) }
        let fileName = safe.last!
        url = FileNode.isNote(URL(fileURLWithPath: fileName))
            ? url.appendingPathComponent(fileName)
            : url.appendingPathComponent(fileName).appendingPathExtension("md")
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try CloudFiles.write(Data(), to: url, options: .withoutOverwriting)
        } catch {
            errorMessage = "Couldn’t create “\(fileName)”: \(error.localizedDescription)"
            return
        }
        reload()
        open(url, inNewTab: inNewTab)
        editor.focus()
    }

    /// Scrolls the open note to a link's #Heading or #^block-id, if it has one.
    private func revealFragment(of rawTarget: String) {
        guard let fragment = Self.linkFragment(rawTarget),
              let document,
              let line = Self.line(of: fragment, in: document.text) else { return }
        editor.reveal(in: document, line: line, range: NSRange(location: 0, length: 0))
    }

    /// The part of a link after the note: "Heading", "Parent#Child" or "^id".
    nonisolated static func linkFragment(_ target: String) -> String? {
        guard let index = target.firstIndex(where: { $0 == "#" || $0 == "^" }) else { return nil }
        var fragment = target[index...].trimmingCharacters(in: .whitespaces)
        if fragment.hasPrefix("#") { fragment.removeFirst() }
        return fragment.isEmpty ? nil : fragment
    }

    /// The 1-based line of a heading (matched like Obsidian: case-insensitive,
    /// formatting ignored; "A#B" means heading B) or a block id ("^id").
    nonisolated static func line(of fragment: String, in text: String) -> Int? {
        if fragment.hasPrefix("^") {
            let id = String(fragment.dropFirst())
            let lines = text.components(separatedBy: "\n")
            for (index, line) in lines.enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed == "^" + id {
                    // An id on its own line names the block above it.
                    var above = index - 1
                    while above > 0, lines[above].trimmingCharacters(in: .whitespaces).isEmpty { above -= 1 }
                    return max(above, 0) + 1
                }
                if trimmed.hasSuffix(" ^" + id) { return index + 1 }
            }
            return nil
        }
        let wanted = (fragment.split(separator: "#").last.map(String.init) ?? fragment)
            .trimmingCharacters(in: .whitespaces).lowercased()
        return NoteParser.parse(text).headings.first { $0.text.lowercased() == wanted }?.line
    }

    /// `url`'s path inside the vault, e.g. "Lore/Crystals/Ilum.md".
    func relativePath(of url: URL) -> String {
        let rootParts = rootURL.pathComponents
        var parts = url.standardizedFileURL.pathComponents
        if !parts.starts(with: rootParts) {
            // Same folder reached through a symlink (/tmp vs /private/tmp…).
            parts = url.resolvingSymlinksInPath().pathComponents
            let resolvedRoot = rootURL.resolvingSymlinksInPath().pathComponents
            guard parts.starts(with: resolvedRoot) else { return url.lastPathComponent }
            return parts.dropFirst(resolvedRoot.count).joined(separator: "/")
        }
        return parts.dropFirst(rootParts.count).joined(separator: "/")
    }

    private static func flatten(_ nodes: [FileNode]) -> [URL] {
        nodes.flatMap { node in
            node.isDirectory ? flatten(node.children ?? []) : [node.url]
        }
    }

    func saveCurrent() {
        saveAll()
    }

    func saveAll() {
        for document in documents.values { document.save() }
    }

    /// Re-indexes the open note shortly after typing pauses, so backlinks
    /// and the outline follow edits before they're saved.
    private func scheduleLiveIndexUpdate(path: String, text: String) {
        liveIndexTask?.cancel()
        liveIndexTask = Task { [index] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            index.update(path: path, text: text)
        }
    }

    // MARK: - Tabs

    /// Opens a note. Switches to its tab if one already shows it; otherwise
    /// shows it in the active tab, or in a new tab when asked (an empty
    /// active tab is reused either way).
    func open(_ url: URL, inNewTab: Bool = false) {
        let url = url.standardizedFileURL
        if let existing = tabs.first(where: { $0.url == url }) {
            activateTab(existing.id)
            return
        }
        // A note still downloading from iCloud opens now and shows once it arrives.
        guard loadDocument(url) != nil || downloadingNotes.contains(url) else { return }
        if let index = activeIndex, !inNewTab || tabs[index].url == nil {
            document?.save()
            tabs[index].navigate(to: url)
        } else {
            let tab = EditorTab(url: url)
            tabs.insert(tab, at: activeIndex.map { $0 + 1 } ?? tabs.endIndex)
            activeTabID = tab.id
        }
        didChangeTabs()
    }

    /// Opens an empty tab after the active one.
    func newTab() {
        let tab = EditorTab()
        tabs.insert(tab, at: activeIndex.map { $0 + 1 } ?? tabs.endIndex)
        activeTabID = tab.id
        didChangeTabs()
    }

    func activateTab(_ id: EditorTab.ID) {
        guard tabs.contains(where: { $0.id == id }) else { return }
        if id != activeTabID { document?.save() }
        activeTabID = id
        if let url = activeTab?.url { loadDocument(url) }
        didChangeTabs()
    }

    func closeTab(_ id: EditorTab.ID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        tabs.remove(at: index)
        if activeTabID == id {
            activeTabID = tabs.indices.contains(index) ? tabs[index].id : tabs.last?.id
            if let url = activeTab?.url { loadDocument(url) }
        }
        didChangeTabs()
    }

    func closeOtherTabs(than id: EditorTab.ID) {
        tabs.removeAll { $0.id != id }
        activateTab(id)
    }

    func closeTabsToTheRight(of id: EditorTab.ID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closing = Set(tabs[(index + 1)...].map(\.id))
        tabs.removeAll { closing.contains($0.id) }
        if let activeTabID, closing.contains(activeTabID) { activateTab(id) } else { didChangeTabs() }
    }

    /// Closes every tab showing `url` (e.g. after the file was deleted).
    func closeTabs(showing url: URL) {
        for tab in tabs where tab.url == url.standardizedFileURL { closeTab(tab.id) }
    }

    func selectNextTab() { selectTab(offset: 1) }
    func selectPreviousTab() { selectTab(offset: -1) }

    /// ⌘1…⌘8 pick that tab; ⌘9 always picks the last one, as in Safari.
    func selectTab(number: Int) {
        guard !tabs.isEmpty else { return }
        let index = number >= 9 ? tabs.count - 1 : number - 1
        if tabs.indices.contains(index) { activateTab(tabs[index].id) }
    }

    private func selectTab(offset: Int) {
        guard let index = activeIndex, tabs.count > 1 else { return }
        activateTab(tabs[(index + offset + tabs.count) % tabs.count].id)
    }

    /// Moves a tab so it sits where `target` is now.
    func moveTab(_ id: EditorTab.ID, to target: EditorTab.ID) {
        guard id != target,
              let from = tabs.firstIndex(where: { $0.id == id }),
              let to = tabs.firstIndex(where: { $0.id == target }) else { return }
        let tab = tabs.remove(at: from)
        tabs.insert(tab, at: to)
        saveTabs()
    }

    var canGoBack: Bool { activeTab?.canGoBack ?? false }
    var canGoForward: Bool { activeTab?.canGoForward ?? false }

    func goBack() { navigateHistory { $0.goBack(skipping: $1) } }
    func goForward() { navigateHistory { $0.goForward(skipping: $1) } }

    private func navigateHistory(_ move: (inout EditorTab, (URL) -> Bool) -> URL?) {
        guard let index = activeIndex else { return }
        document?.save()
        let missing: (URL) -> Bool = { !FileManager.default.fileExists(atPath: $0.path) }
        guard let url = move(&tabs[index], missing) else { return }
        loadDocument(url)
        didChangeTabs()
    }

    private var activeIndex: Int? { tabs.firstIndex { $0.id == activeTabID } }

    /// The shared document for `url`, loading it if needed.
    @discardableResult
    private func loadDocument(_ url: URL) -> NoteDocument? {
        if let existing = documents[url] { return existing }
        if CloudFiles.needsDownload(url) {
            beginDownload(url)
            return nil
        }
        do {
            let document = try NoteDocument(url: url)
            let path = relativePath(of: url)
            document.onTextChange = { [weak self, weak document] text in
                self?.scheduleLiveIndexUpdate(path: path, text: text)
                if let document { self?.scheduleAutoTitle(for: document) }
            }
            if Self.isPlaceholderName(url) { autoTitled.insert(ObjectIdentifier(document)) }
            documents[url] = document
            document.checkForConflictingVersions()
            errorMessage = nil
            return document
        } catch {
            errorMessage = "Couldn’t open “\(url.lastPathComponent)”: \(error.localizedDescription)"
            return nil
        }
    }

    /// Runs after any change to tabs: keeps the sidebar selection and recent
    /// notes in step, unloads notes no tab shows, and remembers the tabs.
    private func didChangeTabs() {
        finishAutoTitles(except: document)
        let url = activeTab?.url
        if selection != url { selection = url }
        if let url { rememberRecent(relativePath(of: url)) }
        unloadUnusedDocuments()
        saveTabs()
    }

    private func unloadUnusedDocuments() {
        let inUse = Set(tabs.compactMap(\.url))
        for (url, document) in documents where !inUse.contains(url) {
            if document.conflict != nil {
                // Never drop unresolved edits: keep them as a separate note.
                document.resolveKeepingBoth()
                reload()
            } else if !document.isMissingOnDisk || document.isDirty {
                document.save()
            }
            document.onExternalTextChange = nil
            autoTitled.remove(ObjectIdentifier(document))
            autoTitleTasks.removeValue(forKey: ObjectIdentifier(document))?.cancel()
            documents[url] = nil
        }
    }

    private var tabsKey: String { "openTabs:" + rootURL.path }

    private func saveTabs() {
        defaults.set(tabs.compactMap { $0.url.map(relativePath(of:)) }, forKey: tabsKey)
        defaults.set(activeIndex ?? 0, forKey: tabsKey + ":active")
    }

    /// Reopens the tabs that were open when this vault was last closed.
    private func restoreTabs() {
        let urls = (defaults.stringArray(forKey: tabsKey) ?? [])
            .map { url(forRelativePath: $0).standardizedFileURL }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !urls.isEmpty else { return }
        tabs = urls.map { EditorTab(url: $0) }
        let active = min(defaults.integer(forKey: tabsKey + ":active"), tabs.count - 1)
        activateTab(tabs[max(0, active)].id)
    }

    // MARK: - File management

    enum FileError: LocalizedError {
        case invalidName
        case alreadyExists(String)
        case intoItself

        var errorDescription: String? {
            switch self {
            case .invalidName: "Names can’t be empty, start with a dot, or contain “/” or “:”."
            case .alreadyExists(let name): "There’s already an item named “\(name)” there."
            case .intoItself: "A folder can’t be moved into itself."
            }
        }
    }

    /// Moves an item to the Trash and returns where it ended up (nil if
    /// unknown). Replaceable so tests don't fill the real Trash.
    @ObservationIgnored var trashItem: (URL) throws -> URL? = CloudFiles.trash

    // MARK: - Toasts

    /// A short confirmation at the bottom of the window, optionally with Undo.
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        /// The button's title ("Undo", "Review"…), if there's a button.
        let actionTitle: String?
        var isWarning = false
        var canUndo: Bool { actionTitle == "Undo" }
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    private(set) var toast: Toast?
    @ObservationIgnored private var toastAction: (() -> Void)?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    /// Shows `message` for a few seconds; `undo` adds an Undo button.
    func showToast(_ message: String, undo: (() -> Void)? = nil) {
        showToast(message, actionTitle: undo == nil ? nil : "Undo", action: undo)
    }

    /// Shows `message` with a button that runs `action`.
    func showToast(_ message: String, actionTitle: String?, isWarning: Bool = false, action: (() -> Void)?) {
        let toast = Toast(message: message, actionTitle: action == nil ? nil : actionTitle, isWarning: isWarning)
        self.toast = toast
        toastAction = action
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(action == nil ? 3 : isWarning ? 12 : 6))
            guard !Task.isCancelled, let self, self.toast == toast else { return }
            self.dismissToast()
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
        toastAction = nil
    }

    /// Runs the current toast's button (Undo, Review…).
    func runToastAction() {
        let action = toastAction
        dismissToast()
        action?()
    }

    /// Runs the current toast's Undo.
    func undoToast() { runToastAction() }

    /// "“Kyber”", or "3 items".
    private func describe(_ urls: [URL]) -> String {
        guard urls.count == 1, let url = urls.first else { return "\(urls.count) items" }
        return "“\(FileNode.isNote(url) ? url.deletingPathExtension().lastPathComponent : url.lastPathComponent)”"
    }

    private func folderName(_ folder: URL) -> String {
        folder.standardizedFileURL == rootURL.standardizedFileURL ? "the top of the vault" : folder.lastPathComponent
    }

    /// Overrides the "update links" setting for this vault (used by tests).
    @ObservationIgnored var updatesLinksOverride: Bool?

    /// The sidebar row currently being renamed.
    var renamingURL: URL?
    /// Items waiting for the user to confirm moving them to the Trash.
    var pendingDeletion: [URL]?

    /// Renames a note or folder in place. Notes keep their extension even if
    /// the new name leaves it off. Links to renamed notes are updated.
    @discardableResult
    func rename(_ url: URL, to rawName: String) throws -> URL {
        if let document = documents[url.standardizedFileURL] {
            autoTitled.remove(ObjectIdentifier(document))
            autoTitleTasks.removeValue(forKey: ObjectIdentifier(document))?.cancel()
        }
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.hasPrefix("."), !name.contains("/"), !name.contains(":") else {
            throw FileError.invalidName
        }
        var fileName = name
        if !isDirectory(url), FileNode.isNote(url), !FileNode.isNote(URL(fileURLWithPath: name)) {
            fileName += "." + url.pathExtension
        }
        let source = url.standardizedFileURL
        let renamed = try performMove(url, to: url.deletingLastPathComponent().appendingPathComponent(fileName, isDirectory: isDirectory(url)))
        if renamed != source {
            showToast("Renamed \(describe([source])) to \(describe([renamed]))") { [weak self] in
                self?.undoMoves([(from: source, to: renamed)])
            }
        }
        return renamed
    }

    /// Puts moved items back where they were (most recent first).
    private func undoMoves(_ moves: [(from: URL, to: URL)]) {
        for move in moves.reversed() {
            do {
                try performMove(move.to, to: move.from)
            } catch {
                errorMessage = "Couldn’t put “\(move.to.lastPathComponent)” back: \(error.localizedDescription)"
            }
        }
        reload()
    }

    /// Moves items into `folder` (the vault root when nil). Files dragged in
    /// from outside the vault are copied in instead.
    func move(_ urls: [URL], into folder: URL?) {
        let destinationFolder = (folder ?? rootURL).standardizedFileURL
        var moves: [(from: URL, to: URL)] = []
        var copies: [URL] = []
        for url in urls.map(\.standardizedFileURL) {
            do {
                if !contains(url) {
                    let target = Self.uniqueURL(
                        named: url.deletingPathExtension().lastPathComponent,
                        extension: url.pathExtension,
                        in: destinationFolder
                    )
                    try CloudFiles.copy(url, to: target)
                    copies.append(target)
                    continue
                }
                guard url.deletingLastPathComponent().standardizedFileURL != destinationFolder else { continue }
                let destinationPath = destinationFolder.path + "/"
                if isDirectory(url), destinationPath.hasPrefix(url.path + "/") || destinationFolder == url {
                    throw FileError.intoItself
                }
                let moved = try performMove(url, to: destinationFolder.appendingPathComponent(url.lastPathComponent, isDirectory: isDirectory(url)))
                moves.append((from: url, to: moved))
            } catch {
                errorMessage = "Couldn’t move “\(url.lastPathComponent)”: \(error.localizedDescription)"
            }
        }
        reload()
        if !moves.isEmpty {
            showToast("Moved \(describe(moves.map(\.to))) to \(folderName(destinationFolder))") { [weak self] in
                self?.undoMoves(moves)
            }
        } else if !copies.isEmpty {
            showToast("Copied \(describe(copies)) into \(folderName(destinationFolder))") { [weak self] in
                self?.delete(copies, announce: false)
            }
        }
    }

    /// Creates "Untitled Folder" (numbered if taken) and starts renaming it.
    @discardableResult
    func createFolder(in parent: URL? = nil) -> URL? {
        let parent = parent ?? targetFolderForNewItems()
        var url = parent.appendingPathComponent("Untitled Folder", isDirectory: true)
        var counter = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = parent.appendingPathComponent("Untitled Folder \(counter)", isDirectory: true)
            counter += 1
        }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            errorMessage = "Couldn’t create a folder: \(error.localizedDescription)"
            return nil
        }
        reload()
        renamingURL = url.standardizedFileURL
        return url
    }

    /// Copies a note beside itself as "Name copy" and opens the copy.
    @discardableResult
    func duplicate(_ url: URL) -> URL? {
        documents[url.standardizedFileURL]?.save()
        let copy = Self.uniqueURL(named: url.deletingPathExtension().lastPathComponent + " copy", extension: url.pathExtension, in: url.deletingLastPathComponent())
        do {
            try CloudFiles.copy(url, to: copy)
        } catch {
            errorMessage = "Couldn’t duplicate “\(url.lastPathComponent)”: \(error.localizedDescription)"
            return nil
        }
        reload()
        open(copy, inNewTab: true)
        showToast("Duplicated \(describe([url]))") { [weak self] in
            self?.delete([copy], announce: false)
        }
        return copy
    }

    /// Asks before moving items to the Trash (see `pendingDeletion`).
    func requestDeletion(of urls: [URL]) {
        let items = urls.filter { contains($0) }
        if !items.isEmpty { pendingDeletion = items }
    }

    func confirmDeletion() {
        guard let urls = pendingDeletion else { return }
        pendingDeletion = nil
        delete(urls)
    }

    /// Moves items to the Trash and closes their tabs. Unsaved edits in
    /// those notes are discarded along with them.
    func delete(_ urls: [URL], announce: Bool = true) {
        var trashed: [(original: URL, inTrash: URL?)] = []
        for url in urls.map(\.standardizedFileURL) {
            let isUnder = { (candidate: URL) in candidate == url || candidate.path.hasPrefix(url.path + "/") }
            // Drop the documents first so closing their tabs can't save them back.
            for (documentURL, document) in documents where isUnder(documentURL) {
                document.onExternalTextChange = nil
                documents[documentURL] = nil
            }
            do {
                trashed.append((original: url, inTrash: try trashItem(url)))
            } catch {
                errorMessage = "Couldn’t move “\(url.lastPathComponent)” to the Trash: \(error.localizedDescription)"
                continue
            }
            for tab in tabs where tab.url.map(isUnder) == true { closeTab(tab.id) }
            if let selection, isUnder(selection) { self.selection = nil }
        }
        reload()
        guard announce, !trashed.isEmpty else { return }
        let restorable = trashed.allSatisfy { $0.inTrash != nil }
        showToast(
            "Moved \(describe(trashed.map(\.original))) to the Trash",
            undo: restorable ? { [weak self] in self?.restoreFromTrash(trashed.compactMap { item in item.inTrash.map { (item.original, $0) } }) } : nil
        )
    }

    /// Moves trashed items back to where they were.
    private func restoreFromTrash(_ items: [(original: URL, inTrash: URL)]) {
        for item in items {
            do {
                try FileManager.default.createDirectory(at: item.original.deletingLastPathComponent(), withIntermediateDirectories: true)
                try CloudFiles.move(item.inTrash, to: item.original)
            } catch {
                errorMessage = "Couldn’t restore “\(item.original.lastPathComponent)”: \(error.localizedDescription)"
            }
        }
        reload()
    }

    private func isDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    /// Moves a file or folder within the vault, keeping open notes, tabs and
    /// (if enabled) links in other notes pointing at the right place.
    @discardableResult
    private func performMove(_ source: URL, to destination: URL) throws -> URL {
        let source = source.standardizedFileURL
        let destination = destination.standardizedFileURL
        guard source != destination else { return destination }
        Self.namedByHolocron.insert(destination.path)
        let caseOnly = source.path.lowercased() == destination.path.lowercased()
        if !caseOnly, FileManager.default.fileExists(atPath: destination.path) {
            throw FileError.alreadyExists(destination.lastPathComponent)
        }

        // Which notes move, by vault-relative path.
        let oldRoot = relativePath(of: source)
        let newRoot = relativePath(of: destination)
        let movesTo: (String) -> String? = { path in
            if path == oldRoot { return newRoot }
            if path.hasPrefix(oldRoot + "/") { return newRoot + path.dropFirst(oldRoot.count) }
            return nil
        }
        var mapping: [String: String] = [:]
        for note in allNotes.map(relativePath(of:)) {
            if let moved = movesTo(note) { mapping[note] = moved }
        }

        // Work out link changes before anything moves.
        let updatesLinks = updatesLinksOverride ?? AppSettings.shared.updateLinksOnMove
        let rewrites = updatesLinks && !mapping.isEmpty ? planLinkRewrites(for: mapping) : [:]

        // Flush open notes being moved, then move on disk.
        for (url, document) in documents where movesTo(relativePath(of: url)) != nil { document.save() }
        if caseOnly {
            // Case-insensitive volumes see "kyber.md" and "Kyber.md" as the same file.
            let temporary = source.deletingLastPathComponent().appendingPathComponent(".holocron-rename-\(UUID().uuidString)")
            try CloudFiles.move(source, to: temporary)
            try CloudFiles.move(temporary, to: destination)
        } else {
            try CloudFiles.move(source, to: destination)
        }

        // Point documents, tabs, selection and recents at the new location.
        let remapURL: (URL) -> URL = { [self] url in
            movesTo(relativePath(of: url)).map {
                rootURL.appendingPathComponent($0, isDirectory: url.hasDirectoryPath).standardizedFileURL
            } ?? url
        }
        for (oldURL, document) in documents {
            let newURL = remapURL(oldURL)
            guard newURL != oldURL else { continue }
            documents[oldURL] = nil
            document.didMove(to: newURL)
            let path = relativePath(of: newURL)
            document.onTextChange = { [weak self, weak document] text in
                self?.scheduleLiveIndexUpdate(path: path, text: text)
                if let document { self?.scheduleAutoTitle(for: document) }
            }
            documents[newURL] = document
            editor.documentDidMove(document, from: oldURL)
        }
        for index in tabs.indices { tabs[index].remap(remapURL) }
        if let selection { self.selection = remapURL(selection) }
        if let renamingURL { self.renamingURL = remapURL(renamingURL) }
        recentNotes = recentNotes.map { movesTo($0) ?? $0 }

        // Rewrite links in other notes.
        for (path, text) in rewrites {
            let url = url(forRelativePath: path).standardizedFileURL
            if let document = documents[url] {
                document.replaceContents(text)
            } else {
                try? CloudFiles.write(Data(text.utf8), to: url)
            }
        }

        reload(changedPaths: Set(rewrites.keys).union(mapping.values))
        saveTabs()
        return destination
    }

    /// For each note whose links point at a moving note (or that moves and
    /// has relative markdown links), its new text — keyed by its path after
    /// the move.
    private func planLinkRewrites(for mapping: [String: String]) -> [String: String] {
        let oldResolver = resolver
        let newPaths = allNotes.map { mapping[relativePath(of: $0)] ?? relativePath(of: $0) }
        let newResolver = LinkResolver(paths: newPaths)
        var result: [String: String] = [:]

        for noteURL in allNotes {
            let sourceOld = relativePath(of: noteURL)
            let sourceNew = mapping[sourceOld] ?? sourceOld
            let sourceMoves = mapping[sourceOld] != nil
            let text: String
            if let document = documents[noteURL.standardizedFileURL] {
                text = document.text
            } else if let data = try? CloudFiles.read(noteURL) {
                text = String(decoding: data, as: UTF8.self)
            } else {
                continue
            }
            // Cheap filter using the index (or a fresh parse if not indexed yet).
            let links = (index.info(for: sourceOld) ?? NoteParser.parse(text)).links
            let relevant = links.contains { link in
                (oldResolver.resolve(link, from: sourceOld).map { mapping[$0] != nil } ?? false)
                    || (sourceMoves && link.kind == .markdown)
            }
            guard relevant else { continue }

            let newFolder = (sourceNew as NSString).deletingLastPathComponent
            let rewritten = LinkRewriter.rewrite(text) { target in
                switch target.kind {
                case .wiki:
                    guard let oldTarget = oldResolver.resolve(wikiTarget: target.path),
                          let newTarget = mapping[oldTarget] else { return nil }
                    return Self.wikiTarget(for: newTarget, writtenAs: target.path, resolver: newResolver)
                case .markdown:
                    guard let oldTarget = oldResolver.resolve(markdownTarget: target.path, from: sourceOld) else { return nil }
                    let newTarget = mapping[oldTarget] ?? oldTarget
                    guard newTarget != oldTarget || sourceMoves else { return nil }
                    return target.path.hasPrefix("/")
                        ? "/" + newTarget
                        : LinkRewriter.relativePath(from: newFolder, to: newTarget)
                }
            }
            if rewritten != text { result[sourceNew] = rewritten }
        }
        return result
    }

    /// How to write a wikilink to `newTarget`, keeping the original's style:
    /// a bare name when that's unambiguous, otherwise the vault path; with
    /// the extension only if the original had one.
    private static func wikiTarget(for newTarget: String, writtenAs original: String, resolver: LinkResolver) -> String {
        let keepsExtension = FileNode.isNote(URL(fileURLWithPath: original.lowercased()))
        let path = keepsExtension ? newTarget : (newTarget as NSString).deletingPathExtension
        let name = (path as NSString).lastPathComponent
        if original.contains("/") { return path }
        return resolver.resolve(wikiTarget: name) == newTarget ? name : path
    }

    // MARK: - Attachments

    /// The file an embed or attachment link points to, for the editor.
    /// `kind` is "embed" (![[name]]) or "relative" (![](path)); the result
    /// is always inside the vault.
    func resolveAsset(kind: String, target: String, fromNote noteURL: URL?) -> URL? {
        if kind == "relative", target.contains(":") { return nil } // not a local path
        let from = noteURL.map(relativePath(of:)) ?? ""
        guard let path = Attachments.resolve(target, from: from, in: attachments) else { return nil }
        let url = url(forRelativePath: path).standardizedFileURL
        return contains(url) ? url : nil
    }

    /// Whether `url` is inside this vault (following symlinks on both sides).
    func contains(_ url: URL) -> Bool {
        let root = rootURL.resolvingSymlinksInPath().pathComponents
        let parts = url.resolvingSymlinksInPath().pathComponents
        return parts.count > root.count && parts.starts(with: root)
    }

    /// Saves pasted data as a new file in the attachment folder and returns
    /// the text that embeds or links it.
    func saveAttachment(_ data: Data, named fileName: String) throws -> String {
        let folder = attachmentFolderURL
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = (fileName as NSString).deletingPathExtension
        let ext = (fileName as NSString).pathExtension
        let url = Self.uniqueURL(named: name.isEmpty ? "Attachment" : name, extension: ext.isEmpty ? "png" : ext, in: folder)
        try CloudFiles.write(data, to: url, options: .withoutOverwriting)
        reload()
        return Attachments.linkText(for: relativePath(of: url), among: attachments)
    }

    /// Adds dropped files: files already in the vault are linked where they
    /// are; others are copied into the attachment folder. Returns the text to
    /// insert for each (notes get a [[link]], images an embed).
    func importFiles(_ urls: [URL]) -> [String] {
        var texts: [String] = []
        for source in urls {
            let source = source.standardizedFileURL
            var target = source
            if !contains(source) {
                do {
                    let folder = attachmentFolderURL
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let name = source.deletingPathExtension().lastPathComponent
                    target = Self.uniqueURL(named: name, extension: source.pathExtension, in: folder)
                    try CloudFiles.copy(source, to: target)
                } catch {
                    errorMessage = "Couldn’t add “\(source.lastPathComponent)”: \(error.localizedDescription)"
                    continue
                }
            }
            reload()
            let path = relativePath(of: target)
            if FileNode.isNote(target) {
                texts.append("[[\((path as NSString).deletingPathExtension)]]")
            } else {
                texts.append(Attachments.linkText(for: path, among: attachments))
            }
        }
        return texts
    }

    private var attachmentFolderURL: URL {
        let folder = Attachments.normalize(AppSettings.shared.attachmentFolder)
        return folder.isEmpty ? rootURL : rootURL.appendingPathComponent(folder, isDirectory: true)
    }

    // MARK: - Daily notes

    struct DailyNoteSettings {
        var folder: String
        var format: String
        var template: String
    }

    /// Overrides the app's daily note settings for this vault (used by tests).
    @ObservationIgnored var dailyNoteSettingsOverride: DailyNoteSettings?

    var dailyNoteSettings: DailyNoteSettings {
        dailyNoteSettingsOverride ?? DailyNoteSettings(
            folder: AppSettings.shared.dailyNoteFolder,
            format: AppSettings.shared.dailyNoteFormat,
            template: AppSettings.shared.dailyNoteTemplate
        )
    }

    /// Opens the daily note for `date` (today by default), creating it first
    /// — from the template, if one is set — when it doesn't exist yet.
    @discardableResult
    func openDailyNote(for date: Date = .now, inNewTab: Bool = false) -> URL? {
        let settings = dailyNoteSettings
        let path = DailyNotes.path(for: date, folder: settings.folder, format: settings.format)
        let url = url(forRelativePath: path)
        var warning: String?
        if !FileManager.default.fileExists(atPath: url.path) {
            let title = url.deletingPathExtension().lastPathComponent
            var text = ""
            let template = settings.template.trimmingCharacters(in: .whitespaces)
            if !template.isEmpty {
                if let templateURL = templateURL(for: template), let data = try? CloudFiles.read(templateURL) {
                    text = DailyNotes.render(template: String(decoding: data, as: UTF8.self), date: date, title: title, dateFormat: settings.format)
                } else {
                    warning = "The daily note template “\(template)” wasn’t found, so the note was created empty."
                }
            }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try CloudFiles.write(Data(text.utf8), to: url, options: .withoutOverwriting)
            } catch {
                errorMessage = "Couldn’t create today’s note: \(error.localizedDescription)"
                return nil
            }
            reload()
        }
        open(url, inNewTab: inNewTab)
        editor.focus()
        // After opening, which clears earlier errors.
        if let warning { errorMessage = warning }
        return url.standardizedFileURL
    }

    /// Opens the nearest existing daily note before (-1) or after (+1) the
    /// open one — or today, if the open note isn't a daily note.
    func openAdjacentDailyNote(_ direction: Int) {
        let settings = dailyNoteSettings
        let dated = allNotes.compactMap { url -> (date: Date, url: URL)? in
            DailyNotes.date(ofPath: relativePath(of: url), folder: settings.folder, format: settings.format).map { ($0, url) }
        }
        .sorted { $0.date < $1.date }
        let reference = document.flatMap {
            DailyNotes.date(ofPath: relativePath(of: $0.url), folder: settings.folder, format: settings.format)
        } ?? Calendar(identifier: .gregorian).startOfDay(for: .now)
        let target = direction < 0 ? dated.last { $0.date < reference } : dated.first { $0.date > reference }
        if let target {
            open(target.url)
        } else {
            NSSound.beep()
        }
    }

    /// A template given as a vault path ("Templates/Daily.md", extension
    /// optional) or just a note name.
    private func templateURL(for template: String) -> URL? {
        for candidate in [template, template + ".md"] {
            let url = url(forRelativePath: Attachments.normalize(candidate))
            if FileManager.default.fileExists(atPath: url.path), contains(url) { return url }
        }
        return resolveLink(template)
    }

    // MARK: - Naming notes from their first line

    /// Notes still being named from their first line (by document identity,
    /// since the URL changes with each rename).
    @ObservationIgnored private var autoTitled: Set<ObjectIdentifier> = []
    @ObservationIgnored private var autoTitleTasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    /// Overrides the setting for this vault (used by tests).
    @ObservationIgnored var namesFromFirstLineOverride: Bool?

    private var namesFromFirstLine: Bool {
        namesFromFirstLineOverride ?? AppSettings.shared.nameNotesFromFirstLine
    }

    /// "Untitled", "Untitled 2", … — placeholder names safe to replace.
    nonisolated static func isPlaceholderName(_ url: URL) -> Bool {
        url.deletingPathExtension().lastPathComponent.range(of: #"^Untitled( \d+)?$"#, options: .regularExpression) != nil
    }

    /// A file name from a note's first line: properties skipped, markdown
    /// and characters that can't be in file names removed, at most ~80
    /// characters (cut at a word). Nil if there's no usable text yet.
    nonisolated static func title(fromContent text: String) -> String? {
        var lines = text.components(separatedBy: "\n")[...]
        if lines.first?.trimmingCharacters(in: .whitespaces) == "---",
           let close = lines.dropFirst().firstIndex(where: { ["---", "..."].contains($0.trimmingCharacters(in: .whitespaces)) }) {
            lines = lines[(close + 1)...]
        }
        guard let first = lines.first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return nil }
        var title = first.trimmingCharacters(in: .whitespaces)
        title = title.replacing(/^(#{1,6}\s+|>\s*|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/, with: "")
        title = NoteParser.plainText(title)
        title = title.replacing(/\s\^[A-Za-z0-9-]+$/, with: "") // block id
        title = String(title.unicodeScalars.filter { !"/\\:*?\"<>|[]#^".unicodeScalars.contains($0) && !CharacterSet.controlCharacters.contains($0) })
        title = title.replacing(/\s+/, with: " ").trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ".")))
        if title.count > 80 {
            let cut = title.prefix(80)
            title = String(cut.lastIndex(of: " ").map { cut[..<$0] } ?? cut).trimmingCharacters(in: .whitespaces)
        }
        return title.isEmpty ? nil : title
    }

    private func scheduleAutoTitle(for document: NoteDocument) {
        let id = ObjectIdentifier(document)
        guard autoTitled.contains(id) else { return }
        autoTitleTasks[id]?.cancel()
        autoTitleTasks[id] = Task { [weak self, weak document] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self, let document else { return }
            self.applyAutoTitle(to: document)
        }
    }

    /// Renames a note to match its first line, if it's still being named.
    func applyAutoTitle(to document: NoteDocument) {
        let id = ObjectIdentifier(document)
        autoTitleTasks[id]?.cancel()
        autoTitleTasks[id] = nil
        guard namesFromFirstLine, autoTitled.contains(id),
              let title = Self.title(fromContent: document.text) else { return }
        let current = document.url.deletingPathExtension().lastPathComponent
        guard title != current else { return }
        let folder = document.url.deletingLastPathComponent()
        var target = folder.appendingPathComponent(title).appendingPathExtension(document.url.pathExtension)
        // Only number the name if it belongs to a different file.
        if FileManager.default.fileExists(atPath: target.path), target.path.lowercased() != document.url.path.lowercased() {
            target = Self.uniqueURL(named: title, extension: document.url.pathExtension, in: folder)
            if target.deletingPathExtension().lastPathComponent == current { return }
        }
        try? performMove(document.url, to: target)
    }

    /// Finishes naming any note that's no longer open in the active tab.
    private func finishAutoTitles(except active: NoteDocument?) {
        // Iterates a copy, so renaming (which re-keys `documents`) is safe.
        for document in documents.values where document !== active && autoTitled.contains(ObjectIdentifier(document)) {
            applyAutoTitle(to: document)
            autoTitled.remove(ObjectIdentifier(document))
        }
    }

    // MARK: - Templates

    enum TemplatePickerMode: Equatable {
        /// Insert a template into the open note.
        case insert
        /// Create a new note from a template.
        case newNote
    }

    /// The template picker, when it's open.
    var templatePicker: TemplatePickerMode?

    /// Overrides the templates folder setting for this vault (used by tests).
    @ObservationIgnored var templatesFolderOverride: String?

    var templatesFolder: String {
        Attachments.normalize(templatesFolderOverride ?? AppSettings.shared.templatesFolder)
    }

    /// Notes in the templates folder (and its subfolders), by name.
    var templates: [URL] {
        let folder = templatesFolder
        guard !folder.isEmpty else { return [] }
        return allNotes
            .filter { relativePath(of: $0).hasPrefix(folder + "/") }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    private func renderTemplate(_ url: URL, title: String) -> Templates.Rendered? {
        guard let data = try? CloudFiles.read(url) else {
            errorMessage = "Couldn’t read the template “\(url.deletingPathExtension().lastPathComponent)”."
            return nil
        }
        return Templates.render(String(decoding: data, as: UTF8.self), title: title, dateFormat: dailyNoteSettings.format)
    }

    /// Inserts a template into the open note at the cursor, merging its
    /// properties into the note's.
    func insertTemplate(_ url: URL) {
        guard let document, let rendered = renderTemplate(url, title: document.title) else { return }
        editor.applyTemplate(frontmatter: rendered.frontmatter, body: rendered.body)
    }

    /// Creates a note from a template beside the selection (never inside the
    /// templates folder), opens it, and puts the cursor at {{cursor}}.
    @discardableResult
    func createNote(fromTemplate template: URL, named rawName: String) -> URL? {
        let name = rawName.replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let title = name.isEmpty ? "Untitled" : name
        var folder = targetFolderForNewItems()
        let templatesRoot = templatesFolder
        if !templatesRoot.isEmpty, (relativePath(of: folder) + "/").hasPrefix(templatesRoot + "/") {
            folder = rootURL
        }
        let url = Self.uniqueURL(named: title, extension: "md", in: folder)
        let finalTitle = url.deletingPathExtension().lastPathComponent
        guard let rendered = renderTemplate(template, title: finalTitle) else { return nil }
        let (text, cursor) = Templates.noteText(from: rendered)
        do {
            try CloudFiles.write(Data(text.utf8), to: url, options: .withoutOverwriting)
        } catch {
            errorMessage = "Couldn’t create “\(finalTitle)”: \(error.localizedDescription)"
            return nil
        }
        reload()
        open(url, inNewTab: true)
        if let document {
            // Turn the UTF-16 offset into a line and column for the editor.
            let prefix = String(text.utf16.prefix(cursor)) ?? text
            let line = prefix.components(separatedBy: "\n").count
            let column = (prefix.components(separatedBy: "\n").last ?? "").utf16.count
            editor.reveal(in: document, line: line, range: NSRange(location: column, length: 0))
        }
        editor.focus()
        return url.standardizedFileURL
    }

    // MARK: - Note embeds

    /// The note an `![[embed]]` shows: its title, vault path and current text
    /// (including unsaved edits if it's open). Nil if no such note exists.
    func embedContent(target rawTarget: String) -> [String: Any]? {
        guard let url = resolver.resolve(wikiTarget: rawTarget).map(url(forRelativePath:))?.standardizedFileURL else { return nil }
        let text: String
        if let document = documents[url] {
            text = document.text
        } else if let data = try? CloudFiles.read(url) {
            text = String(decoding: data, as: UTF8.self)
        } else {
            return nil
        }
        return ["title": url.deletingPathExtension().lastPathComponent, "path": relativePath(of: url), "text": text]
    }

    // MARK: - Autocomplete

    /// What the editor needs to suggest [[links]], #headings, embeds and #tags.
    func completionData() -> [String: Any] {
        let recentRank = Dictionary(recentNotes.prefix(10).enumerated().map { ($1, 10 - $0) }, uniquingKeysWith: { first, _ in first })
        let notes: [[String: Any]] = allNotes.map { url in
            let path = relativePath(of: url)
            let info = index.info(for: path)
            return [
                "path": path,
                "title": url.deletingPathExtension().lastPathComponent,
                "aliases": info?.aliases ?? [],
                "headings": (info?.headings ?? []).map { ["text": $0.text, "level": $0.level] },
                "recent": recentRank[path] ?? 0,
            ]
        }
        let tags = index.allTags().map { ["tag": $0.tag, "count": $0.count] as [String: Any] }
        return ["notes": notes, "attachments": attachments, "tags": tags]
    }

    // MARK: - Recent notes & quick open

    private var recentNotesKey: String { "recentNotes:" + rootURL.path }

    private func rememberRecent(_ path: String) {
        recentNotes.removeAll { $0 == path }
        recentNotes.insert(path, at: 0)
        recentNotes = Array(recentNotes.prefix(30))
        defaults.set(recentNotes, forKey: recentNotesKey)
    }

    func showQuickOpen(query: String = "") {
        quickOpenQuery = query
    }

    /// Switches the sidebar to search and focuses the field, optionally
    /// starting a search.
    func showSearch(for text: String? = nil) {
        sidebarMode = .search
        if let text { search.text = text }
        search.requestFocus()
    }

    /// Opens a search result and selects the match in the editor.
    func reveal(_ match: VaultSearch.LineMatch, in path: String, range: NSRange? = nil) {
        let url = url(forRelativePath: path)
        open(url)
        guard let document = documents[url.standardizedFileURL] else { return }
        let selection = range ?? match.ranges.first ?? NSRange(location: 0, length: 0)
        editor.reveal(in: document, line: match.line, range: selection)
    }

    /// Creates a note named `name` at the vault root (or under the selected
    /// folder) and opens it. Used by quick open's "Create note" row.
    func createNote(named name: String) {
        let cleaned = name.replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty else { return }
        openLink(cleaned)
    }

    /// Creates an empty note named "Untitled" (numbered if taken) in the
    /// selected folder, or beside the selected note, or at the vault root.
    @discardableResult
    func createNote() -> URL? {
        let folder = targetFolderForNewItems()
        let url = Self.uniqueURL(named: "Untitled", extension: "md", in: folder)
        do {
            try CloudFiles.write(Data(), to: url, options: .withoutOverwriting)
        } catch {
            errorMessage = "Couldn’t create a note: \(error.localizedDescription)"
            return nil
        }
        reload()
        open(url, inNewTab: true)
        editor.focus()
        return url
    }

    private func targetFolderForNewItems() -> URL {
        guard let selection else { return rootURL }
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: selection.path, isDirectory: &isDirectory), isDirectory.boolValue {
            return selection
        }
        return selection.deletingLastPathComponent()
    }

    static func uniqueURL(named base: String, extension ext: String, in folder: URL) -> URL {
        let fileManager = FileManager.default
        var candidate = folder.appendingPathComponent(base).appendingPathExtension(ext)
        var counter = 2
        while fileManager.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent("\(base) \(counter)").appendingPathExtension(ext)
            counter += 1
        }
        namedByHolocron.insert(candidate.standardizedFileURL.path)
        return candidate
    }

    /// Files Holocron named or moved to this session, so its own "Kyber 2"
    /// isn't mistaken for an iCloud duplicate.
    static var namedByHolocron: Set<String> = []
}
