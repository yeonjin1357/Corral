import { collectOptionsFrom, createCollector, type CollectorDeps } from './collector'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { Sessions } from './sessions'
import { applyHookEvent } from './sessions'
import type { ClaudeHookStatus, ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'

const MB = 1024 * 1024
const MIN = 60 * 1000
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }
const W2: WorktreeInfo = { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true }
const HOOK: ClaudeHookStatus = {
  state: 'on',
  problem: null,
  allHooksDisabled: false,
  settingsPath: 'C:\\Users\\a\\.claude\\settings.json'
}

function proc(
  pid: number,
  ppid: number,
  name: string,
  cpuMs: number,
  commandLine = name
): ProcessInfo {
  return { pid, ppid, name, commandLine, memoryBytes: 10 * MB, startedAt: 100, cpuMs }
}

/** 개발 서버(3000, shop-web) + Claude(shop-web) + Codex(wt-a). */
function sampleAt(cpu: number): RawSample {
  return {
    processes: [
      proc(4100, 1, 'node.exe', 0, 'node vite'),
      proc(5000, 1, 'claude.exe', cpu),
      proc(6000, 1, 'codex.exe', 0)
    ],
    tcp: [
      {
        pid: 4100,
        localAddress: '0.0.0.0',
        localPort: 3000,
        remoteAddress: '0.0.0.0',
        remotePort: 0,
        state: 'Listen'
      }
    ],
    cwds: { 5000: W1.root, 6000: W2.root },
    collectMode: 'helper-dll'
  }
}

function setup(over: Partial<CollectorDeps> = {}): {
  deps: CollectorDeps
  sessions: Sessions
  clock: { now: number }
  samples: RawSample[]
} {
  const clock = { now: 10 * MIN }
  const sessions: Sessions = new Map()
  const samples: RawSample[] = []
  const deps: CollectorDeps = {
    platform: 'win32',
    sample: async () => samples.shift() ?? sampleAt(0),
    readMemory: async () => ({ totalBytes: 32 * 1024 * MB, freeBytes: 16 * 1024 * MB }),
    resolveProcessWorktrees: async (processes) => {
      const map = new Map<number, WorktreeInfo>()
      for (const p of processes) {
        if (p.pid === 4100 || p.pid === 5000) map.set(p.pid, W1)
        if (p.pid === 6000) map.set(p.pid, W2)
      }
      return map
    },
    resolveWorktree: async (path) => (path.startsWith(W1.root) ? W1 : null),
    sessions,
    hookStatus: async () => HOOK,
    options: () => ({
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      idlePortMs: 20 * MIN
    }),
    selfPid: 999,
    now: () => clock.now,
    ...over
  }
  return { deps, sessions, clock, samples }
}

test('한 번 수집하면 스냅샷에 에이전트·포트·남은 프로세스·훅 상태가 들어 있다', async () => {
  const { deps } = setup()
  const s = await createCollector(deps).collect()
  expect(s.agents.map((a) => [a.pid, a.tool, a.worktree?.root, a.state])).toEqual([
    [5000, 'claude', W1.root, 'unknown'],
    [6000, 'codex', W2.root, 'unknown']
  ])
  expect(s.ports.map((p) => [p.port, p.agentInWorktree, p.judgement])).toEqual([[3000, true, null]])
  expect(s.leftovers).toEqual([])
  expect(s.hook).toEqual(HOOK)
  expect(s.collectMode).toBe('helper-dll')
})

test('이전 샘플의 CPU 를 기억해 두 번째 수집부터 작업 중/쉬는 중을 판단한다', async () => {
  const { deps, clock, samples } = setup()
  const collector = createCollector(deps)
  samples.push(sampleAt(1000), sampleAt(2000))
  await collector.collect()
  clock.now += 5000
  const second = await collector.collect()
  expect(second.agents[0]).toMatchObject({ pid: 5000, state: 'working', cpuPercent: 20 })
})

