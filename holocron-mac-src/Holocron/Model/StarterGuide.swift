import Foundation

/// The "Start Here" guide: two small notes bundled with the app that show
/// off links, embeds, tasks, tables and shortcuts. New vaults get them, and
/// Help › Add Start Here Guide adds them to any vault.
enum StarterGuide {
    static let notes = ["Start Here", "Linked Note"]

    /// Copies the guide into `folder`, skipping notes that already exist.
    /// Returns the "Start Here" note's URL.
    @discardableResult
    static func install(in folder: URL, bundle: Bundle = .main, today: Date = .now) throws -> URL {
        let date = today.formatted(.iso8601.year().month().day())
        for name in notes {
            let target = folder.appendingPathComponent(name).appendingPathExtension("md")
            guard !FileManager.default.fileExists(atPath: target.path) else { continue }
            guard let source = bundle.url(forResource: name, withExtension: "md") else {
                throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "\(name).md"])
            }
            let text = try String(contentsOf: source, encoding: .utf8).replacingOccurrences(of: "{{date}}", with: date)
            try Data(text.utf8).write(to: target, options: .atomic)
        }
        return folder.appendingPathComponent("Start Here.md")
    }
}
