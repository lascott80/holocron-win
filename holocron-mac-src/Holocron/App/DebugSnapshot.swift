#if DEBUG
import AppKit
import SwiftUI
import WebKit

/// Debug builds only: launch with `-HolocronSnapshot /path/to/file.png` and the
/// app writes a PNG of its main window shortly after launch. Lets automated
/// checks see the UI without Screen Recording permission.
enum DebugSnapshot {
    static func scheduleIfRequested() {
        guard let path = UserDefaults.standard.string(forKey: "HolocronSnapshot") else { return }
        let delay = UserDefaults.standard.double(forKey: "HolocronSnapshotDelay")
        DispatchQueue.main.asyncAfter(deadline: .now() + (delay > 0 ? delay : 2)) {
            capture(to: URL(fileURLWithPath: path))
        }
    }

    /// `-HolocronSimulateConflict YES`: once a note is open, makes an
    /// unsaved edit to its first paragraph line and writes a clashing change
    /// to the file, as if another device had edited it. The real folder
    /// watcher then picks it up.
    static func simulateConflictIfRequested(in model: AppModel) {
        guard UserDefaults.standard.bool(forKey: "HolocronSimulateConflict") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard let document = model.vault?.document else { return }
            var mine = TextMerge.lines(document.text).map(String.init)
            var theirs = mine
            guard let index = mine.firstIndex(where: { !$0.hasPrefix("#") && !$0.hasPrefix("-") && $0.count > 20 && !$0.contains(":") }) else { return }
            mine[index] = "Edited here in Holocron: " + mine[index]
            theirs[index] = "Edited on another device: " + theirs[index]
            if let task = theirs.firstIndex(where: { $0.hasPrefix("- [ ]") }) {
                theirs[task] = theirs[task].replacingOccurrences(of: "- [ ]", with: "- [x]")
            }
            document.text = mine.joined()
            try? Data(theirs.joined().utf8).write(to: document.url, options: .atomic)
        }
    }

    /// `-HolocronOpenSettings YES`: opens the Settings window at launch.
    static func openSettingsIfRequested(_ openSettings: OpenSettingsAction) {
        guard UserDefaults.standard.bool(forKey: "HolocronOpenSettings") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            openSettings()
        }
    }

    /// `-HolocronPreviewSidebar YES`: also shows the sidebar in a plain
    /// window. The real sidebar is drawn in system glass that in-app capture
    /// can't see; this window can be captured, so the sidebar's content
    /// (file tree, tags, search results) can be checked.
    static func previewSidebarIfRequested(in model: AppModel) {
        guard UserDefaults.standard.bool(forKey: "HolocronPreviewSidebar") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            guard let vault = model.vault else { return }
            let window = NSWindow(
                contentRect: NSRect(x: 80, y: 80, width: 300, height: 760),
                styleMask: [.titled, .closable], backing: .buffered, defer: false
            )
            window.title = "Sidebar preview (debug)"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SidebarView(vault: vault, model: model).tint(Theme.accent))
            window.orderFront(nil)
            previewWindow = window
        }
    }

    private static var previewWindow: NSWindow?

    /// `-HolocronRename <path>` starts renaming an item in the sidebar;
    /// `-HolocronRequestDelete <path>` asks to move one to the Trash.
    static func fileActionsIfRequested(in model: AppModel) {
        let defaults = UserDefaults.standard
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard let vault = model.vault else { return }
            if let path = defaults.string(forKey: "HolocronRename") {
                let url = vault.url(forRelativePath: path)
                var isDirectory: ObjCBool = false
                FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
                vault.renamingURL = vault.rootURL.appendingPathComponent(path, isDirectory: isDirectory.boolValue).standardizedFileURL
            }
            if let path = defaults.string(forKey: "HolocronRequestDelete") {
                vault.requestDeletion(of: [vault.url(forRelativePath: path)])
            }
        }
    }

    /// `-HolocronTemplatePicker insert|new` opens the template picker.
    static func templatePickerIfRequested(in model: AppModel) {
        guard let mode = UserDefaults.standard.string(forKey: "HolocronTemplatePicker") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            model.vault?.templatePicker = mode == "new" ? .newNote : .insert
        }
    }

    /// `-HolocronSearch <query>`: switches the sidebar to search with a query.
    static func searchIfRequested(in model: AppModel) {
        guard let query = UserDefaults.standard.string(forKey: "HolocronSearch") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            model.vault?.showSearch(for: query)
        }
    }

    /// `-HolocronQuickOpen <query>`: opens quick open with a query at launch.
    static func openQuickOpenIfRequested(in model: AppModel) {
        guard let query = UserDefaults.standard.string(forKey: "HolocronQuickOpen") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            model.vault?.showQuickOpen(query: query)
        }
    }

    /// With `-HolocronSnapshot`, also writes "<name>.editor.json": what the
    /// editor knows for autocomplete (note/attachment/tag counts).
    static func captureEditorState(to url: URL) {
        guard let webView = NSApp.windows.compactMap({ $0.contentView }).flatMap({ subviews(of: $0) }).compactMap({ $0 as? WKWebView }).first else { return }
        // What the web view reports for macOS text substitutions.
        var substitutions: [String] = []
        for name in ["isAutomaticDashSubstitutionEnabled", "isAutomaticQuoteSubstitutionEnabled", "isAutomaticTextReplacementEnabled"] {
            let selector = Selector(name)
            if webView.responds(to: selector) {
                let enabled = (webView.value(forKey: name) as? Bool) ?? false
                substitutions.append("\"\(name)\": \(enabled)")
            } else {
                substitutions.append("\"\(name)\": \"not supported\"")
            }
        }
        webView.evaluateJavaScript("JSON.stringify(window.holocron.vaultDataSummary())") { result, _ in
            let summary = (result as? String ?? "null")
            let json = "{\"vault\": \(summary), " + substitutions.joined(separator: ", ") + "}"
            try? json.write(to: url.deletingPathExtension().appendingPathExtension("editor.json"), atomically: true, encoding: .utf8)
        }
    }

    static func capture(to url: URL) {
        captureEditorState(to: url)
        // The sidebar preview window (when requested) is what we want to see.
        guard let mainWindow = previewWindow ?? NSApp.orderedWindows.first(where: { $0.isVisible && $0.contentView != nil }) else { return }
        let window = mainWindow.attachedSheet ?? mainWindow
        guard let frameView = window.contentView?.superview else { return }
        let bounds = frameView.bounds
        if UserDefaults.standard.bool(forKey: "HolocronDumpViews") {
            var lines: [String] = []
            func walk(_ view: NSView, _ depth: Int) {
                let frame = view.convert(view.bounds, to: frameView)
                lines.append(String(repeating: "  ", count: depth) + "\(type(of: view)) \(Int(frame.minX)),\(Int(frame.minY)) \(Int(frame.width))x\(Int(frame.height))\(view.isHidden ? " hidden" : "")")
                view.subviews.forEach { walk($0, depth + 1) }
            }
            walk(frameView, 0)
            try? lines.joined(separator: "\n").write(to: url.deletingPathExtension().appendingPathExtension("txt"), atomically: true, encoding: .utf8)
        }
        // SwiftUI overlays (like quick open) draw into their own layers, which
        // cacheDisplay skips; render those separately as "<name>-overlay.png".
        if let overlay = subviews(of: frameView).first(where: { String(describing: type(of: $0)) == "_NSGraphicsView" && $0.bounds.width > 100 }),
           let layer = overlay.layer {
            let scale = window.backingScaleFactor
            let size = overlay.bounds.size
            if let context = CGContext(
                data: nil, width: Int(size.width * scale), height: Int(size.height * scale),
                bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) {
                context.scaleBy(x: scale, y: scale)
                if !overlay.isFlipped || layer.isGeometryFlipped == false {
                    context.translateBy(x: 0, y: size.height)
                    context.scaleBy(x: 1, y: -1)
                }
                layer.render(in: context)
                if let image = context.makeImage() {
                    let rep = NSBitmapImageRep(cgImage: image)
                    let overlayURL = url.deletingPathExtension().appendingPathExtension("overlay.png")
                    try? rep.representation(using: .png, properties: [:])?.write(to: overlayURL)
                }
            }
        }
        // Also render the whole window's layer tree as "<name>.layers.png":
        // it includes content drawn inside glass (like the sidebar's rows),
        // which cacheDisplay leaves blank.
        if let layer = frameView.layer {
            let scale = window.backingScaleFactor
            if let context = CGContext(
                data: nil, width: Int(bounds.width * scale), height: Int(bounds.height * scale),
                bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) {
                context.scaleBy(x: scale, y: scale)
                if layer.isGeometryFlipped {
                    context.translateBy(x: 0, y: bounds.height)
                    context.scaleBy(x: 1, y: -1)
                }
                layer.render(in: context)
                if let image = context.makeImage() {
                    let layersURL = url.deletingPathExtension().appendingPathExtension("layers.png")
                    try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: layersURL)
                }
            }
        }
        guard let rep = frameView.bitmapImageRepForCachingDisplay(in: bounds) else { return }
        frameView.cacheDisplay(in: bounds, to: rep)

        // Web views render out of process, so cacheDisplay leaves them blank;
        // snapshot each one and paint it into place.
        let webViews = subviews(of: frameView).compactMap { $0 as? WKWebView }.filter { !$0.isHiddenOrHasHiddenAncestor }
        guard !webViews.isEmpty else { return write(rep, to: url) }

        var remaining = webViews.count
        for webView in webViews {
            webView.takeSnapshot(with: nil) { image, _ in
                if let image {
                    var rect = webView.convert(webView.bounds, to: frameView)
                    if frameView.isFlipped { rect.origin.y = bounds.height - rect.maxY }
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                    image.draw(in: rect)
                    NSGraphicsContext.restoreGraphicsState()
                }
                remaining -= 1
                if remaining == 0 { write(rep, to: url) }
            }
        }
    }

    private static func write(_ rep: NSBitmapImageRep, to url: URL) {
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    private static func subviews(of view: NSView) -> [NSView] {
        view.subviews + view.subviews.flatMap { subviews(of: $0) }
    }
}
#endif
