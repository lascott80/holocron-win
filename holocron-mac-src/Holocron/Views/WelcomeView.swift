import SwiftUI

/// Shown when no vault is open: open or create a vault, or pick a recent one.
struct WelcomeView: View {
    @Bindable var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            brandPanel
            Divider().overlay(Theme.border)
            actionsPanel
        }
        .frame(minWidth: 820, minHeight: 560)
        .background(Theme.editorBackground)
    }

    private var brandPanel: some View {
        VStack(spacing: 14) {
            HolocronMark(lineWidth: 2.5, glowing: true)
                .frame(width: 96, height: 96)
            Text("Holocron")
                .font(.system(size: 28, weight: .bold))
                .tracking(5.6)
                .textCase(.uppercase)
                .foregroundStyle(Theme.text)
                .padding(.top, 8)
            Text("Version \(Bundle.main.shortVersion)")
                .foregroundStyle(Theme.secondaryText)
            Text("Your notes stay plain .md files in folders you choose. No database, no lock-in.")
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: 260)
                .padding(.top, 8)
        }
        .padding(40)
        .frame(width: 380)
        .frame(maxHeight: .infinity)
        .background(Theme.panelBackground)
    }

    private var actionsPanel: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(spacing: 8) {
                WelcomeActionButton(
                    title: "Open Folder as Vault…",
                    subtitle: "Dropbox, iCloud Drive, Syncthing, a Git repo — anywhere",
                    systemImage: "folder",
                    shortcut: "⇧⌘O",
                    isPrimary: true,
                    action: model.presentOpenPanel
                )
                WelcomeActionButton(
                    title: "Create New Vault…",
                    subtitle: "Start an empty folder",
                    systemImage: "folder.badge.plus",
                    shortcut: nil,
                    isPrimary: false,
                    action: model.presentCreatePanel
                )
            }

            if !model.recentVaults.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recent vaults")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.6)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.tertiaryText)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 4)
                    ForEach(model.recentVaults, id: \.self) { url in
                        RecentVaultRow(url: url) {
                            model.openVault(at: url)
                        } onRemove: {
                            model.forget(url)
                        }
                    }
                }
            }

            Spacer(minLength: 0)

            Toggle("Reopen last vault on launch", isOn: Bindable(AppSettings.shared).reopenLastVault)
                .toggleStyle(.checkbox)
                .font(.system(size: 12))
                .foregroundStyle(Theme.tertiaryText)
        }
        .padding(.horizontal, 36)
        .padding(.top, 40)
        .padding(.bottom, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WelcomeActionButton: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let shortcut: String?
    let isPrimary: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 20))
                    .frame(width: 24)
                    .foregroundStyle(isPrimary ? .white : Theme.secondaryText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14, weight: .semibold))
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(isPrimary ? Theme.onPrimarySecondary : Theme.secondaryText)
                }
                Spacer()
                if let shortcut {
                    Text(shortcut)
                        .font(.system(size: 12))
                        .foregroundStyle(isPrimary ? Theme.onPrimarySecondary : Theme.tertiaryText)
                }
            }
            .foregroundStyle(isPrimary ? .white : Theme.text)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isPrimary ? Theme.primaryButton : Theme.raised)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(isPrimary ? .clear : Theme.strongBorder)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

private struct RecentVaultRow: View {
    let url: URL
    let onOpen: () -> Void
    let onRemove: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                HolocronMark(color: isHovered ? Theme.accent : Theme.secondaryText)
                    .frame(width: 20, height: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(url.lastPathComponent)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text((url.path as NSString).abbreviatingWithTildeInPath)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isHovered ? Theme.accent.opacity(0.12) : .clear)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .contextMenu {
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            Button("Remove from Recents", action: onRemove)
        }
    }
}

extension Bundle {
    var shortVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "–"
    }
}
