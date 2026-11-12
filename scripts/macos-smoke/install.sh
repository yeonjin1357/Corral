#!/bin/bash
# 팀원이 받는 것처럼 dmg 를 설치한다(macOS 러너용).
# 1) 브라우저로 받은 파일처럼 격리(quarantine) 속성을 붙이고 2) 응용 프로그램 폴더로 옮기고
# 3) 그대로 열어 Gatekeeper 가 어떻게 하는지 본 뒤 4) README 의 xattr 명령으로 푼다.
# 본 것은 $SMOKE_OUT/install-facts.tsv 에 남긴다(판정은 drive.mjs 가 한다). dmg 를 못 찾거나 옮기지 못하면 실패.
set -uo pipefail

OUT="${SMOKE_OUT:?SMOKE_OUT 이 필요하다}"
DMG_DIR="${SMOKE_DMG_DIR:?SMOKE_DMG_DIR 이 필요하다}"
APP=/Applications/Corral.app
mkdir -p "$OUT"
FACTS="$OUT/install-facts.tsv"
: > "$FACTS"

fact() {
  printf '%s\t%s\n' "$1" "$2" >> "$FACTS"
  echo "· $1: $2"
}

# with_timeout <초> <명령…>: 그 시간 안에 끝나지 않으면 강제로 끝낸다(macOS 에는 timeout 명령이 없다).
with_timeout() {
  local secs=$1
  shift
  "$@" &
  local pid=$!
  (
    sleep "$secs"
    kill -9 "$pid" 2> /dev/null
  ) &
  local killer=$!
  wait "$pid" 2> /dev/null
  local code=$?
  kill "$killer" 2> /dev/null
  return $code
}

ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] && ARCH=x64
fact os "$(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
fact arch "$ARCH"
fact cpu "$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"

DMG=$(ls "$DMG_DIR"/corral-*-"$ARCH".dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "dmg 가 없다: $DMG_DIR/corral-*-$ARCH.dmg" >&2
  ls -la "$DMG_DIR" >&2
  exit 1
fi
fact dmg "$(basename "$DMG") ($(stat -f %z "$DMG") bytes)"

echo "== 격리 속성 붙이기(브라우저로 받은 것처럼)"
QUARANTINE="0081;$(printf '%x' "$(date +%s)");Chrome;$(uuidgen)"
xattr -w com.apple.quarantine "$QUARANTINE" "$DMG"
xattr -l "$DMG"

echo "== dmg 열기"
VOL="$RUNNER_TEMP/corral-volume"
if ! hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$VOL" > "$OUT/hdiutil.txt" 2>&1; then
  cat "$OUT/hdiutil.txt" >&2
  exit 1
fi
cat "$OUT/hdiutil.txt"
ls -la "$VOL"
fact dmg_contents "$(ls "$VOL" | tr '\n' ' ')"

echo "== 응용 프로그램 폴더로 옮기기"
rm -rf "$APP"
if ! cp -R "$VOL/Corral.app" /Applications/; then
  echo "앱을 옮기지 못했다" >&2
  exit 1
fi
hdiutil detach "$VOL" -quiet || true

COPIED=$(xattr -p com.apple.quarantine "$APP" 2>/dev/null || true)
if [ -n "$COPIED" ]; then
  fact quarantine_after_copy "$COPIED"
else
  # cp 가 속성을 옮기지 않았으면 직접 붙인다(Finder 로 끌어 옮기면 붙는다).
  xattr -r -w com.apple.quarantine "$QUARANTINE" "$APP"
  fact quarantine_after_copy "없어서 직접 붙임"
fi

echo "== 서명·구조"
{
  echo "# codesign -dv --verbose=4"
  codesign -dv --verbose=4 "$APP" 2>&1
  echo
  echo "# codesign --verify --deep --strict"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1
  echo "exit=$?"
  echo
  echo "# lipo -archs"
  lipo -archs "$APP/Contents/MacOS/Corral" 2>&1
  echo
  echo "# Info.plist"
  plutil -p "$APP/Contents/Info.plist" 2>&1
} > "$OUT/codesign.txt"
cat "$OUT/codesign.txt"
fact signature "$(codesign -dv "$APP" 2>&1 | grep -E '^(Signature|TeamIdentifier|flags|CodeDirectory)' | tr '\n' ' ')"
codesign --verify --deep --strict "$APP" > /dev/null 2>&1
fact signature_valid "$([ $? -eq 0 ] && echo yes || echo no)"
fact binary_archs "$(lipo -archs "$APP/Contents/MacOS/Corral" 2>&1)"
fact bundle_id "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>&1)"
fact min_macos "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist" 2>&1)"

