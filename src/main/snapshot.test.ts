import {
  buildSnapshot,
  classifyAgent,
  levelOf,
  pidsForWorktreeLookup,
  RELAY_PROCESS_NAMES
} from './snapshot'
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

  test('기타 = 사용 중 메모리 − 위 둘, 공유 메모리 때문에 음수가 되면 0', () => {
    const s = buildSnapshot(input)
    const other = s.groups.find((x) => x.group === 'other')!
    expect(other.memoryBytes).toBe(s.memory.usedBytes - (2220 + 500) * MB)
    expect(other.processCount).toBe(processes.length - 9)
    const tiny = buildSnapshot({ ...input, totalBytes: 1 * GB, freeBytes: 0 })
    expect(tiny.groups.find((x) => x.group === 'other')!.memoryBytes).toBe(0)
  })

  test('에이전트 수는 세션 단위(에이전트 조상이 있는 프로세스는 세지 않음)', () => {
    expect(buildSnapshot(input).agentProcessCount).toBe(2)
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

test('수집 방식을 스냅샷에 그대로 옮기고, 없으면 null', () => {
  expect(
    buildSnapshot({ ...input, sample: { ...sample, collectMode: 'helper-dll' } }).collectMode
  ).toBe('helper-dll')
  expect(buildSnapshot(input).collectMode).toBeNull()
})

test('worktree 판별은 포트를 연 프로세스(1024 이상)와 그 위 3단계 조상만 하면 된다', () => {
  expect([...pidsForWorktreeLookup(sample)].sort((a, b) => a - b)).toEqual([
    4000, 4100, 5000, 5100, 6000, 7000, 7050, 7100, 7202, 7203, 7204, 7205, 9100, 9101
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
