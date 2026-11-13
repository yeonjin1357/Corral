#!/bin/bash
# 설치 스크립트(scripts/install-mac.sh, README 의 한 줄)를 실제 Mac 에서 확인한다(macOS 러너용).
# 1) 최신 릴리스를 설치하고 2) 경고 창 없이 열리는지 보고 3) 실행 중에 다시 돌려(업데이트) 바꿔 넣는지 본다.
set -uo pipefail

OUT="${SMOKE_OUT:?SMOKE_OUT 이 필요하다}"
mkdir -p "$OUT"
APP=/Applications/Corral.app
PROFILE="$HOME/Library/Application Support/pitwall"
FAILED=0

ok() { echo "✅ $1"; }
bad() {
  echo "❌ $1"
  FAILED=1
}

# Corral 이 실제로 일하기 시작하면 설정 폴더가 생긴다(Gatekeeper 가 막으면 프로세스만 멈춰 있고 폴더는 없다).
wait_running() {
  for _ in $(seq 1 60); do
    if pgrep -x Corral > /dev/null && [ -d "$PROFILE" ]; then return 0; fi
    sleep 0.5
  done
  return 1
}
gatekeeper_dialogs() {
  osascript -e 'tell application "System Events" to count (windows of (every process whose name is "CoreServicesUIAgent"))' 2> /dev/null || echo "?"
}

echo "== 설치 스크립트로 설치"
rm -rf "$APP" "$PROFILE"
if bash scripts/install-mac.sh --no-open 2>&1 | tee "$OUT/install-1.log"; then
  ok "설치 스크립트가 끝났다"
else
  bad "설치 스크립트가 실패했다"
fi
if [ -d "$APP" ]; then ok "$APP 이 있다"; else bad "$APP 이 없다"; fi
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>&1)
echo "· 버전: $VERSION, 구조: $(lipo -archs "$APP/Contents/MacOS/Corral" 2>&1), 이 Mac: $(uname -m)"
if xattr -p com.apple.quarantine "$APP" > /dev/null 2>&1; then
  bad "격리 표시가 붙어 있다: $(xattr -p com.apple.quarantine "$APP")"
else
  ok "격리 표시가 없다"
fi
if codesign --verify --deep --strict "$APP" 2> "$OUT/codesign-install.txt"; then
  ok "서명(임시 서명)이 온전하다"
else
  bad "서명 확인 실패: $(cat "$OUT/codesign-install.txt")"
fi
echo "· Gatekeeper: $(spctl --status 2>&1 | tr '\n' ' ')"

echo "== 경고 창 없이 열리는지"
open "$APP" &
if wait_running; then ok "열렸다(경고 창에 막히지 않았다)"; else bad "30초 안에 열리지 않았다"; fi
sleep 3
screencapture -x "$OUT/install-opened.png" 2> /dev/null || true
echo "· 경고 창 수: $(gatekeeper_dialogs)"
FIRST_PID=$(pgrep -x Corral | head -1)

echo "== 실행 중에 같은 줄을 다시 실행(업데이트)"
INODE_BEFORE=$(stat -f %i "$APP")
if bash scripts/install-mac.sh 2>&1 | tee "$OUT/install-2.log"; then
  ok "다시 실행이 끝났다"
else
  bad "다시 실행이 실패했다"
fi
INODE_AFTER=$(stat -f %i "$APP")
if [ "$INODE_BEFORE" != "$INODE_AFTER" ]; then ok "앱을 바꿔 넣었다"; else bad "앱이 그대로다"; fi
if wait_running; then
  SECOND_PID=$(pgrep -x Corral | head -1)
  if [ "$SECOND_PID" != "$FIRST_PID" ]; then
    ok "예전 Corral 을 끝내고 새로 열었다(pid $FIRST_PID → $SECOND_PID)"
  else
    bad "예전 Corral 이 그대로 떠 있다(pid $FIRST_PID)"
  fi
else
  bad "다시 실행한 뒤 열리지 않았다"
fi
if ls -d "$APP".* > /dev/null 2>&1; then bad "임시 폴더가 남았다: $(ls -d "$APP".*)"; else ok "임시 폴더가 남지 않았다"; fi
sleep 2
screencapture -x "$OUT/install-updated.png" 2> /dev/null || true

osascript -e 'tell application "Corral" to quit' > /dev/null 2>&1 || true
sleep 2
pkill -x Corral 2> /dev/null || true
exit $FAILED