test('에이전트 작업 폴더는 명령줄보다 먼저 보도록 넘긴다', async () => {
  const resolveProcessWorktrees = vi.fn<CollectorDeps['resolveProcessWorktrees']>(
    async () => new Map()
  )
  const { deps } = setup({ resolveProcessWorktrees })
  await createCollector(deps).collect()
  const [processes, cwds, cwdFirst] = resolveProcessWorktrees.mock.calls[0]
  expect(processes.map((p) => p.pid).sort()).toEqual([4100, 5000, 6000])
  expect(cwds).toEqual({ 5000: W1.root, 6000: W2.root })
  expect([...cwdFirst].sort()).toEqual([5000, 6000])
})

test('에이전트가 없는 워크트리의 포트는 시간을 기억해 정리 후보가 된다', async () => {
  const { deps, clock } = setup()
  const noAgents: RawSample = {
    ...sampleAt(0),
    processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
  }
  const collector = createCollector({ ...deps, sample: async () => noAgents })
  await collector.collect()
  clock.now += 20 * MIN
  const later = await collector.collect()
  expect(later.ports[0]).toMatchObject({ judgement: 'candidate', idleSince: 10 * MIN })
})

test('Claude 훅 세션의 상태가 그 워크트리의 Claude 행에 쓰인다(하위 폴더에서 연 세션 포함)', async () => {
  const { deps, sessions, clock } = setup()
  applyHookEvent(
    sessions,
    { session_id: 's1', cwd: W1.root + '\\packages\\web', hook_event_name: 'PermissionRequest' },
    clock.now
  )
  const s = await createCollector(deps).collect()
  expect(s.agents[0]).toMatchObject({ pid: 5000, state: 'waiting', stateSource: 'hook' })
  expect(s.agents[1].stateSource).toBe('cpu')
})

test('샘플 전에 온 세션인데 그 워크트리에 Claude 가 없으면 버린다', async () => {
  const { deps, sessions, clock } = setup()
  applyHookEvent(
    sessions,
    { session_id: 'gone', cwd: 'C:\\work\\shop-web', hook_event_name: 'UserPromptSubmit' },
    clock.now - 1
  )
  const noClaude: RawSample = {
    ...sampleAt(0),
    processes: sampleAt(0).processes.filter((p) => p.pid !== 5000)
  }
  await createCollector({ ...deps, sample: async () => noClaude }).collect()
  expect(sessions.size).toBe(0)
})

test('restate: 다시 샘플링하지 않고 훅 상태만 새로 반영한다', async () => {
  const { deps, sessions, clock } = setup()
  const collector = createCollector(deps)
  const first = await collector.collect()
  applyHookEvent(
    sessions,
    { session_id: 's1', cwd: W1.root, hook_event_name: 'PermissionRequest' },
    clock.now
  )
  const next = await collector.restate(first)
  expect(next.agents[0]).toMatchObject({ state: 'waiting', stateSource: 'hook' })
  expect(next.ports).toBe(first.ports)
  // 훅 세션이 끝나면 CPU 판단으로 돌아간다.
  applyHookEvent(sessions, { session_id: 's1', hook_event_name: 'SessionEnd' }, clock.now)
  expect((await collector.restate(next)).agents[0]).toMatchObject({
    state: 'unknown',
    stateSource: 'cpu'
  })
})

test('훅 상태를 읽다 실패해도 수집은 성공하고 훅은 error', async () => {
  const { deps } = setup({
    hookStatus: async () => {
      throw new Error('boom')
    }
  })
  const s = await createCollector(deps).collect()
  expect(s.hook).toMatchObject({ state: 'error', problem: 'settings' })
})

