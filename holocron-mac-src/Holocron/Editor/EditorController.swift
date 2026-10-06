import AppKit
import Observation
import WebKit

/// Owns the editor web view (CodeMirror running in WKWebView) and bridges it
/// to Swift: pushes notes in, receives edits, cursor moves and link clicks.
@Observable
final class EditorController: NSObject {
    private(set) var isReady = false
    private(set) var cursorLine = 1
    private(set) var cursorColumn = 1
    /// Words and characters in the selection (0 when nothing is selected).
    private(set) var selectedWords = 0
    private(set) var selectedCharacters = 0

    /// Called when a [[wikilink]] is clicked, with the link target and
    /// whether to open it in a new tab (⌘-click).
    @ObservationIgnored var onOpenLink: ((String, Bool) -> Void)?
    /// Called when a #tag is clicked, with the tag without "#".
    @ObservationIgnored var onOpenTag: ((String) -> Void)?
    /// Saves pasted image data; returns the text to insert, or nil on failure.
    @ObservationIgnored var onPasteImage: ((Data, _ mimeType: String) -> String?)?
    /// Supplies an embedded note's content (or nil if it doesn't exist).
    @ObservationIgnored var onEmbedRequest: ((String) -> [String: Any]?)?
    /// Adds files dropped from Finder; returns the text to insert for each.
    @ObservationIgnored var onDropFiles: (([URL]) -> [String])?
    /// Serves vault images to the editor.
    @ObservationIgnored let assets = AssetSchemeHandler()

    @ObservationIgnored private var webViewStorage: WKWebView?
    @ObservationIgnored private weak var document: NoteDocument?
    @ObservationIgnored private var focusWhenReady = false
    @ObservationIgnored private var appearance: (vars: [String: String], isDark: Bool)?
    @ObservationIgnored private var mode: AppSettings.EditorMode = .livePreview
    @ObservationIgnored private var focusMode = false
    @ObservationIgnored private var vaultData: [String: Any]?
    @ObservationIgnored private var vaultDataTask: Task<Void, Never>?
    /// A selection to make once a note has been sent to the editor.
    @ObservationIgnored private var pendingReveal: (id: String, line: Int, range: NSRange)?

    /// The editor's web view, created on first use.
    var webView: WKWebView {
        if let webViewStorage { return webViewStorage }
        let webView = makeWebView()
        webViewStorage = webView
        return webView
    }

    /// True when keyboard focus is inside the editor.
    var hasFocus: Bool {
        guard let webViewStorage, let responder = webViewStorage.window?.firstResponder as? NSView else { return false }
        return responder === webViewStorage || responder.isDescendant(of: webViewStorage)
    }

    /// Shows `document` in the editor (no-op if it's already showing).
    func show(_ document: NoteDocument) {
        guard document !== self.document else { return }
        self.document?.onExternalTextChange = nil
        self.document = document
        document.onExternalTextChange = { [weak self, weak document] old, new in
            guard let self, let document, document === self.document, self.isReady else { return }
            self.applyExternalChange(from: old, to: new, id: document.url.path)
        }
        if isReady { send(document) }
    }

