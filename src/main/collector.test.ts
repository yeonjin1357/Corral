import { collectOptionsFrom, createCollector, type CollectorDeps } from './collector'
import { cleanupRecommendation } from '../shared/recommend'
import { buildTrayMenu } from './tray'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { Sessions } from './sessions'
import { applyHookEvent } from './sessions'
import type { ClaudeSessionFile } from './claudeSessionFiles'
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
      agentParkedMs: 180 * MIN,
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
  const both = await collector.collect()
  expect(sessions.size).toBe(2)
  // 권한 대기 세션(stuck)은 더 늦게 시작한 5001 과, calm 은 5000 과 짝지어진다.
  expect(sessions.get('stuck')?.processKey).toBe('5001:200')
  // 같은 폴더의 두 Claude 는 각자 자기 세션의 상태를 보인다(G3a).
  expect(
    both.agents.filter((a) => a.tool === 'claude').map((a) => [a.pid, a.state, a.stateSource])
  ).toEqual([
    [5000, 'idle', 'hook'],
    [5001, 'waiting', 'hook']
  ])
  // 5001 의 창을 닫는다.
  clock.now += 5000
  const s = await collector.collect()
  expect([...sessions.keys()]).toEqual(['calm'])
  expect(s.agents.find((a) => a.pid === 5000)).toMatchObject({ state: 'idle', stateSource: 'hook' })
})

describe('마지막 활동·오래 쉬는 세션(G2)', () => {
  const hookEvent = (
    sessions: Sessions,
    name: string,
    at: number,
    extra: Record<string, unknown> = {}
  ): void => {
    applyHookEvent(
      sessions,
      { session_id: 's1', cwd: W1.root, hook_event_name: name, ...extra },
      at
    )
  }

  test('훅으로 아는 에이전트의 lastActiveAt 은 그 세션의 마지막 활동 시각', async () => {
    const { deps, sessions, clock } = setup()
    clock.now = 60 * MIN
    hookEvent(sessions, 'UserPromptSubmit', 30 * MIN)
    hookEvent(sessions, 'Stop', 40 * MIN)
    // 응답이 끝나고 오는 idle 알림은 활동이 아니다.
    hookEvent(sessions, 'Notification', 41 * MIN, { notification_type: 'idle_prompt' })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 5000)).toMatchObject({
      state: 'idle',
      stateSource: 'hook',
      stateSince: 40 * MIN,
      lastActiveAt: 40 * MIN,
      parked: false
    })
    // CPU 를 아직 읽지 못한(확인 중) CPU 추정은 근거가 없어 모른다.
    expect(s.agents.find((a) => a.pid === 6000)).toMatchObject({
      state: 'unknown',
      stateSource: 'cpu',
      lastActiveAt: null,
      parked: false
    })
  })

  test('Codex 세션 기록으로 아는 에이전트의 lastActiveAt 은 기록의 마지막 이벤트 시각', async () => {
    const { deps } = setup({
      codexState: async () => ({ state: 'idle', since: 2 * MIN, lastEventAt: 3 * MIN })
    })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)).toMatchObject({
      stateSource: 'rollout',
      stateSince: 2 * MIN,
      lastActiveAt: 3 * MIN
    })
  })

  test('agentParkedMs 를 넘긴 쉬는 에이전트는 parked', async () => {
    const { deps, sessions, clock } = setup({
      options: () => ({
        thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
        idlePortMs: 20 * MIN,
        agentParkedMs: 30 * MIN,
        heavyPatterns: []
      })
    })
    const stoppedAt = clock.now - 1
    hookEvent(sessions, 'Stop', stoppedAt)
    const collector = createCollector(deps)
    await collector.collect()
    clock.now = stoppedAt + 30 * MIN - 1
    expect((await collector.collect()).agents[0]).toMatchObject({
      pid: 5000,
      state: 'idle',
      parked: false
    })
    clock.now = stoppedAt + 30 * MIN
    const parked = await collector.collect()
    expect(parked.agents[0]).toMatchObject({
      pid: 5000,
      state: 'idle',
      lastActiveAt: stoppedAt,
      parked: true
    })
    // 새 입력이 오면(훅 이벤트 → restate) 바로 오래 쉬는 세션이 아니다.
    hookEvent(sessions, 'UserPromptSubmit', clock.now)
    const next = await collector.restate(parked)
    expect(next.agents[0]).toMatchObject({
      pid: 5000,
      state: 'working',
      lastActiveAt: clock.now,
      parked: false
    })
  })

  test('처음 본 시각·마지막 작업 시각을 내보내고, 다시 켜면 이어 쓴다(지금보다 뒤의 시각은 버림)', async () => {
    const { deps, clock } = setup()
    const before = createCollector(deps)
    await before.collect()
    expect(before.exportState().agentSeen).toEqual({
      '5000:100': { firstSeen: 10 * MIN, lastWorking: null },
      '6000:100': { firstSeen: 10 * MIN, lastWorking: null }
    })
    clock.now += 5 * MIN
    const after = createCollector(deps)
    after.importState(
      {
        ...before.exportState(),
        agentSeen: {
          '5000:100': { firstSeen: 2 * MIN, lastWorking: 3 * MIN },
          '6000:100': { firstSeen: clock.now + MIN, lastWorking: null }
        }
      },
      clock.now
    )
    const s = await after.collect()
    // 첫 수집은 아직 CPU 를 읽지 못해(확인 중) 마지막 활동을 모른다.
    expect(s.agents.map((a) => [a.pid, a.state, a.lastActiveAt])).toEqual([
      [5000, 'unknown', null],
      [6000, 'unknown', null]
    ])
    // CPU 를 읽으면 CPU 추정은 이어 쓴 마지막 작업 시각, 본 적 없으면 처음 본 시각(그 전은 모른다).
    const seenAt = clock.now
    clock.now += 5000
    const next = await after.collect()
    expect(next.agents.map((a) => [a.pid, a.state, a.lastActiveAt])).toEqual([
      [5000, 'idle', 3 * MIN],
      [6000, 'idle', seenAt]
    ])
  })
})

