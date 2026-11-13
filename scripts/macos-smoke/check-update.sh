#!/bin/bash
# macOS 의 앱 안 업데이트를 실제 Mac 에서 확인한다(macOS 러너용).
# 이 커밋으로 지금 버전과 "새 버전"(99.0.0) 두 개를 만들고, 새 버전을 이 러너 안의 주소에서 내려받게 한 뒤,
# 지금 버전을 깔아 업데이트 버튼으로 새 버전이 되는지(update-drive.mjs)와 확인 값이 틀릴 때 앱이 그대로인지 본다.
set -euo pipefail

OUT="${SMOKE_OUT:?SMOKE_OUT 이 필요하다}"
mkdir -p "$OUT"
APP=/Applications/Corral.app
ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] && ARCH=x64
NEW_VERSION=99.0.0
FEED="$RUNNER_TEMP/update-feed"
BAD_FEED="$RUNNER_TEMP/update-feed-bad"
mkdir -p "$FEED" "$BAD_FEED"

sha512_of() { shasum -a 512 "$1" | awk '{ print $1 }' | xxd -r -p | base64 | tr -d '\n'; }
# 릴리스 정보(latest-mac.yml): <폴더> <버전> <파일 이름> <sha512>
write_feed() {
  printf 'version: %s\nfiles:\n  - url: %s\n    sha512: %s\n    size: 1\npath: %s\nsha512: %s\n' \
    "$2" "$3" "$4" "$3" "$4" > "$1/latest-mac.yml"
}

echo "== 새 버전($NEW_VERSION) 만들기"
npx electron-vite build
npm version "$NEW_VERSION" --no-git-tag-version > /dev/null
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg "--$ARCH" --publish never > "$OUT/build-new.log" 2>&1
NEW_DMG="corral-$NEW_VERSION-$ARCH.dmg"
cp "dist/$NEW_DMG" "$FEED/"
write_feed "$FEED" "$NEW_VERSION" "$NEW_DMG" "$(sha512_of "$FEED/$NEW_DMG")"
# 확인 값이 틀린 릴리스 정보(같은 파일, 다른 sha512).
cp "dist/$NEW_DMG" "$BAD_FEED/"
write_feed "$BAD_FEED" "$NEW_VERSION" "$NEW_DMG" "$(printf 'wrong' | shasum -a 512 | awk '{ print $1 }' | xxd -r -p | base64 | tr -d '\n')"
cat "$FEED/latest-mac.yml"

echo "== 지금 버전 만들기"
git checkout -- package.json package-lock.json
OLD_VERSION=$(node -p "require('./package.json').version")
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg "--$ARCH" --publish never > "$OUT/build-old.log" 2>&1
OLD_DMG="dist/corral-$OLD_VERSION-$ARCH.dmg"
ls -la "$OLD_DMG" "$FEED" "$BAD_FEED"

echo "== 릴리스 파일을 이 러너 안에서 내준다"
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$FEED" > "$OUT/feed.log" 2>&1 &
python3 -m http.server 8766 --bind 127.0.0.1 --directory "$BAD_FEED" > "$OUT/feed-bad.log" 2>&1 &
for port in 8765 8766; do
  for _ in $(seq 1 20); do
    curl -fs -o /dev/null "http://127.0.0.1:$port/latest-mac.yml" && break
    sleep 0.5
  done
done

echo "== 지금 버전($OLD_VERSION) 설치(격리 표시 없음: 설치 한 줄로 받은 상태)"
VOLUME="$RUNNER_TEMP/update-volume"
hdiutil attach "$OLD_DMG" -nobrowse -readonly -mountpoint "$VOLUME" > /dev/null
rm -rf "$APP" "$HOME/Library/Application Support/pitwall"
ditto "$VOLUME/Corral.app" "$APP"
hdiutil detach "$VOLUME" -quiet

SMOKE_OLD_VERSION="$OLD_VERSION" SMOKE_NEW_VERSION="$NEW_VERSION" node scripts/macos-smoke/update-drive.mjs
