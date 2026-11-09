import { buildSnapshot, levelOf, pidsForWorktreeLookup, RELAY_PROCESS_NAMES } from './snapshot'
import { agentToolOf, classifyAgent } from './processTree'
import type { ProcessInfo, RawSample, TcpEntry, WorktreeInfo } from '../shared/types'

const MB = 1024 * 1024
const GB = 1024 * MB

function proc(
  pid: number,
  ppid: number,
  name: string,
  mb: number,
  startedAt: number | null,
  commandLine = name
): ProcessInfo {
  return { pid, ppid, name, memoryBytes: mb * MB, startedAt, commandLine }
}
function listen(pid: number, port: number, localAddress = '0.0.0.0'): TcpEntry {
  return {
    pid,
    localAddress,
    localPort: port,
    remoteAddress: '0.0.0.0',
    remotePort: 0,
    state: 'Listen'
  }
}
function est(pid: number, localPort: number, remotePort: number): TcpEntry {
  return {
    pid,
    localAddress: '::1',
    localPort,
    remoteAddress: '::1',
    remotePort,
    state: 'Established'
  }
}

const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }
const W2: WorktreeInfo = { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true }
const W3: WorktreeInfo = { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false }
const W4: WorktreeInfo = { root: 'C:\\work\\far', branch: 'main', isLinkedWorktree: false }

const processes: ProcessInfo[] = [
  proc(4000, 1, 'node.exe', 50, 100, '"C:\\Program Files\\nodejs\\node.exe" npm-cli.js run dev'),
  proc(4100, 4000, 'node.exe', 1000, 200),
  proc(4101, 4100, 'esbuild.exe', 200, 300),
  // 4100 보다 먼저 시작했는데 ppid 가 4100 → 예전에 끝난 다른 부모의 pid 가 재사용된 것. 자식이 아니다.
  proc(9000, 4100, 'unrelated.exe', 300, 50),
  proc(5000, 1, 'claude.exe', 400, 100, '"C:\\Users\\김개발\\.local\\bin\\claude.exe"'),
  proc(5001, 5000, 'claude.exe', 10, 110, '"C:\\Users\\김개발\\.local\\bin\\claude.exe" --child'),
  proc(5100, 5000, 'node.exe', 900, 120),
  proc(6000, 1, 'wslrelay.exe', 20, 100),
  proc(4, 0, 'System', 1, null),
  proc(7000, 1, 'python.exe', 80, 100),
  proc(7050, 1, 'cmd.exe', 5, 100),
  proc(7100, 7050, 'node.exe', 100, 110),
  proc(7201, 1, 'a.exe', 1, 100),
  proc(7202, 7201, 'b.exe', 1, 101),
  proc(7203, 7202, 'c.exe', 1, 102),
  proc(7204, 7203, 'd.exe', 1, 103),
  proc(7205, 7204, 'node.exe', 1, 104),
  proc(
    8000,
    1,
    'claude.exe',
    300,
    100,
    'C:\\Users\\김개발\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe'
  ),
  proc(8100, 1, 'codex-windows-sandbox-service.exe', 20, 100),
  proc(
    8200,
    1,
    'node.exe',
    30,
    100,
    'node C:\\Users\\김개발\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
  ),
  proc(8201, 8200, 'codex-x86_64-pc-windows-msvc.exe', 60, 110),
  // 서로를 부모로 가리키는 고리(pid 재사용으로 생길 수 있음)에서도 멈춰야 한다.
  proc(9100, 9101, 'loop-a.exe', 1, null),
  proc(9101, 9100, 'loop-b.exe', 1, null)
]

const tcp: TcpEntry[] = [
  listen(4100, 3000),
  listen(4100, 3000, '::'),
  est(4100, 3000, 51234),
  est(7777, 51234, 3000),
  {
    pid: 0,
    localAddress: '::1',
    localPort: 3000,
    remoteAddress: '::1',
    remotePort: 51000,
    state: 'Other'
  },
  listen(5100, 3003),
  listen(6000, 8080),
  listen(4, 445),
  listen(7000, 8000),
  listen(7100, 3010),
  listen(7205, 3020),
  listen(9100, 3030)
]

const sample: RawSample = { processes, tcp }
const worktrees = new Map<number, WorktreeInfo>([
  [4100, W1],
  [5100, W2],
  [7050, W3],
  [7201, W4]
])
const input = {
  sample,
  worktrees,
  totalBytes: 32 * GB,
  freeBytes: Math.round(5.7 * GB),
  thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
  now: 123
}