describe('Claude 세션 파일(G3a)', () => {
  const HOUR = 60 * MIN
  const fileOf = (over: Partial<ClaudeSessionFile> = {}): ClaudeSessionFile => ({
    pid: 5000,
    sessionId: 'f1',
    status: 'idle',
    statusUpdatedAt: null,
    name: null,
    ...over
  })
  /** 수집기에 넘길 세션 파일 읽기. current.file 을 바꾸면 다음 수집부터 반영된다. */
  const filesFrom = (current: {
    file: ClaudeSessionFile | null
  }): NonNullable<CollectorDeps['claudeSessionFiles']> =>
    vi.fn<NonNullable<CollectorDeps['claudeSessionFiles']>>(async () =>
      current.file ? new Map([[current.file.pid, current.file]]) : new Map()
    )
  /** 파일과 같은 세션(f1)의 훅 이벤트. */
  const hookEvent = (
    sessions: Sessions,
    name: string,
    at: number,
    extra: Record<string, unknown> = {}
  ): void => {
    applyHookEvent(
      sessions,
      { session_id: 'f1', cwd: W1.root, hook_event_name: name, ...extra },
      at
    )
  }

  test('훅이 없어도 세션 파일로 작업 중·쉬는 중과 그 시작 시각을 안다', async () => {
    const current = { file: fileOf({ status: 'busy', statusUpdatedAt: 7 * MIN }) }
    const claudeSessionFiles = filesFrom(current)
    const { deps, clock } = setup({ claudeSessionFiles })
    const collector = createCollector(deps)
    const s = await collector.collect()
    // Claude 에이전트의 파일만 읽는다(Codex 는 세션 파일이 없다).
    expect(claudeSessionFiles).toHaveBeenCalledWith([{ pid: 5000, startedAt: 100 }], 10 * MIN)
    expect(s.agents.find((a) => a.pid === 5000)).toMatchObject({
      state: 'working',
      stateSource: 'file',
      stateSince: 7 * MIN,
      // 작업 중이면 마지막 활동은 수집 시각.
      lastActiveAt: 10 * MIN,
      parked: false
    })
    expect(s.agents.find((a) => a.pid === 6000)?.stateSource).toBe('cpu')

    current.file = fileOf({ status: 'idle', statusUpdatedAt: 11 * MIN })
    clock.now = 12 * MIN
    const idle = await collector.collect()
    expect(idle.agents[0]).toMatchObject({
      pid: 5000,
      state: 'idle',
      stateSource: 'file',
      stateSince: 11 * MIN,
      lastActiveAt: 11 * MIN
    })
    // 훅 이벤트가 와도(다른 폴더의 세션) 훅 상태가 생기지 않은 파일 행은 그대로다.
    clock.now = 13 * MIN
    applyHookEvent(
      deps.sessions,
      { session_id: 'elsewhere', cwd: 'C:\\tmp', hook_event_name: 'UserPromptSubmit' },
      clock.now
    )
    expect((await collector.restate(idle)).agents[0]).toMatchObject({
      state: 'idle',
      stateSource: 'file',
      stateSince: 11 * MIN,
      lastActiveAt: 11 * MIN
    })
    // 상태 시각이 없으면 지금처럼 pitwall 이 그 상태를 처음 본 시각.
    current.file = fileOf({ status: 'busy', statusUpdatedAt: null })
    clock.now = 14 * MIN
    expect((await collector.collect()).agents[0]).toMatchObject({
      state: 'working',
      stateSource: 'file',
      stateSince: 14 * MIN,
      lastActiveAt: 14 * MIN
    })
  })

  test('훅과 파일이 둘 다 있으면 더 늦은 근거를 따른다: 훅은 쉬는 중(5시간 전)인데 파일이 방금 busy 면 작업 중', async () => {
    const current = { file: null as ClaudeSessionFile | null }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    clock.now = 10 * HOUR
    hookEvent(sessions, 'Stop', clock.now - 5 * HOUR)
    current.file = fileOf({ status: 'busy', statusUpdatedAt: clock.now - 1000 })
    const collector = createCollector(deps)
    const s = await collector.collect()
    expect(s.agents[0]).toMatchObject({
      pid: 5000,
      state: 'working',
      stateSource: 'file',
      stateSince: clock.now - 1000,
      lastActiveAt: clock.now,
      parked: false
    })
    // 그 뒤 훅 소식이 오면 훅이 더 늦은 근거다(수집 사이에도 마지막으로 읽은 파일과 견준다).
    clock.now += 10_000
    hookEvent(sessions, 'UserPromptSubmit', clock.now)
    const working = await collector.restate(s)
    expect(working.agents[0]).toMatchObject({
      state: 'working',
      stateSource: 'hook',
      stateSince: clock.now
    })
    clock.now += 10_000
    hookEvent(sessions, 'Stop', clock.now)
    expect((await collector.restate(working)).agents[0]).toMatchObject({
      state: 'idle',
      stateSource: 'hook',
      stateSince: clock.now,
      lastActiveAt: clock.now
    })
  })

  test('권한 요청이 파일의 busy 시각보다 늦으면 권한 대기(훅)', async () => {
    const current = { file: null as ClaudeSessionFile | null }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    clock.now = 60 * MIN
    hookEvent(sessions, 'UserPromptSubmit', clock.now - 2 * MIN)
    hookEvent(sessions, 'PermissionRequest', clock.now - 30_000, { tool_name: 'Bash' })
    current.file = fileOf({ status: 'busy', statusUpdatedAt: clock.now - 2 * MIN })
    const s = await createCollector(deps).collect()
    expect(s.agents[0]).toMatchObject({
      pid: 5000,
      state: 'waiting',
      stateSource: 'hook',
      stateSince: clock.now - 30_000
    })
  })

  test('훅이 권한 대기면 파일이 더 늦게 idle 이어도 권한 대기로 둔다, 더 늦은 busy 는 따른다', async () => {
    const current = { file: null as ClaudeSessionFile | null }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    clock.now = 60 * MIN
    hookEvent(sessions, 'UserPromptSubmit', clock.now - 10 * MIN)
    hookEvent(sessions, 'PermissionRequest', clock.now - 5 * MIN, { tool_name: 'Bash' })
    // 권한 창이 떠 있는 동안 파일에 무엇이 쓰이는지 모른다: 훨씬 늦은 idle 이어도 권한 대기(끝은 Stop 으로 온다).
    current.file = fileOf({ status: 'idle', statusUpdatedAt: clock.now - MIN })
    const collector = createCollector(deps)
    expect((await collector.collect()).agents[0]).toMatchObject({
      pid: 5000,
      state: 'waiting',
      stateSource: 'hook',
      stateSince: clock.now - 5 * MIN
    })
    // 더 늦은 busy 는 새 턴이 시작된 것이다.
    current.file = fileOf({ status: 'busy', statusUpdatedAt: clock.now - 30_000 })
    clock.now += 5000
    expect((await collector.collect()).agents[0]).toMatchObject({
      state: 'working',
      stateSource: 'file',
      stateSince: clock.now - 5000 - 30_000
    })
  })

  test('세션 파일이 있는 에이전트는 그 파일의 세션에서만 훅 상태를 얻는다(같은 워크트리의 짝 없는 세션을 빌리지 않는다)', async () => {
    const current = {
      file: fileOf({
        sessionId: 'f1',
        status: 'idle',
        statusUpdatedAt: 2 * MIN
      }) as ClaudeSessionFile | null
    }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    // 같은 워크트리의 다른 세션(어느 프로세스 것인지 모름)이 권한 대기다. 파일의 세션(f1)은 훅이 모른다.
    applyHookEvent(
      sessions,
      { session_id: 'other', cwd: W1.root, hook_event_name: 'PermissionRequest' },
      clock.now - 1
    )
    const collector = createCollector(deps)
    const s = await collector.collect()
    expect(s.agents[0]).toMatchObject({
      pid: 5000,
      state: 'idle',
      stateSource: 'file',
      stateSince: 2 * MIN
    })
    // 파일이 있는 프로세스는 추측 짝의 후보가 아니다.
    expect(sessions.get('other')?.processKey).toBeNull()

    // 수집 사이에 짝 없는 새 세션이 와도 빌리지 않는다.
    clock.now += 10_000
    applyHookEvent(
      sessions,
      { session_id: 'new', cwd: W1.root, hook_event_name: 'UserPromptSubmit' },
      clock.now
    )
    const restated = await collector.restate(s)
    expect(restated.agents[0]).toMatchObject({ state: 'idle', stateSource: 'file' })
    // 파일의 세션 소식이 오면 그것은 이 프로세스의 훅 상태다.
    clock.now += 10_000
    hookEvent(sessions, 'UserPromptSubmit', clock.now)
    expect((await collector.restate(restated)).agents[0]).toMatchObject({
      state: 'working',
      stateSource: 'hook',
      stateSince: clock.now
    })
    // 다음 수집에서 파일의 세션과 정확히 짝짓는다.
    clock.now += 10_000
    await collector.collect()
    expect(sessions.get('f1')?.processKey).toBe('5000:100')
  })

  test('훅과 파일의 시각이 5초 안이면 훅', async () => {
    const current = { file: null as ClaudeSessionFile | null }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    clock.now = 60 * MIN
    const stoppedAt = clock.now - 10 * MIN
    hookEvent(sessions, 'Stop', stoppedAt)
    current.file = fileOf({ status: 'busy', statusUpdatedAt: stoppedAt + 5000 })
    const collector = createCollector(deps)
    expect((await collector.collect()).agents[0]).toMatchObject({
      state: 'idle',
      stateSource: 'hook',
      stateSince: stoppedAt
    })
    // 5초를 넘으면 파일.
    current.file = fileOf({ status: 'busy', statusUpdatedAt: stoppedAt + 5001 })
    clock.now += 5000
    expect((await collector.collect()).agents[0]).toMatchObject({
      state: 'working',
      stateSource: 'file',
      stateSince: stoppedAt + 5001
    })
  })

  test('CPU 를 읽지 못해 확인 중인 에이전트는 lastActiveAt 이 null 이고 오래 쉬는 세션이 아니다', async () => {
    const noCpu: RawSample = {
      ...sampleAt(0),
      processes: sampleAt(0).processes.map((p) => ({ ...p, cpuMs: null }))
    }
    const { deps, clock } = setup({ sample: async () => noCpu })
    const collector = createCollector(deps)
    await collector.collect()
    clock.now += 200 * MIN
    const s = await collector.collect()
    expect(s.agents.map((a) => [a.pid, a.state, a.stateSource, a.lastActiveAt, a.parked])).toEqual([
      [5000, 'unknown', 'cpu', null, false],
      [6000, 'unknown', 'cpu', null, false]
    ])
  })

  test('막 켠 pitwall 도 세션 파일의 시각으로 오래 쉬는 세션을 안다', async () => {
    const { deps, clock } = setup({
      claudeSessionFiles: filesFrom({ file: fileOf({ status: 'idle', statusUpdatedAt: 5 * HOUR }) })
    })
    clock.now = 10 * HOUR
    const s = await createCollector(deps).collect()
    expect(s.agents[0]).toMatchObject({
      pid: 5000,
      state: 'idle',
      stateSource: 'file',
      stateSince: 5 * HOUR,
      lastActiveAt: 5 * HOUR,
      parked: true
    })
  })

  test('세션 파일이 없으면 지금처럼 CPU 추정', async () => {
    const cases: Partial<CollectorDeps>[] = [
      {},
      { claudeSessionFiles: filesFrom({ file: null }) },
      // 상태를 모르는 파일(모양이 다름)은 상태 근거가 아니다.
      { claudeSessionFiles: filesFrom({ file: fileOf({ status: null, statusUpdatedAt: MIN }) }) },
      {
        claudeSessionFiles: async () => {
          throw new Error('EACCES')
        }
      }
    ]
    for (const over of cases) {
      const { deps, samples, clock } = setup(over)
      samples.push(sampleAt(1000), sampleAt(2000))
      const collector = createCollector(deps)
      await collector.collect()
      clock.now += 5000
      const s = await collector.collect()
      expect(s.agents[0]).toMatchObject({ pid: 5000, state: 'working', stateSource: 'cpu' })
    }
  })
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
    agentParkedMs: 180 * MIN,
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
      idlePortMinutes: 45,
      agentParkedMinutes: 240
    })
  ).toEqual({
    thresholds: { ramWarnPercent: 70, ramDangerPercent: 85 },
    idlePortMs: 45 * MIN,
    agentParkedMs: 240 * MIN,
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
  c.importState({ servers: {}, serverMemo: null, agentStates: null, agentSeen: null }, clock.now)
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
      agentParkedMs: 180 * MIN,
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

  test('워크트리 경로:포트 항목은 그 워크트리의 서버만 숨긴다', async () => {
    const mine = setup({ options: options([`${W1.root}:3000`]), sample: async () => idle })
    expect((await createCollector(mine.deps).collect()).hiddenServers).toHaveLength(1)
    const other = setup({ options: options(['C:\\work\\other:3000']), sample: async () => idle })
    const s = await createCollector(other.deps).collect()
    expect(s.hiddenServers).toEqual([])
    expect(s.servers).toHaveLength(1)
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

describe('Codex 세션 기록(F7)', () => {
  test('Codex 는 세션 기록 상태와 그 시각을 쓴다', async () => {
    const codexState = vi.fn<NonNullable<CollectorDeps['codexState']>>(async (a) =>
      a.cwd === W2.root ? { state: 'working', since: 5 * MIN, lastEventAt: 5 * MIN } : null
    )
    const { deps } = setup({ codexState })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)).toMatchObject({
      tool: 'codex',
      state: 'working',
      stateSource: 'rollout',
      stateSince: 5 * MIN
    })
    expect(codexState).toHaveBeenCalledWith({ cwd: W2.root, startedAt: 100 }, 10 * MIN)
    // Claude 에는 쓰지 않는다.
    expect(codexState).toHaveBeenCalledTimes(1)
  })

  test('기록이 없으면(첫 입력 전·압축·resume) CPU 추정 그대로', async () => {
    const { deps } = setup({ codexState: async () => null })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)?.stateSource).toBe('cpu')
  })

  test('Codex 둘이 같은 폴더에서 돌면 어느 쪽 기록인지 몰라 쓰지 않는다', async () => {
    const codexState = vi.fn(async () => ({ state: 'working' as const, since: 1, lastEventAt: 1 }))
    const { deps } = setup({ codexState })
    const two: RawSample = {
      ...sampleAt(0),
      processes: [...sampleAt(0).processes, proc(6100, 1, 'codex.exe', 0)],
      cwds: { 5000: W1.root, 6000: W2.root, 6100: W2.root + '\\' }
    }
    const s = await createCollector({
      ...deps,
      sample: async () => two,
      resolveProcessWorktrees: async (processes) =>
        new Map(
          processes.flatMap((p): [number, WorktreeInfo][] =>
            p.pid === 5000 || p.pid === 4100 ? [[p.pid, W1]] : p.pid >= 6000 ? [[p.pid, W2]] : []
          )
        )
    }).collect()
    expect(codexState).not.toHaveBeenCalled()
    expect(s.agents.filter((a) => a.tool === 'codex').map((a) => a.stateSource)).toEqual([
      'cpu',
      'cpu'
    ])
  })

  test('기록 읽기가 실패해도 수집은 이어진다', async () => {
    const { deps } = setup({
      codexState: async () => {
        throw new Error('EBUSY')
      }
    })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)?.stateSource).toBe('cpu')
  })

  test('restate(훅 이벤트)는 세션 기록 상태를 덮어쓰지 않는다', async () => {
    const { deps } = setup({
      codexState: async () => ({ state: 'error', since: 7 * MIN, lastEventAt: 7 * MIN })
    })
    const collector = createCollector(deps)
    const s = await collector.collect()
    const next = await collector.restate(s)
    expect(next.agents.find((a) => a.pid === 6000)).toMatchObject({
      state: 'error',
      stateSource: 'rollout',
      stateSince: 7 * MIN
    })
  })
})

