import AppKit

/// Every enabled item in the menu bar as a palette command, so the command
/// palette always matches the menus without keeping a second list.
enum MenuCommands {
    /// Menus not worth offering (system-provided or not commands).
    private static let skippedMenus: Set<String> = ["Services", "Open Recent", "Open Recent Vault"]

    static func all() -> [QuickCommand] {
        guard let mainMenu = NSApp.mainMenu else { return [] }
        var commands: [QuickCommand] = []
        var seen = Set<String>()
        for top in mainMenu.items {
            guard let menu = top.submenu else { continue }
            collect(menu, path: top.title, into: &commands, seen: &seen)
        }
        return commands
    }

    private static func collect(_ menu: NSMenu, path: String, into commands: inout [QuickCommand], seen: inout Set<String>) {
        menu.update() // let items validate, so disabled ones are skipped
        for item in menu.items where !item.isSeparatorItem && !item.isHidden && !item.title.isEmpty {
            if let submenu = item.submenu {
                if !skippedMenus.contains(item.title) {
                    collect(submenu, path: item.title, into: &commands, seen: &seen)
                }
                continue
            }
            guard item.isEnabled, item.action != nil else { continue }
            let title = item.title
            guard seen.insert(title.lowercased()).inserted else { continue }
            commands.append(QuickCommand(
                id: "menu:\(path)/\(title)",
                title: title,
                systemImage: item.state == .on ? "checkmark" : "command",
                shortcut: shortcut(for: item)
            ) { [weak menu, weak item] in
                guard let menu, let item else { return }
                let index = menu.index(of: item)
                guard index >= 0 else { return }
                // After the palette has closed and focus is back in the window.
                DispatchQueue.main.async { menu.performActionForItem(at: index) }
            })
        }
    }

    /// The item's shortcut as shown in menus, e.g. "⇧⌘E".
    static func shortcut(for item: NSMenuItem) -> String? {
        let key = item.keyEquivalent
        guard !key.isEmpty else { return nil }
        let flags = item.keyEquivalentModifierMask
        var text = ""
        if flags.contains(.control) { text += "⌃" }
        if flags.contains(.option) { text += "⌥" }
        // An uppercase letter implies Shift.
        if flags.contains(.shift) || (key.count == 1 && key != key.lowercased()) { text += "⇧" }
        if flags.contains(.command) { text += "⌘" }
        return text + keyName(key)
    }

    private static func keyName(_ key: String) -> String {
        switch key.unicodeScalars.first.map({ Int($0.value) }) {
        case NSLeftArrowFunctionKey: "←"
        case NSRightArrowFunctionKey: "→"
        case NSUpArrowFunctionKey: "↑"
        case NSDownArrowFunctionKey: "↓"
        case 0x09: "⇥"
        case 0x0D, 0x03: "↩"
        case 0x08, 0x7F: "⌫"
        case 0x1B: "⎋"
        case 0x20: "Space"
        default: key.uppercased()
        }
    }
}
