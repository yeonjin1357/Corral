#!/bin/bash
# macOS 의 앱 안 업데이트를 진짜 릴리스로 확인한다(macOS 러너용). 새 버전을 게시한 뒤에 돌린다.
# 예전 릴리스(UPDATE_FROM, 예: v0.3.0)의 dmg 를 깔고, 릴리스 주소를 바꾸지 않은 채 업데이트 버튼을 눌러
# GitHub 의 최신 릴리스로 바뀌는지 본다(update-drive.mjs). 팀원의 Mac 에서 일어나는 것과 같은 길이다.
set -euo pipefail

OUT="${SMOKE_OUT:?SMOKE_OUT 이 필요하다}"
FROM="${UPDATE_FROM:?UPDATE_FROM 이 필요하다(예: v0.3.0)}"
mkdir -p "$OUT"
APP=/Applications/Corral.app
ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] && ARCH=x64
DMG_DIR="$RUNNER_TEMP/real-update-dmg"
mkdir -p "$DMG_DIR"

echo "== 예전 릴리스($FROM)의 dmg 받기"
gh release download "$FROM" --repo "$GITHUB_REPOSITORY" --pattern "corral-*-$ARCH.dmg" --dir "$DMG_DIR"
OLD_DMG=$(ls "$DMG_DIR"/corral-*-"$ARCH".dmg)
# 태그를 주지 않으면 최신 릴리스다(앱이 새 버전으로 알게 될 바로 그 릴리스).
NEW_TAG=$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName --jq .tagName)
NEW_VERSION="${NEW_TAG#v}"
echo "· 최신 릴리스: $NEW_VERSION"

echo "== 예전 버전 설치(격리 표시 없음: 설치 한 줄로 받은 상태)"
VOLUME="$RUNNER_TEMP/real-update-volume"
hdiutil attach "$OLD_DMG" -nobrowse -readonly -mountpoint "$VOLUME" > /dev/null
rm -rf "$APP" "$HOME/Library/Application Support/pitwall"
ditto "$VOLUME/Corral.app" "$APP"
hdiutil detach "$VOLUME" -quiet
OLD_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  echo "예전 릴리스와 최신 릴리스가 같은 버전($OLD_VERSION)이다. 더 예전 태그를 줘야 한다." >&2
  exit 1
fi

SMOKE_REAL_FEED=1 SMOKE_OLD_VERSION="$OLD_VERSION" SMOKE_NEW_VERSION="$NEW_VERSION" \
  node scripts/macos-smoke/update-drive.mjs
