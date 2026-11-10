import {
  buildAgents,
  measureTreeCpu,
  withStateSince,
  WORKING_CPU_PERCENT,
  type CpuMemo
} from './agents'
import type { HookView } from './sessions'
import type {
  AgentRow,
  AgentState,
  AgentTool,
  ProcessInfo,
  RawSample,
  WorktreeInfo
} from '../shared/types'

const MB = 1024 * 1024

function proc(
  pid: number,
  ppid: number,
  name: string,
  opts: { mb?: number; startedAt?: number | null; cpuMs?: number | null; commandLine?: string } = {}
): ProcessInfo {
  return {
    pid,
    ppid,
    name,
    commandLine: opts.commandLine ?? name,
    memoryBytes: (opts.mb ?? 1) * MB,
    startedAt: opts.startedAt === undefined ? 100 : opts.startedAt,
    cpuMs: opts.cpuMs === undefined ? 0 : opts.cpuMs
  }
}

const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }
const W2: WorktreeInfo = { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true }

const CODEX_JS =
  'node C:\\Users\\김개발\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'

function run(
  processes: ProcessInfo[],
  opts: {
    previousCpu?: CpuMemo
    now?: number
    devServerPids?: number[]
    worktrees?: [number, WorktreeInfo][]
    hookFor?: (agent: {
      key: string
      worktreeRoot: string | null
      tool: AgentTool
    }) => HookView | null
  } = {}
): ReturnType<typeof buildAgents> {
  const sample: RawSample = { processes, tcp: [] }
  return buildAgents({
    sample,
    worktrees: new Map(opts.worktrees ?? []),
    devServerPids: new Set(opts.devServerPids ?? []),
    previousCpu: opts.previousCpu ?? new Map(),
    now: opts.now ?? 10_000,
    hookFor: opts.hookFor
  })
}

const hookView = (state: AgentState): HookView => ({
  state,
  since: 1,
  lastActivityAt: 1,
  sessionId: 's1'
})

describe('에이전트 행', () => {
  test('최상위 에이전트만 행이 되고, 하위 에이전트(같은 세션)는 행이 아니다', () => {
    const { agents } = run([
      proc(5000, 1, 'claude.exe'),
      proc(5001, 5000, 'claude.exe'),
      proc(5100, 5000, 'node.exe'),
      proc(8200, 1, 'node.exe', { commandLine: CODEX_JS }),
      proc(8201, 8200, 'codex-x86_64-pc-windows-msvc.exe'),
      proc(7000, 1, 'python.exe')
    ])
    expect(agents.map((a) => [a.pid, a.tool])).toEqual([
      [5000, 'claude'],
      [8200, 'codex']
    ])
  })

  test('Claude 데스크톱 앱은 에이전트가 아니다', () => {
    const { agents } = run([
      proc(8000, 1, 'claude.exe', {
        commandLine: 'C:\\Users\\김개발\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe'
      })
    ])
    expect(agents).toEqual([])
  })

  test('메모리·하위 프로세스 수는 자기 + 자손 중 개발 서버가 아닌 것', () => {
    const { agents } = run(
      [
        proc(5000, 1, 'claude.exe', { mb: 400 }),
        proc(5100, 5000, 'node.exe', { mb: 900 }),
        proc(5200, 5000, 'bash.exe', { mb: 10 }),
        proc(5201, 5200, 'node.exe', { mb: 20 })
      ],
      { devServerPids: [5100] }
    )
    expect(agents[0].memoryBytes).toBe(430 * MB)
    expect(agents[0].descendantCount).toBe(2)
    // 마지막 활동·오래 쉬는 세션은 수집기가 채운다.
    expect(agents[0]).toMatchObject({ lastActiveAt: null, parked: false })
    // 상세 패널의 프로세스 목록도 같은 프로세스(자기 포함)로 메모리와 맞는다.
    expect(agents[0].processes.map((p) => [p.name, p.count, p.memoryBytes / MB])).toEqual([
      ['claude.exe', 1, 400],
      ['node.exe', 1, 20],
      ['bash.exe', 1, 10]
    ])
  })

  test('members: 에이전트 키 → 자기와 센 자손 pid(개발 서버와 그 아래는 빼고)', () => {
    const { members } = run(
      [
        proc(5000, 1, 'claude.exe', { startedAt: 50 }),
        proc(5100, 5000, 'node.exe'),
        proc(5101, 5100, 'esbuild.exe'),
        proc(5200, 5000, 'bash.exe'),
        proc(5201, 5200, 'node.exe'),
        proc(6000, 1, 'codex.exe', { startedAt: null }),
        proc(7000, 1, 'python.exe')
      ],
      { devServerPids: [5100, 5101] }
    )
    expect(members).toEqual(
      new Map([
        ['5000:50', [5000, 5200, 5201]],
        ['6000:', [6000]]
      ])
    )
  })

  test('커밋은 메모리와 같은 프로세스(자기 + 개발 서버가 아닌 자손)의 합, 하나도 모르면 null', () => {
    const withCommit = (p: ProcessInfo, mb: number | null): ProcessInfo => ({
      ...p,
      commitBytes: mb == null ? null : mb * MB
    })
    const { agents } = run(
      [
        withCommit(proc(5000, 1, 'claude.exe', { mb: 400 }), 1000),
        withCommit(proc(5100, 5000, 'node.exe', { mb: 900 }), 4000),
        withCommit(proc(5200, 5000, 'bash.exe', { mb: 10 }), null),
        withCommit(proc(5201, 5200, 'node.exe', { mb: 20 }), 60),
        proc(6000, 1, 'codex.exe')
      ],
      { devServerPids: [5100] }
    )
    const claude = agents.find((a) => a.pid === 5000)!
    expect(claude.commitBytes).toBe(1060 * MB)
    expect(claude.processes.map((p) => [p.name, p.commitBytes])).toEqual([
      ['claude.exe', 1000 * MB],
      ['node.exe', 60 * MB],
      ['bash.exe', null]
    ])
    expect(agents.find((a) => a.pid === 6000)!.commitBytes).toBeNull()
  })

  test('워크트리는 에이전트 자신의 판별 결과', () => {
    const { agents } = run([proc(5000, 1, 'claude.exe'), proc(6000, 1, 'codex.exe')], {
      worktrees: [[5000, W2]]
    })
    expect(agents.find((a) => a.pid === 5000)?.worktree).toEqual(W2)
    expect(agents.find((a) => a.pid === 6000)?.worktree).toBeNull()
  })

  test('워크트리 폴더 이름 순, 판별 안 된 것은 뒤로, 같으면 pid 순', () => {
    const { agents } = run(
      [
        proc(1, 0, 'codex.exe'),
        proc(2, 0, 'claude.exe'),
        proc(3, 0, 'claude.exe'),
        proc(4, 0, 'claude.exe')
      ],
      {
        worktrees: [
          [2, W2],
          [3, W1],
          [4, W1]
        ]
      }
    )
    expect(agents.map((a) => a.pid)).toEqual([3, 4, 2, 1])
  })
})

