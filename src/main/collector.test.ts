import {
  collectOptionsFrom,
  createCollector,
  type CollectOptions,
  type CollectorDeps
} from './collector'
import { cleanupRecommendation } from '../shared/recommend'
import { buildTrayMenu } from './tray'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { Sessions } from './sessions'
import { applyHookEvent } from './sessions'
import type { Mock } from 'vitest'
import type { ClaudeSessionFile } from './claudeSessionFiles'
import type { UsageTarget } from './claudeUsage'
import type { CodexInfo, RolloutState } from './codexRollout'
import type {
  AgentUsage,
  ClaudeHookStatus,
  CodexLimits,
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

type CodexAgent = Parameters<NonNullable<CollectorDeps['codexInfo']>>[0]
/** 세션 기록 상태만 읽는 쪽(토큰·한도는 모름). */
type CodexStateFn = (agent: CodexAgent, now: number) => Promise<RolloutState | null>
/** 상태만 돌려주는 읽기를 수집기의 codexInfo 모양으로. */
const stateOnly =
  (read: CodexStateFn): NonNullable<CollectorDeps['codexInfo']> =>
  async (agent, now) => ({ state: await read(agent, now), usage: null, limits: null })

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
      heavyPatterns: ['tsc'],
      showAgentActivity: true,
      readUsage: true
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
      codexInfo: stateOnly(async () => ({ state: 'idle', since: 2 * MIN, lastEventAt: 3 * MIN }))
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
        heavyPatterns: [],
        showAgentActivity: true,
        readUsage: true
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

  test('오래 쉬는 에이전트만 있는 워크트리의 서버는 확인해볼 것까지만, 그 전에는 판단 없이 연결 타이머만 잰다', async () => {
    // 서버(3000)와 Claude(5000)는 shop-web, Codex(6000)는 다른 워크트리.
    const { deps, sessions, clock } = setup({
      options: () => ({
        thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
        idlePortMs: 20 * MIN,
        agentParkedMs: 30 * MIN,
        heavyPatterns: [],
        showAgentActivity: true,
        readUsage: true
      })
    })
    const stoppedAt = clock.now - 1
    hookEvent(sessions, 'Stop', stoppedAt)
    const collector = createCollector(deps)
    const first = await collector.collect()
    expect(first.servers[0]).toMatchObject({
      judgement: null,
      idleSince: 10 * MIN,
      agentInWorktree: true,
      parkedAgent: false
    })
    expect(collector.exportState().serverMemo).toEqual({
      'server:4100:100': { state: 'idle', since: 10 * MIN, shielded: true }
    })
    // 오래 쉬는 세션이 된 샘플: 지난 샘플에 보호받았으므로 그때부터 센다.
    clock.now = stoppedAt + 30 * MIN
    const parkedAt = clock.now
    const justParked = await collector.collect()
    expect(justParked.servers[0]).toMatchObject({
      judgement: null,
      idleSince: parkedAt,
      agentInWorktree: true,
      parkedAgent: true,
      parkedSince: stoppedAt
    })
    clock.now = parkedAt + 20 * MIN
    const s = await collector.collect()
    expect(s.servers[0]).toMatchObject({
      judgement: 'check',
      idleSince: parkedAt,
      parkedAgent: true,
      parkedSince: stoppedAt
    })
    expect(cleanupRecommendation(s).items).toEqual([])
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

describe('조용한 에이전트(G3c)', () => {
  test('훅으로 작업 중인데 이벤트도 CPU 도 없이 15분이면 quietSince, 새 이벤트가 오면 restate 가 지우고 그때부터 다시 센다', async () => {
    const { deps, sessions, clock } = setup()
    const event = (cwd: string, name: string, extra: Record<string, unknown> = {}): void => {
      applyHookEvent(
        sessions,
        { session_id: cwd === W1.root ? 's1' : 'elsewhere', cwd, hook_event_name: name, ...extra },
        clock.now
      )
    }
    event(W1.root, 'UserPromptSubmit')
    const collector = createCollector(deps)
    // 첫 수집은 CPU 를 아직 몰라 조용한지 모른다.
    expect((await collector.collect()).agents[0]).toMatchObject({
      pid: 5000,
      state: 'working',
      stateSource: 'hook',
      cpuPercent: null,
      quietSince: null
    })
    clock.now += 5000
    const calmAt = clock.now
    expect((await collector.collect()).agents[0]).toMatchObject({ cpuPercent: 0, quietSince: null })
    clock.now = calmAt + 15 * MIN - 1
    expect((await collector.collect()).agents[0].quietSince).toBeNull()
    clock.now = calmAt + 15 * MIN
    const quiet = await collector.collect()
    expect(quiet.agents[0]).toMatchObject({
      pid: 5000,
      state: 'working',
      stateSource: 'hook',
      quietSince: calmAt
    })
    // CPU 추정인 Codex 는 아니다.
    expect(quiet.agents[1]).toMatchObject({ pid: 6000, stateSource: 'cpu', quietSince: null })
    // 조용함의 기억은 저장하지 않는다(다시 켜면 처음부터 본다).
    expect(Object.keys(collector.exportState()).sort()).toEqual([
      'agentSeen',
      'agentStates',
      'serverMemo',
      'servers'
    ])

    // 다른 폴더의 세션 소식은 이 에이전트의 이벤트가 아니다.
    clock.now += 1000
    event('C:\\tmp', 'UserPromptSubmit')
    const unrelated = await collector.restate(quiet)
    expect(unrelated.agents[0].quietSince).toBe(calmAt)
    // 새 이벤트(도구 시작)가 오면 수집 사이에도 바로 지운다.
    clock.now += 1000
    const eventAt = clock.now
    event(W1.root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } })
    const next = await collector.restate(unrelated)
    expect(next.agents[0]).toMatchObject({ state: 'working', quietSince: null })
    // 다음 수집은 그 이벤트부터 다시 센다.
    clock.now = eventAt + 15 * MIN - 1
    expect((await collector.collect()).agents[0].quietSince).toBeNull()
    clock.now = eventAt + 15 * MIN
    expect((await collector.collect()).agents[0].quietSince).toBe(eventAt)
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
    nameSource: null,
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

describe('하는 일(G3b)', () => {
  const fileOf = (over: Partial<ClaudeSessionFile> = {}): ClaudeSessionFile => ({
    pid: 5000,
    sessionId: 'f1',
    status: null,
    statusUpdatedAt: null,
    name: null,
    nameSource: null,
    ...over
  })
  /** 바꿀 수 있는 수집 기준값(하는 일 보기 켬). */
  const mutableOptions = (): CollectOptions => ({
    thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
    idlePortMs: 20 * MIN,
    agentParkedMs: 180 * MIN,
    heavyPatterns: [],
    showAgentActivity: true,
    readUsage: true
  })
  /** 수집기에 넘길 세션 파일 읽기. current 를 바꾸면 다음 수집부터 반영된다. */
  const filesFrom =
    (current: { files: ClaudeSessionFile[] }): NonNullable<CollectorDeps['claudeSessionFiles']> =>
    async () =>
      new Map(current.files.map((f) => [f.pid, f]))
  const event = (
    sessions: Sessions,
    id: string,
    name: string,
    at: number,
    extra: Record<string, unknown> = {}
  ): void => {
    applyHookEvent(sessions, { session_id: id, cwd: W1.root, hook_event_name: name, ...extra }, at)
  }

  test('같은 워크트리의 두 세션은 각자의 하는 일을 본다', async () => {
    // shop-web 에 Claude 둘(5000·5001). 세션 파일이 각자의 세션(a·b)을 알려 준다.
    const twoClaudes: RawSample = {
      ...sampleAt(0),
      processes: [...sampleAt(0).processes, { ...proc(5001, 1, 'claude.exe', 0), startedAt: 200 }],
      cwds: { 5000: W1.root, 5001: W1.root, 6000: W2.root }
    }
    const { deps, sessions, clock } = setup({
      sample: async () => twoClaudes,
      resolveProcessWorktrees: async (processes) =>
        new Map(processes.map((p) => [p.pid, p.pid === 6000 ? W2 : W1])),
      claudeSessionFiles: filesFrom({
        files: [fileOf({ pid: 5000, sessionId: 'a' }), fileOf({ pid: 5001, sessionId: 'b' })]
      })
    })
    const t = clock.now
    event(sessions, 'a', 'UserPromptSubmit', t - 4000, {
      prompt: '로그인 버그 고쳐 줘',
      session_title: '로그인 버그'
    })
    event(sessions, 'a', 'PreToolUse', t - 3000, {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' }
    })
    event(sessions, 'b', 'UserPromptSubmit', t - 2000, { prompt: '문서 정리' })
    event(sessions, 'b', 'PermissionRequest', t - 1000, {
      tool_name: 'Write',
      tool_input: { file_path: 'C:\\work\\shop-web\\README.md', content: '본문' }
    })
    const collector = createCollector(deps)
    const s = await collector.collect()
    const doing = (snap: typeof s): unknown[] =>
      snap.agents.filter((a) => a.tool === 'claude').map((a) => [a.pid, a.state, a.activity])
    const b = {
      title: null,
      prompt: '문서 정리',
      tool: null,
      waiting: { tool: 'Write', summary: 'README.md' }
    }
    expect(doing(s)).toEqual([
      [
        5000,
        'working',
        {
          title: '로그인 버그',
          prompt: '로그인 버그 고쳐 줘',
          tool: { name: 'Bash', summary: 'npm test', since: t - 3000 },
          waiting: null
        }
      ],
      [5001, 'waiting', b]
    ])
    // 훅이 없는 Codex 는 하는 일을 모른다.
    expect(s.agents.find((a) => a.pid === 6000)?.activity).toBeNull()

    // 수집 사이에 온 훅 소식은 그 세션의 행만 바꾼다.
    event(sessions, 'a', 'PostToolUse', t + 1000, { tool_name: 'Bash' })
    expect(doing(await collector.restate(s))).toEqual([
      [
        5000,
        'working',
        { title: '로그인 버그', prompt: '로그인 버그 고쳐 줘', tool: null, waiting: null }
      ],
      [5001, 'waiting', b]
    ])
  })

  test('훅 제목이 없으면 세션 파일의 이름(한 줄 80자)을 제목으로 쓴다(훅 세션이 없어도)', async () => {
    const current = {
      files: [
        fileOf({
          status: 'busy',
          statusUpdatedAt: 9 * MIN,
          name: '결제 리팩터링\n둘째 줄',
          nameSource: 'user'
        })
      ]
    }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    const collector = createCollector(deps)
    // 훅 없이 세션 파일로만 아는 에이전트도 제목은 안다.
    const s = await collector.collect()
    expect(s.agents[0]).toMatchObject({
      pid: 5000,
      stateSource: 'file',
      activity: { title: '결제 리팩터링', prompt: null, tool: null, waiting: null }
    })
    // 훅 세션에 제목이 없으면 파일의 이름.
    event(sessions, 'f1', 'UserPromptSubmit', clock.now, { prompt: '테스트 추가' })
    const hooked = await collector.restate(s)
    expect(hooked.agents[0]).toMatchObject({
      stateSource: 'hook',
      activity: { title: '결제 리팩터링', prompt: '테스트 추가', tool: null, waiting: null }
    })
    // 훅이 제목을 알려 주면 그것.
    event(sessions, 'f1', 'UserPromptSubmit', clock.now + 1, {
      prompt: '테스트 추가',
      session_title: '결제 테스트'
    })
    expect((await collector.restate(hooked)).agents[0].activity?.title).toBe('결제 테스트')

    // 긴 이름은 80자로 자른다. 이름도 내용도 없으면 null.
    const fresh = setup({
      claudeSessionFiles: filesFrom({
        files: [fileOf({ name: 'n'.repeat(100), nameSource: 'user' })]
      })
    })
    expect((await createCollector(fresh.deps).collect()).agents[0].activity?.title).toBe(
      'n'.repeat(79) + '…'
    )
    const none = setup({
      claudeSessionFiles: filesFrom({ files: [fileOf({ name: '  ', nameSource: 'user' })] })
    })
    expect((await createCollector(none.deps).collect()).agents[0].activity).toBeNull()
  })

  test('자동으로 붙은 세션 이름(nameSource derived)은 제목으로 쓰지 않는다', async () => {
    const titleWith = async (nameSource: string | null): Promise<string | null | undefined> => {
      const { deps } = setup({
        claudeSessionFiles: filesFrom({ files: [fileOf({ name: 'shop-web-3f', nameSource })] })
      })
      const s = await createCollector(deps).collect()
      return s.agents[0].activity?.title
    }
    // Claude Code 가 폴더 이름으로 자동으로 붙인 이름은 프로젝트 칸을 되풀이할 뿐이다.
    expect(await titleWith('derived')).toBeUndefined()
    // 어디서 온 이름인지 모르면 쓰지 않는다.
    expect(await titleWith(null)).toBeUndefined()
    expect(await titleWith('user')).toBe('shop-web-3f')
  })

  test('권한 대기 중에 늦게 온 같은 도구의 PreToolUse 는 행에서 실행 중으로 보이지 않는다', async () => {
    const { deps, sessions, clock } = setup()
    event(sessions, 'f1', 'UserPromptSubmit', clock.now - 3000)
    event(sessions, 'f1', 'PermissionRequest', clock.now - 2000, {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf dist' }
    })
    // 훅은 따로따로 와서 그 도구의 PreToolUse 가 PermissionRequest 보다 늦게 도착할 수 있다.
    event(sessions, 'f1', 'PreToolUse', clock.now - 1000, {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf dist' }
    })
    const s = await createCollector(deps).collect()
    expect(s.agents[0]).toMatchObject({
      state: 'waiting',
      activity: { tool: null, waiting: { tool: 'Bash', summary: 'rm -rf dist' } }
    })
  })

  test('수집 도중 설정을 끄면 그 수집 결과에도 내용이 없다', async () => {
    const options = mutableOptions()
    const { deps, sessions, clock } = setup({
      options: () => options,
      claudeSessionFiles: filesFrom({ files: [fileOf({ name: '비밀 이름', nameSource: 'user' })] }),
      // 수집의 마지막 기다림(작업 공간 판별) 동안 사용자가 설정을 끈다.
      resolveWorkspace: async (w) => {
        options.showAgentActivity = false
        return { root: w.root, name: 'self', branch: w.branch, outer: false }
      }
    })
    event(sessions, 'f1', 'UserPromptSubmit', clock.now - 1, { prompt: '비밀 요청' })
    const s = await createCollector(deps).collect()
    expect(s.agents.map((a) => a.activity)).toEqual([null, null])
  })

  test('설정이 꺼져 있으면 세션 파일의 이름을 들고 있지 않는다', async () => {
    const options = { ...mutableOptions(), showAgentActivity: false }
    const current = { files: [fileOf({ name: '결제 리팩터링', nameSource: 'user' })] }
    const { deps, clock } = setup({
      options: () => options,
      claudeSessionFiles: filesFrom(current)
    })
    const collector = createCollector(deps)
    const off = await collector.collect()
    expect(off.agents[0].activity).toBeNull()
    // 다시 켜도 새로 읽기 전에는(수집 사이) 제목을 모른다 — 꺼져 있을 때 읽은 이름을 들고 있지 않았다.
    options.showAgentActivity = true
    expect((await collector.restate(off)).agents[0].activity).toBeNull()
    clock.now += 5000
    const on = await collector.collect()
    expect(on.agents[0].activity?.title).toBe('결제 리팩터링')
    // 켠 채 읽은 이름도 끄면 버린다(수집 사이에 끄고 다시 켜도 되살아나지 않는다).
    options.showAgentActivity = false
    expect((await collector.restate(on)).agents[0].activity).toBeNull()
    options.showAgentActivity = true
    expect((await collector.restate(on)).agents[0].activity).toBeNull()
  })

  test('실행 중인 도구는 작업 중·권한 대기일 때만(더 늦은 근거로 쉬는 중이면 옛 도구를 보이지 않는다)', async () => {
    const current = { files: [] as ClaudeSessionFile[] }
    const { deps, sessions, clock } = setup({ claudeSessionFiles: filesFrom(current) })
    clock.now = 60 * MIN
    event(sessions, 'f1', 'UserPromptSubmit', clock.now - 10 * MIN, { prompt: '빌드해 줘' })
    event(sessions, 'f1', 'PreToolUse', clock.now - 9 * MIN, {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' }
    })
    // 훅 전달이 끊긴 뒤 세션 파일이 더 늦게 idle 이 됐다.
    current.files = [fileOf({ status: 'idle', statusUpdatedAt: clock.now - MIN })]
    const s = await createCollector(deps).collect()
    expect(s.agents[0]).toMatchObject({
      state: 'idle',
      stateSource: 'file',
      activity: { title: null, prompt: '빌드해 줘', tool: null, waiting: null }
    })
  })

  test('showAgentActivity 를 끄면 행의 하는 일은 null(세션 파일 이름도 쓰지 않는다), 기억(history.json)에는 담지 않는다', async () => {
    const options = {
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      idlePortMs: 20 * MIN,
      agentParkedMs: 180 * MIN,
      heavyPatterns: [],
      showAgentActivity: true,
      readUsage: true
    }
    const { deps, sessions, clock } = setup({
      options: () => options,
      claudeSessionFiles: filesFrom({
        files: [fileOf({ name: '비밀 세션 이름', nameSource: 'user' })]
      })
    })
    event(sessions, 'f1', 'UserPromptSubmit', clock.now - 1, { prompt: '비밀 요청' })
    const collector = createCollector(deps)
    const s = await collector.collect()
    expect(s.agents[0].activity).toEqual({
      title: '비밀 세션 이름',
      prompt: '비밀 요청',
      tool: null,
      waiting: null
    })
    expect(JSON.stringify(collector.exportState())).not.toContain('비밀')

    options.showAgentActivity = false
    expect((await collector.restate(s)).agents[0].activity).toBeNull()
    clock.now += 5000
    expect((await collector.collect()).agents.map((a) => a.activity)).toEqual([null, null])
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
    heavyPatterns: [],
    showAgentActivity: true,
    readUsage: true
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
      agentParkedMinutes: 240,
      showAgentActivity: false,
      readUsage: false
    })
  ).toEqual({
    thresholds: { ramWarnPercent: 70, ramDangerPercent: 85 },
    idlePortMs: 45 * MIN,
    agentParkedMs: 240 * MIN,
    heavyPatterns: DEFAULT_SETTINGS.heavyPatterns,
    hiddenServers: [],
    workspaceAliases: {},
    showAgentActivity: false,
    readUsage: false
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

describe('작업 공간 합계(G4)', () => {
  test('에이전트가 띄운 무거운 작업은 한 번만 더하고, 워크트리의 변경 수를 붙인다', async () => {
    const changedFiles = {
      get: vi.fn((root: string) => (root === W1.root ? 4 : null)),
      want: vi.fn()
    }
    const { deps } = setup({
      changedFiles,
      resolveProcessWorktrees: async (processes) =>
        new Map(
          processes.flatMap((p): [number, WorktreeInfo][] =>
            [4100, 5000, 7000].includes(p.pid) ? [[p.pid, W1]] : p.pid === 6000 ? [[p.pid, W2]] : []
          )
        )
    })
    // Claude(5000)가 띄운 tsc(7000): 에이전트 메모리에도, 무거운 작업에도 들어 있다.
    const sample: RawSample = {
      ...sampleAt(0),
      processes: [...sampleAt(0).processes, proc(7000, 5000, 'node.exe', 0, 'node tsc --noEmit')]
    }
    const s = await createCollector({ ...deps, sample: async () => sample }).collect()
    expect(s.agents[0].memoryBytes + s.heavyJobs[0].memoryBytes + s.servers[0].memoryBytes).toBe(
      40 * MB
    )
    expect(
      s.workspaces.map((w) => [w.key, w.memoryBytes / MB, w.processCount, w.changedFiles])
    ).toEqual([
      ['ws:c:\\work\\shop-web', 30, 3, 4],
      ['ws:c:\\work\\wt-a', 10, 1, null]
    ])
    expect(s.workspaces[0]).toMatchObject({
      agentKeys: ['agent:5000:100'],
      serverKeys: ['server:4100:100'],
      heavyKeys: ['heavy:7000:100'],
      leftoverKeys: []
    })
    // 변경 수는 수집을 기다리게 하지 않고 뒤에서 센다: 든 워크트리마다 한 번 부탁한다.
    expect(changedFiles.want).toHaveBeenCalledTimes(1)
    expect([...changedFiles.want.mock.calls[0][0]].sort()).toEqual([W1.root, W2.root])
  })

  test('변경 수 세기가 없으면 변경 수는 null', async () => {
    const { deps } = setup()
    const s = await createCollector(deps).collect()
    expect(s.workspaces.map((w) => [w.key, w.changedFiles])).toEqual([
      ['ws:c:\\work\\shop-web', null],
      ['ws:c:\\work\\wt-a', null]
    ])
  })

  test('숨긴 서버는 넣지 않는다', async () => {
    const onlyServer: RawSample = {
      ...sampleAt(0),
      processes: [proc(4100, 1, 'node.exe', 0, 'node vite')]
    }
    const options = (hiddenServers: string[]) => (): CollectOptions => ({
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      idlePortMs: 20 * MIN,
      agentParkedMs: 180 * MIN,
      heavyPatterns: [],
      hiddenServers,
      showAgentActivity: true,
      readUsage: true
    })
    const shown = setup({ options: options([]), sample: async () => onlyServer })
    expect(
      (await createCollector(shown.deps).collect()).workspaces.map((w) => [w.key, w.serverKeys])
    ).toEqual([['ws:c:\\work\\shop-web', ['server:4100:100']]])
    const hidden = setup({ options: options([':3000']), sample: async () => onlyServer })
    const s = await createCollector(hidden.deps).collect()
    expect(s.hiddenServers).toHaveLength(1)
    expect(s.workspaces).toEqual([])
  })

  test('restate: 줄은 그대로 두고 마지막 활동만 새로 한다', async () => {
    const { deps, sessions, clock } = setup()
    const collector = createCollector(deps)
    const first = await collector.collect()
    expect(first.workspaces[0]).toMatchObject({ key: 'ws:c:\\work\\shop-web', lastActiveAt: null })
    clock.now += MIN
    applyHookEvent(
      sessions,
      { session_id: 's1', cwd: W1.root, hook_event_name: 'UserPromptSubmit' },
      clock.now
    )
    const next = await collector.restate(first)
    expect(next.agents.find((a) => a.pid === 5000)?.lastActiveAt).toBe(clock.now)
    expect(next.workspaces).toEqual([
      { ...first.workspaces[0], lastActiveAt: clock.now },
      first.workspaces[1]
    ])
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
      workspaceAliases,
      showAgentActivity: true,
      readUsage: true
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
    const codexState = vi.fn<CodexStateFn>(async (a) =>
      a.cwd === W2.root ? { state: 'working', since: 5 * MIN, lastEventAt: 5 * MIN } : null
    )
    const { deps } = setup({ codexInfo: stateOnly(codexState) })
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
    const { deps } = setup({ codexInfo: stateOnly(async () => null) })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)?.stateSource).toBe('cpu')
  })

  test('Codex 둘이 같은 폴더에서 돌면 어느 쪽 기록인지 몰라 쓰지 않는다', async () => {
    const codexState = vi.fn(async () => ({ state: 'working' as const, since: 1, lastEventAt: 1 }))
    const { deps } = setup({ codexInfo: stateOnly(codexState) })
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
      codexInfo: async () => {
        throw new Error('EBUSY')
      }
    })
    const s = await createCollector(deps).collect()
    expect(s.agents.find((a) => a.pid === 6000)?.stateSource).toBe('cpu')
  })

  test('restate(훅 이벤트)는 세션 기록 상태를 덮어쓰지 않는다', async () => {
    const { deps } = setup({
      codexInfo: stateOnly(async () => ({ state: 'error', since: 7 * MIN, lastEventAt: 7 * MIN }))
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
      codexInfo: stateOnly(async () => ({ state: 'working', since: 1, lastEventAt: 1 })),
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
    const codexState = vi.fn<CodexStateFn>(async () => null)
    const { deps, sessions } = setup({
      codexInfo: stateOnly(codexState),
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
    const codexState = vi.fn<CodexStateFn>(async (agent) => {
      calls.push(agent)
      return null
    })
    const { deps, clock, samples } = setup({ codexInfo: stateOnly(codexState) })
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
      codexInfo: stateOnly(async () => ({ state: 'error', since: 3 * MIN, lastEventAt: 3 * MIN })),
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
      codexInfo: stateOnly(async () => ({ state: 'idle', since: MIN / 2, lastEventAt: MIN / 2 })),
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

describe('토큰·한도(G6)', () => {
  const usage = (n: number): AgentUsage => ({
    contextTokens: n,
    contextWindow: null,
    outputTokens: n * 2,
    totalTokens: null,
    model: 'claude-test'
  })
  const limitsAt = (at: number, usedPercent: number): CodexLimits => ({
    primary: { usedPercent, windowMinutes: 300, resetsAt: null },
    secondary: null,
    planType: 'plus',
    at
  })
  const optionsWith = (readUsage: boolean): CollectOptions => ({
    thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
    idlePortMs: 20 * MIN,
    agentParkedMs: 180 * MIN,
    heavyPatterns: [],
    showAgentActivity: true,
    readUsage
  })
  const fileOf = (pid: number, sessionId: string): ClaudeSessionFile => ({
    pid,
    sessionId,
    status: 'idle',
    statusUpdatedAt: null,
    name: null,
    nameSource: null
  })
  /** 기억한 값을 바로 주는 토큰 숫자 기억(want 는 부른 것만 남긴다). */
  function usageCache(values: Record<string, AgentUsage>): {
    get: Mock<(sessionId: string) => AgentUsage | null>
    want: Mock<(targets: UsageTarget[]) => void>
  } {
    return {
      get: vi.fn((id: string) => values[id] ?? null),
      want: vi.fn<(targets: UsageTarget[]) => void>()
    }
  }
  const PATH_A = 'C:\\Users\\dev\\.claude\\projects\\C--work-shop-web\\a.jsonl'

  /**
   * shop-web 에 Claude 셋과 wt-a 의 Codex(6000). 5000 은 세션 파일(a)과 그 세션의 훅 소식(기록 경로를 앎),
   * 5001 은 세션 파일(b)만, 5002 는 짝이 없다(수집 중에 처음 온 세션의 상태만 빌려 본다).
   */
  function claudeSetup(
    readUsage: boolean,
    over: Partial<CollectorDeps> = {}
  ): ReturnType<typeof setup> & { claudeUsage: ReturnType<typeof usageCache> } {
    const threeClaudes: RawSample = {
      ...sampleAt(0),
      processes: [
        ...sampleAt(0).processes,
        { ...proc(5001, 1, 'claude.exe', 0), startedAt: 200 },
        { ...proc(5002, 1, 'claude.exe', 0), startedAt: 300 }
      ],
      cwds: { 5000: W1.root, 5001: W1.root, 5002: W1.root, 6000: W2.root }
    }
    const claudeUsage = usageCache({ a: usage(100), b: usage(200), loose: usage(999) })
    const ctx = setup({
      sample: async () => threeClaudes,
      resolveProcessWorktrees: async (processes) =>
        new Map(processes.map((p) => [p.pid, p.pid === 6000 ? W2 : W1])),
      claudeSessionFiles: async () =>
        new Map([
          [5000, fileOf(5000, 'a')],
          [5001, fileOf(5001, 'b')]
        ]),
      claudeUsage,
      options: () => optionsWith(readUsage),
      ...over
    })
    applyHookEvent(
      ctx.sessions,
      { session_id: 'a', cwd: W1.root, hook_event_name: 'Stop', transcript_path: PATH_A },
      ctx.clock.now - 1000
    )
    applyHookEvent(
      ctx.sessions,
      {
        session_id: 'loose',
        cwd: W1.root,
        hook_event_name: 'UserPromptSubmit',
        transcript_path: 'C:\\Users\\dev\\.claude\\projects\\C--work-shop-web\\loose.jsonl'
      },
      ctx.clock.now
    )
    return { ...ctx, claudeUsage }
  }

  test('짝지은 세션이 있는 Claude 만 usage 를 갖는다', async () => {
    const { deps, claudeUsage } = claudeSetup(true)
    const collector = createCollector(deps)
    const s = await collector.collect()
    // 훅이 알려 준 기록 경로가 먼저, 없으면 세션 파일의 세션 id(읽는 쪽이 찾는다). 짝이 없으면 읽지 않는다.
    expect(claudeUsage.want).toHaveBeenCalledTimes(1)
    expect(claudeUsage.want).toHaveBeenCalledWith([
      { sessionId: 'a', transcriptPath: PATH_A },
      { sessionId: 'b', transcriptPath: null }
    ])
    expect(s.agents.map((a) => [a.pid, a.stateSource, a.usage])).toEqual([
      [5000, 'hook', usage(100)],
      [5001, 'file', usage(200)],
      [5002, 'hook', null],
      [6000, 'cpu', null]
    ])
    // 기억(history.json)에는 담지 않는다.
    expect(JSON.stringify(collector.exportState())).not.toContain('claude-test')
  })

  test('읽기를 끄면(readUsage) 기록을 읽지 않고 usage·codexLimits 는 null', async () => {
    const codexInfo = vi.fn<NonNullable<CollectorDeps['codexInfo']>>(async () => ({
      state: null,
      usage: usage(5),
      limits: limitsAt(MIN, 10)
    }))
    const { deps, claudeUsage } = claudeSetup(false, { codexInfo })
    const s = await createCollector(deps).collect()
    expect(claudeUsage.want).not.toHaveBeenCalled()
    expect(claudeUsage.get).not.toHaveBeenCalled()
    expect(s.agents.map((a) => a.usage)).toEqual([null, null, null, null])
    expect(s.codexLimits).toBeNull()
  })

  test('수집 도중 readUsage 를 끄면 그 수집은 기록을 읽게 하지 않는다', async () => {
    // 실제처럼 부를 때마다 새 기준값(collectOptionsFrom)을 만든다.
    const settings = { readUsage: true }
    // 수집이 Codex 기록을 기다리는 동안 사용자가 설정을 끈다(applySettings 의 clear 는 이미 지나갔다).
    const { deps, claudeUsage } = claudeSetup(true, {
      options: () => optionsWith(settings.readUsage),
      codexInfo: async () => {
        settings.readUsage = false
        return { state: null, usage: usage(5), limits: limitsAt(MIN, 10) }
      }
    })
    const s = await createCollector(deps).collect()
    expect(claudeUsage.want).not.toHaveBeenCalled()
    expect(s.agents.map((a) => a.usage)).toEqual([null, null, null, null])
    expect(s.codexLimits).toBeNull()
  })

  test('codexLimits 는 가장 최근 값', async () => {
    // Codex 둘(다른 폴더): 6000(wt-a) 은 CPU 추정, 6100(api) 은 훅으로 쉬는 중이어도 숫자를 읽는다(상태는 훅 그대로).
    const W3: WorktreeInfo = { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false }
    const two: RawSample = {
      ...sampleAt(0),
      processes: [...sampleAt(0).processes, { ...proc(6100, 1, 'codex.exe', 0), startedAt: 200 }],
      cwds: { 5000: W1.root, 6000: W2.root, 6100: W3.root }
    }
    const infos: Record<string, CodexInfo> = {
      [W2.root]: {
        state: { state: 'working', since: MIN, lastEventAt: MIN },
        usage: usage(10),
        limits: limitsAt(5 * MIN, 14)
      },
      [W3.root]: {
        state: { state: 'working', since: 9 * MIN, lastEventAt: 9 * MIN },
        usage: usage(20),
        limits: limitsAt(7 * MIN, 20)
      }
    }
    const codexInfo = vi.fn<NonNullable<CollectorDeps['codexInfo']>>(async (a) => infos[a.cwd])
    const options = optionsWith(true)
    const { deps, sessions } = setup({
      sample: async () => two,
      resolveProcessWorktrees: async (processes) =>
        new Map(
          processes.map((p): [number, WorktreeInfo] => [
            p.pid,
            p.pid === 6000 ? W2 : p.pid === 6100 ? W3 : W1
          ])
        ),
      resolveWorktree: async (path) =>
        path.startsWith(W3.root) ? W3 : path.startsWith(W1.root) ? W1 : null,
      codexInfo,
      options: () => options
    })
    applyHookEvent(
      sessions,
      { session_id: 'c1', cwd: W3.root, hook_event_name: 'Stop' },
      MIN,
      'codex'
    )
    const collector = createCollector(deps)
    const s = await collector.collect()
    expect(s.codexLimits).toEqual(limitsAt(7 * MIN, 20))
    expect(
      s.agents
        .filter((a) => a.tool === 'codex')
        .map((a) => [a.pid, a.state, a.stateSource, a.usage])
    ).toEqual([
      [6100, 'idle', 'hook', usage(20)],
      [6000, 'working', 'rollout', usage(10)]
    ])
    // 훅 소식만 반영하는 restate 는 숫자를 그대로 둔다.
    const next = await collector.restate(s)
    expect(next.codexLimits).toEqual(s.codexLimits)
    expect(next.agents.map((a) => a.usage)).toEqual(s.agents.map((a) => a.usage))

    // 끄면 restate 부터 숫자를 보이지 않고, 다음 수집은 상태가 필요한 Codex(CPU 추정)만 읽는다.
    options.readUsage = false
    const hidden = await collector.restate(s)
    expect(hidden.codexLimits).toBeNull()
    expect(hidden.agents.map((a) => a.usage)).toEqual([null, null, null])
    codexInfo.mockClear()
    const off = await collector.collect()
    expect(off.codexLimits).toBeNull()
    expect(off.agents.map((a) => a.usage)).toEqual([null, null, null])
    expect(codexInfo.mock.calls.map(([a]) => a.cwd)).toEqual([W2.root])
  })
})
