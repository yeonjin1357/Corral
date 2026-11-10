import { cleanupEvent, createEventLog, diffEvents, diskRemoveEvent } from './events'
import { blankSnapshot } from '../shared/snapshot'
import type { PitEvent } from '../shared/events'
import type {
  AgentRow,
  DashboardSnapshot,
  HeavyJobRow,
  MemoryLevel,
  ServerRow
} from '../shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const GB = 1024 ** 3
const MB = 1024 ** 2

const WORKTREE = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }

function snap(
  takenAt: number,
  over: Partial<DashboardSnapshot> = {},
  level: MemoryLevel = 'normal'
): DashboardSnapshot {
  const usedPercent = { normal: 50, warn: 85, danger: 93.6 }[level]
  const usedBytes = (32 * GB * usedPercent) / 100
  return {
    ...blankSnapshot(takenAt),
    memory: {
      totalBytes: 32 * GB,
      usedBytes,
      usedPercent,
      availableBytes: 32 * GB - usedBytes,
      level,
      ramLevel: level,
      commit: null,
      kernelBytes: null
    },
    ...over
  }
}

function agent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    pid: 5000,
    tool: 'claude',
    worktree: WORKTREE,
    workspace: null,
    startedAt: 100,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state: 'working',
    stateSource: 'hook',
    stateSince: 0,
    cpuPercent: 0,
    lastActiveAt: null,
    parked: false,
    activity: null,
    quietSince: null,
    usage: null,
    waitReason: null,
    host: { pids: [], app: null },
    ...over
  }
}

function server(over: Partial<ServerRow> = {}): ServerRow {
  return {
    ports: [3000, 3001],
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite --port 3000',
    worktree: WORKTREE,
    workspace: null,
    unresolvable: false,
    memoryBytes: 800 * MB,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    clientCount: 0,
    startedAt: 200,
    judgement: null,
    idleSince: null,
    agentInWorktree: false,
    parkedAgent: false,
    parkedSince: null,
    cpuPercent: null,
    memoryGrowth: null,
    ...over
  }
}

function heavy(over: Partial<HeavyJobRow> = {}): HeavyJobRow {
  return {
    pid: 8000,
    label: 'vue-tsc',
    processName: 'node.exe',
    commandLine: 'node vue-tsc --noEmit',
    worktree: WORKTREE,
    workspace: null,
    memoryBytes: 2 * GB,
    commitBytes: 3 * GB,
    descendantPids: [],
    processes: [],
    startedAt: 0,
    ...over
  }
}

/** 표본 스냅샷을 차례로 견준 기록(첫 스냅샷은 기준선). */
function run(...snapshots: DashboardSnapshot[]): Omit<PitEvent, 'id'>[] {
  const peaks = new Map<string, number>()
  const events: Omit<PitEvent, 'id'>[] = []
  let prev: DashboardSnapshot | null = null
  for (const s of snapshots) {
    events.push(...diffEvents(prev, s, peaks))
    prev = s
  }
  return events
}

test('첫 스냅샷은 기준선이라 기록이 없다', () => {
  const first = snap(
    10 * MIN,
    { agents: [agent({ state: 'waiting' })], servers: [server()], heavyJobs: [heavy()] },
    'danger'
  )
  const peaks = new Map<string, number>()
  expect(diffEvents(null, first, peaks)).toEqual([])
  // 기준선에서도 무거운 작업의 메모리는 재기 시작한다.
  expect(peaks.get('heavy:8000:0')).toBe(3 * GB)
})

test('에이전트가 새로 보이면 agent-start(도구·폴더 · 브랜치·선택 키)', () => {
  expect(run(snap(0), snap(MIN, { agents: [agent({ tool: 'codex' })] }))).toEqual([
    {
      t: MIN,
      kind: 'agent-start',
      tool: 'codex',
      where: 'shop-web · develop',
      key: 'agent:5000:100'
    }
  ])
})