describe('CPU 로 작업 중 판단', () => {
  test('이전 샘플이 없으면 알 수 없음', () => {
    const { agents } = run([proc(5000, 1, 'claude.exe', { cpuMs: 5000 })])
    expect(agents[0]).toMatchObject({ state: 'unknown', stateSource: 'cpu', cpuPercent: null })
  })

  test(`하위 트리 CPU 변화가 코어 1개 기준 ${WORKING_CPU_PERCENT}% 이상이면 작업 중, 미만이면 쉬는 중`, () => {
    const first = run(
      [proc(5000, 1, 'claude.exe', { cpuMs: 1000 }), proc(5100, 5000, 'rg.exe', { cpuMs: 0 })],
      {
        now: 10_000
      }
    )
    // 5초 동안 100ms = 2%
    const working = run(
      [proc(5000, 1, 'claude.exe', { cpuMs: 1060 }), proc(5100, 5000, 'rg.exe', { cpuMs: 40 })],
      { now: 15_000, previousCpu: first.cpu }
    )
    expect(working.agents[0]).toMatchObject({ state: 'working', cpuPercent: 2 })
    const idle = run(
      [proc(5000, 1, 'claude.exe', { cpuMs: 1059 }), proc(5100, 5000, 'rg.exe', { cpuMs: 40 })],
      { now: 15_000, previousCpu: first.cpu }
    )
    // 99ms = 1.98% → 표시도 판단과 맞게 내림(1.9)
    expect(idle.agents[0]).toMatchObject({ state: 'idle', cpuPercent: 1.9 })
  })

  test('지난 샘플 뒤 2초도 안 돼 다시 재면(지금 새로고침) 짧은 구간으로 재지 않고 지난 값을 유지한다', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], { now: 10_000 })
    const steady = run([proc(5000, 1, 'claude.exe', { cpuMs: 1010 })], {
      now: 15_000,
      previousCpu: first.cpu
    })
    expect(steady.agents[0]).toMatchObject({ state: 'idle', cpuPercent: 0.2 })
    // 0.3초 만에 다시: 그 사이 60ms 를 썼어도(20%) 작업 중으로 튀지 않는다.
    const quick = run([proc(5000, 1, 'claude.exe', { cpuMs: 1070 })], {
      now: 15_300,
      previousCpu: steady.cpu
    })
    expect(quick.agents[0]).toMatchObject({ state: 'idle', cpuPercent: 0.2 })
    // 다음 정상 샘플은 지난 기준(15초)부터 잰다: 5초 동안 100ms = 2%.
    const next = run([proc(5000, 1, 'claude.exe', { cpuMs: 1110 })], {
      now: 20_000,
      previousCpu: quick.cpu
    })
    expect(next.agents[0]).toMatchObject({ state: 'working', cpuPercent: 2 })
  })

  test('같은 pid 라도 시작 시각이 다르면 새 프로세스라 알 수 없음', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000, startedAt: 100 })])
    const second = run([proc(5000, 1, 'claude.exe', { cpuMs: 9000, startedAt: 9000 })], {
      now: 15_000,
      previousCpu: first.cpu
    })
    expect(second.agents[0].state).toBe('unknown')
  })

  test('지난 샘플 사이에 끝난 자식 때문에 음수가 되지 않고, 새로 시작한 자식의 CPU 는 센다', () => {
    const first = run(
      [
        proc(5000, 1, 'claude.exe', { cpuMs: 1000 }),
        proc(5100, 5000, 'tsc.exe', { cpuMs: 30_000 })
      ],
      { now: 10_000 }
    )
    const second = run(
      [
        proc(5000, 1, 'claude.exe', { cpuMs: 1000 }),
        proc(5200, 5000, 'node.exe', { cpuMs: 500, startedAt: 12_000 })
      ],
      { now: 15_000, previousCpu: first.cpu }
    )
    expect(second.agents[0]).toMatchObject({ state: 'working', cpuPercent: 10 })
  })

  test('지난 샘플 전부터 있던 자식이 처음 보이면(기록 없음) 누적 CPU 를 세지 않는다', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], { now: 10_000 })
    const second = run(
      [
        proc(5000, 1, 'claude.exe', { cpuMs: 1000 }),
        proc(5300, 5000, 'node.exe', { cpuMs: 60_000, startedAt: 500 })
      ],
      { now: 15_000, previousCpu: first.cpu }
    )
    expect(second.agents[0]).toMatchObject({ state: 'idle', cpuPercent: 0 })
  })

  test('개발 서버 자손의 CPU 는 세지 않는다(HMR 등으로 늘 작업 중처럼 보이지 않게)', () => {
    const first = run(
      [proc(5000, 1, 'claude.exe', { cpuMs: 1000 }), proc(5100, 5000, 'node.exe', { cpuMs: 0 })],
      { now: 10_000, devServerPids: [5100] }
    )
    const second = run(
      [proc(5000, 1, 'claude.exe', { cpuMs: 1000 }), proc(5100, 5000, 'node.exe', { cpuMs: 4000 })],
      { now: 15_000, previousCpu: first.cpu, devServerPids: [5100] }
    )
    expect(second.agents[0].state).toBe('idle')
  })

  test('CPU 시간을 모르면(null) 알 수 없음', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: null })], { now: 10_000 })
    const second = run([proc(5000, 1, 'claude.exe', { cpuMs: null })], {
      now: 15_000,
      previousCpu: first.cpu
    })
    expect(second.agents[0]).toMatchObject({ state: 'unknown', cpuPercent: null })
  })

  test('기록은 지금 보이는 에이전트 트리의 프로세스만 남긴다', () => {
    const first = run([proc(5000, 1, 'claude.exe'), proc(5100, 5000, 'node.exe')], {
      now: 10_000
    })
    expect([...first.cpu.keys()].sort()).toEqual(['5000:100', '5100:100'])
    const second = run([proc(7000, 1, 'python.exe')], { now: 15_000, previousCpu: first.cpu })
    expect(second.cpu.size).toBe(0)
  })
})

