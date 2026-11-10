import { createFocuser, focusScript, openNoticeTarget } from './focusWindow'
import { HOST_CANDIDATE_LIMIT } from './agents'
import { buildPowerShellArgs, nativeHelperDllName, powershellPath } from './collect/windows'
import { blankSnapshot } from '../shared/snapshot'
import { selectionKey } from '../shared/keys'
import type { AgentRow, CollectMode, DashboardSnapshot, Platform } from '../shared/types'
import type { CommandOptions, CommandResult } from './collect/runCommand'

const TERMINAL = '/System/Applications/Utilities/Terminal.app'

function agent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    pid: 5000,
    tool: 'claude',
    worktree: { root: 'C:\\work\\shop-web', branch: 'main', isLinkedWorktree: false },
    workspace: null,
    startedAt: 100,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state: 'waiting',
    stateSource: 'hook',
    stateSince: null,
    cpuPercent: null,
    lastActiveAt: null,
    parked: false,
    activity: null,
    quietSince: null,
    usage: null,
    waitReason: null,
    host: { pids: [4000, 3000, 2000], app: null },
    ...over
  }
}

const KEY = selectionKey.agent(agent())

function snap(
  over: { platform?: Platform; collectMode?: CollectMode | null; agents?: AgentRow[] } = {}
): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    platform: over.platform ?? 'win32',
    collectMode: over.collectMode === undefined ? 'helper-dll' : over.collectMode,
    agents: over.agents ?? [agent()]
  }
}

/** PowerShell 인자(-EncodedCommand)에서 스크립트를 되살린다. */
const scriptOf = (argv: string[]): string =>
  Buffer.from(argv[argv.length - 1], 'base64').toString('utf16le')

/** 실제로 실행하지 않는 가짜 의존성. reply 는 실행할 때마다 돌려줄 결과(없으면 창을 찾지 못함). */
function fakes(
  over: {
    platform?: Platform
    latest?: DashboardSnapshot | null
    reply?: CommandResult | (() => Promise<CommandResult>)
    notDirs?: string[]
  } = {}
): {
  focuser: ReturnType<typeof createFocuser>
  calls: { argv: string[]; opts?: CommandOptions }[]
  checked: string[]
} {
  const calls: { argv: string[]; opts?: CommandOptions }[] = []
  const checked: string[] = []
  const latest = over.latest === undefined ? snap({ platform: over.platform }) : over.latest
  const focuser = createFocuser({
    platform: over.platform ?? 'win32',
    latest: () => latest,
    run: async (argv, opts) => {
      calls.push({ argv, opts })
      const reply = over.reply ?? { stdout: 'null', stderr: '', exitCode: 0 }
      return typeof reply === 'function' ? reply() : reply
    },
    helperDllPath: () => 'C:\\Users\\dev\\AppData\\Roaming\\pitwall\\pitwall-native-1.dll',
    isDirectory: async (p) => {
      checked.push(p)
      return !(over.notDirs ?? []).includes(p)
    }
  })
  return { focuser, calls, checked }
}

const found = (focused: boolean, pid = 3000): CommandResult => ({
  stdout: JSON.stringify({ pid, title: '관리자: Windows PowerShell', focused }),
  stderr: '',
  exitCode: 0
})

/** 스크립트에서 창 찾기 줄(pid 가 들어가는 유일한 줄). */
const findLine = (script: string): string | undefined =>
  script.split('\n').find((l) => l.includes('[PitwallWindow]::Find('))