describe('Codex 연동 훅(F7)', () => {
  test('Codex 훅 상태(권한 대기)가 세션 기록보다 먼저이고, 연동 상태를 스냅샷에 담는다', async () => {
    const status = {
      state: 'on' as const,
      problem: null,
      path: 'C:\\Users\\dev\\.codex\\hooks.json'
    }
    const { deps, sessions } = setup({
      codexState: async () => ({ state: 'working', since: 1, lastEventAt: 1 }),
      codexHookStatus: async () => status,
      resolveWorktree: async (path) =>
        path.startsWith(W1.root) ? W1 : path.startsWith(W2.root) ? W2 : null
    })
    applyHookEvent(
      sessions,
      { session_id: 'c1', cwd: W2.root, hook_event_name: 'PermissionRequest' },
      MIN,
      'codex'
    )
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)).toMatchObject({
      state: 'waiting',
      stateSource: 'hook',
      stateSince: MIN
    })
    expect(sessions.get('c1')?.processKey).toBe('6000:100')
    expect(s.codexHook).toEqual(status)
  })

  test('훅으로 작업 중인 Codex 는 훅이 알려 준 세션 기록 파일을 읽는다', async () => {
    const codexState = vi.fn<NonNullable<CollectorDeps['codexState']>>(async () => null)
    const { deps, sessions } = setup({
      codexState,
      resolveWorktree: async (path) =>
        path.startsWith(W1.root) ? W1 : path.startsWith(W2.root) ? W2 : null
    })
    const transcript = 'C:\\Users\\dev\\.codex\\sessions\\2026\\11\\10\\rollout-x.jsonl'
    applyHookEvent(
      sessions,
      {
        session_id: 'c1',
        cwd: W2.root,
        hook_event_name: 'UserPromptSubmit',
        transcript_path: transcript
      },
      MIN,
      'codex'
    )
    await createCollector(deps).collect()
    expect(codexState).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: W2.root, transcriptPath: transcript }),
      expect.any(Number)
    )
  })

  test('연동 상태를 읽다 실패하면 error(settings), 연동이 없으면 null', async () => {
    const failing = setup({
      codexHookStatus: async () => {
        throw new Error('EACCES')
      }
    })
    expect((await createCollector(failing.deps).collect()).codexHook).toEqual({
      state: 'error',
      problem: 'settings',
      path: ''
    })
    expect((await createCollector(setup().deps).collect()).codexHook).toBeNull()
  })
})

