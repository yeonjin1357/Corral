import type { AgentRow, DashboardSnapshot, Platform } from '../shared/types'
import { COMMAND_TIMEOUT_MS } from '../shared/defaults'
import { selectionKey } from '../shared/keys'
import type { Runner } from './collect/runCommand'
import { appBundleOf, HOST_CANDIDATE_LIMIT } from './agents'
import {
  buildPowerShellArgs,
  helperSourceLines,
  helperUseLines,
  powershellPath,
  WRITE_JSON_LINES
} from './collect/windows'
import { selectTabArgv, TAB_FOUND, tabTerminalOf, ttyArgv, ttyDeviceOf } from './macFocus'

/*
 * 창으로 가기(G3f): 에이전트가 떠 있는 터미널·에디터 창을 앞으로 가져온다. macOS 의 Terminal·iTerm2 는 탭까지 고르고,
 * 그 밖에는 창(Windows)·앱(macOS)까지만 간다.
 */

/** 화면·알림이 준 선택 키의 길이 상한(실제 키는 `agent:<pid>:<시작 시각>` 으로 짧다). */
const MAX_KEY_LENGTH = 100
/** C# int[] 로 넘기므로 int 범위만. */
const MAX_PID = 0x7fffffff

/** 스크립트에 넣을 수 있는 pid: 양의 정수(int 범위). 다른 값은 버린다. */
const isScriptPid = (p: unknown): p is number =>
  typeof p === 'number' && Number.isSafeInteger(p) && p > 0 && p <= MAX_PID

/** 스크립트에 넣는 pid 목록 글자. 숫자 글자와 쉼표 말고는 아무것도 스크립트에 들어가지 않는다. */
function pidList(pids: readonly unknown[]): string {
  return pids
    .filter(isScriptPid)
    .map(String)
    .filter((s) => /^\d+$/.test(s))
    .join(',')
}

/**
 * 창 찾기(find)·앞으로 가져오기(focus) 스크립트. 보조 코드는 수집이 만든 DLL 이 있으면 불러오고 없거나 못 쓰면 메모리에서
 * 컴파일한다(DLL 을 만들거나 지우지 않는다). pids 순서에서 창을 가진 첫 pid 를 쓰고, `{ pid, title, focused }`
 * (창을 못 찾았으면 null) JSON 한 줄을 UTF-8 로 낸다. find 는 Focus 를 부르지 않는다.
 */
export function focusScript(
  helperDllPath: string | null,
  pids: number[],
  mode: 'find' | 'focus'
): string {
  const focused = mode === 'focus' ? '[PitwallWindow]::Focus($w.Hwnd)' : '$false'
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    ...helperSourceLines(),
    '$r = $null',
    'try {',
    ...helperUseLines(helperDllPath),
    `$w = [PitwallWindow]::Find([int[]]@(${pidList(pids)}))`,
    `if ($w) { $r = @{ pid = $w.Pid; title = $w.Title; focused = ${focused} } }`,
    '} catch {}',
    // PowerShell 5.1 의 ConvertTo-Json 은 $null 에 아무것도 내지 않는다(그러면 GetBytes 가 실패한다).
    "$json = if ($r) { ConvertTo-Json -InputObject $r -Compress } else { 'null' }",
    ...WRITE_JSON_LINES
  ].join('\n')
}

interface FocusResult {
  pid: number
  title: string
  focused: boolean
}

/** 스크립트 출력. 모양이 다르거나 물어본 pid 가 아니면 null(창을 못 찾은 것으로 본다). */
function parseFocusResult(stdout: string, pids: number[]): FocusResult | null {
  try {
    const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') return null
    const { pid, title, focused } = data
    if (typeof pid !== 'number' || !pids.includes(pid)) return null
    if (typeof title !== 'string' || typeof focused !== 'boolean') return null
    return { pid, title, focused }
  } catch {
    return null
  }
}

/**
 * 창으로 가기. 화면·알림이 준 키는 찾는 열쇠일 뿐이고, 지금 스냅샷의 에이전트만 다룬다.
 * - Windows: 그 에이전트의 조상(host.pids) 가운데 창을 가진 첫 프로세스의 창을 보조 코드로 앞으로 가져온다.
 *   PowerShell 은 절대 경로로, 작업 폴더 없이 띄운다. 보조 코드를 못 쓰는 수집 방식(basic·safe)이면 하지 않는다.
 * - macOS: 조상의 `.app` 번들(host.app)이 Terminal·iTerm2 면 에이전트의 tty 로 그 탭을 고르고(macFocus.ts), 다른 앱이거나
 *   고르지 못하면 그 번들을 `/usr/bin/open` 으로 연다(이미 떠 있으면 앞으로 온다).
 * 실패하면 false(화면은 실패를 알리고, 알림은 pitwall 을 연다).
 */
