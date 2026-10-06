#!/bin/bash
# Builds a release of Holocron and packages it as a .dmg in dist/.
#
#   scripts/release.sh
#
# Signing is optional and switched on by environment variables:
#
#   DEVELOPMENT_TEAM=ABCDE12345     Your Apple Developer Team ID. Signs the app
#                                   with your "Developer ID Application"
#                                   certificate instead of ad-hoc.
#   NOTARY_PROFILE=holocron         A notarytool keychain profile (see README).
#                                   With DEVELOPMENT_TEAM, also notarizes and
#                                   staples the .dmg so it opens cleanly on any Mac.
#
# Without them you get an ad-hoc signed build: it runs on this Mac, and on
# other Macs only after right-click → Open (or System Settings → Privacy &
# Security → Open Anyway).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
BUILD="$ROOT/build/release"
DIST="$ROOT/dist"
ARCHIVE="$BUILD/Holocron.xcarchive"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

VERSION=$(xcodebuild -project Holocron.xcodeproj -scheme Holocron -configuration Release -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ MARKETING_VERSION = / { print $2; exit }')
BUILD_NUMBER=$(xcodebuild -project Holocron.xcodeproj -scheme Holocron -configuration Release -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ CURRENT_PROJECT_VERSION = / { print $2; exit }')
echo "Holocron $VERSION ($BUILD_NUMBER)"

if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  echo "Signing: Developer ID, team $DEVELOPMENT_TEAM"
else
  echo "Signing: ad-hoc (set DEVELOPMENT_TEAM to sign with your Developer ID)"
fi

step "Checking the editor bundle is up to date"
if command -v npm >/dev/null && [[ -d Editor/node_modules ]]; then
  BEFORE=$(shasum Holocron/Resources/Editor/editor.js)
  (cd Editor && npm run build --silent >/dev/null)
  if [[ "$(shasum Holocron/Resources/Editor/editor.js)" != "$BEFORE" ]]; then
    echo "error: Holocron/Resources/Editor/editor.js was out of date and has been rebuilt — commit it, then run this again." >&2
    exit 1
  fi
  echo "editor.js is current"
else
  echo "(npm or Editor/node_modules missing — using the committed editor.js)"
fi

step "Running tests"
xcodebuild -project Holocron.xcodeproj -scheme Holocron -destination 'platform=macOS' \
  -derivedDataPath "$BUILD/DerivedData" test -quiet

step "Archiving"
rm -rf "$ARCHIVE"
SIGNING_ARGS=()
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  SIGNING_ARGS=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Developer ID Application" OTHER_CODE_SIGN_FLAGS="--timestamp")
fi
xcodebuild -project Holocron.xcodeproj -scheme Holocron -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$BUILD/DerivedData" \
  -archivePath "$ARCHIVE" archive -quiet ${SIGNING_ARGS[@]+"${SIGNING_ARGS[@]}"}

step "Exporting the app"
EXPORT="$BUILD/export"
rm -rf "$EXPORT"
mkdir -p "$EXPORT"
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  cat > "$BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>developer-id</string>
  <key>teamID</key><string>$DEVELOPMENT_TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Developer ID Application</string>
</dict>
</plist>
PLIST
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
    -exportOptionsPlist "$BUILD/ExportOptions.plist" -quiet
else
  ditto "$ARCHIVE/Products/Applications/Holocron.app" "$EXPORT/Holocron.app"
fi
codesign --verify --deep --strict "$EXPORT/Holocron.app"
echo "Signature OK"

step "Building the disk image"
mkdir -p "$DIST"
DMG="$DIST/Holocron-$VERSION.dmg"
STAGING="$BUILD/dmg"
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
ditto "$EXPORT/Holocron.app" "$STAGING/Holocron.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Holocron $VERSION" -srcfolder "$STAGING" -fs HFS+ -format UDZO -ov "$DMG" -quiet
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  codesign --sign "Developer ID Application" --team-id "$DEVELOPMENT_TEAM" --timestamp "$DMG"
fi

if [[ -n "${DEVELOPMENT_TEAM:-}" && -n "${NOTARY_PROFILE:-}" ]]; then
  step "Notarizing (this usually takes a few minutes)"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG"
elif [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  echo "Skipping notarization (set NOTARY_PROFILE to notarize)."
fi

step "Done"
echo "$DMG ($(du -h "$DMG" | cut -f1 | xargs))"