test('같은 작업 공간에서 에이전트가 일하면 다른 저장소의 서버·남은 프로세스도 정리 후보로 올리지 않는다', async () => {
  const WS: WorkspaceInfo = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
  const FRONT: WorktreeInfo = {
    root: 'C:\\work\\ws\\repos\\front',
    branch: 'main',
    isLinkedWorktree: false
  }
  const API: WorktreeInfo = {
    root: 'C:\\work\\ws\\repos\\api',
    branch: 'main',
    isLinkedWorktree: false
  }
  const sample: RawSample = {
    processes: [
      proc(4100, 1, 'node.exe', 0, 'node vite'),
      proc(5000, 1, 'claude.exe', 0),
      proc(7100, 1, 'java.exe', 0, 'java org.gradle.launcher.daemon.bootstrap.GradleDaemon')
    ],
    tcp: sampleAt(0).tcp,
    cwds: { 5000: API.root },
    collectMode: 'helper-dll'
  }
  const { deps, clock } = setup({
    sample: async () => sample,
    resolveProcessWorktrees: async (processes) =>
      new Map(
        processes.flatMap((p): [number, WorktreeInfo][] =>
          p.pid === 5000 ? [[p.pid, API]] : p.pid === 4100 || p.pid === 7100 ? [[p.pid, FRONT]] : []
        )
      ),
    resolveWorktree: async () => null,
    resolveWorkspace: async () => WS
  })
  const collector = createCollector(deps)
  await collector.collect()
  clock.now += 30 * MIN
  const s = await collector.collect()
  expect(s.servers[0]).toMatchObject({ judgement: null, agentInWorktree: true })
  expect(s.leftovers.map((l) => [l.pid, l.agentInWorktree])).toEqual([[7100, true]])
  expect(cleanupRecommendation(s).items).toEqual([])
})