describe('스크립트', () => {
  test('스크립트는 pid 를 숫자로만 넣고 find 에서는 Focus 를 부르지 않는다', () => {
    const find = focusScript(null, [4000, 3000], 'find')
    expect(findLine(find)).toBe('$w = [PitwallWindow]::Find([int[]]@(4000,3000))')
    expect(find).not.toContain('[PitwallWindow]::Focus(')
    expect(focusScript(null, [4000], 'focus')).toContain('[PitwallWindow]::Focus($w.Hwnd)')

    // 양의 정수(int 범위)가 아닌 값은 버린다. 다른 글자가 스크립트에 들어가지 않는다.
    const odd = [
      12,
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      2 ** 31,
      1e21,
      '7); Remove-Item C:\\ -Recurse #',
      '8',
      null,
      [9]
    ] as unknown as number[]
    for (const mode of ['find', 'focus'] as const)
      expect(findLine(focusScript(null, odd, mode))).toBe(
        '$w = [PitwallWindow]::Find([int[]]@(12))'
      )
  })

  test('보조 코드는 수집이 만든 DLL 을 불러오고(경로의 작은따옴표는 이스케이프), 못 쓰면 메모리에서 컴파일하며, JSON 은 UTF-8 바이트로 낸다', () => {
    const script = focusScript("C:\\Users\\김'개발\\pitwall-native-1.dll", [1], 'find')
    expect(script).toContain("$dll = 'C:\\Users\\김''개발\\pitwall-native-1.dll'")
    expect(script).toContain('Add-Type -Path $dll')
    expect(script).toMatch(/catch \{ Add-Type -ErrorAction Stop -TypeDefinition \$src \}/)
    expect(script).toContain('public static class PitwallWindow')
    expect(script).toContain('[Console]::OpenStandardOutput()')
    expect(focusScript(null, [1], 'find')).not.toContain('$dll')
    expect(focusScript(null, [1], 'find')).toContain(
      'Add-Type -ErrorAction Stop -TypeDefinition $src'
    )
  })

  test('창으로 가기 스크립트는 DLL 을 만들거나 지우지 않는다', () => {
    // 업데이트 뒤 수집이 처음 컴파일하는 사이에 끼어들어 DLL 을 만들거나 지우면 수집이 경쟁에 져 그 세션 내내 메모리 컴파일로 간다.
    for (const mode of ['find', 'focus'] as const) {
      const script = focusScript(
        'C:\\Users\\dev\\AppData\\Roaming\\pitwall\\pitwall-native-1.dll',
        [1],
        mode
      )
      expect(script).not.toContain('-OutputAssembly')
      expect(script).not.toContain('Remove-Item')
    }
  })

  test(`창 후보 ${HOST_CANDIDATE_LIMIT}개(가장 긴 pid)와 긴 DLL 경로도 한 명령줄 길이 제한(32767자) 안에 들어간다`, () => {
    const pids = Array.from({ length: HOST_CANDIDATE_LIMIT }, (_, i) => 0x7fffffff - i)
    const dll =
      'C:\\Users\\' + '가'.repeat(60) + '\\AppData\\Roaming\\pitwall\\' + nativeHelperDllName()
    const script = focusScript(dll, pids, 'focus')
    expect(findLine(script)).toBe(`$w = [PitwallWindow]::Find([int[]]@(${pids.join(',')}))`)
    // 수집 스크립트와 같은 여유(30000)를 둔다.
    expect([powershellPath(), ...buildPowerShellArgs(script)].join(' ').length).toBeLessThan(30000)
  })
})

