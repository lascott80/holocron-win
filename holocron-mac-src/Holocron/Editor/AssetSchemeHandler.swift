import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves vault images to the editor at `holocron-asset://<kind>/<target>?from=<note>`.
/// The editor page can't read the vault folder directly; this only hands
/// out image files that resolve to somewhere inside the open vault.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "holocron-asset"

    /// Maps (kind, target, linking note) to a file in the vault, or nil.
    var resolve: ((_ kind: String, _ target: String, _ fromNote: URL?) -> URL?)?

    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url,
              let kind = url.host(),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return fail(task)
        }
        let target = String(url.path(percentEncoded: false).drop { $0 == "/" })
        let from = components.queryItems?.first { $0.name == "from" }?.value
            .flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }

        guard let file = resolve?(kind, target, from), Attachments.isImage(file.path) else {
            return fail(task)
        }
        let id = ObjectIdentifier(task)
        Task {
            // Read off the main thread; answer the task back on it.
            let data = await Task.detached(priority: .userInitiated) {
                try? Data(contentsOf: file, options: .mappedIfSafe)
            }.value
            if stopped.remove(id) != nil { return }
            guard let data else { return fail(task) }
            let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
            task.didReceive(data)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func fail(_ task: any WKURLSchemeTask) {
        task.didFailWithError(URLError(.fileDoesNotExist))
    }
}
