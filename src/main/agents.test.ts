import { buildAgents, WORKING_CPU_PERCENT, type CpuMemo } from './agents'
import type { AgentState, ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'

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
    hookStates?: (root: string) => AgentState | null
  } = {}
): ReturnType<typeof buildAgents> {
  const sample: RawSample = { processes, tcp: [] }
  return buildAgents({
    sample,
    worktrees: new Map(opts.worktrees ?? []),
    devServerPids: new Set(opts.devServerPids ?? []),
    previousCpu: opts.previousCpu ?? new Map(),
    now: opts.now ?? 10_000,
    hookStates: opts.hookStates
  })
}

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
  test('Claude 행은 워크트리의 훅 상태가 있으면 그것이 우선이고, CPU 값은 그대로 보인다', () => {
    const first = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], {
      now: 10_000,
      worktrees: [[5000, W1]]
    })
    const second = run([proc(5000, 1, 'claude.exe', { cpuMs: 1000 })], {
      now: 15_000,
      previousCpu: first.cpu,
      worktrees: [[5000, W1]],
      hookStates: (root) => (root === W1.root ? 'waiting' : null)
    })
    expect(second.agents[0]).toMatchObject({
      state: 'waiting',
      stateSource: 'hook',
      cpuPercent: 0
    })
  })

  test('훅 상태가 없거나 워크트리를 모르면 CPU 판단', () => {
    const hookStates = vi.fn((): AgentState | null => null)
    const { agents } = run([proc(5000, 1, 'claude.exe'), proc(5001, 1, 'claude.exe')], {
      worktrees: [[5000, W1]],
      hookStates
    })
    expect(agents.map((a) => a.stateSource)).toEqual(['cpu', 'cpu'])
    expect(hookStates).toHaveBeenCalledTimes(1)
  })

  test('Codex 행에는 Claude 훅 상태를 쓰지 않는다', () => {
    const { agents } = run([proc(8200, 1, 'node.exe', { commandLine: CODEX_JS })], {
      worktrees: [[8200, W1]],
      hookStates: () => 'waiting'
    })
    expect(agents[0]).toMatchObject({ tool: 'codex', state: 'unknown', stateSource: 'cpu' })
  })
})