describe('포트 행', () => {
  test('IPv4/IPv6 중복 제거, 시스템 포트·판별 안 되는 포트 제외, 릴레이는 판별 불가, 포트 순 정렬', () => {
    const s = buildSnapshot(input)
    expect(s.ports.map((p) => [p.port, p.pid, p.unresolvable])).toEqual([
      [3000, 4100, false],
      [3003, 5100, false],
      [3010, 7100, false],
      [8080, 6000, true]
    ])
  })

  test('조상(3단계까지)의 worktree 를 물려받고, 4단계 위는 보지 않는다', () => {
    const s = buildSnapshot(input)
    expect(s.ports.find((p) => p.port === 3010)?.worktree).toEqual(W3)
    expect(s.ports.find((p) => p.port === 3020)).toBeUndefined()
  })

  test('clientCount 는 서버 쪽 Established 만, 메모리는 자손 포함, 재사용 pid 는 자손 아님', () => {
    const row = buildSnapshot(input).ports.find((p) => p.port === 3000)!
    expect(row.clientCount).toBe(1)
    expect(row.memoryBytes).toBe(1000 * MB + 200 * MB)
    expect(row.descendantPids).toEqual([4101])
    expect(row.processName).toBe('node.exe')
    expect(row.worktree).toEqual(W1)
    expect(row.startedAt).toBe(200)
  })

  test('판별 불가 행은 worktree null', () => {
    const row = buildSnapshot(input).ports.find((p) => p.port === 8080)!
    expect(row.worktree).toBeNull()
    expect(row.clientCount).toBe(0)
  })

  test('ppid 가 서로를 가리키는 고리가 있어도 끝난다', () => {
    const s = buildSnapshot({ ...input, worktrees: new Map([...worktrees, [9100, W1]]) })
    expect(s.ports.find((p) => p.port === 3030)?.descendantPids).toEqual([9101])
  })
})