describe('창으로 가기', () => {
  test(`창 후보가 ${HOST_CANDIDATE_LIMIT}개를 넘으면(스냅샷이 이상해도) 앞의 ${HOST_CANDIDATE_LIMIT}개만 넣는다`, async () => {
    const pids = Array.from({ length: 100 }, (_, i) => 1000 + i)
    const f = fakes({ latest: snap({ agents: [agent({ host: { pids, app: null } })] }) })
    await f.focuser.focusAgent(KEY)
    expect(findLine(scriptOf(f.calls[0].argv))).toBe(
      `$w = [PitwallWindow]::Find([int[]]@(${pids.slice(0, HOST_CANDIDATE_LIMIT).join(',')}))`
    )
  })

  test('스냅샷에 없는 키는 실행하지 않고 false', async () => {
    const f = fakes()
    for (const key of [
      'agent:5000:999',
      'agent:5001:100',
      'server:5000:100',
      '',
      'agent:5000:100'.padEnd(500, 'x'),
      42,
      null,
      { toString: () => KEY }
    ] as unknown as string[]) {
      expect(await f.focuser.focusAgent(key)).toBe(false)
    }
    expect(f.calls).toEqual([])
    // 스냅샷이 아직 없어도 실행하지 않는다.
    const none = fakes({ latest: null })
    expect(await none.focuser.focusAgent(KEY)).toBe(false)
    expect(none.calls).toEqual([])
  })

  test('찾은 창이 앞으로 오지 않았으면 false', async () => {
    const refused = fakes({ reply: found(false) })
    expect(await refused.focuser.focusAgent(KEY)).toBe(false)
    const ok = fakes({ reply: found(true) })
    expect(await ok.focuser.focusAgent(KEY)).toBe(true)
    // PowerShell 은 절대 경로, 작업 폴더 없이, 그 에이전트의 조상 pid 로 focus 를 한다.
    expect(ok.calls).toHaveLength(1)
    const { argv, opts } = ok.calls[0]
    expect(argv[0]).toMatch(/^[A-Za-z]:\\.*\\WindowsPowerShell\\v1\.0\\powershell\.exe$/)
    expect(opts).not.toHaveProperty('cwd')
    expect(scriptOf(argv)).toContain('[PitwallWindow]::Find([int[]]@(4000,3000,2000))')
    expect(scriptOf(argv)).toContain('[PitwallWindow]::Focus($w.Hwnd)')

    // 창을 못 찾음·이상한 출력·조상이 아닌 pid·실패한 실행·예외는 모두 false.
    const replies: (CommandResult | (() => Promise<CommandResult>))[] = [
      { stdout: 'null', stderr: '', exitCode: 0 },
      { stdout: '', stderr: '', exitCode: 0 },
      { stdout: 'Add-Type : blocked', stderr: '', exitCode: 0 },
      { stdout: '{"pid":3000,"title":"x","focused":"yes"}', stderr: '', exitCode: 0 },
      found(true, 9999),
      { ...found(true), exitCode: 1 },
      () => Promise.reject(new Error('timeout'))
    ]
    for (const reply of replies) expect(await fakes({ reply }).focuser.focusAgent(KEY)).toBe(false)
  })

  test('보조 코드를 쓸 수 없는 수집 방식(basic·safe)이거나 조상을 모르면 실행하지 않고 false', async () => {
    for (const latest of [
      snap({ collectMode: 'basic' }),
      snap({ collectMode: 'safe' }),
      snap({ agents: [agent({ host: { pids: [], app: null } })] })
    ]) {
      const f = fakes({ latest, reply: found(true) })
      expect(await f.focuser.focusAgent(KEY)).toBe(false)
      expect(f.calls).toEqual([])
    }
  })

  test('macOS 는 host.app 을 open 으로, 없으면 false', async () => {
    const withApp = (app: string | null): DashboardSnapshot =>
      snap({
        platform: 'darwin',
        collectMode: 'darwin',
        agents: [agent({ host: { pids: [300], app } })]
      })
    const ok = fakes({ platform: 'darwin', latest: withApp(TERMINAL) })
    expect(await ok.focuser.focusAgent(KEY)).toBe(true)
    expect(ok.calls.map((c) => c.argv)).toEqual([['/usr/bin/open', TERMINAL]])
    expect(ok.calls[0].opts).not.toHaveProperty('cwd')
    expect(ok.checked).toEqual([TERMINAL])

    const failed = fakes({
      platform: 'darwin',
      latest: withApp(TERMINAL),
      reply: { stdout: '', stderr: 'Unable to find application', exitCode: 1 }
    })
    expect(await failed.focuser.focusAgent(KEY)).toBe(false)

    // .app 이 없거나, 지금은 폴더가 아니거나, 번들 경로가 아니면 열지 않는다.
    for (const [app, notDirs] of [
      [null, []],
      [TERMINAL, [TERMINAL]],
      ['Terminal.app', []],
      ['/Applications/Code.app/Contents/Frameworks/Helper.app', []],
      ['/Applications/Code', []]
    ] as [string | null, string[]][]) {
      const f = fakes({ platform: 'darwin', latest: withApp(app), notDirs, reply: found(true) })
      expect(await f.focuser.focusAgent(KEY)).toBe(false)
      expect(f.calls).toEqual([])
    }
  })
})

describe('알림을 누르면', () => {
  function click(
    notice: { target: string | null; focusAgentKey?: string },
    clickFocus: boolean,
    focus: (key: string) => Promise<boolean>
  ): Promise<{ focused: string[]; navigated: (string | null)[] }> {
    const focused: string[] = []
    const navigated: (string | null)[] = []
    return openNoticeTarget(notice, {
      clickFocus,
      focusAgent: (key) => {
        focused.push(key)
        return focus(key)
      },
      navigate: (key) => {
        navigated.push(key)
      }
    }).then(() => ({ focused, navigated }))
  }
  const agentNotice = { target: KEY, focusAgentKey: KEY }

  test('에이전트 알림이고 설정이 켜져 있으면 창으로 가고, pitwall 은 열지 않는다', async () => {
    expect(await click(agentNotice, true, async () => true)).toEqual({
      focused: [KEY],
      navigated: []
    })
  })

  test('창으로 가지 못하면(false·예외) 지금처럼 pitwall 의 그 항목을 연다', async () => {
    expect(await click(agentNotice, true, async () => false)).toEqual({
      focused: [KEY],
      navigated: [KEY]
    })
    expect(await click(agentNotice, true, () => Promise.reject(new Error('timeout')))).toEqual({
      focused: [KEY],
      navigated: [KEY]
    })
  })

  test('설정을 껐거나 에이전트 하나에 대한 알림이 아니면 바로 pitwall 을 연다', async () => {
    expect(await click(agentNotice, false, async () => true)).toEqual({
      focused: [],
      navigated: [KEY]
    })
    expect(await click({ target: null }, true, async () => true)).toEqual({
      focused: [],
      navigated: [null]
    })
  })
})
