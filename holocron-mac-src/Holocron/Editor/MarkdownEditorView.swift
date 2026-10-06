import SwiftUI
import WebKit

/// Hosts the shared editor web view and keeps it showing `document`.
struct MarkdownEditorView: NSViewRepresentable {
    let controller: EditorController
    let document: NoteDocument

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        let webView = controller.webView
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        controller.show(document)
        return container
    }

    func updateNSView(_ container: NSView, context: Context) {
        controller.show(document)
    }
}