describe('훅 상태', () => {
  test('Claude 행은 그 프로세스의 훅 상태가 있으면 그것이 우선이고, CPU 값은 그대로 보인다', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], {
      now: 10_000,
      worktrees: [[5000, W1]]
    })
    const second = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], {
      now: 15_000,
      previousCpu: first.cpu,
      worktrees: [[5000, W1]],
      hookFor: (a) => (a.worktreeRoot === W1.root ? hookView('waiting') : null)
    })
    expect(second.agents[0]).toMatchObject({
      state: 'waiting',
      stateSource: 'hook',
      cpuPercent: 0
    })
  })

  test('훅 상태는 에이전트마다(프로세스 키·워크트리·도구로) 묻고, 없으면 CPU 판단', () => {
    const hookFor = vi.fn((): HookView | null => null)
    const { agents } = run(
      [proc(5000, 1, 'claude.exe'), proc(5001, 1, 'claude.exe', { startedAt: 200 })],
      { worktrees: [[5000, W1]], hookFor }
    )
    expect(agents.map((a) => a.stateSource)).toEqual(['cpu', 'cpu'])
    // 워크트리를 몰라도 묻는다(그 프로세스와 짝지은 세션이 있을 수 있다).
    expect(hookFor.mock.calls).toEqual([
      [{ key: '5000:100', worktreeRoot: W1.root, tool: 'claude' }],
      [{ key: '5001:200', worktreeRoot: null, tool: 'claude' }]
    ])
  })

  test('같은 워크트리의 두 Claude 는 각자 자기 훅 상태를 쓴다', () => {
    const { agents } = run(
      [proc(5000, 1, 'claude.exe'), proc(5001, 1, 'claude.exe', { startedAt: 200 })],
      {
        worktrees: [
          [5000, W1],
          [5001, W1]
        ],
        hookFor: (a) => hookView(a.key === '5000:100' ? 'waiting' : 'idle')
      }
    )
    expect(agents.map((a) => [a.pid, a.state])).toEqual([
      [5000, 'waiting'],
      [5001, 'idle']
    ])
  })

  test('훅 상태는 도구별: Codex 행은 Codex 훅 상태, Claude 행은 Claude 훅 상태', () => {
    const { agents } = run(
      [proc(8200, 1, 'node.exe', { commandLine: CODEX_JS }), proc(5000, 1, 'claude.exe')],
      {
        worktrees: [
          [8200, W1],
          [5000, W1]
        ],
        hookFor: (a) => (a.tool === 'codex' ? hookView('waiting') : null)
      }
    )
    expect(agents.find((a) => a.tool === 'codex')).toMatchObject({
      state: 'waiting',
      stateSource: 'hook'
    })
    expect(agents.find((a) => a.tool === 'claude')).toMatchObject({ stateSource: 'cpu' })
  })
})

