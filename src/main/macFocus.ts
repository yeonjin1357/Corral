/**
 * macOS 의 창으로 가기에서 탭까지 고르기: Terminal 과 iTerm2 는 AppleScript 로 "이 tty 의 탭"을 고를 수 있다.
 * 에이전트 프로세스의 tty 를 ps 로 묻고, 그 tty 를 가진 탭을 골라 그 창을 앞으로 가져온다. 다른 앱(VS Code·Warp 등)은
 * 탭을 고를 방법이 없어 앱만 앞으로 가져온다(focusWindow.ts).
 *
 * 처음 쓸 때 macOS 가 "Corral 이 Terminal 을 제어하려고 합니다"를 한 번 묻는다. 허락하지 않으면 스크립트가 실패하고,
 * 부르는 쪽은 앱만 앞으로 가져온다.
 */

/** 탭을 골라 줄 수 있는 터미널 앱. */
export type TabTerminal = 'terminal' | 'iterm'

/** 앱 묶음 이름으로 가린다(경로는 어디든 — /Applications, ~/Applications). */
const BUNDLE_NAME: Record<string, TabTerminal> = {
  'Terminal.app': 'terminal',
  'iTerm.app': 'iterm'
}

export function tabTerminalOf(app: string | null): TabTerminal | null {
  if (!app) return null
  const name = app.slice(app.lastIndexOf('/') + 1)
  return Object.hasOwn(BUNDLE_NAME, name) ? BUNDLE_NAME[name] : null
}

/** 그 프로세스가 붙어 있는 터미널(tty)을 묻는다. 터미널에 붙어 있지 않으면 `??`. */
export function ttyArgv(pid: number): string[] {
  return ['/bin/ps', '-o', 'tty=', '-p', String(pid)]
}

/** ps 의 tty 출력(`ttys003`)을 장치 경로(`/dev/ttys003`)로. 한 낱말의 tty 이름이 아니면 null. */
export function ttyDeviceOf(psOutput: string): string | null {
  const name = psOutput.trim()
  return /^tty[a-z]*\d+$/.test(name) ? `/dev/${name}` : null
}

/** 스크립트가 찍는 답: 그 tty 의 탭을 골랐다. */
export const TAB_FOUND = 'found'

/** 그 tty 의 탭을 찾아 고르고 창을 앞으로 가져온다(줄여 둔 창은 다시 편다). tty 는 `on run` 의 인자로 받는다. */
const SCRIPTS: Record<TabTerminal, string[]> = {
  terminal: [
    'on run argv',
    'set target to item 1 of argv',
    'tell application id "com.apple.Terminal"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'if tty of t is target then',
    'if miniaturized of w then set miniaturized of w to false',
    'set selected tab of w to t',
    'set index of w to 1',
    'activate',
    `return "${TAB_FOUND}"`,
    'end if',
    'end repeat',
    'end repeat',
    'end tell',
    'return "missing"',
    'end run'
  ],
  iterm: [
    'on run argv',
    'set target to item 1 of argv',
    'tell application id "com.googlecode.iterm2"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'repeat with s in sessions of t',
    'if tty of s is target then',
    'select w',
    'select t',
    'select s',
    'activate',
    `return "${TAB_FOUND}"`,
    'end if',
    'end repeat',
    'end repeat',
    'end repeat',
    'end tell',
    'return "missing"',
    'end run'
  ]
}

/**
 * 탭 고르기 명령. 스크립트 글자는 늘 같고, tty 는 맨 끝 인자로 넘긴다(스크립트에 값을 끼워 넣지 않는다).
 * 표준출력이 `found` 면 골랐고, `missing` 이면 그 tty 의 탭이 없다(tmux 안 등).
 */
export function selectTabArgv(kind: TabTerminal, tty: string): string[] {
  return ['/usr/bin/osascript', ...SCRIPTS[kind].flatMap((line) => ['-e', line]), tty]
}
