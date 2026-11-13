#!/bin/bash
# Corral macOS 설치(업데이트도 같은 줄):
#
#   curl -fsSL https://raw.githubusercontent.com/yeonjin1357/Corral/main/scripts/install-mac.sh | bash
#
# 최신 릴리스의 dmg 를 내려받아 응용 프로그램 폴더에 넣고 연다. Corral 은 Apple 서명·공증이 없어서 브라우저로 받은
# dmg 는 처음 열 때 macOS 가 막는다. 이 스크립트로 받은 파일에는 그 "인터넷에서 받음" 표시가 붙지 않아 바로 열린다.
#
#   --no-open              설치만 하고 열지 않는다
#   CORRAL_VERSION=v0.2.0  최신 대신 그 버전을 설치한다
#
# 내려받은 파일은 릴리스에 함께 올라간 latest-mac.yml 의 sha512 와 맞는지 확인한다.

set -euo pipefail

REPO="yeonjin1357/Corral"
APP_NAME="Corral.app"
# 끝날 때 치울 것(임시 폴더, 열어 둔 설치 파일).
WORK=""
VOLUME=""

cleanup() {
  if [ -n "$VOLUME" ]; then hdiutil detach "$VOLUME" -quiet 2> /dev/null || true; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
fail() {
  printf '설치하지 못했어요: %s\n' "$*" >&2
  exit 1
}

# 스크립트를 받다가 끊겨도 반쪽만 실행되지 않게, 모든 일을 함수 안에서 하고 맨 끝 줄에서 부른다.
main() {
  local open_after=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-open) open_after=0 ;;
      *) fail "모르는 옵션이에요: $1" ;;
    esac
    shift
  done

  [ "$(uname -s)" = "Darwin" ] || fail "macOS 에서만 쓸 수 있어요."

  # Rosetta 로 도는 셸에서도 Apple Silicon 을 알아본다.
  local arch=x64
  if [ "$(sysctl -n hw.optional.arm64 2> /dev/null || echo 0)" = "1" ]; then arch=arm64; fi

  local base="https://github.com/$REPO/releases/latest/download"
  if [ -n "${CORRAL_VERSION:-}" ]; then
    case "$CORRAL_VERSION" in
      v[0-9]*) base="https://github.com/$REPO/releases/download/$CORRAL_VERSION" ;;
      *) fail "CORRAL_VERSION 은 v0.2.0 같은 모양이어야 해요." ;;
    esac
  fi

  WORK=$(mktemp -d)

  say "릴리스 정보를 확인하고 있어요…"
  local info="$WORK/latest-mac.yml"
  curl -fsSL "$base/latest-mac.yml" -o "$info" || fail "릴리스 정보를 받지 못했어요($base/latest-mac.yml)."

  # latest-mac.yml 의 files 목록에서 이 Mac 에 맞는 dmg 의 이름과 sha512 를 꺼낸다.
  local version name sha
  version=$(awk '$1 == "version:" { print $2; exit }' "$info")
  name=$(awk -v suffix="-$arch.dmg" '
    $1 == "-" && $2 == "url:" && substr($3, length($3) - length(suffix) + 1) == suffix { print $3; exit }
  ' "$info")
  sha=$(awk -v suffix="-$arch.dmg" '
    $1 == "-" && $2 == "url:" { found = (substr($3, length($3) - length(suffix) + 1) == suffix); next }
    found && $1 == "sha512:" { print $2; exit }
  ' "$info")
  case "$name" in
    */* | *..*) fail "릴리스 정보의 파일 이름이 이상해요: $name" ;;
    corral-*-"$arch".dmg) ;;
    *) fail "이 Mac($arch)에 맞는 설치 파일을 릴리스에서 찾지 못했어요." ;;
  esac
  [ -n "$sha" ] || fail "릴리스 정보에 $name 의 확인 값(sha512)이 없어요."

  say "Corral $version ($arch) 을 내려받고 있어요…"
  local dmg="$WORK/$name"
  curl -fL --progress-bar "$base/$name" -o "$dmg" || fail "$name 을 내려받지 못했어요."

  local actual
  actual=$(shasum -a 512 "$dmg" | awk '{ print $1 }' | xxd -r -p | base64 | tr -d '\n')
  [ "$actual" = "$sha" ] || fail "내려받은 파일이 릴리스의 확인 값과 달라요. 다시 시도해 주세요."

  local volume="$WORK/volume"
  hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$volume" > /dev/null || fail "설치 파일을 열지 못했어요."
  VOLUME=$volume
  [ -d "$volume/$APP_NAME" ] || fail "설치 파일 안에 $APP_NAME 이 없어요."

  # 이미 깔려 있으면 그 자리에, 아니면 응용 프로그램 폴더(쓸 수 없으면 내 응용 프로그램 폴더)에.
  local dest
  if [ -d "/Applications/$APP_NAME" ] && [ -w /Applications ]; then
    dest=/Applications
  elif [ -d "$HOME/Applications/$APP_NAME" ]; then
    dest="$HOME/Applications"
  elif [ -w /Applications ]; then
    dest=/Applications
  else
    dest="$HOME/Applications"
    mkdir -p "$dest"
  fi
  local target="$dest/$APP_NAME"

  # 새 앱을 옆에 풀어 둔 뒤 바꿔 넣는다(풀다가 실패해도 지금 앱은 그대로다).
  rm -rf "$target.installing"
  ditto "$volume/$APP_NAME" "$target.installing" || fail "$dest 에 쓸 수 없어요."
  # 브라우저로 받은 파일이 아니라 보통 붙어 있지 않지만, 붙어 있으면 뗀다(서명되지 않은 앱이라 붙어 있으면 열리지 않는다).
  xattr -dr com.apple.quarantine "$target.installing" 2> /dev/null || true

  if pgrep -x Corral > /dev/null; then
    say "실행 중인 Corral 을 끝내고 있어요…"
    osascript -e 'tell application "Corral" to quit' > /dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      pgrep -x Corral > /dev/null || break
      sleep 0.5
    done
    pkill -x Corral 2> /dev/null || true
  fi

  rm -rf "$target.previous"
  if [ -e "$target" ]; then mv "$target" "$target.previous"; fi
  if ! mv "$target.installing" "$target"; then
    # 바꿔 넣지 못했으면 예전 앱을 되돌린다.
    if [ -e "$target.previous" ]; then mv "$target.previous" "$target"; fi
    fail "$target 을 바꿔 넣지 못했어요."
  fi
  rm -rf "$target.previous"

  say "Corral $version 을 $dest 에 설치했어요."
  if [ "$open_after" = 1 ]; then
    open "$target"
    say "Corral 을 열었어요. 메뉴 막대에 작은 모니터 아이콘이 생겨요."
  fi
}

main "$@"