test('에이전트가 사라지면 agent-end, 작업 중이었으면 abnormal', () => {
  const working = agent({ pid: 1, state: 'working' })
  const waiting = agent({ pid: 2, state: 'waiting' })
  const idle = agent({ pid: 3, state: 'idle' })
  // CPU 로 짐작한 작업 중은 정확하지 않아 비정상으로 보지 않는다.
  const guessed = agent({ pid: 4, state: 'working', stateSource: 'cpu' })
  const events = run(snap(0, { agents: [working, waiting, idle, guessed] }), snap(MIN))
  expect(events.map((e) => [e.kind, e.key, e.abnormal])).toEqual([
    ['agent-end', 'agent:1:100', true],
    ['agent-end', 'agent:2:100', true],
    ['agent-end', 'agent:3:100', false],
    ['agent-end', 'agent:4:100', false]
  ])
  expect(events[0]).toMatchObject({ t: MIN, tool: 'claude', where: 'shop-web · develop' })
})

test('2분 넘게 일하고 끝나면 agent-done 에 걸린 시간, 짧으면 없다', () => {
  const long = run(
    snap(0, { agents: [agent({ state: 'working', stateSince: 0 })] }),
    snap(3 * MIN, { agents: [agent({ state: 'idle', stateSince: 3 * MIN })] })
  )
  expect(long).toEqual([
    {
      t: 3 * MIN,
      kind: 'agent-done',
      tool: 'claude',
      where: 'shop-web · develop',
      key: 'agent:5000:100',
      ms: 3 * MIN
    }
  ])
  const short = run(
    snap(0, { agents: [agent({ state: 'working', stateSince: 0 })] }),
    snap(MIN, { agents: [agent({ state: 'idle', stateSince: MIN })] })
  )
  expect(short).toEqual([])
})

test('훅 상태가 바뀐 시각을 알면 그 시각에 적는다(스냅샷을 다시 내보낼 때도)', () => {
  // 훅 이벤트로 상태만 바꿔 다시 내보낸 스냅샷은 수집 시각이 그대로다.
  const collected = snap(10 * MIN, { agents: [agent({ state: 'working', stateSince: 0 })] })
  const restated = { ...collected, agents: [agent({ state: 'idle', stateSince: 10.5 * MIN })] }
  expect(run(collected, restated)).toEqual([
    expect.objectContaining({ kind: 'agent-done', t: 10.5 * MIN, ms: 10.5 * MIN })
  ])
})

test('권한 대기·오류로 넘어가거나 조용해지면 적는다', () => {
  const events = run(
    snap(0, { agents: [agent({ pid: 1 }), agent({ pid: 2 }), agent({ pid: 3 })] }),
    snap(MIN, {
      agents: [
        agent({ pid: 1, state: 'waiting', stateSince: 30_000 }),
        agent({ pid: 2, state: 'error', stateSince: 40_000 }),
        agent({ pid: 3, quietSince: 0 })
      ]
    })
  )
  expect(events.map((e) => [e.kind, e.key, e.t])).toEqual([
    ['agent-waiting', 'agent:1:100', 30_000],
    ['agent-error', 'agent:2:100', 40_000],
    ['agent-quiet', 'agent:3:100', MIN]
  ])
  // 그대로 기다리는 중이면 다시 적지 않는다.
  const still = agent({ pid: 1, state: 'waiting', stateSince: 30_000 })
  expect(run(snap(MIN, { agents: [still] }), snap(2 * MIN, { agents: [still] }))).toEqual([])
})

test('새로 보인 에이전트가 이미 권한을 기다리고 있으면 그것도 적는다', () => {
  const events = run(snap(0), snap(MIN, { agents: [agent({ state: 'waiting', stateSince: 0 })] }))
  expect(events.map((e) => e.kind)).toEqual(['agent-start', 'agent-waiting'])
})