test('같은 워크트리에 다른 Claude 가 살아 있어도, 짝지은 프로세스가 꺼진 세션은 그 수집부터 상태에 쓰지 않는다', async () => {
  const { deps, sessions, clock } = setup()
  const withTwo: RawSample = {
    ...sampleAt(0),
    processes: [...sampleAt(0).processes, { ...proc(5001, 1, 'claude.exe', 0), startedAt: 200 }],
    cwds: { 5000: W1.root, 5001: W1.root, 6000: W2.root }
  }
  const twoWorktrees: CollectorDeps['resolveProcessWorktrees'] = async (processes) => {
    const map = new Map<number, WorktreeInfo>()
    for (const p of processes) {
      if (p.pid === 4100 || p.pid === 5000 || p.pid === 5001) map.set(p.pid, W1)
      if (p.pid === 6000) map.set(p.pid, W2)
    }
    return map
  }
  const samples = [withTwo, withTwo, sampleAt(0)]
  const collector = createCollector({
    ...deps,
    sample: async () => samples.shift()!,
    resolveProcessWorktrees: twoWorktrees
  })
  applyHookEvent(
    sessions,
    { session_id: 'stuck', cwd: W1.root, hook_event_name: 'PermissionRequest' },
    clock.now - 2
  )
  applyHookEvent(
    sessions,
    { session_id: 'calm', cwd: W1.root, hook_event_name: 'Stop' },
    clock.now - 1
  )
  await collector.collect()
  clock.now += 5000
  await collector.collect()
  expect(sessions.size).toBe(2)
  // 권한 대기 세션(stuck)은 더 늦게 시작한 5001 과, calm 은 5000 과 짝지어진다. 5001 의 창을 닫는다.
  expect(sessions.get('stuck')?.processKey).toBe('5001:200')
  clock.now += 5000
  const s = await collector.collect()
  expect([...sessions.keys()]).toEqual(['calm'])
  expect(s.agents.find((a) => a.pid === 5000)).toMatchObject({ state: 'idle', stateSource: 'hook' })
})

test('네트워크 경로(UNC·WSL)에서 연 세션은 워크트리를 찾아보지 않는다(응답 없는 공유에 수집이 묶이지 않게)', async () => {
  const resolveWorktree = vi.fn<CollectorDeps['resolveWorktree']>(async () => W1)
  const { deps, sessions, clock } = setup({ resolveWorktree })
  for (const cwd of [
    '\\\\nas\\share\\repo',
    '\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo',
    '//nas/share/repo'
  ])
    applyHookEvent(
      sessions,
      { session_id: cwd, cwd, hook_event_name: 'PermissionRequest' },
      clock.now
    )
  const s = await createCollector(deps).collect()
  expect(resolveWorktree).not.toHaveBeenCalled()
  expect(s.agents[0].stateSource).toBe('cpu')
})

test('설정(기준값)을 바꾸면 다음 수집부터 반영된다', async () => {
  const options = {
    thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
    idlePortMs: 20 * MIN
  }
  const { deps, clock } = setup({ options: () => options })
  const noAgents: RawSample = {
    ...sampleAt(0),
    processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
  }
  const collector = createCollector({ ...deps, sample: async () => noAgents })
  const first = await collector.collect()
  // 32GB 중 16GB 사용 = 50%
  expect(first.memory.level).toBe('normal')
  clock.now += 5 * MIN
  options.thresholds = { ramWarnPercent: 50, ramDangerPercent: 60 }
  options.idlePortMs = 5 * MIN
  const second = await collector.collect()
  expect(second.memory.level).toBe('warn')
  expect(second.ports[0].judgement).toBe('candidate')
})

test('설정에서 수집 기준값을 만든다(분 → ms)', () => {
  expect(
    collectOptionsFrom({
      ...DEFAULT_SETTINGS,
      ramWarnPercent: 70,
      ramDangerPercent: 85,
      idlePortMinutes: 45
    })
  ).toEqual({ thresholds: { ramWarnPercent: 70, ramDangerPercent: 85 }, idlePortMs: 45 * MIN })
})
