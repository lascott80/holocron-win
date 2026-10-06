import Foundation

/// One editor tab: the note it shows plus its back/forward history.
/// An empty tab (no note yet) has an empty history.
nonisolated struct EditorTab: Identifiable, Equatable, Sendable {
    let id: UUID
    private(set) var history: [URL]
    private(set) var historyIndex: Int

    init(url: URL? = nil) {
        id = UUID()
        history = url.map { [$0] } ?? []
        historyIndex = url == nil ? -1 : 0
    }

    var url: URL? { history.indices.contains(historyIndex) ? history[historyIndex] : nil }
    var canGoBack: Bool { historyIndex > 0 }
    var canGoForward: Bool { historyIndex < history.count - 1 }

    /// Rewrites history entries after files were renamed or moved.
    mutating func remap(_ transform: (URL) -> URL) {
        history = history.map(transform)
    }

    /// Shows `url`, dropping any forward history (like a browser).
    mutating func navigate(to url: URL) {
        guard url != self.url else { return }
        history = Array(history.prefix(historyIndex + 1)) + [url]
        historyIndex = history.count - 1
        if history.count > 100 {
            history.removeFirst(history.count - 100)
            historyIndex = history.count - 1
        }
    }

    /// Moves through history; returns the URL to show, or nil if there's
    /// nowhere to go. Entries for notes that no longer exist are skipped.
    mutating func goBack(skipping missing: (URL) -> Bool) -> URL? {
        var index = historyIndex - 1
        while index >= 0, missing(history[index]) { index -= 1 }
        guard index >= 0 else { return nil }
        historyIndex = index
        return history[index]
    }

    mutating func goForward(skipping missing: (URL) -> Bool) -> URL? {
        var index = historyIndex + 1
        while index < history.count, missing(history[index]) { index += 1 }
        guard index < history.count else { return nil }
        historyIndex = index
        return history[index]
    }
}