    /// Updates the notes, attachments and tags used for autocomplete.
    /// Coalesced, since the index changes often while typing.
    func setVaultData(_ makeData: @escaping () -> [String: Any]) {
        vaultDataTask?.cancel()
        vaultDataTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, !Task.isCancelled else { return }
            self.vaultData = makeData()
            if self.isReady { self.sendVaultData() }
        }
    }

    private func sendVaultData() {
        guard let vaultData else { return }
        webView.callAsyncJavaScript(
            "window.holocron.setVaultData(data)",
            arguments: ["data": vaultData],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Applies the theme's colours and the editor font settings.
    func applyAppearance(isDark: Bool, settings: AppSettings = .shared) {
        let vars = Theme.cssVariables(isDark: isDark, settings: settings)
        if let appearance, appearance.vars == vars, appearance.isDark == isDark { return }
        appearance = (vars, isDark)
        if isReady { sendAppearance() }
    }

    private func sendAppearance() {
        guard let appearance else { return }
        webView.callAsyncJavaScript(
            "window.holocron.setAppearance(vars, mode)",
            arguments: ["vars": appearance.vars, "mode": appearance.isDark ? "dark" : "light"],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Shows notes in live preview, source mode or reading view.
    func setMode(_ mode: AppSettings.EditorMode) {
        guard mode != self.mode else { return }
        self.mode = mode
        if isReady { sendMode() }
    }

    private func sendMode() {
        webView.callAsyncJavaScript(
            "window.holocron.setMode(mode); window.holocron.setFocusMode(focus)",
            arguments: ["mode": mode.editorName, "focus": focusMode],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Dims all but the current paragraph and keeps the cursor centred.
    func setFocusMode(_ on: Bool) {
        guard on != focusMode else { return }
        focusMode = on
        if isReady { sendMode() }
    }

    /// Selects `range` (UTF-16, within the line) on a 1-based line of
    /// `document` and scrolls it into view — after the note is showing.
    func reveal(in document: NoteDocument, line: Int, range: NSRange) {
        pendingReveal = (document.url.path, line, range)
        if isReady, document === self.document { flushReveal() }
    }

    private func flushReveal() {
        guard let reveal = pendingReveal, reveal.id == document?.url.path, isReady else { return }
        pendingReveal = nil
        webView.callAsyncJavaScript(
            "window.holocron.selectInLine(line, from, to)",
            arguments: ["line": reveal.line, "from": reveal.range.location, "to": reveal.range.location + reveal.range.length],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    func focus() {
        guard isReady, let webViewStorage else {
            focusWhenReady = true
            return
        }
        webViewStorage.window?.makeFirstResponder(webViewStorage)
        evaluate("window.holocron.focus()")
    }

    /// Inserts a rendered template at the cursor, merging its properties.
    func applyTemplate(frontmatter: String?, body: String) {
        guard isReady else { return }
        webViewStorage?.window?.makeFirstResponder(webViewStorage)
        webView.callAsyncJavaScript(
            "window.holocron.applyTemplate(frontmatter, body)",
            arguments: ["frontmatter": frontmatter ?? "", "body": body],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Tells the editor its note's file moved, so edits keep flowing to it.
    func documentDidMove(_ document: NoteDocument, from oldURL: URL) {
        guard isReady else { return }
        webView.callAsyncJavaScript(
            "window.holocron.renameDocument(oldId, newId)",
            arguments: ["oldId": oldURL.path, "newId": document.url.path],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Moves the cursor to a 1-based line and scrolls it into view.
    func scrollToLine(_ line: Int) {
        guard isReady, let webViewStorage else { return }
        webViewStorage.window?.makeFirstResponder(webViewStorage)
        webViewStorage.callAsyncJavaScript(
            "window.holocron.scrollToLine(line)",
            arguments: ["line": line],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Inserts a table with `rows` empty body rows and `columns` columns.
    func insertTable(rows: Int, columns: Int) {
        guard isReady else { return }
        webViewStorage?.window?.makeFirstResponder(webViewStorage)
        webView.callAsyncJavaScript(
            "window.holocron.insertTable(rows, columns)",
            arguments: ["rows": rows, "columns": columns],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    /// Runs a named editor command (see `commands` in Editor/src/main.js).
    func run(_ command: String) {
        guard isReady else { return }
        webViewStorage?.window?.makeFirstResponder(webViewStorage)
        webView.callAsyncJavaScript(
            "window.holocron.run(name)",
            arguments: ["name": command],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    // MARK: - Private

    private func makeWebView() -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(WeakScriptMessageHandler(self), name: "holocron")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(assets, forURLScheme: AssetSchemeHandler.scheme)

        let webView = EditorWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.onDropFiles = { [weak self, weak webView] urls, point in
            guard let self, let webView, let texts = self.onDropFiles?(urls), !texts.isEmpty else { return }
            webView.callAsyncJavaScript(
                "window.holocron.insertAtPoint(x, y, text)",
                arguments: ["x": point.x, "y": point.y, "text": texts.joined(separator: "\n") + "\n"],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = Theme.AppKit.editorBackground
        webView.isHidden = true // revealed once CodeMirror reports ready
        #if DEBUG
        webView.isInspectable = true
        #endif

        if let page = Bundle.main.url(forResource: "editor", withExtension: "html") {
            webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        } else {
            assertionFailure("editor.html missing from the app bundle")
        }
        return webView
    }

    private func send(_ document: NoteDocument) {
        webView.callAsyncJavaScript(
            "window.holocron.setDocument(text, id)",
            arguments: ["text": document.text, "id": document.url.path],
            in: nil,
            in: .page,
            completionHandler: nil
        )
        flushReveal()
    }

    /// Applies a reload or merge to the editor as line edits.
    private func applyExternalChange(from old: String, to new: String, id: String) {
        let edits = TextMerge.edits(from: old, to: new).map {
            ["from": $0.from, "to": $0.to, "insert": $0.insert] as [String: Any]
        }
        webView.callAsyncJavaScript(
            "window.holocron.applyExternalEdits(edits, text, id)",
            arguments: ["edits": edits, "text": new, "id": id],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    private func evaluate(_ script: String) {
        webViewStorage?.evaluateJavaScript(script, completionHandler: nil)
    }

    fileprivate func handle(_ body: [String: Any]) {
        switch body["type"] as? String {
        case "ready":
            isReady = true
            sendAppearance()
            sendMode()
            sendVaultData()
            webViewStorage?.isHidden = false
            if let document { send(document) }
            if focusWhenReady {
                focusWhenReady = false
                focus()
            }

        case "change":
            guard let document,
                  body["id"] as? String == document.url.path,
                  let text = body["text"] as? String else { return }
            document.text = text

        case "selection":
            guard body["id"] as? String == document?.url.path else { return }
            cursorLine = body["line"] as? Int ?? 1
            cursorColumn = body["column"] as? Int ?? 1
            selectedWords = body["selectedWords"] as? Int ?? 0
            selectedCharacters = body["selectedCharacters"] as? Int ?? 0

        case "openLink":
            if let target = body["target"] as? String { onOpenLink?(target, body["newTab"] as? Bool ?? false) }

        case "pasteImage":
            guard let base64 = body["data"] as? String,
                  let data = Data(base64Encoded: base64),
                  let text = onPasteImage?(data, body["mime"] as? String ?? "image/png") else { return }
            webView.callAsyncJavaScript(
                "window.holocron.insertAtCursor(text)",
                arguments: ["text": text],
                in: nil,
                in: .page,
                completionHandler: nil
            )

        case "embed":
            guard let id = body["id"] as? Int, let target = body["target"] as? String else { return }
            let result: Any = onEmbedRequest?(target) ?? NSNull()
            webView.callAsyncJavaScript(
                "window.holocron.resolveEmbed(id, result)",
                arguments: ["id": id, "result": result],
                in: nil,
                in: .page,
                completionHandler: nil
            )

        case "copy":
            if let text = body["text"] as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }

        case "openTag":
            if let tag = body["tag"] as? String { onOpenTag?(tag) }

        case "openURL":
            if let string = body["url"] as? String,
               let url = URL(string: string),
               let scheme = url.scheme?.lowercased(),
               ["http", "https", "mailto"].contains(scheme) {
                NSWorkspace.shared.open(url)
            }

        default:
            break
        }
    }
}

// MARK: - Navigation

extension EditorController: WKNavigationDelegate {
    /// The editor page must never be replaced: only its own initial load is
    /// allowed. Web links open in the browser; anything else is ignored.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if url.isFileURL, url.lastPathComponent == "editor.html", !isReady { return .allow }
        if action.navigationType == .linkActivated, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) {
            NSWorkspace.shared.open(url)
        }
        return .cancel
    }
}

/// The editor's web view. Handles files dragged in from Finder itself (so
/// it knows their paths and can link files already in the vault instead of
/// copying them); everything else goes to the editor as usual.
final class EditorWebView: WKWebView {
    /// Called with dropped file URLs and the drop point in page coordinates.
    var onDropFiles: (([URL], CGPoint) -> Void)?

    private func fileURLs(_ info: any NSDraggingInfo) -> [URL] {
        info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingUpdated(sender) : .copy
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        guard !urls.isEmpty, let onDropFiles else { return super.performDragOperation(sender) }
        // WKWebView is flipped, so view coordinates match the page's.
        let point = convert(sender.draggingLocation, from: nil)
        onDropFiles(urls, point)
        return true
    }
}

/// Forwards script messages without the content controller retaining the
/// editor controller (which would leak it).
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: EditorController?

    init(_ target: EditorController) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        target?.handle(body)
    }
}
