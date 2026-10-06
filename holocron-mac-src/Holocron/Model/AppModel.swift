import AppKit
import Observation

/// App-wide state: which vault is open and the recent-vaults list.
@Observable
final class AppModel {
    private(set) var vault: Vault?
    private(set) var recentVaults: [URL] = []
    var errorMessage: String?

    @ObservationIgnored private let defaults: UserDefaults

    private enum Keys {
        static let recentVaults = "recentVaultPaths"
    }

    private static let maxRecents = 8

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        recentVaults = (defaults.stringArray(forKey: Keys.recentVaults) ?? [])
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
            .filter { Self.folderExists($0) }

        if AppSettings.shared.reopenLastVault, let last = recentVaults.first {
            openVault(at: last)
            if AppSettings.shared.openDailyNoteOnLaunch {
                vault?.openDailyNote()
            }
        }

        #if DEBUG
        // `-HolocronOpenNote <path relative to vault>` opens a note at launch.
        if let note = defaults.string(forKey: "HolocronOpenNote"), let vault {
            vault.selection = vault.rootURL.appendingPathComponent(note)
        }
        #endif
    }

    func openVault(at url: URL) {
        guard Self.folderExists(url) else {
            errorMessage = "The folder “\(url.lastPathComponent)” no longer exists."
            forget(url)
            return
        }
        vault?.close()
        vault = Vault(rootURL: url)
        remember(url)
    }

    func closeVault() {
        vault?.close()
        vault = nil
    }

    func saveAll() {
        vault?.saveCurrent()
    }

    /// Undo goes to the markdown editor when it has focus (it keeps its own
    /// history), otherwise to whatever native control does.
    func undo() {
        if let editor = vault?.editor, editor.hasFocus {
            editor.run("undo")
        } else {
            NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
        }
    }

    func redo() {
        if let editor = vault?.editor, editor.hasFocus {
            editor.run("redo")
        } else {
            NSApp.sendAction(Selector(("redo:")), to: nil, from: nil)
        }
    }

    func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.title = "Open Folder as Vault"
        panel.prompt = "Open Vault"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            openVault(at: url)
        }
    }

    func presentCreatePanel() {
        let panel = NSSavePanel()
        panel.title = "Create New Vault"
        panel.prompt = "Create Vault"
        panel.nameFieldLabel = "Vault name:"
        panel.nameFieldStringValue = "My Vault"
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            let guide = try? StarterGuide.install(in: url)
            openVault(at: url)
            if let guide { vault?.open(guide) }
        } catch {
            errorMessage = "Couldn’t create the vault: \(error.localizedDescription)"
        }
    }

    /// Adds the Start Here guide to the open vault and shows it.
    func addStarterGuide() {
        guard let vault else { return }
        do {
            let guide = try StarterGuide.install(in: vault.rootURL)
            vault.reload()
            vault.open(guide, inNewTab: vault.document != nil)
        } catch {
            errorMessage = "Couldn’t add the guide: \(error.localizedDescription)"
        }
    }

    func forget(_ url: URL) {
        recentVaults.removeAll { $0.standardizedFileURL == url.standardizedFileURL }
        persistRecents()
    }

    private func remember(_ url: URL) {
        let url = url.standardizedFileURL
        recentVaults.removeAll { $0.standardizedFileURL == url }
        recentVaults.insert(url, at: 0)
        recentVaults = Array(recentVaults.prefix(Self.maxRecents))
        persistRecents()
    }

    private func persistRecents() {
        defaults.set(recentVaults.map(\.path), forKey: Keys.recentVaults)
    }

    private static func folderExists(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }
}
