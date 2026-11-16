#!/bin/bash
# Verify and exercise the exact read-only disk image handed to the publish job.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ ${MACOS_TEAM_ID:-} =~ ^[A-Z0-9]{10}$ ]] || { echo 'Invalid MACOS_TEAM_ID' >&2; exit 1; }
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid GITHUB_SHA' >&2; exit 1; }
version=$(node -p 'require("./package.json").version')
dmg="release/LOLPingYourAI-$version-arm64.dmg"
requirement="anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$MACOS_TEAM_ID\""
codesign --verify --strict -R="$requirement" "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature "$dmg"

tempdir=$(mktemp -d)
mountpoint="$tempdir/mac-arm64"
mkdir "$mountpoint"
trap 'rmdir "$mountpoint" "$tempdir"' EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$dmg"
trap 'hdiutil detach "$mountpoint" && rm -r "$tempdir"' EXIT
app="$mountpoint/LOLPingYourAI.app"
codesign --verify --deep --strict "$app"
spctl --assess --type execute "$app"
for binary in "$app" "$app/Contents/Resources/desktop-helper" "$app/Contents/Resources/hook-helper"; do
  codesign --verify --strict -R="$requirement" "$binary"
  signature=$(codesign --display --verbose=4 "$binary" 2>&1)
  grep -Eq '^CodeDirectory .*flags=0x[[:xdigit:]]+\([^)]*runtime' <<< "$signature"
  grep -q '^Timestamp=' <<< "$signature"
done

node -e 'const p = require(process.argv[1]); if (p.buildCommit !== process.env.GITHUB_SHA || p.version !== process.argv[2]) process.exit(1)' "$app/Contents/Resources/app/package.json" "$version"
"$app/Contents/Resources/desktop-helper" doctor </dev/null | jq -e '.platform == "darwin"'
# Exercise native dependencies inside the hardened Electron runtime, then the app and renderer.
ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/LOLPingYourAI" tools/check-packaged-runtime.cjs "$tempdir"
node tools/windows/check-app.mjs "$app/Contents/MacOS/LOLPingYourAI"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then printf 'dmg=%s\n' "$dmg" >> "$GITHUB_OUTPUT"; fi
