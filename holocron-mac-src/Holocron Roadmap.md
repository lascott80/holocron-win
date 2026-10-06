---
tags: [holocron, roadmap]
created: 2026-10-05
updated: 2026-10-05
status: planning
---

# Holocron Roadmap

What to build next, as of 2026-10-05, in four stages: **Now → Next → Then → Later**. Tick things off as they land. Sizes are rough: **S** ≤ 1 day, **M** 2–4 days, **L** a week or more.

> [!tip] Top three
> 1. **Quick capture** — jot into Holocron from anywhere
> 2. **Version history** — a safety net for every note
> 3. **Reading view & source mode** — switch how a note is shown

## Quick fixes

- [x] Remove the extra blank line above images and embeds
- [x] Check inline rename in the sidebar (right-click › Rename, or Return)
- [x] Check drag-and-drop to move notes and folders
- [ ] Note anything that feels off in daily use #feedback

## Now — daily-use polish

About two weeks. Small things that make every writing session better.

- [x] **Reading view & source mode** — toggle between fully rendered, live preview and raw text (⇧⌘E reading view, ⌥⌘E source mode)
- [x] **Hover previews** (S) — hold ⌘ over a `[[link]]` to see the note in a popover without opening it
- [x] **Focus & typewriter mode** (S) — dim everything but the current paragraph, keep the cursor line centred, hide sidebar, tabs and toolbar; one shortcut toggles it
- [x] **Command palette** (S–M) — ⇧⌘P lists every command and setting, searchable, with its shortcut
- [x] **Table keyboard shortcuts** — Return moves down a row (adding one at the end), typing a header row and Return adds the `| --- |` line, shortcuts to insert, move and delete rows and columns, and tidy columns when leaving the table
- [x] **Paste tables** — cells copied from Numbers, Excel or Google Sheets arrive as a markdown table, plus "Convert to Table" for selected CSV or tab-separated lines, and a size picker on the toolbar's Table button

## Next — the native-Mac payoff, and organising

About three to four weeks.

- [ ] **Quick capture** — a global shortcut or menu bar icon that opens a small window to add to today's note or a new note, from any app
- [ ] **Shortcuts & Siri** — actions like "Append to today's note", "Create note from template" and "Search Holocron"
- [ ] **Spotlight** — notes show up in macOS search and open straight in Holocron
- [ ] **Share & Services** — "Save to Holocron" from Safari's share menu, or from selected text via right-click › Services
- [ ] **Tasks view** (M) — every open `- [ ]` across the vault in one sidebar panel, grouped by note or due date (`📅 2026-10-12` or `due:`); tick them off there and the note updates
- [ ] **Daily-notes calendar** (S–M) — a small month calendar with dots on days that have a note; click a day to open or create it
- [ ] **Version history** — local snapshots of each note to browse and restore, independent of Dropbox or iCloud (worth landing before relying on Holocron for everything)
- [x] **Reliable iCloud Drive vaults** (M) — download notes iCloud has offloaded (`.icloud` placeholders) instead of hiding them, coordinate reads and saves with iCloud (file coordination), surface iCloud conflict versions and "Note 2.md" copies in the conflict sheet, and show sync status in the status bar

## Then — depth

About three to four weeks.

- [ ] **Unlinked mentions** (S–M) — in the Links tab, notes that mention this note's title without linking it, with a **Link** button
- [ ] **Edit properties inline** — click a value to change it, plus an "Add property" button
- [ ] **Search & replace across the vault**, and highlight every search match inside the open note
- [ ] **Edit inside embeds**, saving back to the original note
- [ ] **Split view** — two notes side by side by dragging a tab to the edge
- [ ] **Bookmarks** — pin favourite notes and searches in the sidebar
- [ ] **Sidebar options** — sort by modified or created date, show attachments, reveal the open note in the tree
- [ ] **Note icons & folder colours** (S) — an emoji or SF Symbol per note or folder (stored as `icon:` in front matter), shown in the sidebar, tabs and Quick Open
- [ ] **Export & print** (M) — print, PDF and HTML export with clean typography, plus "Copy as rich text" for Mail or Docs; embeds, callouts and tables render properly

## Later — scale and reach

- [ ] **Themes & CSS snippets** (M) — a few built-in themes, plus a vault `.holocron/snippets/` folder for custom CSS, toggled in Settings
- [ ] **Vault health** (S–M) — broken links, orphan notes, unused attachments and duplicate titles, with one-click fixes
- [ ] **Large vaults** — cache the index on disk and load the file tree lazily, so 10,000+ notes open instantly
- [ ] **Multiple windows**, each with its own vault or tabs

> [!note]- Optional extras (heavier — only if needed)
> - [ ] Math: `$x^2$` and `$$…$$` (KaTeX, ~280 KB + fonts)
> - [ ] Mermaid diagrams (~1–2 MB)
> - [ ] PDF, audio and video embeds

### Distribution

Pull this forward if Holocron is going to other people sooner; the Share extension also works better with a proper Developer ID.

- [ ] Join the Apple Developer Program, then sign & notarize (the release script is ready: `DEVELOPMENT_TEAM=… NOTARY_PROFILE=… scripts/release.sh`)
- [ ] **Holocron iCloud folder** (M, needs the Developer Program) — "Create Vault in iCloud" puts vaults in Holocron's own iCloud Drive folder, like Obsidian's; the groundwork for an iPhone and iPad app
- [ ] Sparkle auto-updates, with releases hosted on GitHub
- [ ] Turn CI back on (`gh workflow enable CI`) once GitHub Actions is behaving

## Not planned

Deliberately left out, for now:

- **Graph view** — impressive, rarely used day to day
- **Plugins** — a big surface to keep stable
- **Built-in sync or CloudKit** — Dropbox and iCloud Drive already sync plain files; a database would break the plain-`.md` promise, and version history covers the safety side

## Done ✓

> [!success]- Built so far
> - [x] Vaults, file tree, autosave
> - [x] Live preview editor
> - [x] Sync safety: watching for outside changes, merging, conflict sheet
> - [x] Backlinks, outline, tags, quick open (⌘O)
> - [x] Settings, light/dark themes and crystal accents, app icon, release script
> - [x] Tabs with history
> - [x] Full-text search (⇧⌘F)
> - [x] Images: paste, drop, embed
> - [x] Properties panel
> - [x] File management with link updating
> - [x] Autocomplete for links, headings, embeds and tags
> - [x] Daily notes (⇧⌘D)
> - [x] Note embeds
> - [x] Templates (⌥⌘T, ⇧⌘N)
> - [x] Tables, highlights, code colours, footnotes, comments, folding callouts, HTML, block references
> - [x] Formatting bar and markdown cheat sheet
> - [x] Notes named from their first line
> - [x] GitHub repo and CI workflow (CI paused for now)
> - [x] Table editing from the grid: column and row menus, + to add rows and columns, sort, align, right-click
> - [x] Sidebar drop highlight when dragging notes and folders
> - [x] New notes start with a # heading on the first line
> - [x] Toasts with Undo after moving, renaming, duplicating or trashing
> - [x] "Start Here" guide in new vaults (and Help › Add Start Here Guide to Vault)
> - [x] Empty editor with quick actions, recent notes and key shortcuts
> - [x] Status bar: selection word count, note stats popover, last-saved time
