import Foundation
import Observation

/// The vault search panel's state. Searches run in the background a moment
/// after typing stops, and re-run when notes change.
@Observable
final class SearchModel {
    var text = "" { didSet { if text != oldValue { schedule() } } }
    var matchCase = false { didSet { if matchCase != oldValue { schedule(delay: .zero) } } }
    var useRegex = false { didSet { if useRegex != oldValue { schedule(delay: .zero) } } }

    private(set) var outcome = VaultSearch.Outcome()
    private(set) var isSearching = false
    /// Bumped to ask the search field to take focus.
    private(set) var focusRequest = 0

    @ObservationIgnored private let index: VaultIndex
    @ObservationIgnored private var task: Task<Void, Never>?

    init(index: VaultIndex) {
        self.index = index
    }

    func requestFocus() {
        focusRequest += 1
    }

    /// Runs the current query again (e.g. after notes changed).
    func refresh() {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        schedule(delay: .milliseconds(250))
    }

    private func schedule(delay: Duration = .milliseconds(150)) {
        task?.cancel()
        let query = VaultSearch.parse(text, matchCase: matchCase, useRegex: useRegex)
        guard !query.isEmpty else {
            outcome = VaultSearch.Outcome()
            isSearching = false
            return
        }
        isSearching = true
        let notes = index.searchSnapshot()
        task = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            let outcome = await Task.detached(priority: .userInitiated) {
                VaultSearch.run(query, over: notes)
            }.value
            guard !Task.isCancelled, let self else { return }
            self.outcome = outcome
            self.isSearching = false
        }
    }

    /// Waits for a pending search (for tests).
    func searchFinished() async {
        await task?.value
    }
}
