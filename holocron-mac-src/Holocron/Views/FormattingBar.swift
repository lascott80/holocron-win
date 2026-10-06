import SwiftUI

/// Quick markdown formatting above the editor. Each button runs the same
/// command as its menu item / shortcut; hovering shows the markdown it writes.
struct FormattingBar: View {
    let editor: EditorController
    @State private var showCheatSheet = false

    var body: some View {
        HStack(spacing: 2) {
            group {
                FormatButton("Bold", "bold", help: "**text**", shortcut: "⌘B", editor: editor)
                FormatButton("Italic", "italic", help: "*text*", shortcut: "⌘I", editor: editor)
                FormatButton("Strikethrough", "strikethrough", help: "~~text~~", shortcut: "⇧⌘X", editor: editor)
                FormatButton("Highlight", "highlighter", command: "highlight", help: "==text==", shortcut: "⇧⌘H", editor: editor)
                FormatButton("Inline Code", "chevron.left.forwardslash.chevron.right", command: "code", help: "`code`", shortcut: "⌘E", editor: editor)
                FormatButton("Link", "link", help: "[text](url) — or type [[ for a note link", shortcut: "⌘K", editor: editor)
            }
            separator
            Menu {
                Button("Heading 1") { editor.run("heading1") }
                Button("Heading 2") { editor.run("heading2") }
                Button("Heading 3") { editor.run("heading3") }
                Divider()
                Button("Body Text") { editor.run("heading0") }
            } label: {
                Image(systemName: "textformat.size")
                    .font(.system(size: 13))
                    .frame(width: 28, height: 26)
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .foregroundStyle(Theme.secondaryText)
            .fixedSize()
            .help("Heading — # Heading, ## Heading… (⌥⌘1–3)")
            group {
                FormatButton("Bulleted List", "list.bullet", command: "bulletList", help: "- item", editor: editor)
                FormatButton("Numbered List", "list.number", command: "numberedList", help: "1. item", editor: editor)
                FormatButton("Checklist", "checklist", command: "task", help: "- [ ] task", shortcut: "⌘L", editor: editor)
                FormatButton("Quote", "text.quote", command: "quote", help: "> quote", editor: editor)
            }
            separator
            group {
                FormatButton("Code Block", "curlybraces", command: "codeBlock", help: "```language … ```", editor: editor)
                TableSizeButton(editor: editor)
                FormatButton("Callout", "exclamationmark.bubble", command: "callout", help: "> [!note] Title", editor: editor)
                FormatButton("Divider", "minus", command: "divider", help: "---", editor: editor)
            }
            Spacer(minLength: 8)
            Button {
                showCheatSheet.toggle()
            } label: {
                Label("Markdown Help", systemImage: "questionmark.circle")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 13))
                    .frame(width: 28, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.secondaryText)
            .help("Markdown cheat sheet")
            .popover(isPresented: $showCheatSheet, arrowEdge: .bottom) {
                MarkdownCheatSheet()
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
    }

    @ViewBuilder
    private func group(@ViewBuilder _ content: () -> some View) -> some View {
        HStack(spacing: 0) { content() }
    }

    private var separator: some View {
        Rectangle()
            .fill(Theme.border)
            .frame(width: 1, height: 16)
            .padding(.horizontal, 6)
    }
}

private struct FormatButton: View {
    let title: String
    let symbol: String
    let command: String
    let tooltip: String
    let editor: EditorController
    @State private var isHovered = false

    init(_ title: String, _ symbol: String, command: String? = nil, help: String, shortcut: String? = nil, editor: EditorController) {
        self.title = title
        self.symbol = symbol
        self.command = command ?? title.lowercased()
        self.tooltip = "\(title) — \(help)" + (shortcut.map { " (\($0))" } ?? "")
        self.editor = editor
    }

    var body: some View {
        Button {
            editor.run(command)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .frame(width: 28, height: 26)
                .background(RoundedRectangle(cornerRadius: 5).fill(isHovered ? Theme.chip : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.text : Theme.secondaryText)
        .onHover { isHovered = $0 }
        .help(tooltip)
        .accessibilityLabel(title)
    }
}

/// The Table button: pick a size from a grid, like in Word or Notion.
private struct TableSizeButton: View {
    let editor: EditorController
    @State private var isHovered = false
    @State private var showPicker = false

    var body: some View {
        Button {
            showPicker.toggle()
        } label: {
            Image(systemName: "tablecells")
                .font(.system(size: 13))
                .frame(width: 28, height: 26)
                .background(RoundedRectangle(cornerRadius: 5).fill(isHovered || showPicker ? Theme.chip : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovered ? Theme.text : Theme.secondaryText)
        .onHover { isHovered = $0 }
        .help("Table — pick a size, or type | a | b | and press ↩")
        .accessibilityLabel("Table")
        .popover(isPresented: $showPicker, arrowEdge: .bottom) {
            TableSizePicker { rows, columns in
                showPicker = false
                editor.insertTable(rows: rows, columns: columns)
            }
        }
    }
}

/// A grid of cells; hovering picks columns × rows (header included).
private struct TableSizePicker: View {
    let onPick: (_ bodyRows: Int, _ columns: Int) -> Void
    @State private var hovered = (rows: 3, columns: 3)
    private let maxRows = 8
    private let maxColumns = 8
    private let cell: CGFloat = 18

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(horizontalSpacing: 3, verticalSpacing: 3) {
                ForEach(1...maxRows, id: \.self) { row in
                    GridRow {
                        ForEach(1...maxColumns, id: \.self) { column in
                            let isOn = row <= hovered.rows && column <= hovered.columns
                            RoundedRectangle(cornerRadius: 3)
                                .fill(isOn ? Theme.accent.opacity(row == 1 ? 0.55 : 0.3) : Theme.chip)
                                .strokeBorder(isOn ? Theme.accent.opacity(0.8) : Theme.border, lineWidth: 1)
                                .frame(width: cell, height: cell)
                                .contentShape(Rectangle())
                                .onHover { if $0 { hovered = (row, column) } }
                                .onTapGesture { onPick(max(1, row - 1), column) }
                        }
                    }
                }
            }
            Text("\(hovered.columns) × \(hovered.rows) table")
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .monospacedDigit()
        }
        .padding(12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Table size")
        .accessibilityValue("\(hovered.columns) columns, \(hovered.rows) rows")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: hovered.rows = min(maxRows, hovered.rows + 1)
            case .decrement: hovered.rows = max(2, hovered.rows - 1)
            @unknown default: break
            }
        }
        .accessibilityAction { onPick(max(1, hovered.rows - 1), hovered.columns) }
    }
}

/// A one-page reference for the markdown Holocron understands.
struct MarkdownCheatSheet: View {
    private let sections: [(String, [(String, String)])] = [
        ("Text", [
            ("**bold**", "Bold  ⌘B"),
            ("*italic*", "Italic  ⌘I"),
            ("~~strikethrough~~", "Strikethrough  ⇧⌘X"),
            ("==highlight==", "Highlight  ⇧⌘H"),
            ("`code`", "Inline code  ⌘E"),
            ("\\*", "A literal * (escape)"),
            ("%% hidden %%", "Comment, not shown"),
            ("<kbd>⌘</kbd>  <sup>2</sup>", "Keys, super/subscript"),
        ]),
        ("Headings", [
            ("# Heading 1", "⌥⌘1"),
            ("## Heading 2", "⌥⌘2"),
            ("### Heading 3", "⌥⌘3"),
        ]),
        ("Links & embeds", [
            ("[[Note]]", "Link to a note (type [[ for suggestions)"),
            ("[[Note|shown text]]", "Link with your own text"),
            ("[[Note#Heading]]", "Link to a heading"),
            ("[[Note#^id]]", "Link to a block marked ^id"),
            ("[text](https://…)", "Web link  ⌘K"),
            ("![[Note]]", "Embed a note (or #Heading)"),
            ("![[image.png|300]]", "Image, optional width"),
            ("#tag  #nested/tag", "Tags"),
            ("text[^1] … [^1]: note", "Footnote"),
        ]),
        ("Lists", [
            ("- item", "Bulleted list"),
            ("1. item", "Numbered list"),
            ("- [ ] task   - [x] done", "Checklist  ⌘L"),
            ("- [-] [/] [>] [!] [?]", "Cancelled, partial, forwarded…"),
        ]),
        ("Blocks", [
            ("> quote", "Quote"),
            ("> [!note] Title", "Callout (tip, warning, …)"),
            ("> [!tip]- Title", "Callout, folded (+ for open)"),
            ("```swift … ```", "Code block with colours"),
            ("| a | b |  then ↩", "Table — Tab and ↩ move between cells"),
            ("---", "Divider"),
            ("<details><summary>…", "Foldable section"),
        ]),
        ("Properties", [
            ("---\ntags: [a, b]\n---", "At the very top of a note"),
        ]),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Markdown cheat sheet")
                    .font(.system(size: 14, weight: .semibold))
                ForEach(sections, id: \.0) { title, rows in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title)
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 5) {
                            ForEach(rows, id: \.0) { syntax, meaning in
                                GridRow {
                                    Text(syntax)
                                        .font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(Theme.accentText)
                                        .textSelection(.enabled)
                                    Text(meaning)
                                        .font(.system(size: 12))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .frame(width: 440, height: 520)
    }
}
