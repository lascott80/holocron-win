# Holocron

A native Mac markdown editor for a folder of plain `.md` files (a "vault") that
syncs outside the app — Dropbox, iCloud Drive, Syncthing, Git.

## Layout

- `Holocron/` — the SwiftUI/AppKit app (Xcode synced folder; new files are picked up automatically)
  - `Model/` — vaults, notes, file tree, link resolution
  - `Views/` — windows, sidebar, welcome screen
  - `Editor/` — the Swift side of the markdown editor (WKWebView bridge)
  - `Resources/Editor/` — the bundled editor page (`editor.js` is generated — don't edit it)
- `Editor/` — source for the CodeMirror 6 live-preview editor
- `HolocronTests/` — unit tests (Swift Testing)

## Building

```bash
xcodebuild -project Holocron.xcodeproj -scheme Holocron -derivedDataPath build test
```

After changing anything in `Editor/src/`, rebuild the editor bundle and commit
the regenerated `Holocron/Resources/Editor/editor.js`:

```bash
cd Editor && npm install && npm run build
```

To work on the editor in a browser, serve the repo root and open
`/Holocron/Resources/Editor/editor.html?sample=/Editor/dev/sample.md`.

## Debug launch arguments

- `-HolocronOpenNote <path in vault>` opens a note at launch
- `-HolocronSnapshot <file.png>` writes a PNG of the window after launch
  (`-HolocronSnapshotDelay <seconds>` to adjust; captures an open sheet if there is one)
- `-HolocronOpenSettings YES` opens the Settings window
- Any setting can be overridden for one launch, e.g. `-appearance light -accent sith`
- `-HolocronPreviewSidebar YES` also shows the sidebar in a plain window that
  snapshots can capture (the real sidebar's glass can't be captured in-app)
- `-HolocronRename <path>` / `-HolocronRequestDelete <path>` start a rename or
  a delete confirmation for a vault item
- `-HolocronTemplatePicker insert|new` opens the template picker
- `-HolocronSearch <query>` switches the sidebar to search with a query
- `-HolocronQuickOpen <query>` opens quick open with a query
- `-HolocronSimulateConflict YES` makes an unsaved edit and a clashing change on
  disk, to exercise the changed-on-disk flow

## App icon

The icon is drawn in code; edit `scripts/make-icon.swift` and run:

```bash
swift scripts/make-icon.swift
```

## Releasing

```bash
scripts/release.sh
```

Checks the editor bundle is current, runs the tests, archives a universal
(Apple silicon + Intel) Release build and writes `dist/Holocron-<version>.dmg`.
Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the project first.

Without a Developer ID the build is ad-hoc signed: it runs on this Mac, and
other Macs need right-click → Open (or System Settings → Privacy & Security →
Open Anyway) the first time.

### Turning on signing and notarization

Once you have an Apple Developer Program membership:

1. In Xcode → Settings → Accounts, add your Apple ID, then Manage Certificates →
   + → **Developer ID Application**.
2. Create an app-specific password at appleid.apple.com, then store notarization
   credentials in your keychain (one time):

   ```bash
   xcrun notarytool store-credentials holocron --apple-id you@example.com --team-id ABCDE12345
   ```

3. Release with:

   ```bash
   DEVELOPMENT_TEAM=ABCDE12345 NOTARY_PROFILE=holocron scripts/release.sh
   ```

   The app and .dmg are signed with your Developer ID, notarized by Apple and
   stapled, so they open cleanly on any Mac.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- **Build and test** — builds the app on a GitHub-hosted Mac with the newest
  Xcode and runs the full test suite. Failed runs upload the `.xcresult`.
- **Editor bundle is current** — rebuilds `editor.js` from `Editor/src` and
  fails if it differs from the committed file (i.e. someone edited the editor
  source without running `npm run build`).
