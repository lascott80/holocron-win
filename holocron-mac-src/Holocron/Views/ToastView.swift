import SwiftUI

/// The confirmation that slides up after moving, renaming, duplicating or
/// trashing something (with Undo), or a heads-up about iCloud (with Review).
struct ToastView: View {
    let vault: Vault
    let toast: Vault.Toast

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: toast.isWarning ? "exclamationmark.icloud.fill" : "checkmark.circle.fill")
                .foregroundStyle(toast.isWarning ? Theme.warning : Theme.synced)
            Text(toast.message)
                .foregroundStyle(Theme.text)
                .lineLimit(2)
            if let actionTitle = toast.actionTitle {
                Button(actionTitle) { vault.runToastAction() }
                    .buttonStyle(.plain)
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.accentText)
            }
            Button {
                vault.dismissToast()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.tertiaryText)
            .accessibilityLabel("Dismiss")
        }
        .font(.system(size: 13))
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .padding(.vertical, 9)
        .background(Theme.panelBackground, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.strongBorder))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
        .frame(maxWidth: 520)
        .onAppear {
            AccessibilityNotification.Announcement(toast.message).post()
        }
    }
}