test('CPU 추정 상태의 변화는 적지 않는다', () => {
  const cpu = (state: AgentRow['state'], stateSince: number): AgentRow =>
    agent({ state, stateSince, stateSource: 'cpu' })
  expect(
    run(
      snap(0, { agents: [cpu('working', 0)] }),
      snap(5 * MIN, { agents: [cpu('idle', 5 * MIN)] }),
      snap(6 * MIN, { agents: [cpu('working', 6 * MIN)] })
    )
  ).toEqual([])
  // 훅으로 작업 중이던 것이 CPU 추정의 쉬는 중이 돼도 끝났다고 보지 않는다.
  expect(
    run(
      snap(0, { agents: [agent({ state: 'working', stateSince: 0 })] }),
      snap(5 * MIN, { agents: [cpu('idle', 5 * MIN)] })
    )
  ).toEqual([])
})

test('바뀐 것이 없는 스냅샷(디스크 갱신 등으로 다시 내보낸 것)은 기록이 없다', () => {
  const s = snap(0, { agents: [agent()], servers: [server()], heavyJobs: [heavy()] }, 'warn')
  expect(run(s, { ...s, disk: { rows: [], scannedAt: 1, scanning: false, error: null } })).toEqual(
    []
  )
  expect(run(s, { ...s, takenAt: MIN })).toEqual([])
})

test('보이는 서버가 새로 뜨거나 꺼지면 포트 목록과 함께, 숨기기·보이기는 시작·꺼짐이 아니다', () => {
  const a = server()
  const b = server({ pid: 4200, ports: [5173], startedAt: 300, worktree: null })
  expect(run(snap(0, { servers: [a] }), snap(MIN, { servers: [b] }))).toEqual([
    { t: MIN, kind: 'server-start', label: ':5173', key: 'server:4200:300' },
    {
      t: MIN,
      kind: 'server-end',
      where: 'shop-web · develop',
      label: ':3000 · :3001',
      key: 'server:4100:200'
    }
  ])
  expect(run(snap(0, { servers: [a] }), snap(MIN, { hiddenServers: [a] }))).toEqual([])
  expect(run(snap(0, { hiddenServers: [a] }), snap(MIN, { servers: [a] }))).toEqual([])
  // 숨긴 서버는 뜨거나 꺼져도 적지 않는다.
  expect(run(snap(0), snap(MIN, { hiddenServers: [a] }), snap(2 * MIN))).toEqual([])
})

test('무거운 작업이 끝나면 걸린 시간과 그동안의 최대 메모리', () => {
  const job = (commitBytes: number | null, memoryBytes = 2 * GB): HeavyJobRow =>
    heavy({ startedAt: MIN, commitBytes, memoryBytes })
  const peaks = new Map<string, number>()
  const s0 = snap(0)
  const s1 = snap(2 * MIN, { heavyJobs: [job(3 * GB)] })
  const s2 = snap(4 * MIN, { heavyJobs: [job(5 * GB)] })
  // 커밋을 모르면 RAM 으로 잰다.
  const s3 = snap(6 * MIN, { heavyJobs: [job(null, 4 * GB)] })
  const s4 = snap(8 * MIN)
  expect(diffEvents(s0, s1, peaks)).toEqual([
    {
      t: 2 * MIN,
      kind: 'heavy-start',
      label: 'vue-tsc',
      where: 'shop-web · develop',
      key: 'heavy:8000:60000'
    }
  ])
  expect(diffEvents(s1, s2, peaks)).toEqual([])
  expect(diffEvents(s2, s3, peaks)).toEqual([])
  expect(diffEvents(s3, s4, peaks)).toEqual([
    {
      t: 8 * MIN,
      kind: 'heavy-end',
      label: 'vue-tsc',
      where: 'shop-web · develop',
      key: 'heavy:8000:60000',
      ms: 7 * MIN,
      bytes: 5 * GB
    }
  ])
  // 끝난 작업은 더 기억하지 않는다.
  expect(peaks.size).toBe(0)
})