echo "== Gatekeeper 판정"
fact gatekeeper_status "$(spctl --status 2>&1 | tr '\n' ' ')"
fact gatekeeper_assess "$(spctl --assess --type execute -vv "$APP" 2>&1 | tr '\n' ' ')"

echo "== 격리된 채로 열어 보기(팀원이 처음 더블클릭했을 때)"
# 경고 창이 뜨면 open 은 누가 답할 때까지 끝나지 않는다. 뒤에서 띄우고 15초만 본다.
open "$APP" > "$OUT/open-quarantined.txt" 2>&1 &
OPEN_PID=$!
sleep 15
if kill -0 "$OPEN_PID" 2> /dev/null; then
  fact open_quarantined "15초가 지나도 open 이 끝나지 않음(경고 창이 답을 기다림)"
else
  wait "$OPEN_PID"
  fact open_quarantined "open 이 $? 로 끝남: $(tr '\n' ' ' < "$OUT/open-quarantined.txt" | cut -c1-300)"
fi
CORRAL_PID=$(pgrep -x Corral | head -1)
if [ -n "$CORRAL_PID" ]; then
  # stat 의 T 는 멈춰 있는(아직 실행을 허락받지 못한) 프로세스.
  fact corral_process "$(ps -o pid=,stat=,etime=,rss= -p "$CORRAL_PID" | tr -s ' ')"
else
  fact corral_process "없음"
fi
if [ -d "$HOME/Library/Application Support/pitwall" ]; then
  fact gatekeeper_blocked "no (앱이 실행되어 설정 폴더를 만듦)"
else
  fact gatekeeper_blocked "yes (앱이 실행되지 못함: 설정 폴더가 생기지 않음)"
fi
with_timeout 20 screencapture -x "$OUT/01-gatekeeper.png" 2> "$OUT/screencapture.err" || true
# 경고 창의 글자(읽을 수 있으면).
cat > "$OUT/gatekeeper-dialog.applescript" <<'EOF'
set AppleScript's text item delimiters to " / "
set found to ""
tell application "System Events"
  repeat with p in (every process whose name is "CoreServicesUIAgent")
    repeat with w in (every window of p)
      set found to found & "text: " & ((value of every static text of w) as text) & linefeed
      set found to found & "buttons: " & ((name of every button of w) as text) & linefeed
    end repeat
  end repeat
end tell
return found
EOF
with_timeout 40 osascript "$OUT/gatekeeper-dialog.applescript" > "$OUT/gatekeeper-dialog.txt" 2>&1 || true
fact gatekeeper_dialog "$(tr '\n' ' ' < "$OUT/gatekeeper-dialog.txt" | cut -c1-600)"

# 다음 단계가 처음 실행부터 보도록 치운다(경고 창은 "Done" 을 눌러 닫는다).
with_timeout 20 osascript -e 'tell application "System Events" to tell process "CoreServicesUIAgent" to click button "Done" of window 1' > /dev/null 2>&1 || true
kill -9 "$OPEN_PID" 2> /dev/null || true
pkill -9 -x Corral 2> /dev/null || true
killall CoreServicesUIAgent 2> /dev/null || true
sleep 3
rm -rf "$HOME/Library/Application Support/pitwall" "$HOME/Library/Application Support/Corral"

echo "== README 의 명령으로 격리 풀기"
xattr -dr com.apple.quarantine "$APP"
fact xattr_exit "$?"
fact quarantine_after_xattr "$(xattr -p com.apple.quarantine "$APP" 2>&1 | tr '\n' ' ')"

echo "== 끝"
cat "$FACTS"