describe('Codex 검토 뒤 보강', () => {
  test('같은 폴더의 다른 Codex 가 꺼진 뒤에도 그 프로세스가 살아 있던 구간은 기록 찾기에서 뺀다', async () => {
    const calls: { exclude?: { from: number; to: number }[] }[] = []
    const codexState = vi.fn<NonNullable<CollectorDeps['codexState']>>(async (agent) => {
      calls.push(agent)
      return null
    })
    const { deps, clock, samples } = setup({ codexState })
    const other = { ...proc(6100, 1, 'codex.exe', 0), startedAt: 5 * MIN }
    const both: RawSample = {
      ...sampleAt(0),
      processes: [...sampleAt(0).processes, other],
      cwds: { 5000: W1.root, 6000: W2.root, 6100: W2.root }
    }
    samples.push(both, sampleAt(0))
    const collector = createCollector({
      ...deps,
      resolveProcessWorktrees: async (processes) =>
        new Map(
          processes.flatMap((p): [number, WorktreeInfo][] =>
            p.pid === 5000 || p.pid === 4100 ? [[p.pid, W1]] : p.pid >= 6000 ? [[p.pid, W2]] : []
          )
        )
    })
    await collector.collect()
    // 둘이 함께 떠 있으면 어느 쪽 기록인지 몰라 읽지 않는다.
    expect(codexState).not.toHaveBeenCalled()
    const seen = clock.now
    clock.now += 10 * MIN
    await collector.collect()
    expect(calls).toHaveLength(1)
    expect(calls[0].exclude).toEqual([{ from: 5 * MIN, to: seen + MIN }])
  })

  test('Codex 연동 중 오류로 끝난 턴(Stop 이 오지 않음)은 세션 기록의 끝 이벤트로 바로잡는다', async () => {
    const after = setup({
      codexState: async () => ({ state: 'error', since: 3 * MIN, lastEventAt: 3 * MIN }),
      resolveWorktree: async (path) =>
        path.startsWith(W1.root) ? W1 : path.startsWith(W2.root) ? W2 : null
    })
    applyHookEvent(
      after.sessions,
      { session_id: 'c1', cwd: W2.root, hook_event_name: 'UserPromptSubmit' },
      MIN,
      'codex'
    )
    const s = await createCollector(after.deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)).toMatchObject({
      state: 'error',
      stateSource: 'rollout',
      stateSince: 3 * MIN
    })

    // 세션 기록의 끝 이벤트가 훅의 작업 시작보다 이르면(지난 턴) 훅 상태를 그대로 쓴다.
    const before = setup({
      codexState: async () => ({ state: 'idle', since: MIN / 2, lastEventAt: MIN / 2 }),
      resolveWorktree: async (path) =>
        path.startsWith(W1.root) ? W1 : path.startsWith(W2.root) ? W2 : null
    })
    applyHookEvent(
      before.sessions,
      { session_id: 'c1', cwd: W2.root, hook_event_name: 'UserPromptSubmit' },
      MIN,
      'codex'
    )
    const t = await createCollector(before.deps).collect()
    expect(t.agents.find((a) => a.pid === 6000)).toMatchObject({
      state: 'working',
      stateSource: 'hook'
    })
  })
})