test('메모리 단계가 바뀌면 memory-level', () => {
  expect(
    run(snap(0), snap(MIN, {}, 'warn'), snap(2 * MIN, {}, 'warn'), snap(3 * MIN, {}, 'danger'))
  ).toEqual([
    { t: MIN, kind: 'memory-level', level: 'warn', percent: 85 },
    { t: 3 * MIN, kind: 'memory-level', level: 'danger', percent: 93.6 }
  ])
})

test('stale 스냅샷으로는 사라졌다고 보지 않는다', () => {
  const peaks = new Map<string, number>()
  const before = snap(0, { agents: [agent()], servers: [server()], heavyJobs: [heavy()] })
  const stale = { ...snap(MIN), stale: true }
  expect(diffEvents(before, stale, peaks)).toEqual([])
  expect(diffEvents(stale, before, peaks)).toEqual([])
})

test('기록은 300개까지, 24시간이 지나면 버린다', () => {
  let now = 0
  const added: PitEvent[][] = []
  const log = createEventLog({ now: () => now, onAdded: (events) => added.push(events) })
  now = HOUR
  log.add(
    Array.from({ length: 310 }, (_, i): Omit<PitEvent, 'id'> => ({
      t: HOUR,
      kind: 'server-start',
      count: i
    }))
  )
  expect(log.list()).toHaveLength(300)
  expect(log.list()[0]).toEqual({ id: 11, t: HOUR, kind: 'server-start', count: 10 })
  expect(added[0]).toHaveLength(300)

  now = 24 * HOUR
  log.add([{ t: 24 * HOUR, kind: 'memory-level', level: 'warn', percent: 85 }])
  expect(log.list()).toHaveLength(300)
  expect(added[1]).toEqual([
    { id: 311, t: 24 * HOUR, kind: 'memory-level', level: 'warn', percent: 85 }
  ])

  // 24시간이 지나면 들어올 것이 없어도 버린다.
  now = 25 * HOUR + 1
  expect(log.list()).toEqual([
    { id: 311, t: 24 * HOUR, kind: 'memory-level', level: 'warn', percent: 85 }
  ])
  expect(log.export()).toEqual(log.list())
  // 빈 목록은 알리지 않는다.
  log.add([])
  expect(added).toHaveLength(2)
})

test('불러오기는 모양이 맞는 것만, 24시간이 지난 것은 버리고, id 는 이어서 센다', () => {
  const now = 100 * HOUR
  const log = createEventLog({ now: () => now })
  log.import(
    [
      {
        id: 7,
        t: now - HOUR,
        kind: 'agent-end',
        tool: 'codex',
        where: 'api · main',
        abnormal: true
      },
      { id: 3, t: now - 2 * HOUR, kind: 'cleanup', count: 2, bytes: 1024, extra: 'x' },
      { id: 9, t: now - 25 * HOUR, kind: 'server-start' },
      { id: 4, t: now, kind: 'nope' },
      { id: 5, t: now, kind: 'agent-start', tool: 'cursor' },
      { id: 6, t: now, kind: 'heavy-end', ms: 'x' },
      { id: 8, t: now, kind: 'memory-level', level: 'red' },
      { id: 0, t: now, kind: 'server-end' },
      { id: 10, t: 'x', kind: 'server-end' },
      { id: 11, t: now, kind: 'agent-end', abnormal: 'yes' },
      null
    ],
    now
  )
  expect(log.list()).toStrictEqual([
    { id: 3, t: now - 2 * HOUR, kind: 'cleanup', count: 2, bytes: 1024 },
    { id: 7, t: now - HOUR, kind: 'agent-end', tool: 'codex', where: 'api · main', abnormal: true }
  ])
  log.add([{ t: now, kind: 'server-start' }])
  // 버린 것(24시간 지남)까지 포함해 가장 큰 id 다음부터.
  expect(log.list().map((e) => e.id)).toEqual([3, 7, 10])

  const empty = createEventLog({ now: () => now })
  empty.import('broken', now)
  expect(empty.list()).toEqual([])
})

