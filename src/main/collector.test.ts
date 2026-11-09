import { collectOptionsFrom, createCollector, type CollectorDeps } from './collector'
import { cleanupRecommendation } from '../shared/recommend'
import { buildTrayMenu } from './tray'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { Sessions } from './sessions'
import { applyHookEvent } from './sessions'
import type {
  ClaudeHookStatus,
  ProcessInfo,
  RawSample,
  WorkspaceInfo,
  WorktreeInfo
} from '../shared/types'

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
    resolveWorkspace: async (w) => ({ root: w.root, name: 'self', branch: w.branch, outer: false }),
    sessions,
    hookStatus: async () => HOOK,
    options: () => ({
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      idlePortMs: 20 * MIN,
      heavyPatterns: ['tsc']
    }),
    selfPid: 999,
    cpuCount: 8,
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
  expect(s.servers.map((r) => [r.ports, r.agentInWorktree, r.judgement])).toEqual([
    [[3000], true, null]
  ])
  expect(s.leftovers).toEqual([])
  expect(s.hook).toEqual(HOOK)
  expect(s.collectMode).toBe('helper-dll')
  expect(s).toMatchObject({ platform: 'win32', cpuCount: 8 })
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
  expect(later.servers[0]).toMatchObject({ judgement: 'candidate', idleSince: 10 * MIN })
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
  expect(next.servers).toBe(first.servers)
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
    idlePortMs: 20 * MIN,
    heavyPatterns: []
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
  expect(second.servers[0].judgement).toBe('candidate')
})

test('설정에서 수집 기준값을 만든다(분 → ms)', () => {
  expect(
    collectOptionsFrom({
      ...DEFAULT_SETTINGS,
      ramWarnPercent: 70,
      ramDangerPercent: 85,
      idlePortMinutes: 45
    })
  ).toEqual({
    thresholds: { ramWarnPercent: 70, ramDangerPercent: 85 },
    idlePortMs: 45 * MIN,
    heavyPatterns: DEFAULT_SETTINGS.heavyPatterns,
    hiddenServers: [],
    workspaceAliases: {}
  })
})

test('무거운 명령 패턴을 넘겨 무거운 작업을 찾고, 그 워크트리도 찾아본다', async () => {
  const resolveProcessWorktrees = vi.fn<CollectorDeps['resolveProcessWorktrees']>(
    async () => new Map()
  )
  const { deps } = setup({ resolveProcessWorktrees })
  const withTsc: RawSample = {
    ...sampleAt(0),
    processes: [...sampleAt(0).processes, proc(7000, 1, 'node.exe', 0, 'node tsc --noEmit')]
  }
  const s = await createCollector({ ...deps, sample: async () => withTsc }).collect()
  expect(s.heavyJobs.map((j) => [j.pid, j.label])).toEqual([[7000, 'tsc']])
  expect(resolveProcessWorktrees.mock.calls[0][0].map((p) => p.pid)).toContain(7000)
})

test('서버·남은 프로세스·무거운 작업·에이전트에 작업 공간을 붙인다', async () => {
  const WS: WorkspaceInfo = { root: 'C:\\work', name: 'work', branch: 'main', outer: true }
  const resolveWorkspace = vi.fn<CollectorDeps['resolveWorkspace']>(async (w) =>
    w.root === W1.root ? WS : { root: w.root, name: 'wt-a', branch: w.branch, outer: false }
  )
  const { deps, clock } = setup({
    resolveWorkspace,
    resolveProcessWorktrees: async (processes) => {
      const map = new Map<number, WorktreeInfo>()
      for (const p of processes) {
        if ([4100, 5000, 7000, 7100].includes(p.pid)) map.set(p.pid, W1)
        if (p.pid === 6000) map.set(p.pid, W2)
      }
      return map
    }
  })
  clock.now = 60 * MIN
  const sample: RawSample = {
    ...sampleAt(0),
    processes: [
      ...sampleAt(0).processes,
      proc(7000, 1, 'node.exe', 0, 'node tsc --noEmit'),
      proc(7100, 1, 'java.exe', 0, 'java org.gradle.launcher.daemon.bootstrap.GradleDaemon')
    ]
  }
  const s = await createCollector({ ...deps, sample: async () => sample }).collect()
  expect(s.servers.map((r) => r.workspace)).toEqual([WS])
  expect(s.heavyJobs.map((r) => r.workspace)).toEqual([WS])
  expect(s.leftovers.map((r) => r.workspace)).toEqual([WS])
  expect(s.agents.map((a) => [a.pid, a.workspace?.root])).toEqual([
    [5000, 'C:\\work'],
    [6000, W2.root]
  ])
  // 같은 워크트리는 한 번만 판별한다.
  expect(resolveWorkspace).toHaveBeenCalledTimes(2)
})

test('작업 공간 판별이 실패하면 그 워크트리 자체를 작업 공간으로 본다', async () => {
  const { deps } = setup({
    resolveWorkspace: async () => {
      throw new Error('EACCES')
    }
  })
  const s = await createCollector(deps).collect()
  expect(s.servers[0].workspace).toEqual({
    root: W1.root,
    name: 'shop-web',
    branch: 'develop',
    outer: false
  })
})