export function createFocuser(deps: {
  platform: Platform
  latest: () => DashboardSnapshot | null
  run: Runner
  /** 보조 코드 DLL 경로(수집과 같은 것). 없으면 메모리에서 컴파일한다. */
  helperDllPath: () => string | null
  /** 지금도 폴더인지(스냅샷의 .app 이 그 사이 지워졌거나 파일로 바뀌었으면 열지 않는다). */
  isDirectory: (p: string) => Promise<boolean>
}): {
  focusAgent(key: string): Promise<boolean>
} {
  function agentFor(key: unknown): AgentRow | null {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null
    return deps.latest()?.agents.find((a) => selectionKey.agent(a) === key) ?? null
  }

  async function focusWindowsHost(agent: AgentRow): Promise<FocusResult | null> {
    const collectMode = deps.latest()?.collectMode
    if (collectMode === 'basic' || collectMode === 'safe') return null
    // 수집이 이미 상한을 지키지만, 명령줄 길이를 넘지 않도록 여기서도 앞의 것만 넣는다.
    const pids = agent.host.pids.filter(isScriptPid).slice(0, HOST_CANDIDATE_LIMIT)
    if (pids.length === 0) return null
    const result = await deps.run(
      [powershellPath(), ...buildPowerShellArgs(focusScript(deps.helperDllPath(), pids, 'focus'))],
      { timeoutMs: COMMAND_TIMEOUT_MS }
    )
    return result.exitCode === 0 ? parseFocusResult(result.stdout, pids) : null
  }

  /** 스냅샷의 값도 다시 확인한다: 수집 때와 같은 규칙(절대 경로, 다른 .app 안이 아닌 .app)에 맞고 지금도 있는 번들만. */
  async function runningApp(app: string | null): Promise<string | null> {
    const isBundle = !!app && appBundleOf(`${app}/Contents/MacOS/`) === app
    if (!app || !isBundle) return null
    return (await deps.isDirectory(app)) ? app : null
  }

  /**
   * Terminal·iTerm2 면 에이전트가 붙어 있는 tty 의 탭을 고른다. 골랐으면 true. 다른 앱이거나, tty 를 모르거나, 그 tty 의
   * 탭이 없거나(tmux 안 등), 허락받지 못했거나, 답이 없으면 false — 부르는 쪽이 앱만 앞으로 가져온다.
   */
  async function selectTab(app: string, agent: AgentRow): Promise<boolean> {
    const kind = tabTerminalOf(app)
    if (!kind || !isScriptPid(agent.pid)) return false
    try {
      const ps = await deps.run(ttyArgv(agent.pid), { timeoutMs: COMMAND_TIMEOUT_MS })
      const tty = ps.exitCode === 0 ? ttyDeviceOf(ps.stdout) : null
      if (!tty) return false
      const result = await deps.run(selectTabArgv(kind, tty), { timeoutMs: COMMAND_TIMEOUT_MS })
      return result.exitCode === 0 && result.stdout.trim() === TAB_FOUND
    } catch {
      return false
    }
  }

  async function focusMacHost(agent: AgentRow): Promise<boolean> {
    const app = await runningApp(agent.host.app)
    if (!app) return false
    if (await selectTab(app, agent)) return true
    const result = await deps.run(['/usr/bin/open', app], { timeoutMs: COMMAND_TIMEOUT_MS })
    return result.exitCode === 0
  }

  return {
    async focusAgent(key) {
      const agent = agentFor(key)
      if (!agent) return false
      try {
        if (deps.platform === 'darwin') return await focusMacHost(agent)
        return (await focusWindowsHost(agent))?.focused === true
      } catch {
        return false
      }
    }
  }
}

/**
 * OS 알림을 눌렀을 때: 에이전트 하나에 대한 알림이고 설정(notifyClickFocus)이 켜져 있으면 먼저 그 에이전트의 창으로 가 보고,
 * 안 되면(false·예외) 지금처럼 pitwall 의 그 항목을 연다. 창으로 갔으면 pitwall 창은 열지 않는다.
 */
export async function openNoticeTarget(
  notice: { target: string | null; focusAgentKey?: string },
  deps: {
    clickFocus: boolean
    focusAgent: (key: string) => Promise<boolean>
    navigate: (key: string | null) => void
  }
): Promise<void> {
  if (notice.focusAgentKey && deps.clickFocus) {
    const focused = await deps.focusAgent(notice.focusAgentKey).catch(() => false)
    if (focused) return
  }
  deps.navigate(notice.target)
}