test('기록 한 줄에 activity(제목·프롬프트·명령)가 들어가지 않는다', () => {
  const activity = {
    title: '결제 화면 리팩터링',
    prompt: '카드 번호 검증을 고쳐 줘',
    tool: { name: 'Bash', summary: 'npm run deploy --token=s3cret', since: 0 },
    waiting: { tool: 'Bash', summary: 'git push --force origin main' }
  }
  const busy = agent({ activity, state: 'working', stateSince: 0 })
  const quietServer = server({ commandLine: 'node secret-server.js --api-key=abc123' })
  const job = heavy({ commandLine: 'node vue-tsc --project private.json' })
  const events = run(
    snap(0),
    snap(MIN, { agents: [busy], servers: [quietServer], heavyJobs: [job] }, 'warn'),
    snap(2 * MIN, { agents: [{ ...busy, state: 'waiting', stateSince: 2 * MIN }] }),
    snap(3 * MIN, { agents: [{ ...busy, stateSince: 3 * MIN, quietSince: 3 * MIN }] }),
    snap(10 * MIN, { agents: [{ ...busy, state: 'idle', stateSince: 10 * MIN }] }),
    snap(11 * MIN)
  )
  expect(new Set(events.map((e) => e.kind))).toEqual(
    new Set([
      'agent-start',
      'agent-waiting',
      'agent-quiet',
      'agent-done',
      'agent-end',
      'server-start',
      'server-end',
      'heavy-start',
      'heavy-end',
      'memory-level'
    ])
  )
  const json = JSON.stringify(events)
  for (const secret of [
    activity.title,
    activity.prompt,
    activity.tool.summary,
    activity.waiting.summary,
    'Bash',
    quietServer.commandLine,
    'secret-server',
    job.commandLine,
    'private.json',
    // 전체 경로도 담지 않는다(폴더 이름 · 브랜치만).
    'C:'
  ])
    expect(json).not.toContain(secret)
})

describe('정리·디스크 지우기 기록', () => {
  const freed = { count: 2, memoryBytes: 1900 * MB, commitBytes: 3900 * MB }

  test('끈 것이 있으면 cleanup(개수·확보한 RAM), 아니면 없음', () => {
    expect(cleanupEvent({ status: 'killed', message: '2개를 껐어요.', freed }, 5)).toEqual({
      t: 5,
      kind: 'cleanup',
      count: 2,
      bytes: 1900 * MB
    })
    expect(cleanupEvent({ status: 'cancelled' }, 5)).toBeNull()
    expect(cleanupEvent({ status: 'failed', message: 'x' }, 5)).toBeNull()
    expect(cleanupEvent({ status: 'killed' }, 5)).toBeNull()
  })

  test('지웠으면 disk-remove(워크트리 폴더 이름·지운 폴더 이름·확보한 크기, 전체 경로는 없음)', () => {
    const removed = {
      status: 'killed' as const,
      freed: { count: 2, memoryBytes: 3000, commitBytes: null, names: ['node_modules', '.venv'] }
    }
    expect(diskRemoveEvent('C:\\work\\feat-gone\\', removed, 5)).toEqual({
      t: 5,
      kind: 'disk-remove',
      where: 'feat-gone',
      label: 'node_modules, .venv',
      bytes: 3000
    })
    expect(diskRemoveEvent('/Users/dev/feat-gone', removed, 5)?.where).toBe('feat-gone')
    expect(diskRemoveEvent('C:\\work\\feat-gone', { status: 'gone' }, 5)).toBeNull()
    // 그 사이 폴더가 이미 없어져 지운 것이 없으면 적지 않는다.
    const nothing = { status: 'killed' as const, freed: { ...removed.freed, count: 0, names: [] } }
    expect(diskRemoveEvent('C:\\work\\feat-gone', nothing, 5)).toBeNull()
  })
})