describe('상태 시작 시각(F3)', () => {
  const row = (over: Partial<AgentRow> = {}): AgentRow => ({
    pid: 5000,
    tool: 'codex',
    worktree: null,
    workspace: null,
    startedAt: 100,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state: 'working',
    stateSource: 'cpu',
    stateSince: null,
    cpuPercent: 10,
    lastActiveAt: null,
    parked: false,
    ...over
  })

  test('CPU 추정 상태의 시작 시각은 처음 본 시각, 상태가 바뀌면 새로', () => {
    const first = withStateSince([row()], new Map(), 1000, () => null)
    expect(first.agents[0].stateSince).toBe(1000)
    const same = withStateSince([row()], first.memo, 6000, () => null)
    expect(same.agents[0].stateSince).toBe(1000)
    const idle = withStateSince([row({ state: 'idle' })], same.memo, 11_000, () => null)
    expect(idle.agents[0].stateSince).toBe(11_000)
  })

  test('훅 상태면 그 상태가 된 이벤트 시각을 쓴다', () => {
    const r = withStateSince(
      [row({ stateSource: 'hook', state: 'waiting' })],
      new Map(),
      9000,
      () => 4000
    )
    expect(r.agents[0].stateSince).toBe(4000)
  })

  test('아직 판단하지 못한 상태(unknown)는 시작 시각이 없고 기억하지 않는다', () => {
    const r = withStateSince(
      [row({ state: 'unknown', cpuPercent: null })],
      new Map(),
      1000,
      () => null
    )
    expect(r.agents[0].stateSince).toBeNull()
    expect(r.memo.size).toBe(0)
  })

  test('사라진 에이전트의 기억은 버린다', () => {
    const first = withStateSince([row()], new Map(), 1000, () => null)
    expect(withStateSince([], first.memo, 2000, () => null).memo.size).toBe(0)
  })
})

describe('트리 CPU', () => {
  test('맨 위 프로세스와 자손의 누적 CPU 변화로 잰다(서버에도 같은 계산)', () => {
    const top: ProcessInfo = {
      pid: 6100,
      ppid: 1,
      name: 'java.exe',
      commandLine: 'java',
      memoryBytes: 1,
      startedAt: 1,
      cpuMs: 1000
    }
    const child: ProcessInfo = { ...top, pid: 6101, ppid: 6100, startedAt: 2, cpuMs: 500 }
    const first: CpuMemo = new Map()
    expect(measureTreeCpu(top, [top, child], new Map(), 10_000, first)).toBeNull()
    const second: CpuMemo = new Map()
    const later = [
      { ...top, cpuMs: 1500 },
      { ...child, cpuMs: 1500 }
    ]
    // 10초 동안 0.5초 + 1초 = 1.5초 → 15%.
    expect(measureTreeCpu(later[0], later, first, 20_000, second)).toBe(15)
  })
})