describe('묶음과 에이전트', () => {
  test('에이전트 자손인 개발 서버는 devServer 로만 센다', () => {
    const g = Object.fromEntries(buildSnapshot(input).groups.map((x) => [x.group, x]))
    expect(g.devServer.memoryBytes).toBe((1000 + 200 + 900 + 100 + 20) * MB)
    expect(g.devServer.processCount).toBe(5)
    expect(g.agent.memoryBytes).toBe((400 + 10 + 30 + 60) * MB)
    expect(g.agent.processCount).toBe(4)
  })

  test('다른 앱 = 나머지 프로세스 전용 메모리 합, 시스템 = 사용 중 메모리 − 프로세스 전부', () => {
    const s = buildSnapshot(input)
    const g = Object.fromEntries(s.groups.map((x) => [x.group, x]))
    expect(s.groups.map((x) => x.group)).toEqual([
      'devServer',
      'agent',
      'heavy',
      'otherApps',
      'system'
    ])
    const all = processes.reduce((sum, p) => sum + p.memoryBytes, 0)
    expect(all).toBe(3483 * MB)
    expect(g.otherApps.memoryBytes).toBe(all - (2220 + 500) * MB)
    expect(g.otherApps.processCount).toBe(processes.length - 9)
    expect(g.system.memoryBytes).toBe(s.memory.usedBytes - all)
    expect(g.heavy).toMatchObject({ memoryBytes: 0, processCount: 0 })
  })

  test('프로세스 합이 사용량보다 크면(공유 메모리를 겹쳐 센 기본 수집 방식) 다른 앱을 사용량 안으로 줄이고 시스템은 0', () => {
    const tiny = buildSnapshot({ ...input, totalBytes: 3 * GB, freeBytes: 0 })
    const g = Object.fromEntries(tiny.groups.map((x) => [x.group, x]))
    expect(g.otherApps.memoryBytes).toBe(3 * GB - (2220 + 500) * MB)
    expect(g.system.memoryBytes).toBe(0)
    const none = buildSnapshot({ ...input, totalBytes: 1 * GB, freeBytes: 0 })
    expect(none.groups.find((x) => x.group === 'otherApps')!.memoryBytes).toBe(0)
  })

  test('다른 앱 상위 5개: 이름별로 묶어 메모리 큰 순(같으면 이름 순)', () => {
    expect(buildSnapshot(input).topApps).toEqual([
      { name: 'claude.exe', memoryBytes: 300 * MB, processCount: 1, exePath: null },
      { name: 'unrelated.exe', memoryBytes: 300 * MB, processCount: 1, exePath: null },
      { name: 'python.exe', memoryBytes: 80 * MB, processCount: 1, exePath: null },
      { name: 'node.exe', memoryBytes: 51 * MB, processCount: 2, exePath: null },
      {
        name: 'codex-windows-sandbox-service.exe',
        memoryBytes: 20 * MB,
        processCount: 1,
        exePath: null
      }
    ])
  })

  test('다른 앱은 명령줄에서 찾은 실행 파일 경로를 함께 담는다(앱 아이콘용, 모르면 null)', () => {
    const apps = buildSnapshot({
      ...input,
      platform: 'win32',
      sample: {
        ...input.sample,
        processes: [
          ...input.sample.processes,
          proc(
            9001,
            1,
            'Figma.exe',
            900,
            null,
            '"C:\\Users\\dev\\AppData\\Local\\Figma\\Figma.exe" --type=renderer'
          )
        ]
      }
    }).topApps
    expect(apps[0]).toEqual({
      name: 'Figma.exe',
      memoryBytes: 900 * MB,
      processCount: 1,
      exePath: 'C:\\Users\\dev\\AppData\\Local\\Figma\\Figma.exe'
    })
    expect(apps.find((a) => a.name === 'python.exe')?.exePath).toBeNull()
  })

  test('OS 와 논리 코어 수를 스냅샷에 담는다(CPU 표시 기준)', () => {
    expect(buildSnapshot({ ...input, platform: 'win32', cpuCount: 16 })).toMatchObject({
      platform: 'win32',
      cpuCount: 16
    })
    expect(buildSnapshot(input)).toMatchObject({ platform: null, cpuCount: 1 })
  })

  test('에이전트 수는 세션 단위(에이전트 조상이 있는 프로세스는 세지 않음)', () => {
    expect(buildSnapshot(input).agentProcessCount).toBe(2)
  })

  test('agentToolOf: Claude Code 는 claude, Codex 는 codex, 아니면 null', () => {
    const tool = (pid: number): string | null => agentToolOf(processes.find((p) => p.pid === pid)!)
    expect([5000, 5001, 8200, 8201, 8000, 8100, 4100].map(tool)).toEqual([
      'claude',
      'claude',
      'codex',
      'codex',
      null,
      null,
      null
    ])
  })

  test('classifyAgent: Claude Code·Codex 는 맞고, Claude 데스크톱 앱·Codex 서비스는 아니다', () => {
    const p = (name: string, commandLine = name): ProcessInfo =>
      proc(1, 0, name, 1, null, commandLine)
    expect(classifyAgent(p('claude.exe', '"C:\\Users\\a\\.local\\bin\\claude.exe"'))).toBe(true)
    expect(classifyAgent(p('claude', '/Users/a/.local/bin/claude --resume'))).toBe(true)
    expect(classifyAgent(p('codex'))).toBe(true)
    expect(classifyAgent(p('codex-aarch64-apple-darwin'))).toBe(true)
    expect(
      classifyAgent(p('node', 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'))
    ).toBe(true)
    expect(
      classifyAgent(p('node.exe', 'node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'))
    ).toBe(true)
    expect(
      classifyAgent(
        p('claude.exe', 'C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\app-1\\claude.exe')
      )
    ).toBe(false)
    expect(classifyAgent(p('Claude', '/Applications/Claude.app/Contents/MacOS/Claude'))).toBe(false)
    // Codex 데스크톱 앱(macOS)도 에이전트(CLI)가 아니다.
    expect(classifyAgent(p('Codex', '/Applications/Codex.app/Contents/MacOS/Codex'))).toBe(false)
    expect(classifyAgent(p('claude.exe', 'claude.exe --type=renderer'))).toBe(false)
    expect(classifyAgent(p('codex-windows-sandbox-service.exe'))).toBe(false)
    expect(classifyAgent(p('node.exe', 'node server.js'))).toBe(false)
  })
})

describe('메모리 요약', () => {
  test('사용량·소수 첫째 자리 퍼센트·단계', () => {
    const s = buildSnapshot(input)
    expect(s.memory.totalBytes).toBe(32 * GB)
    expect(s.memory.usedPercent).toBe(82.2)
    expect(s.memory.level).toBe('warn')
    expect(s.takenAt).toBe(123)
    expect(s.stale).toBe(false)
    expect(s.error).toBeNull()
  })

  test('RAM 단계 경계값', () => {
    expect(levelOf(79.9)).toBe('normal')
    expect(levelOf(80)).toBe('warn')
    expect(levelOf(89.9)).toBe('warn')
    expect(levelOf(90)).toBe('danger')
    expect(levelOf(50, { ramWarnPercent: 40, ramDangerPercent: 60 })).toBe('warn')
  })

  test('총량 0·여유가 총량보다 큰 값 같은 이상한 입력에도 NaN·음수 없음', () => {
    const zero = buildSnapshot({ ...input, totalBytes: 0, freeBytes: 0 })
    expect(zero.memory).toEqual({ totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' })
    expect(buildSnapshot({ ...input, freeBytes: 40 * GB }).memory.usedBytes).toBe(0)
  })
})

test('에이전트(Claude Code 등)가 연 포트는 worktree 안이어도 목록에 올리지 않는다(세션을 끄지 않도록)', () => {
  const s = buildSnapshot({
    ...input,
    worktrees: new Map([...worktrees, [5000, W2]]),
    sample: { processes, tcp: [...tcp, listen(5000, 7523)] }
  })
  expect(s.ports.map((p) => p.port)).not.toContain(7523)
})

test('pitwall 자신과 그 자식 프로세스가 연 포트는 목록에 올리지 않는다', () => {
  const s = buildSnapshot({
    ...input,
    selfPid: 4100,
    sample: { processes, tcp: [...tcp, listen(4101, 9333)] }
  })
  expect(s.ports.map((p) => p.port)).not.toContain(3000)
  expect(s.ports.map((p) => p.port)).not.toContain(9333)
  expect(s.ports.map((p) => p.port)).toContain(3003)
})

test('pitwall 을 띄운 조상(개발 실행의 vite 서버 등)이 연 포트도 올리지 않는다(내리면 pitwall 이 같이 꺼짐)', () => {
  // 4100(vite, W1) 아래에서 pitwall(9900)이 떴다고 본다. 4000(npm)도 조상이다.
  const s = buildSnapshot({
    ...input,
    selfPid: 9900,
    sample: {
      processes: [...processes, proc(9900, 4100, 'electron.exe', 100, 400)],
      tcp: [...tcp, listen(4000, 3001)]
    }
  })
  expect(s.ports.map((p) => p.port)).not.toContain(3000)
  expect(s.ports.map((p) => p.port)).not.toContain(3001)
  expect(s.ports.map((p) => p.port)).toContain(3003)
})

test('수집 방식을 스냅샷에 그대로 옮기고, 없으면 null', () => {
  expect(
    buildSnapshot({ ...input, sample: { ...sample, collectMode: 'helper-dll' } }).collectMode
  ).toBe('helper-dll')
  expect(buildSnapshot(input).collectMode).toBeNull()
})

test('worktree 판별은 포트를 연 프로세스(1024 이상)와 그 위 3단계 조상, 최상위 에이전트, 남은 프로세스 후보만 하면 된다', () => {
  // 8200 은 최상위 Codex, 5001·8201 은 하위 에이전트라 빠진다.
  // 4000(npm, 부모 없음) 아래 esbuild(4101)가 있어 남은 프로세스 후보로 4000·4100·4101 이 들어간다
  // (개발 서버인지는 판별 뒤에 알 수 있어 이 단계에서는 못 뺀다).
  expect([...pidsForWorktreeLookup(sample)].sort((a, b) => a - b)).toEqual([
    4000, 4100, 4101, 5000, 5100, 6000, 7000, 7050, 7100, 7202, 7203, 7204, 7205, 8200, 9100, 9101
  ])
})

test('릴레이 프로세스 이름 목록은 대소문자 무관하게 비교', () => {
  expect(RELAY_PROCESS_NAMES).toContain('wslrelay.exe')
  const s = buildSnapshot({
    ...input,
    sample: { processes: [proc(1, 0, 'WslRelay.EXE', 1, null)], tcp: [listen(1, 9000)] },
    worktrees: new Map()
  })
  expect(s.ports.map((p) => p.unresolvable)).toEqual([true])
})

describe('남은 프로세스', () => {
  const PW = 'C:\\x\\ms-playwright\\chromium\\chrome.exe --remote-debugging-pipe'
  const VT = 'node C:\\work\\wt-a\\node_modules\\vitest\\vitest.mjs'
  const extra = [
    proc(9500, 9499, 'chrome.exe', 120, 100, PW),
    proc(9600, 9599, 'node.exe', 30, 100, VT),
    proc(9700, 9699, 'chrome.exe', 50, 100, PW)
  ]

  test('개발 서버·에이전트·pitwall 트리는 빼고, 같은 워크트리 에이전트를 표시한다', () => {
    const s = buildSnapshot({
      ...input,
      sample: { processes: [...processes, ...extra], tcp },
      worktrees: new Map([...worktrees, [9600, W2], [5000, W2]]),
      selfPid: 9500,
      // 남은 프로세스는 10분 넘게 산 것만(표본 시작 시각은 수백 ms).
      now: 60 * 60 * 1000
    })
    expect(s.leftovers.map((r) => [r.pid, r.label, r.agentInWorktree])).toEqual([
      [9700, 'Playwright 브라우저', false],
      [9600, 'Vitest', true]
    ])
  })

  test('기존 표본(개발 서버를 거느린 npm·에이전트·셸)에서는 남은 프로세스가 없다', () => {
    expect(buildSnapshot(input).leftovers).toEqual([])
  })

  test('워크트리 판별 대상에 남은 프로세스와 그 자손을 더한다', () => {
    const pids = pidsForWorktreeLookup({
      processes: [...processes, ...extra, proc(9601, 9600, 'node.exe', 1, 200, 'worker')],
      tcp
    })
    expect([9500, 9600, 9601, 9700].every((pid) => pids.has(pid))).toBe(true)
  })
})

describe('무거운 작업', () => {
  const tscUnderAgent = proc(
    5200,
    5000,
    'node.exe',
    3000,
    130,
    'node C:\\work\\wt-a\\node_modules\\typescript\\bin\\tsc --noEmit'
  )
  const viteBuild = proc(
    7300,
    1,
    'node.exe',
    2000,
    100,
    'node C:\\work\\api\\node_modules\\vite\\bin\\vite.js build'
  )
  const patterns = ['tsc', 'vite build']
  const heavyInput = {
    ...input,
    sample: { processes: [...processes, tscUnderAgent, viteBuild], tcp },
    worktrees: new Map([...worktrees, [5000, W2], [7300, W3]]),
    heavyPatterns: patterns
  }

  test('에이전트가 띄운 작업도 찾고, 묶음은 무거운 작업으로 옮긴다(에이전트 묶음에서 빠짐)', () => {
    const s = buildSnapshot(heavyInput)
    expect(s.heavyJobs.map((j) => [j.pid, j.label, j.worktree?.root])).toEqual([
      [5200, 'tsc', W2.root],
      [7300, 'vite build', W3.root]
    ])
    const g = Object.fromEntries(s.groups.map((x) => [x.group, x]))
    expect(g.heavy).toMatchObject({ memoryBytes: 5000 * MB, processCount: 2 })
    expect(g.agent.memoryBytes).toBe((400 + 10 + 30 + 60) * MB)
  })

  test('겹침 경고: 2개 이상이고 RAM 이 경고 기준 이상일 때만', () => {
    expect(buildSnapshot(heavyInput).heavyOverlap).toBe(true)
    expect(buildSnapshot({ ...heavyInput, freeBytes: 20 * GB }).heavyOverlap).toBe(false)
    const one = buildSnapshot({
      ...heavyInput,
      sample: { processes: [...processes, viteBuild], tcp },
      freeBytes: 1 * GB
    })
    expect(one.heavyJobs).toHaveLength(1)
    expect(one.heavyOverlap).toBe(false)
  })

  test('패턴이 없으면 무거운 작업도 없다', () => {
    expect(buildSnapshot({ ...heavyInput, heavyPatterns: [] }).heavyJobs).toEqual([])
    expect(buildSnapshot(input).heavyJobs).toEqual([])
  })

  test('워크트리 판별 대상에 무거운 작업과 그 조상을 더한다', () => {
    const pids = pidsForWorktreeLookup(heavyInput.sample, 'win32', patterns)
    expect(pids.has(5200)).toBe(true)
    expect(pids.has(7300)).toBe(true)
  })
})