test('서버 CPU 는 서버 트리의 누적 CPU 변화로 잰다', async () => {
  const { deps, clock, samples } = setup()
  const withServerCpu = (serverCpu: number): RawSample => {
    const s = sampleAt(0)
    return {
      ...s,
      processes: s.processes.map((p) => (p.pid === 4100 ? { ...p, cpuMs: serverCpu } : p))
    }
  }
  samples.push(withServerCpu(1000), withServerCpu(3000))
  const collector = createCollector(deps)
  const first = await collector.collect()
  expect(first.servers[0].cpuPercent).toBeNull()
  clock.now += 10_000
  const second = await collector.collect()
  expect(second.servers[0].cpuPercent).toBe(20)
})

test('에이전트 상태 시작 시각: CPU 추정은 처음 본 시각부터 이어진다', async () => {
  const { deps, clock, samples } = setup()
  const collector = createCollector(deps)
  samples.push(sampleAt(1000), sampleAt(2000), sampleAt(3000))
  await collector.collect()
  clock.now += 5000
  const second = await collector.collect()
  const since = second.agents.find((a) => a.pid === 5000)!.stateSince
  expect(since).toBe(clock.now)
  clock.now += 5000
  const third = await collector.collect()
  expect(third.agents.find((a) => a.pid === 5000)!.stateSince).toBe(since)
})

test('메모리가 계속 느는 서버에 근거를 붙인다(1분마다 기록, 30분 이상)', async () => {
  const { deps, clock, samples } = setup()
  const GB = 1024 * MB
  for (let i = 0; i <= 30; i++) {
    const s = sampleAt(0)
    samples.push({
      ...s,
      processes: s.processes.map((p) =>
        p.pid === 4100 ? { ...p, memoryBytes: 2 * GB + Math.round((1.6 * GB * i) / 30) } : p
      )
    })
  }
  const collector = createCollector(deps)
  let last = await collector.collect()
  expect(last.servers[0].memoryGrowth).toBeNull()
  for (let i = 1; i <= 30; i++) {
    clock.now += 60_000
    last = await collector.collect()
  }
  expect(last.servers[0].memoryGrowth).toMatchObject({ fromBytes: 2 * GB, minutes: 30 })
})

test('내보낸 정리 판단 기억·서버 메모리 기록·에이전트 상태 시각을 새 수집기가 이어 쓴다(다시 켜기)', async () => {
  const { deps, clock } = setup()
  const noAgents: RawSample = {
    ...sampleAt(0),
    processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
  }
  const before = createCollector({ ...deps, sample: async () => noAgents })
  await before.collect()
  const state = before.exportState()
  expect(state.serverMemo).toEqual({ 'server:4100:100': { state: 'idle', since: 10 * MIN } })
  expect(Object.keys(state.servers)).toEqual(['server:4100:100'])

  clock.now += 20 * MIN
  const after = createCollector({ ...deps, sample: async () => noAgents })
  after.importState(
    { ...state, agentStates: { '5000:100': { state: 'working', since: 9 * MIN } } },
    clock.now
  )
  const later = await after.collect()
  expect(later.servers[0]).toMatchObject({ judgement: 'candidate', idleSince: 10 * MIN })
  expect(after.exportState().servers['server:4100:100']).toHaveLength(2)
})

test('판단 기억 없이(null) 불러오면 처음부터 센다', async () => {
  const { deps, clock } = setup()
  const noAgents: RawSample = {
    ...sampleAt(0),
    processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
  }
  const c = createCollector({ ...deps, sample: async () => noAgents })
  c.importState({ servers: {}, serverMemo: null, agentStates: null }, clock.now)
  const s = await c.collect()
  expect(s.servers[0]).toMatchObject({ judgement: null, idleSince: 10 * MIN })
})

describe('숨기기·별칭(F11)', () => {
  const idle: RawSample = {
    ...sampleAt(0),
    processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
  }
  const options =
    (hiddenServers: string[], workspaceAliases: Record<string, string> = {}) =>
    () => ({
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      idlePortMs: 20 * MIN,
      heavyPatterns: [],
      hiddenServers,
      workspaceAliases
    })

  test('숨긴 서버는 목록·추천·트레이에서 빠지고 숨김 목록에 있다', async () => {
    for (const hidden of [[':3000'], ['NODE.EXE']]) {
      const { deps, clock } = setup({ options: options(hidden), sample: async () => idle })
      const collector = createCollector(deps)
      await collector.collect()
      clock.now += 30 * MIN
      const s = await collector.collect()
      expect(s.servers).toEqual([])
      expect(s.hiddenServers.map((r) => r.ports)).toEqual([[3000]])
      // 숨긴 서버는 판단하지 않는다(추천·알림·트레이 개수에 들어가지 않음).
      expect(s.hiddenServers[0].judgement).toBeNull()
      expect(cleanupRecommendation(s).items).toEqual([])
      expect(
        buildTrayMenu(s, { open: vi.fn(), settings: vi.fn(), quit: vi.fn() }).map((i) => i.label)
      ).toContain('개발 서버 0개')
    }
  })

  test('별칭이 있으면 작업 공간 이름(경로는 대소문자·끝 구분자 무시)', async () => {
    const { deps } = setup({
      options: options([], { 'c:\\WORK\\shop-web\\': '쇼핑' }),
      sample: async () => idle
    })
    const s = await createCollector(deps).collect()
    expect(s.servers[0].workspace).toMatchObject({ root: W1.root, name: '쇼핑' })
  })
})
