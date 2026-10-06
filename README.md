# Holocron for Windows

An Electron port of Holocron, a plain-files markdown notes app in the style
of Obsidian. A vault is an ordinary folder of `.md` files; there is no
database. The behaviour spec is [REQUIREMENTS.md](REQUIREMENTS.md); the
original Mac app is in `holocron-mac-src/` for reference.

## Layout

- `src/core/` — pure TypeScript logic shared by every process: note parsing,
  link resolution and rewriting, three-way merge, search, quick open, daily
  notes, templates. No Node or DOM imports.
- `src/main/` — the Electron main process: the vault model (`vault.ts`),
  open notes with autosave and conflict handling (`noteDocument.ts`), atomic
  file writes and the Recycle Bin with Undo (`fsx.ts`), the folder watcher,
  settings, the editor bridge and the `holocron-asset://` image protocol.
  Full-text search runs in a worker thread (`indexWorker.ts`).
- `src/preload/` — the narrow API the sandboxed renderer gets.
- `src/renderer/` — the window chrome in Svelte 5.
- `src/editor/` — the CodeMirror 6 live-preview editor, reused from the Mac
  app with small Windows adaptations (`platform.js`).
- `src/shared/` — types and settings shared by main and renderer.
- `tests/` — Vitest suites (`core`, `main`, `editor`).

## Developing

```bash
npm install
npm run dev        # app with hot reload
npm test           # unit tests
npm run check      # type-check main, renderer and core
```

To screenshot the built app against a scratch copy of a vault:

```bash
npm run build
node scripts/smoke.mjs smoke-output --vault path\to\vault
```

## Building an installer

```bash
npm run dist
```

Writes an NSIS installer to `dist/`. It's unsigned, so Windows SmartScreen
asks for confirmation the first time.

## Updates

The installed app checks GitHub Releases (`lascott80/holocron-win`) about
15 s after launch and every 6 hours (Settings › General › Updates turns this
off; Help › Check for Updates… always checks). It asks before downloading and
again before installing: Restart Now saves all notes and runs the installer
silently, or Later installs it when Holocron quits. Because the app downloads
the installer itself, SmartScreen doesn't interrupt. Logs go to
`%APPDATA%\Holocron\logs\updater.log`.

To publish a release, bump `version`, run `npm run dist` (it never publishes
by itself), and upload all three files from `dist/` to a GitHub release
tagged `v<version>` (not a draft or prerelease):

- `Holocron-Setup-<version>.exe`
- `Holocron-Setup-<version>.exe.blockmap`
- `latest.yml`

To test updates without GitHub, build an older and a newer version into
separate folders, serve the newer one locally and point the older one at it
with `HOLOCRON_UPDATE_URL` (a downloaded test update is never installed on
quit):

```bash
set HOLOCRON_OUT=out-update
npx electron-vite build
npx electron-builder --win nsis --publish never --config.directories.output=dist-test-0.3.9 -c.extraMetadata.version=0.3.9 -c.extraMetadata.main=out-update/main/index.js -c.files=out-update/** -c.files=resources/**
npx electron-builder --win nsis --publish never --config.directories.output=dist-test-0.4.0 -c.extraMetadata.version=0.4.0 -c.extraMetadata.main=out-update/main/index.js -c.files=out-update/** -c.files=resources/**
node scripts/smoke-update.mjs --app dist-test-0.3.9/win-unpacked/Holocron.exe --feed dist-test-0.4.0
```

`node scripts/test-update-server.mjs <folder>` serves a folder on its own.

## Windows keyboard shortcuts

Mostly ⌘ → Ctrl, with these deliberate changes (REQUIREMENTS §17.2):

| Action | Mac | Windows |
| --- | --- | --- |
| Back / Forward | ⌥⌘← / ⌥⌘→ | Alt+← / Alt+→ (and the mouse's back/forward buttons) |
| Previous / Next daily note | ⌃⌘← / ⌃⌘→ | Alt+PageUp / Alt+PageDown |
| Move table row / column | ⌃⌥ arrows | Alt+Shift+arrows (Ctrl+Alt+arrows rotates the screen on many PCs) |
| Insert table row / column | ⌃⌥⇧ arrows | Ctrl+Alt+Shift+arrows |
| Delete table row / column | ⌃⌥⌫ / ⌃⌥⇧⌫ | Alt+Shift+Backspace / Ctrl+Alt+Shift+Backspace |
| Tab 1–8, last tab | ⌘1–⌘9 | Ctrl+1–Ctrl+9 |
| Headings 1–3, body text | ⌥⌘1–3, ⌥⌘0 | Ctrl+Alt+1–3, Ctrl+Alt+0 |
| Toggle sidebar | — | Ctrl+\ |
| Find next / previous | ⌘G / ⇧⌘G | F3 / Shift+F3 |
| Redo | ⇧⌘Z | Ctrl+Y or Ctrl+Shift+Z |
| Hover preview, open link in new tab | ⌘ | Ctrl |
| Copy as Markdown / Paste as Plain Text | — | Ctrl+Shift+C / Ctrl+Shift+V |
| Fold / unfold heading | — | Ctrl+Shift+[ / Ctrl+Shift+] |

App shortcuts match on the character typed, so AltGr combinations on
international keyboards never trigger them. Tapping Alt opens the menu bar.
