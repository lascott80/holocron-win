# Holocron — Product Requirements

A complete, behaviour-level description of Holocron as built (October 2026), so it can be rebuilt from scratch or ported to another platform. It was written from the Mac app (version 0.1) and is now kept in step with the **Windows/Electron port (version 0.2.0)** in this repository. Where the two differ, the Windows behaviour is stated and the Mac behaviour noted; §22 summarises the Windows port.

It describes **what the app does and how it should feel**, with exact rules, defaults, limits and user-facing strings. It names the Mac implementation only where that helps, and §17 maps every Mac-specific piece to a cross-platform equivalent.

**How to read it**

- Requirements have IDs (`VLT-03`) so a port can track them. "Must" is required for parity; "should" is strongly recommended; "may" is optional.
- Quoted strings are exact user-facing text. Curly quotes (“ ” ’) and "…" are literal characters.
- Shortcuts are written the Mac way (⌘ Command, ⌥ Option, ⌃ Control, ⇧ Shift). §17.2 gives the Windows/Linux mapping.
- **Acceptance criteria** at the end of each area come from the existing automated test suite (170 tests). A port should pass equivalents.
- §19 lists known bugs and quirks in the current build — fix them in the port rather than copying them.

---

## Contents

1. [Product overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Vaults and files on disk](#3-vaults-and-files-on-disk)
4. [Note format and parsing](#4-note-format-and-parsing)
5. [Links](#5-links)
6. [File operations](#6-file-operations)
7. [Tabs, navigation and app state](#7-tabs-navigation-and-app-state)
8. [Daily notes and templates](#8-daily-notes-and-templates)
9. [Search](#9-search)
10. [The editor](#10-the-editor)
11. [User interface](#11-user-interface)
12. [Commands and keyboard shortcuts](#12-commands-and-keyboard-shortcuts)
13. [Settings](#13-settings)
14. [Saving, outside changes and conflicts](#14-saving-outside-changes-and-conflicts)
15. [Cloud-synced vaults](#15-cloud-synced-vaults)
16. [Visual design](#16-visual-design)
17. [Porting guide](#17-porting-guide)
18. [Non-functional requirements](#18-non-functional-requirements)
19. [Known bugs and quirks](#19-known-bugs-and-quirks)
20. [Constants](#20-constants)
21. [Not built yet](#21-not-built-yet)
22. [The Windows port](#22-the-windows-port)

---

## 1. Product overview

Holocron is a desktop markdown notes app in the style of Obsidian, with a dark "kyber crystal" visual identity.

**Principles (must hold in any port)**

- **P1 — Plain files, no lock-in.** A vault is an ordinary folder of `.md` files. There is no database; every index is rebuilt from the files at launch. Other apps, sync services and Git can read and write the same files at any time.
- **P2 — Never lose writing.** Saves are atomic, outside changes are merged or surfaced (never silently overwritten), deletions go to the system Trash with Undo, and unresolved conflicts are kept as copies rather than discarded.
- **P3 — Live preview.** Markdown renders as you type; the raw syntax appears only on the line(s) you're editing.
- **P4 — Obsidian-compatible syntax.** Wikilinks, embeds, callouts, tags, properties, block references and daily-note formats follow Obsidian's conventions so vaults move between the two apps.
- **P5 — Keyboard first.** Every action has a menu item; common ones have shortcuts; a command palette reaches everything.

**Glossary**

| Term | Meaning |
|---|---|
| Vault | A folder opened in Holocron. Everything inside it (except hidden items) is part of the vault. |
| Note | A file with extension `md` or `markdown` (case-insensitive). |
| Attachment | Any other non-hidden regular file in the vault (images, PDFs, …). |
| Vault path | A path relative to the vault root, using "/", e.g. `Lore/Kyber.md`. |
| Title | A note's file name without extension. |
| Properties | YAML frontmatter at the top of a note. |
| Active line | A line the cursor/selection touches while the editor is focused and editable. |

---

## 2. Architecture

The Mac app has two halves; a port should keep the same split.

```
┌────────────────────── Native shell (Swift/SwiftUI) ───────────────────────┐
│ Vault model: file tree, index, links, search, file ops, tabs, settings    │
│ NoteDocument: autosave, outside-change reconcile, merge, conflicts        │
│ Watcher (FSEvents), cloud helpers, window/menus/sidebar/inspector UI      │
│                                                                           │
│   ┌──────────── Web view (WKWebView) ────────────┐                        │
│   │ Editor: CodeMirror 6 + custom extensions     │  ◄─ bridge messages ─► │
│   │ (Editor/src/*.js, bundled by esbuild)        │                        │
│   └──────────────────────────────────────────────┘                        │
└───────────────────────────────────────────────────────────────────────────┘
```

- **ARC-01** The editor must be CodeMirror 6 (or equivalent) running in a web context. The existing `Editor/src` is plain JavaScript with no Mac dependencies and **can be reused unchanged in Electron's renderer**. Only the bridge transport changes (§2.1).
- **ARC-02** The native side owns the files. The editor never touches the disk; it receives text and reports edits.
- **ARC-03** One editor instance per window is reused for every note. The editor keeps per-note state (undo history, cursor, scroll) for up to **30** notes and restores it when switching back, but only if the note's text is unchanged; otherwise it starts fresh at the top.
- **ARC-04** Editor bundle build: `esbuild src/main.js --bundle --minify --format=iife --target=safari17 --outfile=…/editor.js`. Dependencies: `@codemirror/*` (state, view, commands, language, search, autocomplete, lang-markdown 6.5.x plus the code languages in §10.9), `@lezer/markdown`, `@lezer/highlight`. For Electron, change the target to the Chromium version in use. *Windows:* the editor (`src/editor`) is bundled into the renderer by Vite instead; code languages (§10.9), Mermaid, KaTeX and the emoji data load lazily as separate chunks the first time a note needs them.
- **ARC-05** The editor page loads three files: `editor.html`, `editor.css` (CSS variables for highlight/syntax/callout colours, light/dark), `editor.js`.

### 2.1 Bridge

The editor calls `post(message)` (Mac: `window.webkit.messageHandlers.holocron.postMessage`). Native calls methods on `window.holocron`. In a browser with no native handler the editor runs in **dev mode** (§10.15).

**Native → editor (`window.holocron.*`)**

| Method | Arguments | Behaviour |
|---|---|---|
| `setDocument` | `text, id` | Show a note. `id` is its file path. Restores saved state if the text matches (ARC-03). |
| `applyExternalEdits` | `edits[{from,to,insert}], text, id` | Apply a disk reload/merge as targeted edits (UTF-16 offsets) so the cursor and undo history survive. If the result ≠ `text`, replace the whole document. If `id` isn't the current note, drop that note's saved state instead. User event `input.external`. |
| `setVaultData` | `{notes, attachments, tags}` | Autocomplete data (§10.11). Also refetches embeds. |
| `resolveEmbed` | `id, result` | Answer to an `embed` request: `{title, path, text}` or `null` if missing. |
| `renameDocument` | `oldId, newId` | The file moved; move saved state and current id. |
| `forget` | `id` | Drop a note's saved state. |
| `run` | `name` | Run a named command (§10.12). Returns false if unknown. Focuses the editor first. In reading view only `find`, `findNext`, `findPrevious`, `selectMatches` run. |
| `focus` | — | Focus the editor. |
| `setMode` | `"live" \| "source" \| "reading"` | Switch view mode (§10.2). |
| `setFocusMode` | `on` | Focus mode on/off (§10.3). Turning it on centres the cursor line. |
| `setAppearance` | `vars, "dark" \| "light"` | Set every `--hc-*` CSS variable on `<html>`, toggle `hc-dark`/`hc-light`, set `color-scheme`. |
| `applyTemplate` | `frontmatter, body` | Insert a template (§8.2). |
| `insertAtCursor` | `text` | Replace the selection; cursor after. |
| `insertAtPoint` | `x, y, text` | Insert at viewport coordinates (dropped files). Prefix "\n" if the character before isn't whitespace. |
| `insertTable` | `rows, columns` | Insert a sized table (§10.8). |
| `selectInLine` | `line, from, to` | Select columns on a 1-based line (UTF-16) and centre it. |
| `scrollToLine` | `line` | Cursor to line start, scroll near the top (48 px margin), focus. |
| `getText` | — | Return the document text. |

**Editor → native (`post({type, …})`)**

| `type` | Payload | Native behaviour |
|---|---|---|
| `ready` | — | Sent once. Native then sends appearance, mode, focus mode, vault data and the current note, and reveals the view. |
| `change` | `id, text` | Full text on every edit. Ignored if `id` isn't the shown note. |
| `selection` | `id, line, column, selectedWords, selectedCharacters` | 1-based. Words = whitespace-separated tokens. |
| `openLink` | `target, newTab` | Open a wikilink (`newTab` = ⌘ held). |
| `openURL` | `url` | Open in the system browser — **only** `http`, `https`, `mailto`. |
| `openTag` | `tag` | Open Quick Open with `#tag`. |
| `embed` | `id, target, from` | Request embed content (`from` = current note path). Native answers with `resolveEmbed`. |
| `copy` | `text` | Put text on the clipboard (code block Copy button). |
| `pasteImage` | `name, mime, data(base64)` | Save as an attachment (§3.3) and answer with `insertAtCursor(embedText)`. |

- **ARC-06** The web view must only ever load the bundled editor page. Any other navigation is cancelled; link clicks to http/https/mailto open externally.
- **ARC-07** Images are served to the editor through a private URL scheme (Mac: `holocron-asset://<kind>/<target>?from=<note path>`, kind `embed` or `relative`). The native handler resolves the target as an attachment (§3.4), refuses `relative` targets containing ":", requires the resolved file to be inside the vault (symlinks resolved on both sides) and serves only image extensions. Everything else fails as "file does not exist". Reads happen off the UI thread.
  *Windows:* the scheme also serves video (mp4 webm mov m4v ogv), audio (mp3 wav m4a ogg flac aac opus) and PDF for media embeds (ED-56) — never notes, scripts, executables or anything else. Only GET and HEAD are allowed. Responses support HTTP `Range` (206 with `Content-Range`, 416 for unsatisfiable ranges, `Accept-Ranges` always) so players can seek, carry the correct MIME type and `X-Content-Type-Options: nosniff`, and every non-PDF response is sandboxed with `Content-Security-Policy: default-src 'none'; sandbox`.

---

## 3. Vaults and files on disk

### 3.1 What's in a vault

- **VLT-01** Any folder can be a vault. Opening it never writes anything until the user acts.
- **VLT-02** Notes are files with extension `md` or `markdown`, case-insensitive.
- **VLT-03** Hidden entries are ignored everywhere (tree, index, watcher, search): any path component starting with "." (`.git`, `.obsidian`, `.DS_Store`, `.trash`…). Packages/bundles count as files.
- **VLT-04** File tree: folders and notes only (attachments are not listed). Empty folders are shown. Folders first, then natural "Finder" order on the full file name, case-insensitive with numbers compared numerically: `Note 1, note 2, Note 10`. Notes display their title; folders their name.
- **VLT-05** A folder's note count is the number of notes in its subtree. The sidebar header shows the vault total.
- **VLT-06** Attachments are every non-note, non-hidden regular file, held as a sorted list of vault paths. Image extensions: `png jpg jpeg gif webp svg bmp tif tiff heic avif`.

### 3.2 Unique names

- **VLT-07** Whenever Holocron needs a free name it uses "Base.ext", then "Base 2.ext", "Base 3.ext", …. Every name Holocron produces or moves a file to is remembered for the session (used by duplicate detection, §15.4).

### 3.3 Pasted and dropped files

- **VLT-08** Attachment folder setting (default "Attachments"; empty = vault root), created when needed.
- **VLT-09** Pasted image file name: `Pasted image yyyyMMddHHmmss.<ext>` (POSIX locale, local time). Extension from the MIME type (`jpeg`→`jpg`, fallback `png`). An empty base name becomes "Attachment". Clashes are numbered: "Pasted image 1 2.png". Error: "Couldn’t save the pasted image: <err>".
- **VLT-10** Files dropped onto the editor:
  - already inside the vault → linked where they are, never copied;
  - from outside → copied into the attachment folder with a unique name; the original is untouched. Error: "Couldn’t add “<file>”: <err>".
  - Inserted text: notes → `[[<vault path without extension>]]`; other files → attachment link text (VLT-11). Several files are joined with "\n" plus a trailing "\n".
- **VLT-11** Attachment link text: images → `![[target]]`, others → `[[target]]`. `target` is the bare file name if no other attachment shares it (case-insensitive), otherwise the full vault path.
- **VLT-12** Files dropped onto the sidebar from outside the vault are copied in (see FOP-08).

### 3.4 Resolving an attachment target

- **VLT-13** Normalise: backslashes → "/", strip `#…`/`^…`, compare case-insensitively. Resolve "." and ".."; never climb above the vault root (`../../../etc/passwd` → `etc/passwd`).
- **VLT-14** A leading "/" is vault-absolute. Otherwise try, in order: (1) relative to the linking note's folder, (2) as a vault path, (3) if the target has no "/", by file name anywhere in the vault, fewest path segments winning.
- **VLT-15** A link target "is an attachment" when its path part has an extension that is not md/markdown and is made only of letters/digits (so `v1.2 notes` is a note name, not an attachment).

---

## 4. Note format and parsing

Notes are UTF-8. Invalid bytes are replaced, never fatal. Lines may end in LF or CRLF (CRLF must be preserved byte-for-byte when the app rewrites a file it hasn't otherwise changed).

### 4.1 Properties (frontmatter)

- **NOTE-01** Recognised only when line 1 trimmed is exactly `---` and a later line trimmed is `---` or `...`. If never closed, the whole file is body.
- **NOTE-02** Index parsing (native): top-level `key: value` lines only (line doesn't start with whitespace or "#", contains ":"). Values:
  - `[a, b]` → list (comma split; surrounding `"`/`'` stripped; empties dropped);
  - empty value followed by indented `- item` lines → list;
  - empty value followed by indented `k: v` lines → one joined string "k: v, k2: v2";
  - empty value with nothing under it → no values;
  - otherwise one scalar (quotes stripped). All values are strings; key order is preserved.
- **NOTE-03** Tags come from `tags:`/`tag:`, aliases from `aliases:`/`alias:` (key case-insensitive, column 0). Accepted forms: `[a, b]`, `a, b`, `a`, or a `- a` block list (ends at the first line that isn't `- `). Leading "#" and spaces are trimmed.
- **NOTE-04** The editor renders properties as a panel (§10.7) with richer typing (booleans, dates, links, URLs).

### 4.2 Body

- **NOTE-05** Fenced code starts at a line whose leading spaces/tabs are followed by ```` ``` ```` or `~~~`; it ends at a line starting with the same three characters. Fenced content is ignored by all parsing (headings, links, tags, words).
- **NOTE-06** Inline code (backtick pairs per line) is blanked before finding headings, links and tags.
- **NOTE-07 Headings**: column 0, 1–6 "#" then space/tab/end of line; trailing "#"s stripped; empty text is not a heading. Heading text is "plain text": `[[a|b]]`→b, `[[a]]`→a, `[t](x)`→t, markers `** __ ~~ == * _` and backticks removed. Line numbers are 1-based and count frontmatter lines.
- **NOTE-08 Tags**: `(^|\s)#([\p{L}\p{N}_\-/]+)` — "#" at line start or after whitespace; letters, digits, `_ - /`; nested with "/". Must contain at least one character that isn't a digit or "/" (`#42` is not a tag; `#2026/q4` is). De-duplicated case-insensitively, first spelling wins, frontmatter tags first.
- **NOTE-09 Wikilinks**: `!?\[\[([^\[\]\n|#^]*)([#^][^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]`. Stored target = trimmed path + raw fragment: `[[Ilum]]`→"Ilum", `[[A|alias]]`→"A", `[[Ilum#Caves]]`→"Ilum#Caves", `[[Note#^id]]`→"Note#^id", `[[#Heading]]`→"#Heading". Embeds (`![[x]]`) count as links.
- **NOTE-10 Markdown links**: `[text](dest "title")` or `[text](<dest with spaces>)`. Images and destinations containing ":" are skipped. The destination is percent-decoded and its path (before "#") must have a note extension: `[the log](Crystal%20Log.md)` → "Crystal Log.md". Each link stores its whole trimmed line as context.
- **NOTE-11 Block ids**: a trailing ` ^id` on a line (`[A-Za-z0-9-]`), or `^id` alone on a line, which names the nearest non-blank block above.
- **NOTE-12 Word count**: whitespace-separated tokens on non-fenced body lines (frontmatter excluded; heading "#" counts as a word). The status bar uses a simpler whole-text count (whitespace tokens of the entire text); either is acceptable but be consistent.

**Acceptance**: headings with markup are cleaned ("## Attunement **steps** ##" → level 2 "Attunement steps"); tags inside code are ignored; unclosed frontmatter is body; property values keep order; `[the log](Crystal%20Log.md)` decodes.

---

## 5. Links

### 5.1 Resolution

- **LNK-01** Path part = target cut at the first "#" or "^", trimmed. Empty path (`[[#H]]`) means the current note.
- **LNK-02** Case-insensitive. If the target lacks a note extension, ".md" is appended for lookup.
- **LNK-03** Target containing "/": exact vault-path match (leading "/" stripped). No "../" for wikilinks.
- **LNK-04** Otherwise match by title across the whole vault; with duplicates, the fewest path segments wins, then plain string order. (The linking note's folder is *not* preferred.)
- **LNK-05** Markdown links resolve relative to the linking note's folder ("/" = vault root; "." and ".." handled, never above root); exact case first, then case-insensitive.

### 5.2 Opening a link

- **LNK-06** Attachment target → open in the OS default app; if missing, error "“<path>” isn’t in this vault." Never creates a note.
- **LNK-07** Existing note → open (⌘/Ctrl-click: new tab), focus the editor, reveal the fragment.
- **LNK-08** Missing note → create it empty at the written path (folders created). Each path segment: ":" → "-", trimmed; empty, "." and ".." segments dropped (no escaping the vault); ".md" added unless present. The fragment is dropped (`Dagobah#Swamps` creates `Dagobah.md`). Error: "Couldn’t create “<name>”: <err>".
- **LNK-09** Fragment reveal: `#Heading` → first heading whose plain text matches case-insensitively; `#^id` → the line ending ` ^id`, or for `^id` alone on a line, the nearest non-blank line above. A bare trailing "#" means no fragment.
- **LNK-10** `http`, `https`, `mailto` links open in the browser; other schemes are ignored.

### 5.3 Rewriting links on rename/move

- **LNK-11** Setting "Update links when renaming or moving notes" (default on). Rewrites are planned before the move; open notes are updated in memory (and saved), closed notes rewritten on disk.
- **LNK-12** Wikilinks: only those whose target moved. If the original contained "/", write the new full vault path; otherwise keep the bare name if it still resolves to the moved note, else use the full path. Keep the extension only if the original had one. Keep `#heading`, `^block`, `|alias` and the `!` prefix. On a pure move with an unchanged name, name-only links are untouched.
- **LNK-13** Markdown links: rewritten when the target moved *or* the containing note moved. `/abs` stays vault-absolute; relative links are recomputed from the new folder (e.g. `../../Orders/Saber.md`). Encoding: angle-bracket form keeps raw spaces; otherwise percent-encode if the original was encoded or had no spaces. Keep `#fragment` and title.
- **LNK-14** Never rewrite inside fenced code or inline code, or destinations containing ":". If nothing changes, the file must be byte-identical (including CRLF).

**Acceptance**: renaming updates `[[Kyber]]`, `[[Kyber#Attunement|kyber notes]]`, `[[Lore/Crystals/Kyber]]` and `[crystal](../Lore/Crystals/Kyber.md)` everywhere while `` `[[Kyber]]` `` in code stays; moving keeps name links and fixes path links and the moved note's own relative links; folder renames fix path links; with the setting off nothing changes; open notes follow their file with unsaved edits intact.

---

## 6. File operations

All destructive or structural operations show an **undo toast** (§11.10). Errors appear in an alert "Something went wrong" / "OK".

- **FOP-01 New note** (⌘N): "Untitled.md", "Untitled 2.md", …; created in the selected folder, else the selected note's folder, else the root; opened in a new tab (an empty active tab is reused); editor focused. Error: "Couldn’t create a note: <err>".
- **FOP-02 New note named** (Quick Open "Create note"): ":" → "-", trimmed; opened like a link (so "/" creates folders). The selected folder is ignored.
- **FOP-03 New folder** (⌥⌘N): "Untitled Folder", "Untitled Folder 2", …; inline rename starts immediately. Error: "Couldn’t create a folder: <err>".
- **FOP-04 First-line heading**: typing into an empty note starts it with "# " (§10.4), so new notes get a real H1.
- **FOP-05 Name from first line** (setting, default on). Applies to notes named `^Untitled( \d+)?$` (whenever such a note is loaded). 1 s after typing pauses the note is renamed from its title text:
  1. skip frontmatter, take the first non-blank line, trim;
  2. strip a leading `#{1,6} `, `>`, list bullet with optional `[ ]`/`[x]`, `1.`/`1)`;
  3. apply plain-text cleaning (NOTE-07); drop a trailing ` ^blockid`;
  4. remove `/ \ : * ? " < > | [ ] # ^` and control characters;
  5. collapse whitespace; trim spaces and dots from both ends;
  6. over 80 characters → cut to 80, then back to the last space.

  Empty result → no rename. A clash with another file numbers the name ("Ilum 2"); a case-only change of its own name is allowed. It stops following when the note leaves the active tab (one final rename), when the user renames it by hand, or when it's unloaded.
  Examples: "Q3: plan/review? <draft> | v2" → "Q3 planreview draft v2"; "- [ ] Buy [[Kyber]] crystals ^task" → "Buy Kyber crystals".
- **FOP-06 Rename** (inline in the sidebar, Return or context menu): name trimmed; rejected if empty, starting with ".", or containing "/" or ":" — "Names can’t be empty, start with a dot, or contain “/” or “:”."; notes keep their extension unless the new name ends in md/markdown; collision — "There’s already an item named “<name>” there."; case-only renames go via a temporary hidden name. Links are rewritten (LNK-11). Toast "Renamed “Saber” to “Lightsaber”" + Undo (renames back, links back). No toast if unchanged.
- **FOP-07 Move** (drag in sidebar): nil target = vault root; items already there are skipped; a folder into itself/a descendant — "Couldn’t move “Lore”: A folder can’t be moved into itself."; open notes, tabs, selection and recents follow the file. Toast "Moved “Kyber” to Orders" / "… to the top of the vault" / "Moved 3 items to …" + Undo (reverse moves, most recent first, links restored; failure "Couldn’t put “<file>” back: <err>").
- **FOP-08 Copy in from outside**: items dragged in from outside the vault are copied (unique names). Toast "Copied “X” into Orders" + Undo (trash the copies silently). Mixed batch → only the "Moved" toast.
- **FOP-09 Duplicate**: save first, copy to "Name copy.md" ("Name copy 2.md", …), open in a new tab. Toast "Duplicated “Saber”" + Undo (trash the copy, no second toast). Error "Couldn’t duplicate “<file>”: <err>".
- **FOP-10 Delete**: only vault items; always confirm. Dialog title "Move “Name” to the Trash?" or "Move N items to the Trash?"; message "You can restore it from the Trash. Unsaved changes in it will be lost."; buttons "Move to Trash" (destructive) / "Cancel". Open documents under the path are dropped **before** trashing (so nothing is saved back), tabs closed, selection cleared. Goes to the **system Trash/Recycle Bin**, never permanent delete. Toast "Moved “Ilum” to the Trash" + Undo only if every item's location in the Trash is known; Undo recreates parent folders and moves the item back. Errors: "Couldn’t move “X” to the Trash: <err>", "Couldn’t restore “X”: <err>".
- **FOP-11** In toasts, notes are named without extension, other items with; several items → "N items"; the root → "the top of the vault".

**Acceptance**: new notes number as "Untitled 2.md" in the selected folder; new folders number and enter rename; duplicate opens "Saber copy.md"; trashing a folder closes its tabs without resurrecting dirty files; outside files are copied (source kept); bad names and collisions are rejected; each operation's toast text matches and its Undo restores files *and* links; undoing a duplicate shows no second toast.

---

## 7. Tabs, navigation and app state

- **TAB-01** A tab has an id, a history of note paths and a position. An empty tab ("New Tab") has no history. History: browser-like (navigating drops forward entries; same note = no-op), capped at **100**; Back/Forward skip notes that no longer exist.
- **TAB-02 Open**: if a tab already shows the note, activate it. Otherwise navigate the active tab (saving the current note first) unless a new tab is requested; new tabs go right after the active tab; an empty active tab is always reused.
- **TAB-03 Close**: activate the tab now at the same index (right neighbour), else the last. Also "Close Other Tabs", "Close Tabs to the Right".
- **TAB-04** ⌘1–⌘8 pick that tab; ⌘9 always the last. Next/previous tab wrap around. Tabs reorder by drag.
- **TAB-05** One loaded document per file, shared by every tab showing it. Documents no tab shows are saved and unloaded; one with an open conflict is first resolved as "Keep Both" (§14.5) so nothing is lost.
- **TAB-06** The sidebar selection follows the active tab's note. Selecting a note in the sidebar opens it; selecting a folder doesn't.
- **TAB-07 Persistence (per vault)**: `openTabs:<vault path>` = vault paths of tabs showing a note (empty tabs and history not saved); `openTabs:<vault path>:active` = active index. On restore, missing files are dropped and the index clamped.
- **TAB-08 Recent notes (per vault)**: `recentNotes:<vault path>`, most recent first, de-duplicated, max **30**; updated whenever a tab lands on a note; pruned of missing files; remapped on moves.
- **TAB-09 Recent vaults**: `recentVaultPaths`, max **8**, most recent first; missing folders dropped at launch; opening a missing one — "The folder “X” no longer exists." — removes it.
- **TAB-10 Launch**: if "Reopen the last vault" is on (default) open the most recent vault; then, if "Open today’s note when Holocron starts" is on, open the daily note.
- **TAB-11 Saving triggers on lifecycle**: app deactivation and quit save everything; closing a vault saves everything and stops watching.

**Acceptance**: opening into the active tab vs new tab; empty tab reuse; closing picks the right neighbour; ⌘9 = last; back/forward skip deleted notes; switching saves; tabs restore with missing files dropped; unloading a conflicted note keeps both versions.

---

## 8. Daily notes and templates

### 8.1 Daily notes

- **DAY-01** Settings: folder (default "Daily", empty = root), date format (default "YYYY-MM-DD"; empty = default), template (default none), open on launch (default off).
- **DAY-02** Path = `<folder>/<formatted date>.md`. A "/" in the format makes subfolders: `YYYY/MM/YYYY-MM-DD dddd` → `Journal/2026/10/2026-10-05 Monday.md`.
- **DAY-03** Moment-style tokens (longest match first), en-US POSIX locale, Gregorian calendar, local time zone: `YYYY YY MMMM MMM MM M DDDD`(day of year)` DD D Do`(day number, no ordinal suffix)` dddd ddd HH H hh h mm m ss s A a ww w gggg Q`. `[text]` is literal; any other letter is output literally.
- **DAY-04** A note is a daily note if its path is under the folder and parses strictly (formatting the parsed date reproduces the exact string). "Daily/Meeting notes.md" and "2026-13-45" are not.
- **DAY-05 Today's Note** (⇧⌘D): open, or create from the template. Template lookup: as a vault path, then with ".md", then as a wikilink name. Missing template → note created empty plus message "The daily note template “X” wasn’t found, so the note was created empty." Opens in the active tab and focuses the editor. Error "Couldn’t create today’s note: <err>".
- **DAY-06 Previous/Next Daily Note** (⌃⌘← / ⌃⌘→): the nearest *existing* daily note before/after the open note's date (or today if the open note isn't a daily note). None → system beep; nothing is created.

### 8.2 Templates

- **TPL-01** Folder setting (default "Templates"; empty = no templates). Every note under it (including subfolders) is a template, sorted naturally by file name.
- **TPL-02 Placeholders** (lowercase names; spaces inside braces allowed; unknown ones left as-is):

| Placeholder | Value |
|---|---|
| `{{title}}` | Note title |
| `{{date}}` | Last path segment of now formatted with the daily-note format |
| `{{date:FORMAT}}` | Now in a Moment format |
| `{{time}}` / `{{time:FORMAT}}` | "HH:mm" / custom |
| `{{yesterday}}` / `{{tomorrow}}` | Neighbouring days' daily-note names (a `:FORMAT` is ignored) |
| `{{cursor}}` | Where the cursor goes (first occurrence); every occurrence removed; default end of body |

For daily notes, dates refer to the note's day.
- **TPL-03** A template's frontmatter is split off; one leading newline is removed from the body.
- **TPL-04 New Note from Template** (⇧⌘N): pick a template, then name the note (":" and "/" → "-", trimmed, empty → "Untitled"). Created in the folder for new items but never inside the templates folder (root instead); numbered on clash ("Dune 2"); the final name is `{{title}}`. Opens in a new tab with the cursor at `{{cursor}}`. Error "Couldn’t read the template “X”."
- **TPL-05 Insert Template** (⌥⌘T): the body replaces the selection; `{{title}}` = current note. Frontmatter merge: no frontmatter → create a `---` block at the top; otherwise add only keys the note lacks (case-insensitive) before the closing `---`. Never overwrite keys or merge lists.

**Acceptance**: placeholder rendering incl. custom formats and unknown placeholders; template-created notes number and land outside the templates folder; daily paths with subfolders; strict daily-note recognition; previous/next skip missing days.

---

## 9. Search

### 9.1 Quick Open (⌘O) and command palette (⇧⌘P)

- **QO-01** One overlay with three modes: empty query → "Recent" notes (that still exist); text → "Notes" (fuzzy); `#tag` → notes with that tag or a nested tag ("#" alone = every tagged note), ranked by recency then path; a query starting with `>` → commands only.
- **QO-02 Fuzzy match**: case-insensitive subsequence, whitespace in the query ignored. Per matched character: 1 + position bonus (start of string 12; after space `- _ / .` 10; lower→upper case change 8; non-letter→letter 6); +8 if adjacent to the previous match; −2 per gap; first character penalised by min(position, 8). Final = 4×score − candidate length. Fields: title (+40), each alias (+20), folder path (+0, only if neither matched); best field wins. Recency bonus max(0, 20 − 2×recent index). Ties by path (natural order). Up to 30 note results shown.
- **QO-03** For a plain query (not `#`) with no exact title match, add "Create note “<query>”" (hint "⇧↵").
- **QO-04** For non-empty non-`#` queries, also show up to 4 matching commands; `>` mode shows up to 200.
- **QO-05 Commands** (`>` mode): the built-in list (§11.7) plus appearance/accent switches plus **every enabled menu-bar item** not already listed, discovered from the menu at open time (so the palette never falls out of date). Each shows its shortcut.
- **QO-06 Keys**: ↑/↓ move, ↵ activate, ⌘↵ open in new tab, ⇧↵ create, Esc close. Opening a note focuses the editor.
- **QO-07** Empty states: "No notes with that tag" (# queries) / "No matches".

### 9.2 Full-text search (⇧⌘F, sidebar Search mode)

- **SRCH-01 Query syntax**: words are ANDed (each in text or file name); `"exact phrase"`; `-word` excludes (a lone "-" is a term); filters `tag:x` (optional "#", nested tags match), `path:x` (substring of vault path), `file:x` (substring of file name). Filter prefixes are case-insensitive; quoted filter values allowed (`path:"Jedi Orders"`).
- **SRCH-02** Default matching is case- **and accent**-insensitive ("cafe" finds "Café"). Toggles: **Aa** "Match case", **.\*** "Regular expression" (whole query is one pattern; `^`/`$` match at line breaks; invalid → "That isn’t a valid regular expression.").
- **SRCH-03 Results**: per note, the total match count and up to **20** matching lines (overlapping matches merged); at most **200** notes (flag when truncated). Order: notes whose title contains every term first, then by match count, then path. Filter-only queries list notes without lines. Searches raw text including frontmatter and code.
- **SRCH-04 Timing**: runs 150 ms after typing stops; toggles apply immediately; re-runs 250 ms after notes change.
- **SRCH-05 UI** — see §11.4.

### 9.3 Index-derived features

- **IDX-01 Backlinks**: wikilinks, markdown links and embeds count; self-links excluded; one entry per source note with each linking line as context; sorted by title.
- **IDX-02 Unlinked mentions**: the note's title and aliases of ≥3 characters as whole words (letter/digit boundaries), case- and accent-insensitive, in lines that don't already link to it; first line per source; max 50; sorted by title.
- **IDX-03 Outgoing links**: de-duplicated case-insensitively; attachment links and same-note `#heading` links skipped; unresolved targets kept ("Not created yet").
- **IDX-04 Tags**: counts per tag (case-insensitive), most used first, then name. Max 100 shown in the sidebar.
- **IDX-05 Live updates**: the open note is re-indexed 300 ms after typing pauses; changed files are re-read when the watcher reports them. Index updates run off the UI thread, serialised.
- **IDX-06 Autocomplete data** sent to the editor: every note's path, title, aliases and headings (with recent rank 10…1 for the top 10 recent notes), attachments, and tags with counts — debounced 1 s.

**Acceptance**: fuzzy ranking prefers word starts, titles over paths, recent notes; tag search includes nested tags; phrase/exclude/filters/regex/case/accents behave as specified; truncation at 200 notes / 20 lines; backlinks and mentions as described.

---

## 10. The editor

### 10.1 Live preview rules

- **ED-01** A line is **active** (shows raw markdown) only if the editor is focused **and** editable **and** a selection range touches it. Unfocused editors and reading view render everything.
- **ED-02** Markup is hidden with zero-width replacements; the document text is never changed by rendering, only by explicit actions.

| Syntax | Rendered (line not active) | Active line |
|---|---|---|
| ATX headings `#`–`######` | Sized heading (§16.4); `# ` and closing `###` hidden | Marks faint, monospace, 0.78em |
| Setext (`===` H1, `---` H2) | First line as heading; underline drawn faint | same |
| `**bold**` `__bold__` `*it*` `_it_` `~~strike~~` | Styled, marks hidden | Marks faint |
| `==highlight==` | Highlight background (`===` is not highlight) | Marks faint |
| `` `code` `` | Monospace chip; backticks hidden | Backticks shown |
| `\*` escapes | Backslash hidden | Shown |
| `[text](url "t")` | Accent text; brackets/URL hidden | Raw |
| `[text][ref]`, `[text][]`, `[ref]` + `[ref]: url` | Resolved like inline links (first definition, case-insensitive); unresolved stay plain. Definition lines small and muted, not hidden | Raw |
| `<https://…>`, bare URLs | Link-styled; angle brackets stay | Same |
| `[[T]]` / `[[T\|Alias]]` / `[[T#H]]` / `[[#H]]` / `[[#^id]]` | "T" / "Alias" / "T#H" / "H" / "id", accent colour | `[[ ]]` faint, inner text raw |
| `#tag`, `#a/b` | Pill (the "#" stays visible) | Pill |
| Images | Block below the line (§10.6); syntax hidden | Syntax faint, image still shown |
| `![[Note]]`, `![[Note#H]]` | Embed box below the line (§10.6) | Syntax faint |
| ` ^block-id` | Hidden with its leading space | Faint, 0.85em |
| `[^1]` footnote ref | Superscript number (order of first reference; unknown "?") | Faint |
| `[^1]: text` | Prefix replaced by "N." in accent; line small/muted | Raw |
| `%% comment %%` | Hidden (whole-line comments collapse as a block) | Faint italic (only while the cursor touches it) |
| `<kbd> <mark> <sup> <sub> <u> <b> <i> <s> <small> <ins> <del>` (one line, no attributes) | Styled, tags hidden | Tags faint |
| `<br>` `<br/>` `<br />` | Line break | Raw |
| `<details>` / `<summary>X</summary>` | `<details>` lines collapse; summary becomes a bold chevron row (fold, §10.10) | Raw |
| Other inline HTML: `<span style>`, `<font color>`, `<abbr>`, `<q>`, `<cite>`, `<a href>`, `<img>`, attributes on the tags above (ED-55) | Sanitised and rendered; tags hidden, markdown inside still renders | Raw |
| HTML blocks (`<div align="center">…`, `<table>`, `<figure>`…) (ED-55) | Sanitised HTML block widget; wrappers that render nothing collapse | Raw (click to edit) |
| `<!-- comment -->` | Hidden | Raw |
| `:shortcode:` emoji (ED-54) | The emoji (🚀); file text unchanged | Raw |
| `$inline math$` (ED-53) | KaTeX formula | Raw |
| `$$ … $$` display math (ED-53) | Centred KaTeX block | Raw (click to edit) |
| ```` ```mermaid ```` (ED-52) | Rendered diagram | Raw code block (click to edit) |
| `![[clip.mp4]]`, `![[a.mp3]]`, `![[a.pdf]]` (ED-56) | Video/audio player or PDF viewer below the line; syntax hidden | Syntax faint, player still shown |
| `> [!type]± Title` callouts | Callout box (§10.5) | Raw first line |
| `> quote` | Left border (outermost quote only), quote colour; `> ` hidden | Raw |
| `- * +` bullets | "•" (muted). *Windows:* by level •, ◦, ▪ (repeating); each nesting level indents 1.5 em whatever spaces or tabs the file uses, and wrapped lines hang under the item text | Raw (indent kept) |
| `1.` ordered | Shown as typed | — |
| `- [ ]` / `- [x]` tasks | Checkbox (marker hidden); done lines muted and struck through | Raw |
| `---` `***` `___` rules | Full-width 1 px line | Faint text |
| Fenced/indented code | Code block (§10.9) | Fences visible |
| Frontmatter | Properties panel (§10.7) | Raw YAML (monospace) |
| Tables | Rendered grid (§10.8) | Raw (monospace) |

- **ED-03 Custom task statuses** (marker `-`, `*`, `+`, `N.` or `N)`):

| Box | Meaning | Look |
|---|---|---|
| `[ ]` | open | empty box |
| `[x]` `[X]` | done | accent fill + tick; line struck through |
| `[-]` | cancelled | grey fill with bar; line struck through |
| `[/]` | partial | diagonal half fill (aria "mixed") |
| `[>]` | forwarded | "›" |
| `[<]` | scheduled | "‹" |
| `[!]` | important | warning-yellow fill with "!" |
| `[?]` | question | "?" |
| `[*]` | star | "★" |
| other non-space | done | as `[x]` |

Clicking a checkbox toggles space ↔ `x` (works in reading view; not inside embeds). See §19 for the custom-status click quirk.

- **ED-04 Clicking**: on a non-active line a click on a link/tag opens it; on an active line ⌘/Ctrl-click opens. Wikilinks → `openLink`; markdown links → `openURL`; tags → `openTag`. Footnote refs jump to the definition; definition numbers jump back. Tooltips "Footnote <label>" / "Back to the reference".
- **ED-05 Collapsed media lines**: a line containing only images/embeds (whose syntax is hidden) collapses to zero height so no blank line appears above the widget. ↑/↓ (and ⇧↑/⇧↓) must stop on such a line (expanding it to raw) rather than skip it.

### 10.2 View modes

- **ED-06 Live Preview** (default): all rendering.
- **ED-07 Source Mode** (⌥⌘E toggles with live preview): raw markdown with syntax colouring only — no heading sizes, pills, widgets (diagrams, math, emoji, HTML, media), grid or folds. *Windows:* table Tab/⇧Tab cell navigation works here too (§19 #3); the Mac app lacked it.
- **ED-08 Reading View** (⇧⌘E toggles, returning to the previous editing mode): everything rendered, read-only, nothing ever active. Links, embeds, task checkboxes and property booleans still work; formatting commands, the formatting bar and the Format menu are disabled; Find still works. *Windows:* clicking never reveals markdown in reading view — not in tables, properties, math, HTML, diagrams or text (`isEditing` is always false for a read-only state); clicking a diagram opens the viewer (ED-52a).
- **ED-09** Always on in every mode: autocomplete, bracket closing, first-line heading, table Enter/⌃⌥ keys, image paste, spreadsheet paste.
- **ED-10** The mode is a persisted setting, switchable from the View menu, the status bar mode menu and the command palette.

### 10.3 Focus mode (⌥⌘F)

- **ED-11** Hides all chrome (sidebar, inspector, tab bar, toolbar, breadcrumb, status bar, formatting bar).
- **ED-12** Dims everything outside the current paragraph (run of non-blank lines around the cursor) to 0.28 opacity with a 0.2 s fade; block widgets dimmed too (not in reading view, where nothing is dimmed).
- **ED-13** Typewriter scrolling: every edit or cursor move recentres the cursor line; scroller padding 40vh top / 50vh bottom.

### 10.4 First-line heading

- **ED-14** Typing the first character into an **empty** note inserts `# ` before it, unless the character is whitespace or one of `` # - * + > ` | ! [ < $ = ~ `` or an IME composition is in progress. Paste is unaffected.
- **ED-15** Backspace at the end of a bare `#{1,6} ` line removes the whole marker. If that empties the note, the automatic heading is not applied again for that note.

### 10.5 Callouts

- **ED-16** First line `> [!type][+|-] optional title` (type `[\w-]+`, case-insensitive). `+` foldable open, `-` foldable closed.
- **ED-17** Families (unknown types = blue): **blue** note, info, abstract, summary, todo · **green** tip, hint, success, check, done · **purple** question, help, faq, example · **yellow** warning, caution, attention · **red** failure, fail, missing, danger, error, bug · **gray** quote, cite. Colours in §16.5.
- **ED-18** Box: every line tinted 10% with 32% borders, 8 px radius, 16 px padding; title row = optional chevron, a 14 px outlined circle icon, then the custom title or the capitalised type ("Warning"), 600 weight, 14 px, in the family title colour. `>` markers hidden on all lines.

### 10.6 Images and embeds

- **ED-19 Images**: `![[img.ext]]`, `![[img.ext|300]]`, `![[img.ext|300x200]]` (height ignored), `![alt](path "t")`, `![alt|300](url)`. Rendered in a block below the line (several stack vertically), width in px if given, max-width 100%, 6 px radius, left-aligned. `http(s):`/`data:` URLs load directly; local files via the private scheme (ARC-07). Missing: "Image not found: <alt or src>" in a dashed box.
- **ED-20 Note embeds** `![[Note]]`, `![[Note#Heading]]`: a box below the line with header "<title> › <heading>" (tooltip "Open note"; click opens, ⌘-click new tab) and a read-only nested editor with the same rendering (no checkbox toggling), max height 480 px scrolling, frontmatter stripped. Content comes from native (unsaved edits in other tabs included), cached per target+current note and refetched when vault data changes.
- **ED-21 Sections**: `#Heading` → from that heading to the next heading of the same or higher level (case-insensitive, markup ignored, fenced code skipped). `#^id` → the list item or paragraph carrying the id (id removed); an id alone on a line names the block above.
- **ED-22 Messages**: "Loading…", "“<target>” doesn’t exist yet. Click the title to create it.", "No heading “<heading>” in this note.", "This note is empty."
- **ED-23 Depth**: one level only — inside an embed, `![[…]]` renders as a plain wikilink. *Mac:* non-image attachments (`![[file.pdf]]`) render as a wikilink. *Windows:* video, audio and PDF attachments render as players/viewers (ED-56); other attachments render as a wikilink. Block embeds `![[Note#^id]]` and same-note embeds `![[#Heading]]`/`![[#^id]]` render (§19 #2); a line is hidden only if its embed actually renders.

### 10.7 Properties panel

- **ED-24** Unless the editor is focused with the cursor inside the frontmatter, the YAML block is replaced by a panel: key column 112 px (muted, ellipsised), value column.
- **ED-25** Values: empty → italic "Empty"; `true`/`false` → checkbox (**clicking rewrites the YAML value; the only in-place edit**); `tags`/`tag` → `#tag` pills (strings split on commas/spaces); other lists → chips; `[[x|alias]]` → link; `http(s)` → link; `YYYY-MM-DD[ T]HH:MM` → localised date ("Sep 28, 2026", raw value as tooltip); else text.
- **ED-26** Tooltip "Click to edit properties"; no properties → "Empty properties — click to edit". Clicking elsewhere in the panel puts the cursor at the start of the YAML and shows it raw.

### 10.8 Tables

- **ED-27 Detection**: a line containing `|` followed by a delimiter row (`| --- | :-: | --: |`); body continues while lines contain `|` and aren't blank; fenced code skipped; `\|` escapes allowed. Alignment `:-` left, `-:` right, `:-:` centre.
- **ED-28 Grid**: unless the cursor is inside, render an HTML table (header on the raised colour, weight 600; zebra rows; 6×12 px cell padding; min width 50%; horizontal scroll). Cells render inline markdown (escapes, code, bold, italic, strike, highlight, wikilinks, links, bare URLs, tags, the HTML tags in ED-02, `<br>`). Clicking a cell shows the raw table (monospace) with the cursor at the end of that cell's text; links and tags in cells still open.
- **ED-29 Grid controls** (editable modes only, not in embeds; appear on hover):
  - Column header ▾ ("Column options"): Align Left / Align Center / Align Right (✓ current) · Sort A → Z / Sort Z → A (numeric-aware, case-insensitive, empty cells last; disabled with < 2 rows) · Insert Column Left / Insert Column Right · Move Column Left / Move Column Right (disabled at edges) · Delete Column (red; disabled with 1 column) · Delete Table.
  - Row handle ⋮⋮ in the left gutter ("Row options"): Insert Row Above / Insert Row Below · Move Row Up / Move Row Down · Delete Row · Delete Table. The header row ("Header row options") offers only Insert Row Below.
  - "+" bars: "Add column" (right), "Add row" (bottom).
  - Right-click a cell: row items, column items, Delete Table.
  - Every action rewrites the table tidied (padded columns), as **one undo step**; the grid stays shown. Menus close on outside click, Escape, blur or scroll.
- **ED-30 Keyboard in tables** (raw mode):
  - **Tab / ⇧Tab** (live & reading): next/previous cell after tidying; wraps across rows; Tab past the last cell adds a row.
  - **Return** at the end of a lone `| a | b |` line (not in code or a table): adds the delimiter row and one empty row, cursor in the first body cell.
  - **Return** in a cell: same column, next row; adds a row on the last row; on an **empty** last row, removes it and continues below the table after a blank line.
  - **⇧Return**: leave the table (next blank line, or insert one).
  - **⌃⌥↑/↓** move row (header can't move) · **⌃⌥⇧↑/↓** insert row above/below · **⌃⌥←/→** move column · **⌃⌥⇧←/→** insert column left/right · **⌃⌥⌫** delete row (not the header) · **⌃⌥⇧⌫** delete column (not the last).
  - Empty cells put the cursor right after "| ", not after the padding.
- **ED-31 Tidy on leave**: when the cursor leaves a table (or the editor loses focus) and it isn't already tidy, pad its columns — appended to the same transaction.
- **ED-32 Insert**: "Insert Table" inserts `| Column | Column | Column |` + delimiter + one empty row with the first "Column" selected. The size picker inserts headers "Column 1…N" and R empty rows, with "Column 1" selected. Both go on their own lines with blank lines around.
- **ED-33 Paste from a spreadsheet**: clipboard text with tabs, ≥2 rows, ≥2 columns, all rows equal width → a tidied table (first row = header; `|` escaped as `\|`; newlines in cells → `<br>`), on its own lines with blank-line padding. Not inside a table or code. Other pastes are unaffected.
- **ED-34 Convert Selection to Table**: delimiter = tab if present, else `;` if there are no commas, else `,`; quoted CSV with `""` escapes; needs ≥2 columns.

### 10.9 Code blocks

- **ED-35** Monospace 13.5 px, line-height 1.7, raised background, 1 px border, 8 px radius, 16 px padding. Fence lines hidden to small faint lines when no line of the block is active.
- **ED-36** Language label (first word of the info string, lowercase, 11 px) and a "Copy" button (aria "Copy code") that copies the contents and shows "Copied" for 1.2 s — in live and reading modes.
- **ED-37 Highlighted languages** (and aliases): javascript/js/jsx/mjs, typescript/ts/tsx, python/py, json/jsonc, html/htm/svelte/vue, css/scss/less, sql/postgres/mysql/sqlite, rust/rs, c/h/cpp/c++/hpp, java, go/golang, xml/plist/svg, yaml/yml, swift, shell/sh/bash/zsh/console, ruby/rb, toml, dockerfile/docker, lua, kotlin/kt, csharp/cs/c#, objc/objective-c, diff/patch. Token colours §16.6.
  *Windows adds:* powershell/ps1/pwsh/ps/psm1/psd1, batch/bat/cmd/dos, php, elixir/ex/exs, makefile/make/mk/mak, graphql/gql, markdown/md, ini/cfg/conf/env/dotenv/properties/editorconfig/gitconfig, scala/sc, dart, ocaml/ml, fsharp/fs/f#, r/rscript, haskell/hs, perl/pl/pm, erlang/erl, clojure/clj/cljs/cljc/edn, scheme/racket/rkt/scm, julia/jl, groovy/gradle, tcl, verilog/v/systemverilog/sv, vhdl/vhd, fortran/f90/f95/f03, pascal/delphi/pas, vbnet/vb/vb.net/visualbasic, vbscript/vbs, latex/tex, protobuf/proto, nginx/nginxconf, cmake, plus cjs/mts/cts/cc/cxx/kts/objectivec/shellsession. The info string's first word must match a name or alias exactly (case-insensitive). Every language loads on demand: a block shows plain until its language has loaded, then re-highlights. Variables, built-ins, definitions and labels are coloured too (variables/definitions as properties, built-ins as functions, labels as meta).
- **ED-37a Mermaid blocks** are not highlighted as code; they render as diagrams (ED-52).

### 10.10 Folding and comments

- **ED-38** Foldable: callouts with `+`/`-` and at least one body line; `<details>` blocks (folded unless `<details open>`; header = the `<summary>` line if it follows, else the `<details>` line). *Mac:* headings do **not** fold. *Windows:* headings fold too (ED-38a).
- **ED-38a Heading folding** (Windows): every ATX heading's section — from the end of the heading line to just before the next heading of the same or higher level, or the end of the note — can fold. Fenced code and frontmatter are skipped when finding headings; sections that are only blank lines don't fold; setext headings don't fold. A small chevron sits in the left margin, shown on hover and always while folded (rotated −90°); a folded heading shows a "…" pill after its text, and clicking the pill or the chevron unfolds. The heading line itself is never hidden. Moving the cursor into a folded section unfolds it. Keys: Ctrl+Shift+[ folds the innermost section around the cursor (moving the cursor onto its heading), Ctrl+Shift+] unfolds on the cursor's line; View › Fold Heading / Unfold Heading / Fold All Headings / Unfold All (also in the command palette; editor command names `foldHeading`, `unfoldHeading`, `foldAllHeadings`, `unfoldAll`). Folds belong to each note's editor state (they don't leak between notes and survive switching back). Live preview and reading view only; not in source mode or embeds.
- **ED-39** Initial fold state is computed when a note is opened; folds typed later start open. Clicking the callout title/summary toggles; a small triangle chevron rotates −90° when folded (0.12 s). Active in live, reading and embeds; not in source mode.

### 10.11 Autocomplete

Active while typing outside code and frontmatter; max 60 options.

- **ED-40 `[[query`**: notes (label = title, detail = folder, ranked by recency) and aliases (detail "→ Title", ranked just below). Inserts the title (or the path without extension if titles are ambiguous; `Target|alias` for aliases) and adds `]]` unless present; cursor after `]]`.
- **ED-41 `![[query`**: as above plus attachments (label = file name, detail = folder; full path if the name isn't unique).
- **ED-42 `[[Note#`**: that note's headings in order (detail "H1"–"H6"); inserts heading text + `]]`.
- **ED-43 `#tag`** (≥1 character, after whitespace/line start): vault tags with counts, by count, max 50.
- **ED-44** Brackets `() [] {} '' ""` auto-close, so typing `[[` gives `[[|]]`.

### 10.12 Formatting commands

| Command (name) | Shortcut | Behaviour |
|---|---|---|
| Bold (`bold`) | ⌘B | Toggle `**` around each selection: remove if already wrapped (outside or inside the selection), else add and keep the inner text selected; empty selection → `****` cursor in the middle. For `*`, the inner `*` of `**` doesn't count as wrapped. |
| Italic (`italic`) | ⌘I | Same with `*` |
| Strikethrough (`strikethrough`) | ⇧⌘X | `~~` |
| Highlight (`highlight`) | ⇧⌘H | `==` |
| Inline code (`code`) | ⌘E | `` ` `` |
| Link (`link`) | ⌘K | `[sel]()` cursor in `()`; no selection → `[]()` cursor in `[]` |
| Task (`task`) | ⌘L | Per line: `- [ ]`↔`- [x]`; a bullet gets `[ ] `; anything else gets `- [ ] ` |
| Heading N (`heading0`–`heading3`) | ⌥⌘0–3 | Replace any `#…` prefix with N "#" + space; 0 removes |
| Bulleted / numbered list, quote | — | If every selected line has the prefix remove it; else replace each line's marker with `- `, `1. 2. 3.…`, or `> ` (indent kept) |
| Code block (`codeBlock`) | — | Wrap selected lines in fences, cursor after the opening fence; else insert an empty fenced block |
| Callout (`callout`) | — | `> [!note]\n> ` (selected lines become the body) |
| Divider (`divider`) | — | `---\n` (after a blank line if needed) |
| Table (`table`) | — | ED-32 |
| Find (`find`), `findNext`, `findPrevious`, `replaceAll`, `selectMatches` | ⌘F, ⌘G, ⇧⌘G | In-note search panel at the top |
| Undo/redo | ⌘Z / ⇧⌘Z | Editor history when the editor has focus, otherwise the focused native control |
| Table commands | §10.8 | `tableMoveRowUp/Down`, `tableMoveColumnLeft/Right`, `tableInsertRowAbove/Below`, `tableInsertColumnLeft/Right`, `tableDeleteRow/Column`, `convertToTable` |

Insertions on a non-empty line go after a blank line ("\n\n") where noted.

### 10.13 Lists and editing keys

- **ED-45** Return continues lists, tasks (new item gets `[ ]`), numbered lists (incrementing) and quotes; on an empty item it ends the list. Backspace right after markup deletes it/outdents. Tab/⇧Tab indent/outdent (outside tables).
- **ED-46** Backspace precedence: delete markup → clear empty heading (ED-15) → delete an empty auto-closed pair → normal delete.
- **ED-47** Standard editor features: multiple cursors, rectangular selection (⌥-drag), ⌘D select next occurrence, ⌘⇧L select all matches, ⌘⌥G go to line, ⌘/ toggles an HTML comment, drop caret when dragging.
- **ED-48** Pasting a URL over selected text makes `[sel](url)` (`www.` gets `https://`).

### 10.14 Text input

- **ED-49** Spellcheck on; autocorrect, autocapitalise, smart quotes, smart dashes and text replacement **off** (markdown needs literal characters: smart dashes break `---` table dividers; smart quotes break properties and links). Placeholder "Start writing…".

### 10.15 Hover previews and dev mode

- **ED-50 Hover preview**: holding ⌘ over a wikilink (or pressing ⌘ while over one) shows a popover after 120 ms; it hides 250 ms after the mouse leaves both the link and the popover; Escape or scrolling closes it. Content = the embed box (ED-20). Placed 6 px below the link (above if no room), kept 8 px inside the window, width min(460 px, 100vw−16 px), body max 340 px. `[[#Heading]]` in the same note shows nothing. Links inside the popover open on click (no nested popovers); clicking its header or a link closes it. Main editor only.
- **ED-51 Dev mode** (no native bridge, Mac build): `?sample=<url>` loads a document; embeds load from `/Editor/dev/<target>.md`; images from `/Editor/dev/<basename>`; messages log to the console. Fixtures: `Editor/dev/sample.md`, `showcase.md`, `Ilum Survey.md`, `crystal.png`. Use it for visual checks without the native shell.

### 10.16 Rich content (Windows)

Added in the Windows port (0.2.0). All of it follows the live-preview rule: rendered unless the editor is focused and a selection touches it; reading view and unfocused editors always render; source mode never does. Large libraries (Mermaid ~1.2 MB, KaTeX) load the first time a note needs them.

- **ED-52 Mermaid diagrams**: a fenced block whose info string's first word is `mermaid` (``` or ~~~, any fence length, any case, extra words allowed) renders as its diagram in a block widget; unclosed or empty blocks stay plain code. Clicking a diagram puts the cursor at the start of its code (shown raw). Rendering uses Mermaid with `securityLevel: "strict"` (no click handlers or raw HTML in labels) and the `base` theme coloured from the palette: node fill = chip, borders = accent glyph, text = body text, lines = muted. Diagrams redraw when the appearance or accent changes. While loading: "Drawing diagram…". A diagram Mermaid can't parse shows "Mermaid couldn’t draw this diagram: <first lines of the error>" instead of disappearing. Box: centred, 16 px padding, code background, 1 px border, 8 px radius, horizontal scroll for wide diagrams. Also rendered inside embeds. Results are cached (last 100) by theme + code.
- **ED-52a Diagram viewer**: each rendered diagram has an "Expand diagram" button (top-right, shown on hover or keyboard focus) that never enters edit mode; in reading view and embeds clicking the diagram also opens it. The viewer fills the window (24 px margin, backdrop rgba(0,0,0,.6), editor background, 12 px radius) and opens fitted (small diagrams enlarge up to 4×). Zoom: Ctrl+wheel or pinch at the pointer, double-click 2× at that point, buttons −/%/+/Fit (clicking % → 100%), keys `+` `-` `0` (fit) `1` (100%); range 5–800%. Pan: wheel, Shift+wheel horizontally, drag, arrow keys; at least 48 px of the diagram stays on screen. "Copy image" puts a PNG on the clipboard ("Copied" for 1.2 s). Esc, × or a backdrop click closes it and returns focus. Hint: "Scroll to pan · Ctrl+scroll to zoom · Esc to close". 120 ms fades and zooms, none under reduced motion. `diagramImage(code, {theme, scale})` exports a PNG (rendered without HTML labels so the canvas isn't tainted; "light" always uses the light palette on white).
- **ED-53 Math** (KaTeX, Obsidian/pandoc rules):
  - Display: `$$ … $$` on their own lines (multi-line), or `$$x$$` on one line → a centred block; not inside fenced code or frontmatter, not across a blank line, never if unclosed. Clicking puts the cursor after the opening `$$`; while editing, every line of the block is raw.
  - Inline: `$…$` → inline formula. The opening `$` must not be followed by whitespace; the closing `$` must not be preceded by whitespace nor followed by a digit; a `$` that can't close ends the search (so "costs $5 and $10" stays text); `\$` is a literal dollar; `$$` is never inline. Never inside inline/fenced/indented code, frontmatter, URLs, autolinks, HTML, wikilinks or tables (math in table cells stays raw). Single-line only.
  - Options: `throwOnError: false` (errors show the source in red), `output: "htmlAndMathml"`, `trust: false`, `strict: "ignore"`. Formulas inherit the text colour. Rendered HTML cached by (display mode, source). Not inside callouts or blockquotes.
- **ED-54 Emoji shortcodes**: the 1,913 GitHub shortcodes (gemoji 8.1, bundled; no network) render as their emoji on non-active lines; the file keeps the shortcode. Unknown names stay text. The opening `:` must not follow a letter, digit, `/` or `:` (except directly after another shortcode, so `:smile::rocket:` works) and no word character may follow the closing `:` — so `10:30:00` and `http://x:smile:` don't match. Skipped in code, frontmatter, URLs, wikilinks and table cells. **Autocomplete**: `:` plus ≥2 characters after whitespace or line start suggests shortcodes with their emoji; choosing one inserts the shortcode (`:rocket:`), not the character; ~90 popular shortcodes rank first.
- **ED-55 HTML** (like VS Code's preview, sanitised with DOMPurify):
  - Blocks: top-level HTML blocks (`HTMLBlock` in the markdown parser) render in a block widget; click to edit. A block that would render nothing (a lone `<div align="center">`/`</div>` wrapping markdown, `<script>…`) collapses. `<details>`/`<summary>` and lone `<br>` keep their ED-02 handling. HTML comments are hidden (whole-line comments collapse) unless being edited.
  - Inline: span, font, abbr, q, cite, code, em, strong, var, samp, dfn, time, big, tt (and the ED-02 tags when written with attributes) style their content, tags hidden; `<img>` renders inline; `<video>`/`<audio>` written on one line render whole.
  - Allowed tags: formatting, structure, tables, figure, center, font, img, video, audio, source, details/summary. Always removed: script, iframe, frame, object, embed, form, input, button, select, textarea, style, link, meta, base, svg, math, template, picture, track, canvas, dialog.
  - Allowed attributes include align, valign, alt, title, src, href, width, height, colspan, rowspan, style, color, face, size, bgcolor, border, controls, loop, muted, poster, start, type. Removed: on* handlers, srcset, srcdoc, formaction, ping, background, autoplay, id, name, class, data-*, aria-*.
  - CSS (`style`): kept — colour, background-color, text-align/decoration, font-*, spacing, width/height, margin (never negative), padding, border*, vertical-align, opacity. Dropped — position, display, transform, `url()`, expressions, escapes, comments, `attr()`/`env()`.
  - URLs: only http(s), mailto, `data:image/` (images only) and relative paths. Relative `src`/`poster` are served through the asset scheme (kind `relative`); a literal `holocron-asset:` URL in a note is dropped. No href survives sanitising: clicks on `<a>` go through the editor — http/https/mailto → `openURL`; a relative `.md` path, `#Heading` or `[[Target]]` → `openLink`; anything else does nothing.
  - Inline HTML other than the ED-02 tags shows raw inside rendered table cells.
- **ED-56 Media embeds**: `![[clip.mp4]]`, `![[clip.mp4|400]]` (width), `![](clip.webm)` → an HTML5 video player (mp4 webm mov m4v ogv); `![[song.mp3]]` → an audio player (mp3 wav m4a ogg flac aac opus); `![[paper.pdf]]` / `![[paper.pdf#page=3]]` → a PDF card (badge, file name, page hint, "Open" button that opens it in the default app) above the built-in Chromium PDF viewer (600 px tall, resizable). Placement and hiding as images (ED-19, ED-05). Players can seek (ARC-07 range requests). Missing: "File not found: <name>" in a dashed box (PDFs are checked with a HEAD request). Remote `https://` media isn't played.
- **ED-58 Formatted copy**: in live preview and reading view, Copy and Cut put both `text/plain` (the markdown, exactly as before) and `text/html` (the selection rendered for pasting into email, Teams or Word) on the clipboard; source mode copies markdown only. Edit › **Copy as Markdown** (Ctrl+Shift+C) copies only markdown in any mode. The HTML uses inline styles only, light colours whatever the app theme, and no forced body font: headings, emphasis, `==highlight==` (yellow), code chips and syntax-coloured code blocks, ☐/☑ tasks, tables with borders and alignment, callouts as tinted boxes in their family colour, quotes, footnotes numbered with definitions at the end. Wikilinks become their visible label as plain text; note embeds their title in italics; tags plain text; emoji shortcodes the emoji; math its TeX in monospace; media embeds "▶ clip.mp4" / "🎵 song.mp3" / "📄 paper.pdf"; comments and (when copied from line 1) frontmatter are dropped; raw HTML is sanitised as ED-55. The HTML is written immediately; a second pass then embeds vault images (≤10 MB, ≤640 px wide, as PNG data) and Mermaid diagrams (PNG, light theme) and rewrites the clipboard through main, only if it still holds that copy. In reading view a selection that starts or ends inside a table or diagram takes the whole block.
- **ED-59 Paste as Markdown**: pasting HTML (web pages, Word, Outlook, Teams, Google Docs) inserts clean markdown — headings, emphasis, `==highlight==`, lists (Word `mso-list` paragraphs become nested lists), tasks (checkboxes or ☐/☑), pipe tables (tidied), quotes, fenced code with its language, links (only http/https/mailto keep a URL), as one undo step. Images: `data:` images are saved as attachments ("Pasted image …"), `file:///` images (Outlook/Word temp files; image extensions only) are copied into the attachment folder, `http(s)` images stay as links, others become their alt text. Escaping only where text would otherwise start markdown. Precedence: read-only → nothing; inside code or frontmatter → plain text; a tab-separated grid (Excel) → the ED-33 table; a single URL over a one-line selection → `[sel](url)` (ED-48, `www.` gets `https://`); no HTML → plain text or image paste; images only → image paste; inside a table → plain text; Holocron's own formatted copy (marked `data-holocron-copy`) → its markdown; trivially plain HTML → plain text; otherwise converted. **Paste as Plain Text** (Ctrl+Shift+V, Edit menu) inserts the clipboard text unchanged.
- **ED-60 Context menu**: right-clicking in the editor or a text field opens the app's popup menu: spelling suggestions (up to 5, or "No Suggestions") and "Add “word” to Dictionary"; items for what's under the pointer — wikilink: Open Link / Open in New Tab; URL: Open Link / Copy Link Address; tag: Search for #tag; diagram: Expand Diagram / Copy Image; image: Copy Image / Open Image (vault images open in their default app); then Cut, Copy, Copy as Markdown, Paste, Paste as Plain Text, Select All (from the platform's edit flags; Cut and Paste hidden in reading view); and a Format submenu (Bold, Italic, Strikethrough, Highlight, Inline Code, Link) when editable text is selected. Other text fields get the spelling and edit items. Components with their own menus (file tree, tabs, recent vaults, tables) keep them. Menu actions go through the platform's edit commands, so formatted copy (ED-58) still applies.
- **ED-57 HTML tag autocomplete**: `<` plus letters (or `<` when completion is invoked explicitly), outside code and frontmatter, offers kbd, mark, sup, sub, u, b, i, s, small, ins, del, br, details, summary. Paired tags insert `<tag></tag>` with the cursor inside; `br` inserts `<br>`; `details` inserts a `<details>`/`<summary>` skeleton with the cursor in the summary (§19 #7).

---

## 11. User interface

### 11.1 Window and layout

- **UI-01** One window, title "Holocron", default 1280×820. Title bar shows the note title with the vault name as subtitle.
- **UI-02** No vault open → Welcome view (§11.9). Vault open → three columns:
  - **Sidebar** (min 200, ideal 260, max 400) — §11.2
  - **Detail**: tab bar → (formatting bar) → breadcrumb → (missing-file banner) → editor → status bar. Or a "Downloading…" view or the empty editor (§11.8).
  - **Inspector** (min 240, ideal 290, max 420; visibility persisted, default shown) — §11.3
- **UI-03 Toolbar**: left "Back" (help "Back (⌥⌘←)"), "Forward" ("Forward (⌥⌘→)"), disabled when unavailable; right "Today’s Note" ("Today’s Note (⇧⌘D)"), "Quick Open" ("Quick Open (⌘O)"), "New Note" ("New Note (⌘N)"), "Inspector" ("Show or hide the inspector (⌥⌘I)").
- **UI-04 Tab bar** (height 36): tabs share the width (each 120–240 px), scroll horizontally, the active one scrolls into view. "+" ("New Tab (⌘T)"). Tab: title (or "New Tab" with a dashed-plus icon), 12 pt, medium + full text colour when active; top corners rounded; active fill = editor background with border, hover fill = chip; tooltip = vault path. Trailing control priority: close × (hovered/active; label "Close <title>") → warning triangle (conflict/missing) → accent dot (unsaved) → nothing. Drag to reorder (2 px accent insertion bar). Context menu: "Close Tab", "Close Other Tabs", "Close Tabs to the Right", "Show in Finder".
- **UI-05 Breadcrumb** (height 36, 12 pt, tertiary text): vault folders separated by "/" then the file name with extension (emphasised).
- **UI-06 Formatting bar** (height 34; shown when enabled, not in reading view or focus mode). Buttons 28×26 with tooltips "<Title> — <markdown> (<shortcut>)":
  - Bold `**text**` (⌘B) · Italic `*text*` (⌘I) · Strikethrough `~~text~~` (⇧⌘X) · Highlight `==text==` (⇧⌘H) · Inline Code `` `code` `` (⌘E) · Link "[text](url) — or type [[ for a note link" (⌘K)
  - | Heading menu ("Heading 1", "Heading 2", "Heading 3", —, "Body Text"; help "Heading — # Heading, ## Heading… (⌥⌘1–3)") · Bulleted List `- item` · Numbered List `1. item` · Checklist `- [ ] task` (⌘L) · Quote `> quote`
  - | Code Block "```language … ```" · Table (opens the size picker; help "Table — pick a size, or type | a | b | and press ↩") · Callout `> [!note] Title` · Divider `---`
  - right: Markdown Help (?) → cheat sheet (§11.11).
- **UI-07 Status bar** (height 28, 11 pt; hidden in focus mode):
  - Left: status dot + save status (§14.1) with hover help; then iCloud status (§15.5) for cloud vaults.
  - Right: word count button ("1 word"/"N words"; with a selection "X of N words"; help "Word count — click for characters and reading time") → stats popover (§11.11); "Ln <n>, Col <n>"; mode menu (current mode title; inline picker; help "Switch between live preview, source mode and reading view").

### 11.2 Sidebar

- **UI-08 Vault switcher** (top): logo, vault name, abbreviated path, chevron; menu = other recent vaults, "Open Folder as Vault…", "Create New Vault…", "Show Vault in Finder", "Close Vault".
- **UI-09** Segmented "Files" / "Search".
- **UI-10 File tree**: section header "Files" with the note count (drop target for the root; help "Drop here to move to the top of the vault"; context menu "New Note", "New Folder"). Rows: folder/doc icon + name; cloud-only notes show a small download-cloud icon (filled while downloading; help "Stored in iCloud — downloads when you open it"). Selecting a note opens it. Return renames the selected row; Delete key asks to trash it.
- **UI-11 Inline rename**: text field (placeholder "Name") pre-filled and focused; Return commits, Esc cancels, losing focus commits. Error "Couldn’t rename “<name>”: <err>".
- **UI-12 Drag and drop**: rows drag as files; drop on a folder → into it; on a note → into its folder; on the header → root. **Drop highlight**: the destination folder (or the header for the root) gets a rounded accent outline (fill 18%, 1.5 px stroke 70%), animated 0.12 s; moving between rows never flickers.
- **UI-13 Context menus**: note — "Open in New Tab", "Rename", "Duplicate", "Show in Finder", "Move to Trash"; folder — "Rename", "New Note in Folder", "New Folder Inside", "Show in Finder", "Move to Trash".
- **UI-14 Tags section** (collapsible, state persisted): up to 100 tags with counts; click → Quick Open "#tag".
- **UI-15 Bottom bar**: "+ New Note" and a New Folder button ("New Folder (⌥⌘N)").

### 11.3 Inspector

- **UI-16** Segmented Outline / Links / Info (choice persisted). No note: "No note open".
- **UI-17 Outline**: headings indented by level; current heading (last at/before the cursor line) highlighted in accent; click scrolls the editor there. Empty: "Headings in this note appear here."
- **UI-18 Links**: "Backlinks" (count) — cards with title and up to 3 context lines; empty "No other notes link here yet." · "Unlinked mentions" (if any) · "Links from this note" (if any; unresolved dimmed with "Not created yet"; click creates). Section headers uppercase with a count chip.
- **UI-19 Info**: "Location" (folder or "Vault root"), "Words", "Characters", "Created", "Modified", "Aliases"; a "Properties" list (other frontmatter keys; empty → "—"); "Tags" as clickable pills; "Show in Finder".

### 11.4 Search panel (sidebar)

- **UI-20** Field "Search vault" with clear button and toggles "Aa" (Match case) and ".*" (Regular expression). Return reveals the first match. Focused when shown and on every ⇧⌘F.
- **UI-21** Summary: error / "Searching…" / "No results" / "<N matches|1 match> in <N notes|N+ notes|1 note>", plus "Collapse All"/"Expand All".
- **UI-22** Results grouped per note (title, count, expandable). Each line: snippet starting up to 24 characters before the first match (word boundary, "…" if trimmed), max 240 characters, matches bold on an accent background; help "Line N". "More matches in this note" past 20. Clicking opens the note and selects the match.
- **UI-23** Empty-query help: `kyber crystal` "notes with both words" · `"red shift"` "an exact phrase" · `-ilum` "leave out a word" · `tag:lore` "notes with a tag" · `path:Daily` "notes in a folder" · `file:log` "notes by name".

### 11.5 Quick Open / palette look

- **UI-24** Dimmed backdrop (click closes); panel 600 wide, 80 px from the top, radius 12; search row 52 tall with placeholder "Find a note, #tag, or > command" and an "esc" keycap; results max 420 tall; rows 40 tall, selected row filled with the primary button colour and white text; matched characters bold in accent; note rows show the folder on the right, alias hits "— alias “<alias>”"; section labels "Recent"/"Notes"/"Commands". Footer: "↑↓ navigate", "↵ open", "⌘↵ new tab", "⇧↵ create", "#tag · > commands".

### 11.6 Template picker

- **UI-25** Same style, 520 wide; placeholder "Insert template" or "New note from template". Rows show the subfolder. No templates: "No templates yet" + "Add notes to the “<folder>” folder and they’ll appear here. Templates can use {{title}}, {{date}}, {{time}} and {{cursor}}. Change the folder in Settings › Templates." No match: "No matching templates". New-note mode second step: "New note from “<template>”", field "Note name", hint "↵ create · esc cancel".

### 11.7 Built-in palette commands

In order: "New Note" ⌘N · "Open Today’s Note" ⇧⌘D · ("Insert Template…" ⌥⌘T and "Show Note in Finder", only with a note open) · "Previous Daily Note" ⌃⌘← · "Next Daily Note" ⌃⌘→ · "New Note from Template…" ⇧⌘N · "New Tab" ⌘T · "Toggle Inspector" ⌥⌘I · "Search Vault" ⇧⌘F · "Find in Note" ⌘F · "Open Folder as Vault…" ⇧⌘O · "Show Vault in Finder" · "Close Vault" ⇧⌘W · "Appearance: <Match System|Dark|Light>" (other than current) · "Accent Colour: <name>" (other than current) · then every other enabled menu item (skipping Services and Open Recent submenus; icon "checkmark" if checked).

### 11.8 Empty editor and downloading view

- **UI-26 Empty editor**: logo; heading "This vault is empty" / "No note open" / "New tab"; for an empty vault "Create a note, add .md files to the folder in Finder, or add a short guide to get started."; tiles (120×84) "New Note" ⌘N, "Today’s Note" ⇧⌘D, and "Start Here Guide" (empty vault) or "Quick Open" ⌘O; "Recent" list (up to 6 existing recent notes with folder); hint keycaps "⇧⌘P Commands", "⇧⌘F Search", "⌥⌘F Focus".
- **UI-27 Downloading view**: spinner + "Downloading “<name>” from iCloud…".

### 11.9 Welcome view and vault creation

- **UI-28** Min 820×560. Left brand panel: glowing logo, "HOLOCRON" (tracked uppercase), "Version <x>", "Your notes stay plain .md files in folders you choose. No database, no lock-in." Right: primary "Open Folder as Vault…" (subtitle "Dropbox, iCloud Drive, Syncthing, a Git repo — anywhere", ⇧⌘O), secondary "Create New Vault…" ("Start an empty folder"), "Recent vaults" list (context menu "Show in Finder", "Remove from Recents"), checkbox "Reopen last vault on launch".
- **UI-29** Open panel: title "Open Folder as Vault", button "Open Vault". Create panel: title "Create New Vault", button "Create Vault", label "Vault name:", default "My Vault"; creates the folder, installs the **Start Here guide** (UI-30) and opens "Start Here". Error "Couldn’t create the vault: <err>".
- **UI-30 Start Here guide**: two bundled notes, "Start Here.md" and "Linked Note.md", copied into new vaults (never overwriting existing files; `{{date}}` → ISO date) and via Help › "Add Start Here Guide to Vault" (opens it; new tab if a note is open; error "Couldn’t add the guide: <err>"). The guide demonstrates properties, a tip callout with the three key shortcuts, formatting, tasks, `[[Linked Note]]`, hover preview, `![[Linked Note#A section to embed]]`, tags, a shortcuts table, view modes, a folded callout and a code block. Reuse the files from `Holocron/Resources/Guide/` (update shortcuts for the target platform).

### 11.10 Toasts

- **UI-31** One toast at a time (a new one replaces the old), bottom-centre of the detail pane (44 px up), sliding in with a spring. Icon (check in "synced" green, or a warning cloud in amber), message (≤2 lines), optional action button (semibold, accent), dismiss ×. Auto-dismiss: **3 s** without an action, **6 s** with one, **12 s** for warnings. The action dismisses then runs. Announced to screen readers.

### 11.11 Popovers and sheets

- **UI-32 Note stats popover**: "Words", "Characters", "Without spaces", "Paragraphs" (non-empty blank-line-separated blocks), "Reading time" (230 wpm: "Under a minute" or "N min" rounded up); with a selection also "Selected words", "Selected characters".
- **UI-33 Table size picker**: 8×8 grid of 18 px cells; hover selects columns × rows (header row tinted stronger); caption "<cols> × <rows> table"; click inserts (rows−1 body rows, min 1). Default hover 3×3. Accessible label "Table size", value "N columns, N rows".
- **UI-34 Markdown cheat sheet** (popover, "Markdown cheat sheet"): Text (bold, italic, strikethrough, highlight, code, escape, `%% hidden %%`, `<kbd>`/`<sup>`), Headings (⌥⌘1–3), Links & embeds (`[[Note]]`, alias, heading, `^id`, web link ⌘K, embeds, image width, tags, footnotes), Lists (bullets, numbers, checklist ⌘L, `[-] [/] [>] [!] [?]`), Blocks (quote, callout, folded callout, code block, "| a | b |  then ↩" "Table — Tab and ↩ move between cells", divider, `<details>`), Properties. Syntax shown monospace in accent, selectable. *Windows* adds Mermaid, math, emoji shortcodes, media embeds and HTML, and shows Ctrl-based shortcuts.
- **UI-35 Conflict sheet** — §14.5. **Missing-file banner** — §14.2.
- **UI-36 Settings window** — §13.

---

## 12. Commands and keyboard shortcuts

Every command must be reachable from a menu (and so from the palette).

**File**: New Note ⌘N · New Note from Template… ⇧⌘N · New Folder ⌥⌘N · New Tab ⌘T · *Windows:* Quick Capture (the system-wide shortcut, default Win+Alt+N; §22) · Quick Open… ⌘O · Command Palette… ⇧⌘P · Open Folder as Vault… ⇧⌘O · Create New Vault… · Open Recent Vault › · Save ⌘S · Close Tab ⌘W · Close Vault ⇧⌘W · *Windows:* Exit Holocron (quits even when running in the background; §22)

**Edit**: Undo ⌘Z · Redo ⇧⌘Z · (standard Cut/Copy/Paste/Select All) · *Windows:* Copy as Markdown Ctrl+Shift+C (ED-58) · Paste as Plain Text Ctrl+Shift+V (ED-59) · Find in Note… ⌘F · Search Vault… ⇧⌘F

**View**: Show/Hide Inspector ⌥⌘I · Show/Hide Formatting Bar · View Mode (Live Preview / Source Mode / Reading View) · Toggle Reading View / Back to Editing ⇧⌘E · Toggle Source Mode ⌥⌘E · Enter/Exit Focus Mode ⌥⌘F · (standard Show/Hide Sidebar) · *Windows:* Fold Heading Ctrl+Shift+[ · Unfold Heading Ctrl+Shift+] · Fold All Headings · Unfold All (ED-38a)

**Go**: Today’s Note ⇧⌘D · Previous Daily Note ⌃⌘← · Next Daily Note ⌃⌘→ · Back ⌥⌘← · Forward ⌥⌘→ · Show Next Tab ⌃⇥ · Show Previous Tab ⌃⇧⇥ · Tab 1–8 ⌘1–⌘8 · Last Tab ⌘9

**Format** (disabled with no note or in reading view): Insert Template… ⌥⌘T · Bold ⌘B · Italic ⌘I · Strikethrough ⇧⌘X · Highlight ⇧⌘H · Inline Code ⌘E · Insert Link ⌘K · Toggle Checklist Item ⌘L · Bulleted List · Numbered List · Quote · Code Block · Callout · Divider · **Table ›** (Insert Table · Convert Selection to Table · Insert Row Above ⌃⌥⇧↑ · Insert Row Below ⌃⌥⇧↓ · Insert Column Left ⌃⌥⇧← · Insert Column Right ⌃⌥⇧→ · Move Row Up ⌃⌥↑ · Move Row Down ⌃⌥↓ · Move Column Left ⌃⌥← · Move Column Right ⌃⌥→ · Delete Row ⌃⌥⌫ · Delete Column ⌃⌥⇧⌫) · Heading 1–3 ⌥⌘1–3 · Body Text ⌥⌘0

**Help**: Add Start Here Guide to Vault · *Windows:* Check for Updates… (§22)

**App**: Settings… ⌘,

Editor-only keys: §10.8, §10.11–10.13. Palette/picker keys: §9.1.

---

## 13. Settings

Stored per user (Mac: UserDefaults). Window with four tabs; the last tab is remembered.

| Tab | Label | Key | Default | Notes |
|---|---|---|---|---|
| General | Reopen the last vault when Holocron starts | `reopenLastVault` | on | |
| General › Files | Update links when renaming or moving notes | `updateLinksOnMove` | on | |
| General › Files | Name new notes from their first line | `nameNotesFromFirstLine` | on | |
| General › Sync | Merge outside changes automatically when they don’t overlap | `autoMergeExternalChanges` | on | Note: "When another app or device changes a note you’re editing, Holocron combines both sets of changes if they touch different lines. Overlapping changes always ask first." |
| Appearance | Appearance: Match System / Dark / Light | `appearance` | system | |
| Appearance | Dark theme (*Windows*): Holocron Dark / Dark+ / One Dark / Dracula / Nord / GitHub Dark / Solarized Dark | `darkTheme` | "holocron-dark" | Preview cards (§16.10); used whenever the effective appearance is dark. Applies on click. Unknown ids fall back to the default |
| Appearance | Light theme (*Windows*): Holocron Light / Light+ / GitHub Light / Solarized Light | `lightTheme` | "holocron-light" | As above, for light |
| Appearance | Crystal: Theme default (*Windows*) / Kyber Blue / Sith Red / Jedi Green / Temple Gold | `accent` | kyber | swatches; "theme" = the active colour theme's own accent (Holocron's is Kyber Blue) |
| Editor | Show the formatting bar above notes | `showFormattingBar` | on | |
| Editor | Font: System / Serif / Monospaced | `editorFont` | system | §16.3 |
| Editor | Text size (13–24, step 1, "N pt") | `editorFontSize` | 16 | |
| Editor | Line width (560–1100, step 20, "N pt") | `editorLineWidth` | 720 | |
| Editor | Readable line length — limit the text width instead of filling the window (*Windows*; also View › Readable Line Length) | `readableLineLength` | on | Off: the text column grows with the window; the Line width slider hides |
| Editor | Attachment folder (prompt "Vault root") | `attachmentFolder` | "Attachments" | "Pasted images and files dropped in from outside the vault are saved here, relative to the vault. Leave it empty to use the vault root." |
| Templates | Templates folder | `templatesFolder` | "Templates" | Explains placeholders (TPL-02) |
| Templates › Daily notes | Folder | `dailyNoteFolder` | "Daily" | |
| Templates › Daily notes | Date format | `dailyNoteFormat` | "YYYY-MM-DD" | Shows a live "Today’s note" example path. "Uses Obsidian’s date format: YYYY year, MM month, DD day, dddd weekday. A “/” makes subfolders, e.g. YYYY/MM/YYYY-MM-DD." |
| Templates | Daily note template (prompt "None") | `dailyNoteTemplate` | "" | "It can use {{date}}, {{date:dddd, MMMM D}}, {{time}}, {{title}}, {{yesterday}} and {{tomorrow}}." |
| Templates | Open today’s note when Holocron starts | `openDailyNoteOnLaunch` | off | |
| General › Updates (*Windows*) | Check for updates automatically | `checkForUpdates` | on | Also shows the version, update status and a Check for Updates / Restart to Update button |
| General (*Windows*) | Keep Holocron running in the background when the window is closed | `runInBackground` | on | "Closing the window hides Holocron in the notification area, so quick capture keeps working. Quit from the tray icon or File › Exit Holocron." Off: closing the window quits and there's no tray icon |
| General (*Windows*) | Start Holocron when you sign in to Windows | `launchAtLogin` | off | Registers a sign-in item running `Holocron.exe --hidden` (installed app only); starts hidden in the tray when running in the background is on |
| General › Quick capture (*Windows*) | Open quick capture with a keyboard shortcut from any app | `quickCaptureEnabled` | on | |
| General › Quick capture (*Windows*) | Shortcut (a key recorder with Reset) | `quickCaptureShortcut` | "Super+Alt+N" (shown "Win+Alt+N") | Stored as an Electron accelerator, canonical order Super, Ctrl, Alt, Shift, key; needs Ctrl, Alt or Win plus one key (never Esc). Refused: Holocron's own shortcuts ("Holocron already uses Ctrl+Alt+N for “New Folder”.") and combinations without Ctrl/Alt/Win ("Use Ctrl, Alt or the Windows key together with another key."). If Windows won't register it: "That shortcut is in use by another app." |
| General › Quick capture (*Windows*) | Save captures to: Today’s note / Inbox note | `quickCaptureTarget` | daily | `daily` / `inbox`; the capture window can switch for one capture |
| General › Quick capture (*Windows*) | Inbox note (prompt "Inbox.md") | `quickCaptureInbox` | "Inbox.md" | A vault path; ".md" added if missing; created when needed. Paths that climb out of the vault or into a hidden folder are refused |
| (View menu) | View mode | `editorMode` | livePreview | livePreview / source / reading |

UI state also persisted: inspector visible (`showInspector`), inspector tab, tags section expanded, settings tab, per-vault tabs and recents (§7).

---

## 14. Saving, outside changes and conflicts

The heart of P2. A port must reproduce this logic exactly; it is what makes the app safe with Dropbox, iCloud, Git and other editors.

### 14.1 Saving

- **SAV-01** Each open note keeps `text` (editor), `savedText` (last read from/written to disk — the merge base), `isDirty = text != savedText`, `lastSaved`, `saveError`, `conflict`, `isMissingOnDisk`, `lastSyncEvent` (reloaded/merged + time). Typing back to the saved text clears dirty.
- **SAV-02 Autosave**: 1 s after typing stops (each change restarts the timer).
- **SAV-03 save()**: cancel the pending autosave → if a conflict is open, do nothing → if not dirty and not missing, stop → **if the disk text differs from `savedText`, reconcile (§14.3) instead of writing** → else write.
- **SAV-04 write**: atomic (temp file + rename), creating parent folders, coordinated with sync services where the platform supports it. Success sets `savedText`, clears missing/error, sets `lastSaved`. Failure sets `saveError` (shown in the status bar); the note stays dirty.
- **SAV-05 Triggers**: autosave; ⌘S (saves every loaded note); switching tabs; navigating the active tab; closing tabs (unloading); before moving/renaming/duplicating; app deactivate and quit; closing the vault; link rewrites (immediate).
- **SAV-06 Status text** (priority order): "Couldn’t save: <error>" (red) · "Changed on disk — choose a version" (amber) · "Not on disk" (amber) · "Editing…" · "Merged changes from disk" / "Updated from disk" (if the last sync event is newer than the last save) · "Saved to disk" (green). Hover: the error, "Not saved in this session yet", or "Last saved at <time>" (date included if not today).

### 14.2 Watching and missing files

- **SAV-07** Watch the whole vault recursively (latency 0.2 s), filter hidden paths, deliver vault paths in batches on the UI thread.
- **SAV-08** On a batch: rescan the tree and attachments (update only if changed); queue index re-reads of changed notes; run cloud checks (§15); then for each loaded note affected (path equal, or a parent folder changed, or the root) → reconcile.
- **SAV-09 Missing file**: if a loaded note's file is gone → `isMissingOnDisk`. If it has no unsaved edits and no conflict, wait **1.5 s** (some sync tools delete then rewrite), re-check, and close its tabs if still gone. If it has edits, show the banner: "This note was deleted or moved outside Holocron. Your unsaved edits are still here." with "Discard Edits" and "Restore" (default; saves, re-creating the file).

### 14.3 Reconcile decision table

Run on watcher events for the note, before every save that finds the disk changed, and in the missing-file check. In order:

| # | Situation | Result | Status |
|---|---|---|---|
| 0 | File gone | missing | "Not on disk" + banner |
| 1 | Cloud service holds another device's version (§15.3) | other-device conflict (quietly resolved if identical) | sheet |
| 2 | A non-disk conflict is open | ignore | — |
| 3 | A disk conflict is open | refresh it with the latest disk text | sheet updates |
| 4 | disk == savedText | nothing (our own write / no real change) | unchanged |
| 5 | disk == text | adopt disk as saved (clean, no event) | "Saved to disk" |
| 6 | Not dirty | reload: take disk text, event *reloaded* | "Updated from disk" |
| 7 | Dirty, auto-merge on, 3-way merge clean | text = merged, savedText = disk, event *merged*, autosave if merged ≠ disk | "Merged changes from disk" |
| 8 | Dirty, overlapping (or auto-merge off) | disk conflict; autosave cancelled; nothing written | sheet |

- **SAV-10** Outside text changes reach the editor as minimal line edits (UTF-16 offsets) so the cursor and undo history survive.

### 14.4 Three-way merge

- **SAV-11 Lines** keep their terminators; joining gives the exact text. Break on LF and on CRLF as **one** break; a lone CR is not a break; "" → no lines.
- **SAV-12 Diff**: exact line comparison; strip common prefix/suffix; Myers O(ND) shortest edit script on the middle (prefer insertion when `k == -d || (k != d && v[k-1] < v[k+1])`); gaps between matches become hunks (half-open base and other ranges).
- **SAV-13 Merge(base, mine, theirs)**: shortcuts mine==theirs → mine; mine==base → theirs; theirs==base → mine. Otherwise diff both sides against base, sort hunks by base position, group hunks whose base ranges **overlap or touch** (`start <= groupEnd`), copy unchanged base lines between groups; per group: only mine changed → mine; only theirs, or identical slices → theirs; else a conflict (record base/mine/theirs slices). Clean iff no conflicts.

**Acceptance**: edits on different lines merge; prepend + append merge; identical edits merge; different additions at the same place conflict; deletion + distant edit merge; 2000-line documents merge correctly; CRLF round-trips; edit offsets count UTF-16 (emoji = 2).

### 14.5 Conflict sheet

Modal (cannot be dismissed by clicking outside), 740 wide. Header icon, title, summary ("One section differs"/"N sections differ"), two side-by-side diff columns (2-way diff of the current text vs the other version; up to 30 blocks with one context line; mine tinted accent, other tinted amber; "(removed)"/"(not present)" for empty sides; monospace, selectable). The last button is the default (Return). While any conflict is open nothing is saved.

| Origin | Title | Columns | Buttons → effect |
|---|---|---|---|
| **Disk** (outside change vs unsaved edits) | "“<file.md>” changed on disk"; summary "Another app or device changed this note while you had unsaved edits. <sections>[, and some of your edits overlap the outside change]." | "Your edits · unsaved" / "On disk" | **Keep Both as Copies** — save mine as a copy, show disk · **Use Disk Version** — discard my edits · **Merge Both** — only when clean · **Keep My Edits** (default) — overwrite disk. Plus checkbox "Merge automatically when changes don’t overlap". |
| **Other device** (§15.3) | "“<title>” was changed on another device"; "iCloud kept two versions: this Mac’s and <device>’s (<date>). <sections>. Pick one, or keep both." | "This Mac" / device name | **Keep Both as Copies** — keep mine here, save theirs as a copy · **Use <device>’s Version** — write theirs to the file · **Keep This Mac’s Version** (default) — write mine. All resolve every pending version with the cloud service. |
| **Duplicate** (§15.4) | "“<copy>” may be a duplicate of “<title>”"; "iCloud sometimes saves a numbered copy when a note changes on two devices at once. <sections>. Keeping either version moves the copy to the Trash." | "<title>" / "<copy>" | **Keep Both Notes** — leave both · **Use “<copy>”** — put the copy's text in the original, trash the copy · **Keep “<title>”** (default) — trash the copy. Trashing shows the Undo toast. |

- **SAV-14 Conflicted copy name**: `<title> (conflicted copy yyyy-MM-dd HHmm).<ext>` in the same folder (POSIX locale, local time), numbered if taken; written without overwriting. If writing the copy fails, the conflict stays open and the error shows.
- **SAV-15** Help texts: "Save your version as a separate “conflicted copy” note and show the disk version here", "Discard your unsaved edits", "Combine both sets of changes" / "Your edits and the outside change touch the same lines", "Overwrite the disk version with yours", and the equivalents for the other origins.

**Acceptance** (from the sync tests): a clean note reloads quietly; our own save isn't an outside change; non-overlapping edits auto-merge and save; overlapping edits raise a conflict and block saving; auto-merge off always asks; saving checks the disk first; each resolution writes what it says; a deleted file is reported missing and can be restored; the watcher reports relative paths, ignores hidden ones, picks up outside edits and new files, and closes notes deleted elsewhere after the grace period.

---

## 15. Cloud-synced vaults

The Mac build targets iCloud Drive; the same ideas apply to OneDrive, Dropbox and Google Drive on other platforms (§17.4).

- **CLD-01 Coordinated I/O**: every read, write, create, copy, move, rename and trash goes through the platform's file-coordination mechanism (Mac: NSFileCoordinator) so the sync service never sees a half-done change. Harmless for local folders.
- **CLD-02 Offloaded files**: a note whose content isn't on this device (Mac: download status "not downloaded"; macOS 15+ keeps the real name with no local data) must never be read on the UI thread (it would block while downloading).
  - Sidebar: a download-cloud icon (filled while downloading).
  - Opening: the tab opens immediately and shows "Downloading “<name>” from iCloud…"; the download runs in the background; when done the note shows (if a tab still wants it). Failure: "Couldn’t download “<name>” from iCloud: <err>".
  - Index: offloaded notes are skipped in the main pass and downloaded in the background (4 at a time), each indexed as it arrives — so search and backlinks don't silently miss them.
- **CLD-03 Other-device versions**: when the sync service holds an unresolved version from another device, opening or reconciling the note raises the other-device conflict (§14.5) with the newest version (device name and date); if it's identical to the current text, resolve silently. Closed notes with such versions get a warning toast "“<title>” has a version from another device" with **Review** (opens the note).
- **CLD-04 Duplicate copies** (cloud vaults only): a note that newly appears named "<Name> N" (N = 2–9, exact pattern `^(.+) ([2-9])$` on the title) beside an existing "<Name>" with the same extension, and that the app didn't create itself this session, gets a warning toast "“<Name> N” looks like an iCloud duplicate of “<Name>”" with **Compare** (opens the duplicate conflict sheet). Only one cloud toast per batch; duplicates checked first.
- **CLD-05 Status** (cloud vaults only; polled every **3 s** while syncing, **30 s** otherwise, and after every watcher batch; computed off the UI thread):

| State | Icon | Label | Help |
|---|---|---|---|
| Up to date | cloud | — | "Synced with iCloud" (+ " 1 note is / N notes are stored only in iCloud and will download when opened.") |
| Syncing | cloud with arrows | "Syncing N" / "Uploading N" / "Downloading N" | "Uploading N to iCloud · Downloading N from iCloud" |
| Error | cloud with "!" (red) | "iCloud problem" | "iCloud couldn’t sync: <message>" |
| Unavailable | cloud with slash (amber) | "Not syncing" | "This vault is in the iCloud Drive folder, but iCloud Drive isn’t syncing it. Check that iCloud Drive is on in System Settings › Apple Account › iCloud." |

Uploading = item uploading or not yet uploaded; downloading = item downloading or awaiting download by the app; errors = the first upload/download error. A vault is "in iCloud Drive" when its path contains `/Library/Mobile Documents/`.

**Acceptance**: coordinated operations work on ordinary folders; local vaults have no cloud status; numbered copies are recognised (not "Name 10", not without an original); a synced duplicate offers Compare and each choice does what it says; the app's own numbered names and non-cloud vaults never trigger it; another device's version raises a never-clean conflict; Keep Both stores the other version as the copy; identical versions resolve quietly; closed notes offer Review.

---

## 16. Visual design

### 16.1 Palette

| Token | Dark | Light | Use |
|---|---|---|---|
| editorBackground | #0F1115 | #FFFFFF | editor, active tab |
| sidebarBackground | #15181E | #F4F5F7 | sidebar, tab bar |
| panelBackground | #13161B | #F7F8FA | inspector, welcome panel, toasts |
| overlayBackground | #1A1D23 | #FFFFFF | palette, sheets, editor menus |
| raised | #181B21 | #FFFFFF | cards, vault switcher |
| chip | #1E222A | #EBEDF0 | hovers, pills, keycaps |
| border | #23272F | #E3E5E9 | |
| strongBorder | #343A45 | #CDD1D7 | |
| strongText | #F2F4F7 | #111318 | headings |
| text | #E6E8EC | #1C1F24 | UI text |
| bodyText | #D8DBE0 | #2A2E35 | note text |
| emphasizedSecondaryText | #C9CDD4 | #3A3F47 | quotes |
| secondaryText | #9AA1AD | #5F6672 | |
| tertiaryText | #8A919D | #6B7280 | muted |
| faintText | #6B7280 | #9AA1AD | markup on active lines |
| codeBackground | #161A20 | #F4F5F7 | code, embeds, table header |
| synced | #3DD68C | #1F9D5C | success |
| warning | #E8C15A | #9A6B00 | warnings |

### 16.2 Accents ("crystals")

| Accent | Glyph dark | Glyph light | Text dark | Text light | Fill (white text ≥4.5:1) |
|---|---|---|---|---|---|
| Kyber Blue (default) | #5AB4FF | #1F6FBF | #9CCFFF | #1A5FA6 | #2A72BD |
| Sith Red | #FF6B70 | #C42F35 | #FFA3A6 | #A8262B | #C03A40 |
| Jedi Green | #7CD992 | #2A7A3B | #A8E8B6 | #236A32 | #2E7D40 |
| Temple Gold | #E8C15A | #8F6B00 | #F1D58C | #7A5B00 | #86650F |

Glyph = links, cursor, icons, checkboxes; Text = tags, current outline item, accent text; Fill = primary buttons and selected palette rows.

### 16.3 Typography

- UI: system font (Mac SF Pro; Windows Segoe UI Variable; Linux system-ui). Common sizes 11 (labels, status; section headers uppercase semibold with 0.6 tracking), 12, 13, 14, 16–18 (fields).
- Editor font stacks: System `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif` · Serif `ui-serif, 'New York', Georgia, serif` · Mono `ui-monospace, 'SF Mono', Menlo, monospace` (port: add Segoe UI / Cambria / Cascadia Mono / Consolas equivalents).
- Editor: line-height 1.65; content max-width = line width + 64 px, centred, 32 px side padding; scroller padding 28 px top, 35vh bottom; caret 2 px accent; selection accent 28%.

### 16.4 Editor elements

- Headings (strong colour): H1 2.125em/700/lh 1.25/top 10 px/−0.01em · H2 1.44em/650/1.3/14 px · H3 1.19em/650/1.35/10 px · H4 1.06em/650/8 px · H5 0.94em/650/6 px · H6 0.88em/650/6 px muted.
- Tags: accent text on accent 14%, radius 10, padding 1×7, 0.88em. Inline code: 0.86em monospace on chip, radius 4. Highlight: dark rgba(232,193,90,.32), light rgba(255,214,0,.42). Search matches rgba(232,193,90,.25), current .55. Blockquote: 3 px left border (strong border), 14 px padding. Rule: 1 px strong border. Checkbox 16 px radius 4.

### 16.5 Callout colours (RGB; tint at 10%, borders 32%)

| Family | Dark tint | Dark title | Light tint | Light title |
|---|---|---|---|---|
| blue | 90,180,255 | 140,203,255 | 31,111,191 | 26,95,166 |
| green | 61,214,140 | 120,226,172 | 31,157,92 | 26,115,64 |
| purple | 176,148,255 | 196,176,255 | 118,84,214 | 98,66,186 |
| yellow | 232,193,90 | 240,210,130 | 196,146,0 | 128,92,0 |
| red | 255,107,107 | 255,150,150 | 196,47,53 | 168,38,43 |
| gray | 154,161,173 | 190,196,205 | 107,114,128 | 75,81,92 |

### 16.6 Code token colours

| Token | Dark | Light |
|---|---|---|
| keyword | #C792EA | #8A3FBF |
| string | #A5D6A7 | #2E7D32 |
| number | #F78C6C | #B8501E |
| comment (italic) | #6B7280 | #8A919D |
| function | #82AAFF | #1F5FBF |
| type | #FFCB6B | #8F6B00 |
| property | #89DDFF | #0B7285 |
| tag | #F07178 | #C42F35 |
| punctuation | #9AA1AD | #5F6672 |
| meta | #C3A6FF | #6A4FC2 |

### 16.7 CSS variables sent to the editor

`--hc-bg` editorBackground · `--hc-text` bodyText · `--hc-strong` strongText · `--hc-muted` tertiaryText · `--hc-faint` faintText · `--hc-quote` emphasizedSecondaryText · `--hc-border` border · `--hc-strong-border` strongBorder · `--hc-raised` codeBackground · `--hc-chip` chip · `--hc-panel` overlayBackground · `--hc-accent` accent glyph · `--hc-accent-rgb` same as "r, g, b" · `--hc-accent-text` accent text · `--hc-font` font stack · `--hc-font-size` "<n>px" · `--hc-line-width` "<n>px". Re-sent whenever appearance, accent, font, size or width changes. (`--hc-highlight` and `--hc-syn-*` live in `editor.css`.)

*Windows:* every colour comes from the active colour theme (§16.10), so the port also sends `--hc-theme` (theme id; Mermaid redraws when it changes) · `--hc-heading` heading colour · `--hc-accent-fill` · `--hc-selection` · `--hc-highlight` · `--hc-search-match-rgb` · `--hc-synced` · `--hc-danger` · `--hc-syn-<token>` (keyword, control, string, number, comment, function, type, variable, property, attribute, tag, punctuation, regexp, meta) · `--hc-callout-<family>` and `--hc-callout-<family>-text` ("r, g, b") · `--hc-callout-body`. `editor.css` keeps Holocron Dark/Light values only as fallbacks.

### 16.8 Logo

An isometric cube on a 24-unit grid: hexagon through (12,2) (21,7) (21,17) (12,22) (3,17) (3,7) with three inner edges from the centre (12,12) to (21,7), (12,22) and (3,7); 1.5 px stroke, round joins/caps, accent colour. "Glowing" variant: 22% fill, a white centre dot (3× stroke width) and an accent shadow (55%, radius 12). App icon PNGs at 16–512 px (@1x/@2x) in `Assets.xcassets/AppIcon.appiconset`.

### 16.9 Motion

Tab scroll 0.15 s; focus-mode transitions 0.2 s; drop highlight 0.12 s; fold chevron 0.12 s; toast spring 0.3 s; dimming 0.2 s. A port should respect the OS "reduce motion" setting (not yet done on Mac — §21).

### 16.10 Colour themes (*Windows*)

The Appearance setting still picks dark or light (or follows Windows); `darkTheme` / `lightTheme` (§13) pick which palette each uses, so Match System can be Dark+ at night and Light+ by day. Themes are pure data in `src/shared/themes.ts`, shared by the renderer (CSS variables, `lib/theme.ts`) and the main process (window background = sidebarBackground; title-bar overlay = titleBar with emphasizedSecondaryText symbols, updated on any appearance, theme or Windows theme change).

| Theme | Kind | Source |
|---|---|---|
| Holocron Dark / Holocron Light | dark / light | §16.1 (unchanged); theme accent Kyber Blue |
| Dark+ / Light+ | dark / light | VS Code "Default Dark+" / "Default Light+" (editor, sidebar, title bar, widget, input, border, selection colours and token colours from the built-in theme files) |
| One Dark | dark | Atom One Dark (One Dark Pro port) |
| Dracula | dark | draculatheme.com/spec |
| Nord | dark | nordtheme.com palette (nord0–nord15) |
| GitHub Dark / GitHub Light | dark / light | GitHub Primer "dark default" / "light default" (prettylights syntax) |
| Solarized Dark / Solarized Light | dark / light | ethanschoonover.com/solarized |

Each theme defines all §16.1 tokens plus `titleBar` (the 40 px title bar and window-button overlay; equals sidebarBackground except Dark+ #3C3C3C and Light+ #DDDDDD, whose title-bar hovers use a translucent white/black instead of chip), the 14 code tokens (§16.6 plus control keyword, variable, attribute and regexp), the ==highlight== and search-match colours, a tint and title colour per callout family, and a theme accent (glyph, text, fill). Optional: `heading` (Dark+ #569CD6, Light+ #800000, One Dark #E06C75, Dracula #BD93F9, Nord #88C0D0, Solarized #268BD2 — the themes' markdown heading colours), `quote` (blockquote text: Dark+ #6A9955, Light+ #0451A5, Dracula #F1FA8C, GitHub fg.muted; callouts keep emphasizedSecondaryText) and `selection` (Dark+ #264F78, Light+ #ADD6FF, One Dark #3E4451, Dracula #44475A, Nord #434C5E, Solarized Dark #274642; others use the accent at 28%).

Token mapping: editorBackground = the theme's editor background; sidebarBackground = side bar (also the tab strip); panelBackground = side bar / secondary side bar; overlayBackground = quick input / menus / widgets; raised and chip = inactive tab, input or list-hover colours; border / strongBorder = panel and widget borders; bodyText = editor foreground; text = workbench foreground; tertiaryText = description / line-number foreground; faintText = comment-like grey; codeBackground = a step off the editor background. Where a theme has no equivalent (Nord's and Dracula's muted UI greys, Nord's darker sidebar #2A2F3A) a value was derived from its palette.

Contrast (tests/shared/themes.test.ts): body and UI text ≥ 4.5:1 on the editor, sidebar and overlays; muted and secondary text ≥ 3:1; headings, accent glyphs and callout titles ≥ 3:1; accent text ≥ 4.5:1; white on every theme's accent fill (and every crystal fill) ≥ 4.5:1 (Dark+'s #007ACC is 4.51:1). Exception by design: Solarized Light uses base01 (#586E75) for body text, because Solarized's base00 on base3 is only about 4.1:1. Code token colours are the themes' own and aren't held to a ratio (Solarized's are around 3:1).

Accent: "Theme default" (`accent: "theme"`) uses the theme's accent — Dark+ glyph #3794FF / text #75BEFF / fill #007ACC, Light+ #005FB8, One Dark #61AFEF / fill #3E6FCB, Dracula #BD93F9 / fill #7349C2, Nord #88C0D0 / fill #4C6F99, GitHub #4493F8 or #0969DA / fill #1F6FEB or #0969DA, Solarized #268BD2 / fill #1D6EA8. The four crystals still work with every theme (their dark or light values follow the theme's kind).

Command palette: "Theme: <name>" for every theme sets darkTheme or lightTheme and, if the window is currently showing the other kind, also sets Appearance to Dark or Light so the choice is visible. "Crystal: Theme default" joins the crystal commands.

---

## 17. Porting guide

### 17.1 Component mapping (Mac → Electron)

| Mac | Electron / cross-platform |
|---|---|
| SwiftUI shell | Electron main process + a renderer UI (React/Svelte/Solid…) |
| WKWebView editor + `webkit.messageHandlers` | Reuse `Editor/src` as-is in the renderer (or a sandboxed `<webview>`); replace `post()` with `ipcRenderer` / a preload `contextBridge` API |
| `holocron-asset://` scheme | `protocol.handle('holocron-asset', …)` in main, with the same vault-confinement checks (ARC-07) |
| FSEvents watcher | `@parcel/watcher` or `chokidar` (recursive, ignore dot-paths, ~200 ms batching) |
| Atomic writes | write temp file in the same folder, `fs.rename` (on Windows retry on EBUSY/EPERM from AV/indexers) |
| NSFileCoordinator | No direct equivalent; atomic writes plus watcher reconcile already give safety |
| Trash (`trashItem`) | `shell.trashItem(path)` — note it doesn't return the item's new location, so Undo-from-Trash needs a different approach (e.g. move to an app-managed `.holocron/trash` first, or use the Windows Shell API) |
| "Show in Finder" | "Show in Explorer"/"Show in Folder" → `shell.showItemInFolder` |
| Open in default app / browser | `shell.openPath` / `shell.openExternal` (http/https/mailto only) |
| UserDefaults | `electron-store` or a JSON file in `app.getPath('userData')` |
| NSOpenPanel / NSSavePanel | `dialog.showOpenDialog({properties:['openDirectory','createDirectory']})` / save dialog |
| SF Symbols | An icon set (e.g. Lucide/Phosphor) — keep the same metaphors |
| Menu bar + palette harvesting | `Menu.buildFromTemplate`; build the palette from the same command registry (simpler than walking the menu) |
| NSFileVersion (other-device versions) | Not available; detect provider conflict copies by name instead (§17.4) |
| System beep | `shell.beep()` |
| Accessibility announcements | ARIA live region |

### 17.2 Shortcuts on Windows/Linux

Map ⌘ → Ctrl, ⌥ → Alt, ⇧ → Shift, ⌃ → Ctrl where it would otherwise clash. As built in the Windows port:

| Mac | Windows | Why |
|---|---|---|
| ⌘ (most) | Ctrl | |
| ⌥⌘← / ⌥⌘→ Back/Forward | Alt+← / Alt+→, and the mouse's back/forward buttons | Platform convention |
| ⌃⌘← / ⌃⌘→ daily notes | Alt+PageUp / Alt+PageDown | Ctrl+Alt+arrows rotates the screen on many PCs (Intel graphics) |
| ⌃⇥ / ⌃⇧⇥ tabs | Ctrl+Tab / Ctrl+Shift+Tab (also Ctrl+PageDown / Ctrl+PageUp) | |
| ⌘1–⌘8, ⌘9 tabs | Ctrl+1–Ctrl+8, Ctrl+9 = last | Browser convention |
| ⌃⌥ ↑↓←→ move table row/column | Alt+Shift+arrows | Screen rotation; AltGr |
| ⌃⌥⇧ ↑↓←→ insert table row/column | Ctrl+Alt+Shift+arrows | |
| ⌃⌥⌫ / ⌃⌥⇧⌫ delete table row/column | Alt+Shift+Backspace / Ctrl+Alt+Shift+Backspace | |
| ⇧⌘Z Redo | Ctrl+Y and Ctrl+Shift+Z | |
| ⌘G / ⇧⌘G find next/previous | F3 / Shift+F3 (Ctrl+G also works in the editor) | Windows convention |
| ⌘, Settings | Ctrl+, | |
| ⌥⌘0–3 headings | Ctrl+Alt+0–3 | Safe: shortcuts match the typed character, so AltGr characters never trigger them |
| ⌥⌘N / ⌥⌘T / ⌥⌘I / ⌥⌘F / ⌥⌘E | Ctrl+Alt+N / T / I / F / E | Same AltGr-safe matching |
| (standard) Show/Hide Sidebar | Ctrl+\ | |
| ⌘-hover preview, ⌘-click new tab | Ctrl-hover, Ctrl-click | |
| ⌥-drag rectangular selection | Alt-drag | |
| — | Tapping Alt opens the menu bar | Windows convention |

App shortcuts are matched on `KeyboardEvent.key` (digits also by physical key), in the capture phase so they win over the editor's defaults; formatting and find keys are left to the editor while it has focus.

### 17.3 Platform UX differences

- Windows: menu inside the window (or a title-bar menu), window controls on the right, "Recycle Bin" wording, `Ctrl` in all tooltips, cheat sheet and guide text.
- File names: Windows forbids `< > : " / \ | ? *` and trailing dots/spaces, and reserves `CON PRN AUX NUL COM1–9 LPT1–9`. FOP-05/FOP-06 rules already strip most; add the reserved names and the 260-character path limit (or use long-path APIs).
- Case-insensitive file systems (NTFS default): keep the case-only rename path via a temporary name.
- Line endings: preserve whatever the file uses (CRLF is common on Windows); new notes should use LF unless a setting says otherwise.

### 17.4 Cloud providers elsewhere

- **OneDrive Files On-Demand / Dropbox online-only**: placeholder files carry `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` / `OFFLINE`; reading hydrates them (blocking). Apply CLD-02: detect, show the cloud icon, hydrate off the UI thread.
- Conflict copies: OneDrive "Name-DEVICE.md", Dropbox "Name (Computer's conflicted copy YYYY-MM-DD).md", Google Drive "Name (1).md". Generalise CLD-04's pattern per provider and reuse the duplicate conflict sheet.
- Status: no general API; may show nothing, or use provider-specific integrations later.

### 17.5 Suggested build order for a port

1. Vault scan, tree, open/save notes with atomic writes and the reconcile/merge logic (§3, §14) — with the acceptance tests.
2. Editor integration via the bridge (reuse `Editor/src`), view modes, appearance.
3. Index, links, rewriting, backlinks, Quick Open, search.
4. File operations with toasts/Undo, tabs and persistence.
5. Daily notes, templates, settings, palette, focus mode.
6. Cloud provider handling and polish.

---

## 18. Non-functional requirements

- **NFR-01 Data safety**: P1/P2 above; never write a file the user didn't change (byte-identical when no rewrite is needed); never write while a conflict is open; deletions only via the system Trash.
- **NFR-02 Responsiveness**: typing never blocks on disk, index or search; indexing, search, cloud status and downloads run off the UI thread; the editor reveals only after it's ready (no flash of unstyled content).
- **NFR-03 Scale**: comfortable to ~10,000 notes (planned work: cache the index on disk, lazy tree — §21).
- **NFR-04 Security**: the editor web content can't navigate away or load remote pages; the asset scheme serves only image files inside the vault (no path traversal, symlink-escape checks); only http/https/mailto links open externally; notes are never executed. *Windows:* the asset scheme also serves media and PDF (ARC-07) with the same confinement; HTML in notes is sanitised (ED-55); Mermaid runs in strict mode and KaTeX with `trust: false`; the renderer is sandboxed with context isolation and gets only the preload's narrow API, and the main process validates every command's arguments; the page CSP allows scripts only from the app, images from the app/data/http(s)/asset scheme, media and frames only from the asset scheme, and no objects. `webPreferences.plugins` is on solely for the built-in PDF viewer.
- **NFR-05 Accessibility**: every icon button has a label; toasts are announced; keyboard reachability for all commands; the table size picker is adjustable by assistive tech; accent fills keep white text at ≥4.5:1.
- **NFR-06 Platform** (Mac build): macOS 15+, Swift 6, not sandboxed, ad-hoc signed today; release script builds, tests, archives, optionally signs with Developer ID, notarises and makes a DMG. CI checks the committed editor bundle is current and runs the tests. *Windows build:* Windows 10/11 x64, Electron 44 (Node 24), TypeScript + Svelte 5, built with electron-vite; `npm run dist` makes an unsigned NSIS installer (~110 MB) with electron-builder. Only `@parcel/watcher` (prebuilt native binary, no rebuild) ships as a runtime dependency; everything else is bundled.
- **NFR-07 Testability**: deterministic seams — injectable state store (instead of UserDefaults), injectable trash function, overridable cloud checks, configurable autosave delay and watcher latency. The Mac test suite is the best executable spec: `HolocronTests/` (Swift Testing, 170 tests across files, notes, links, search, daily notes, templates, tabs, sync, merge, attachments, cloud). *Windows:* 530 Vitest tests in `tests/` — `core` (pure logic), `main` (vault, documents, sync, file operations, tabs, links, daily notes, templates, attachments and the asset protocol, against real temp folders) and `editor` (editor-state level) — ported from the Swift suite except the iCloud tests, plus `scripts/smoke*.mjs`, which drive the built app with Playwright and take screenshots.

---

## 19. Known bugs and quirks

Found while documenting the Mac app (0.1). The last column says how the Windows port (0.2.0) stands; the Mac app still has them.

| # | Area | Issue (Mac) | Windows port |
|---|---|---|---|
| 1 | Missing-file banner | **"Discard Edits" saves the edits anyway** (confirmed in code). It closes the tab, and unloading a note that is dirty saves it, re-creating the deleted file. Intended: drop the document without saving. | Fixed: the document is dropped without writing. |
| 2 | Embeds | `![[Note#^id]]` (block embeds) don't render in the editor — the embed pattern rejects `^` in the fragment — yet live preview hides the line, so it vanishes. Block extraction only works in hover previews. | Fixed: block and same-note embeds render; a line is hidden only if something renders it. |
| 3 | Tables | Tab/⇧Tab cell navigation isn't active in source mode (Return and ⌃⌥ keys are). | Fixed. |
| 4 | Tasks | Clicking a custom-status checkbox (`[!]`, `[?]`…) sets it to `[ ]` instead of cycling or toggling done. ⌘L on such a line inserts a second box (`- [ ] [!] text`). | Fixed: any custom status toggles to done `[x]`, done toggles to open; Ctrl+L toggles the same way (also on `1.` lists). |
| 5 | Tables | Column tidying counts UTF-16 units, so CJK/emoji/wide characters misalign. | Fixed: columns use display width (wide/fullwidth and emoji = 2, combining marks/joiners = 0). |
| 6 | Theme | `--hc-warning` is used for `[!]` tasks but never sent by the shell, so it's always the dark-mode yellow. | Fixed: sent with the other `--hc-*` variables. |
| 7 | Autocomplete | HTML tag completion is switched off by the custom completion override. | Fixed (ED-57). |
| 8 | Links | Wikilink resolution doesn't prefer the linking note's folder among same-named notes; `Specs/v1.2 notes` with a `.markdown` file isn't found by path (".md" is appended). Whitespace inside `[[ Ilum ]]` is lost when that link is rewritten. | Partly fixed: path links try ".md" then ".markdown"; `[[ Ilum ]]` keeps its spacing. Same-folder preference is unchanged (matches LNK-04). |
| 9 | Templates | `{{yesterday:FORMAT}}` / `{{tomorrow:FORMAT}}` ignore the format. `Do` outputs the day without an ordinal suffix. | Fixed: both honour FORMAT; `Do` gives 1st, 2nd, 3rd, 11th… |
| 10 | Quick Open | "Create note" ignores the selected folder (always vault-relative), unlike ⌘N. | Fixed: uses the selected folder unless the name contains "/". |
| 11 | Word count | Two different counts exist (index vs status bar); pick one. | Resolved: the status bar, stats popover and inspector all count whitespace-separated tokens of the whole text. |
| 12 | Tags | A `#` inside an HTML tag (`<span style="color: #e5534b">`) was indexed as a tag. | Found in the port; fixed: text inside HTML tags is ignored when finding tags. |

---

## 20. Constants

| What | Value |
|---|---|
| Autosave delay | 1 s |
| Auto-title delay | 1 s |
| Live re-index delay | 300 ms |
| Search debounce | 150 ms (250 ms after notes change) |
| Autocomplete data debounce | 1 s |
| Watcher latency | 0.2 s |
| Missing-file grace period | 1.5 s |
| Cloud status poll | 3 s syncing / 30 s idle |
| Concurrent cloud downloads | 4 |
| Toast duration | 3 s / 6 s (action) / 12 s (warning) |
| Hover preview show / hide | 120 ms / 250 ms |
| Copy button "Copied" | 1.2 s |
| Tab history | 100 |
| Saved editor states | 30 notes |
| Recent notes / vaults | 30 / 8 |
| Quick Open results | 30 notes, 4 commands (200 in `>` mode) |
| Search limits | 200 notes, 20 lines per note |
| Snippet | ≤24 chars before match, ≤240 total |
| Unlinked mentions | 50, names ≥3 characters |
| Sidebar tags | 100 |
| Autocomplete | 60 options (tags 50); recent rank top 10 |
| Auto-title length | 80 characters |
| Reading speed | 230 words/minute |
| Embed max height / hover body | 480 px / 340 px |
| Table size picker | 8 × 8 |
| Editor text size / line width | 13–24 (16) / 560–1100 step 20 (720) |
| Window default / welcome minimum | 1280×820 / 820×560 |
| *Windows:* list indent per nesting level | 1.5 em |
| *Windows:* update checks | 15 s after launch, then every 6 h |
| *Windows:* sidebar / inspector width | 200–400 (260) / 240–420 (290) px, user-resizable |
| *Windows:* title bar height | 40 px |
| *Windows:* Undo copy of a trashed item kept | 60 s |
| *Windows:* write retry on file locks | 10 attempts, ~0.8 s total |
| *Windows:* index read batch | 64 notes |
| *Windows:* rendered diagram cache | 100 diagrams |
| *Windows:* PDF viewer height | 600 px (resizable) |
| *Windows:* emoji autocomplete trigger | `:` + 2 characters |

---

## 21. Not built yet

See `Holocron Roadmap.md` for the full roadmap. Not part of the current product (don't treat as requirements for parity): quick capture, Shortcuts/Siri, Spotlight, Share/Services, tasks view, daily-notes calendar, version history, editing properties inline, vault-wide search & replace, editing inside embeds, split view, bookmarks, sidebar sort options, note icons, export & print, themes/CSS snippets, vault health, large-vault caching, multiple windows, a dedicated Holocron iCloud folder, signing/notarisation/auto-updates.

*Built in the Windows port since this list was written:* quick capture (with a tray icon and taskbar jump list, §22), maths (ED-53), Mermaid (ED-52), PDF/audio/video embeds (ED-56), heading folding (ED-38a), HTML rendering (ED-55), emoji shortcodes (ED-54), more code languages (ED-37), and reduce-motion support (animations and transitions are cut to near zero when Windows' "Animation effects" is off).

*Not built in the Windows port yet:* everything above that's still listed, plus §15 cloud handling (iCloud doesn't apply; OneDrive/Dropbox placeholders and conflict-copy detection from §17.4 aren't built), dragging notes out of the sidebar to File Explorer, multi-select in the file tree, math inside callouts/blockquotes, inline HTML inside rendered table cells, remote (https) media, and code signing.

---

## 22. The Windows port

How this repository's Electron app (0.2.0) realises the spec, and where it deliberately differs from the Mac app. Everything not mentioned here behaves as described above.

**Architecture** (§2)
- **Main process** = the "native" side: the vault model (`src/main/vault.ts`), open notes with autosave, reconcile and merge (`noteDocument.ts`, a line-for-line port of the Swift logic in §14), file I/O (`fsx.ts`), the watcher, settings, the editor bridge and the asset scheme. Full-text search runs in a worker thread with its own copy of note texts.
- **Renderer** = the window chrome (Svelte 5) and the CodeMirror editor in the same page, sandboxed with context isolation. It receives state snapshots from main and calls named, argument-checked commands through the preload's API.
- **Pure logic** (`src/core`: parser, links, rewriting, merge, search, quick open, daily notes, templates, auto-title) has no Node or DOM imports and is shared by both.
- **Bridge** (§2.1): the editor posts through `window.holocronHost.postEditor`; note ids are vault paths rather than absolute paths. Code-block Copy goes straight to the renderer's clipboard. Main → editor calls arrive as IPC messages applied to `window.holocron`.

**Window and UI** (§11)
- A custom 40 px title bar holds the logo, an in-window menu bar (tapping Alt opens it; ←/→ move between menus), Back/Forward, the note title with the vault as subtitle, and the toolbar buttons; the system's minimise/maximise/close buttons are drawn over its right edge.
- Sidebar (200–400 px, default 260) and inspector (240–420 px, default 290) are resized by dragging their borders; widths are remembered. Toggle Sidebar is Ctrl+\.
- Fonts: UI Segoe UI Variable; editor System = Segoe UI Variable, Serif = Cambria/Georgia, Monospaced = Cascadia Mono/Consolas.
- Wording: "Show in File Explorer", "Recycle Bin", Ctrl-based shortcuts everywhere (tooltips, cheat sheet, the Start Here guide).
- The file tree also supports Ctrl-click / middle-click to open in a new tab, F2 to rename, Home/End and ←/→ to collapse/expand, and expanding a collapsed folder by hovering over it while dragging. Middle-click closes a tab.
- Settings is a modal dialog with a left-hand list of the four tabs.

**Files** (§3, §6)
- Deletion goes to the Recycle Bin (`shell.trashItem`). Electron can't say where an item went, so for Undo a copy is first staged in the app's data folder; Undo restores from it, and it's removed after 60 s. Toasts read "Moved “X” to the Recycle Bin".
- Atomic writes rename a hidden temp file over the target, retrying for about a second on `EPERM`/`EBUSY`/`EACCES` (antivirus, the search indexer and sync clients briefly hold files open on Windows).
- Names: rename (FOP-06) also rejects `< > " | ? * \`, a trailing dot or space, and the reserved names CON, PRN, AUX, NUL, COM1–9 and LPT1–9 (with or without an extension): "“<name>” can’t be used as a name on Windows." Names from the first line (FOP-05) get " note" appended if they'd be a reserved name. Notes created from links (LNK-08) turn `: < > " | ? * \` into "-".
- Case-only renames go through a temporary hidden name (NTFS is case-insensitive). CRLF files round-trip byte-for-byte.
- The index reads notes in batches of 64 with synchronous reads, yielding between batches; asynchronous reads held handles open across yields, which made renames fail with `EPERM` right after opening a vault.

**Search** (§9): when more than 200 notes match, the best-ranked 200 are kept (the Mac keeps the first 200 found, then sorts).

**Watcher** (SAV-07): `@parcel/watcher` on the Windows backend (ReadDirectoryChangesW), 200 ms batches; `.git`, `.obsidian` and `.trash` aren't watched at all, and other hidden paths are filtered.

**Cloud** (§15): not applicable — the vault is a plain local folder. Only the "Disk" conflict origin exists (§14.5); there's no other-device or duplicate sheet and no sync status.

**Settings and state** (§13): stored as JSON in `%APPDATA%\Holocron\holocron.json`, written atomically 250 ms after a change and on quit. Same keys and defaults as §13, plus `showSidebar`.

**Updates** (from 0.4.0): `electron-updater` checks the GitHub releases of `lascott80/holocron-win` 15 s after launch and every 6 hours (setting `checkForUpdates`; Help › Check for Updates… always checks). Only the installed app checks. A card at the bottom-right offers "Holocron X is available" with the first lines of the release notes, "What’s new" (opens the release page) and Download / Skip This Version / Later; then a progress bar; then "Update ready — restart to install" with Restart Now (saves everything, installs silently, relaunches) / Later (installs on quit). Skipping suppresses automatic prompts for that version only. Errors from automatic checks show only in Settings; friendly messages for no network ("Couldn’t check for updates. Check your internet connection.") and releases without update data ("No update information is published yet."). The download is verified against the SHA-512 in the release's `latest.yml`; because the app downloads it, Windows SmartScreen doesn't interrupt. Each release must upload `Holocron-Setup-<version>.exe`, its `.blockmap` and `latest.yml`. Log: `%APPDATA%\Holocron\logs\updater.log`.

**Quick capture, tray and jump list** (Windows only)
- *Quick capture.* A system-wide shortcut (`globalShortcut`; setting `quickCaptureShortcut`, default Win+Alt+N — free on stock Windows 11 and never used inside Holocron; Ctrl+Alt combinations can collide with AltGr typing and with other apps) opens a 520×220 frameless, always-on-top window without a taskbar button, centred on the monitor with the mouse pointer, in the app's light/dark theme. It's the renderer's second page (`capture.html`), with the same preload, context isolation and sandbox as the main window; it can't navigate, open windows or attach webviews, and may only call `captureInfo`, `captureSave`, `captureHide` and `showMainWindow`. Header "Quick capture → [Today’s note | Inbox]" (the target for this capture; a fresh capture starts at `quickCaptureTarget`), a spell-checked text box (focused), footer "Ctrl+Enter to save · Esc to cancel" with Cancel / Save. Enter is a new line; Ctrl+Enter saves; Esc discards the draft and hides; clicking elsewhere hides but keeps the draft. With no vault open: "Open a vault in Holocron first." and an "Open Holocron" button. Also reachable from File › Quick Capture, the command palette, the tray and the jump list. While Settings records a new shortcut the current one is released.
- *Saving a capture* (`Vault.appendCapture`) appends a block at the end of today's daily note (created from the daily template if missing, without opening it — `ensureDailyNote`) or the inbox note (created, with folders, if missing): a line break if the note doesn't end with one, one blank line unless the last line is already blank, then `- HH:mm first line` with later lines indented two spaces (blank lines inside kept; leading/trailing blank lines and trailing spaces dropped; nothing left → "There’s nothing to save."). The note's line endings are kept (CRLF if its first line break is CRLF); nothing already in the note changes. If the note is open, the capture goes through its NoteDocument (`replaceContents`), so the editor gets it as an outside edit (cursor and undo kept), unsaved edits are kept, and the save that follows checks the disk first (§14: a non-overlapping outside change merges, an overlapping one raises the conflict sheet — nothing is lost). Otherwise the file is read and rewritten atomically. Success hides the window and shows a Windows notification "Saved to Today’s note" (or "Saved to “Inbox”") with the first line; clicking it opens the note.
- *Background and tray.* With `runInBackground` (default on) a tray icon (the app icon at 16–32 px, tooltip "Holocron") is shown; left-click shows the window; right-click: Quick Capture (with its shortcut), Today’s Note, New Note, —, Open Holocron, Check for Updates…, —, Quit Holocron. Closing the window then saves everything and hides it; the first time, a notification says "Holocron is still running — use Win+Alt+N to capture, or the tray icon to open it." Quitting for real: the tray's Quit, File › Exit Holocron, Windows shutting down, and the updater's Restart Now (electron-updater's `quitAndInstall` quits through `before-quit`, which — like `before-quit-for-update` — marks the app as quitting so windows close instead of hiding; everything is saved first). `launchAtLogin` sets a sign-in item `Holocron.exe --hidden`; launched that way (or with only `--capture`) Holocron starts in the tray.
- *Jump list.* Tasks: New Note (`--new-note`), Today’s Note (`--today`), Quick Capture (`--capture`); a "Recent Notes" category lists up to 8 of the open vault's recent notes (title; tooltip = vault path; `--open="<file>"`; the exe's icon), refreshed 1.5 s after recent notes change and reduced to the tasks when no vault is open. Items the user removed are left out (re-adding one would make Windows drop the category); if Windows refuses custom categories the tasks are set alone; errors are only logged. Only the installed app with its real profile writes the jump list (it belongs to the app id, so dev and test runs would overwrite the installed app's).
- *Launch arguments* (`launchArgs.ts`, untrusted): `--new-note`, `--today`, `--capture`, `--hidden`, `--open <file>` / `--open=<file>`, and a bare `.md`/`.markdown` path (file association). Paths must be absolute drive or UNC paths (not `\\?\` or `\\.\`), end in a note extension, exist, and be a non-hidden note inside the open vault or a recent vault (that vault is opened first); otherwise "That note isn’t in a vault Holocron knows." They're read at launch and from a second launch (the single-instance lock passes its argv); a second launch with no arguments shows the window.

**Development hooks**
- `HOLOCRON_UPDATE_URL=<url>` reads updates from a local server instead of GitHub (`scripts/test-update-server.mjs` serves a folder with Range support); a test update downloaded this way is never installed on quit.
- `HOLOCRON_USER_DATA=<folder>` uses an isolated profile (and then never writes the jump list, and exposes the app object as `globalThis.holocron` in main for smoke scripts such as `scripts/smoke-capture.mjs`); `HOLOCRON_OPEN_VAULT=<folder>` opens that vault at launch.
- `HOLOCRON_OUT=<folder>` builds into another output folder, so parallel builds don't collide.
- `node scripts/smoke.mjs <shots> [--script <file>] [--out <build>] [--vault <folder>] [--light]` launches the built app against a scratch copy of a vault and saves screenshots and the console log.