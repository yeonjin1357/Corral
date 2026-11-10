import type { Platform } from '../shared/types'
import {
  hookItems,
  installPitwallHooks,
  readPitwallHookState,
  uninstallPitwallHooks,
  type ClaudeHookEntry,
  type HookFileResult,
  type HookFileSpec,
  type PitwallHookInspection
} from './claudeHooks'
import { CODEX_HOOK_PATH } from './hookServer'

/**
 * Codex 연동(F7 hooks). 사용자가 "Codex 연동 켜기"를 누를 때만 `$CODEX_HOME/hooks.json` 에 pitwall 항목을 더한다
 * (Claude 연동과 같은 방식: 확인 창·백업·다른 항목 보존). 형식은 공식 문서(learn.chatgpt.com/docs/hooks, 2026-11-09 확인):
 * `{ "hooks": { "<이벤트>": [ { "matcher"?: …, "hooks": [ { "type": "command", "command", "commandWindows"?, "async"?, "timeout" } ] } ] } }`.
 * Codex 는 새 훅을 사용자가 `/hooks` 에서 한 번 승인해야 실행한다.
 */
export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'Interrupt',
  'SessionEnd'
] as const

export const CODEX_HOOK_FILE: HookFileSpec = {
  file: 'hooks.json',
  path: CODEX_HOOK_PATH
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
/** 공백·따옴표·셸 특수 문자가 없는 Windows 폴더 경로만 그대로 쓴다. */
const SAFE_WINDOWS_DIR = /^[A-Za-z]:\\[A-Za-z0-9_.\\-]*$/

/**
 * 훅 명령. 표준입력(이벤트 JSON)을 curl 이 직접 읽어 로컬 훅 서버로 보내고 출력은 버린다(Codex 에 끼어들지 않음).
 * pitwall 이 꺼져 있어도 0 으로 끝나 Codex 가 훅 실패로 보지 않는다(Windows 는 cmd·PowerShell 두 셸에서 시험함:
 * 켜져 있으면 이벤트가 오고, 꺼져 있으면 종료 코드 0). 백그라운드(async)로 돌아 Codex 를 기다리게 하지 않는다
 * (항상 동기로 도는 SessionEnd 만 pitwall 이 꺼져 있을 때 최대 2초 걸린다).
 */
export function codexHookCommand(
  platform: Platform,
  port: number,
  token: string,
  systemRoot?: string
): ClaudeHookEntry {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port ${port}`)
  if (!TOKEN_PATTERN.test(token)) throw new Error('invalid hook token')
  const url = `http://127.0.0.1:${port}${CODEX_HOOK_PATH}?t=${token}`
  if (platform === 'win32') {
    const system =
      systemRoot && SAFE_WINDOWS_DIR.test(systemRoot)
        ? `${systemRoot.replace(/\\$/, '')}\\System32\\`
        : ''
    // cmd 로 감싸 curl 이 실패해도(pitwall 이 꺼져 있음) 0 으로 끝낸다. Codex 가 어떤 셸(cmd·PowerShell)로
    // 돌려도 같게 동작한다. cmd 는 슬래시 경로 명령을 구문 오류로 보므로 역슬래시, 주소는 cmd 특수 문자가 없다.
    const command = `${system}cmd.exe /d /c "${system}curl.exe -s -m 2 -o NUL --data-binary @- ${url} & exit /b 0"`
    return { type: 'command', command, commandWindows: command, async: true, timeout: 5 }
  }
  return {
    type: 'command',
    command: `/usr/bin/curl -s -m 2 -o /dev/null --data-binary @- '${url}'; exit 0`,
    async: true,
    timeout: 5
  }
}

export function installCodexHooks(opts: {
  dir: string
  entry: ClaudeHookEntry
  now: number
}): Promise<HookFileResult> {
  return installPitwallHooks({
    dir: opts.dir,
    items: hookItems(CODEX_HOOK_EVENTS, opts.entry),
    now: opts.now,
    spec: CODEX_HOOK_FILE
  })
}

export function uninstallCodexHooks(opts: { dir: string; now: number }): Promise<HookFileResult> {
  return uninstallPitwallHooks({ ...opts, spec: CODEX_HOOK_FILE })
}

export function readCodexHookState(
  dir: string,
  entry: ClaudeHookEntry
): Promise<PitwallHookInspection> {
  return readPitwallHookState(dir, hookItems(CODEX_HOOK_EVENTS, entry), CODEX_HOOK_FILE)
}
