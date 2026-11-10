import type { AgentRow } from '../shared/types'
import {
  isParked,
  lastActiveOf,
  stillQuiet,
  trackQuiet,
  trackSeen,
  type CalmMemo,
  type SeenMemo
} from './activity'

const MIN = 60_000
const PARKED_MS = 180 * MIN

describe('마지막 활동 시각', () => {
  test('CPU 추정은 마지막으로 작업 중이던 시각, 본 적 없으면 처음 본 시각', () => {
    const cpu = { stateSource: 'cpu' as const, state: 'idle' as const }
    expect(lastActiveOf(cpu, null, { firstSeen: 1000, lastWorking: 5000 })).toBe(5000)
    expect(lastActiveOf(cpu, null, { firstSeen: 1000, lastWorking: null })).toBe(1000)
    // CPU 추정에는 정확한 시각이 없다(넘어와도 쓰지 않는다).
    expect(lastActiveOf(cpu, 9000, { firstSeen: 1000, lastWorking: null })).toBe(1000)
  })

  test('CPU 를 읽지 못해 확인 중인 CPU 추정은 근거가 없어 null', () => {
    const unknown = { stateSource: 'cpu' as const, state: 'unknown' as const }
    expect(lastActiveOf(unknown, null, { firstSeen: 1000, lastWorking: null })).toBeNull()
    expect(lastActiveOf(unknown, 9000, { firstSeen: 1000, lastWorking: 5000 })).toBeNull()
  })

  test('훅·세션 기록·세션 파일은 그 시각, 모르면 pitwall 이 본 기록', () => {
    const seen = { firstSeen: 1000, lastWorking: 3000 }
    const idle = 'idle' as const
    expect(lastActiveOf({ stateSource: 'hook', state: idle }, 7000, seen)).toBe(7000)
    expect(lastActiveOf({ stateSource: 'rollout', state: idle }, 6000, seen)).toBe(6000)
    expect(lastActiveOf({ stateSource: 'file', state: idle }, 5000, seen)).toBe(5000)
    expect(lastActiveOf({ stateSource: 'hook', state: idle }, null, seen)).toBe(3000)
    expect(lastActiveOf({ stateSource: 'file', state: idle }, null, seen)).toBe(3000)
    expect(
      lastActiveOf({ stateSource: 'rollout', state: idle }, null, { ...seen, lastWorking: null })
    ).toBe(1000)
  })
})

describe('본 기록', () => {
  test('처음 본 시각은 그대로, 작업 중이면 마지막 작업 시각을 새로, 사라진 에이전트는 버린다', () => {
    const a = { pid: 1, startedAt: 100 }
    const b = { pid: 2, startedAt: 200 }
    const first = trackSeen(
      [
        { ...a, state: 'working' },
        { ...b, state: 'unknown' }
      ],
      new Map(),
      1000
    )
    expect(first).toEqual(
      new Map([
        ['1:100', { firstSeen: 1000, lastWorking: 1000 }],
        ['2:200', { firstSeen: 1000, lastWorking: null }]
      ])
    )
    const second = trackSeen(
      [
        { ...a, state: 'idle' },
        { ...b, state: 'working' }
      ],
      first,
      2000
    )
    expect(second).toEqual(
      new Map([
        ['1:100', { firstSeen: 1000, lastWorking: 1000 }],
        ['2:200', { firstSeen: 1000, lastWorking: 2000 }]
      ])
    )
    const third: SeenMemo = trackSeen([{ ...b, state: 'idle' }], second, 3000)
    expect([...third.keys()]).toEqual(['2:200'])
    // 같은 pid 라도 시작 시각이 다르면 다른 프로세스다.
    const reused = trackSeen([{ pid: 2, startedAt: 9000, state: 'idle' }], third, 9500)
    expect(reused).toEqual(new Map([['2:9000', { firstSeen: 9500, lastWorking: null }]]))
  })
})

describe('오래 쉬는 세션', () => {
  test('pitwall 이 막 본 에이전트는 오래 쉬는 세션이 아니다', () => {
    const now = 1000 * MIN
    const seen = trackSeen([{ pid: 1, startedAt: 0, state: 'idle' }], new Map(), now)
    expect(seen.get('1:0')?.firstSeen).toBe(now)
    const lastActiveAt = lastActiveOf({ stateSource: 'cpu', state: 'idle' }, null, seen.get('1:0')!)
    expect(isParked({ state: 'idle', lastActiveAt }, now, PARKED_MS)).toBe(false)
  })

  test('작업 중·권한 대기는 아무리 오래여도 아니다', () => {
    const now = 10_000 * MIN
    expect(isParked({ state: 'working', lastActiveAt: 0 }, now, PARKED_MS)).toBe(false)
    expect(isParked({ state: 'waiting', lastActiveAt: 0 }, now, PARKED_MS)).toBe(false)
  })

  test('쉬는 중이고 마지막 활동이 180분 전이면 오래 쉬는 세션', () => {
    const now = 1000 * MIN
    expect(isParked({ state: 'idle', lastActiveAt: now - 180 * MIN }, now, PARKED_MS)).toBe(true)
    expect(isParked({ state: 'idle', lastActiveAt: now - 179 * MIN }, now, PARKED_MS)).toBe(false)
    // 오류로 끝났거나 확인 중인 채로 오래 있어도 마찬가지.
    expect(isParked({ state: 'error', lastActiveAt: now - 200 * MIN }, now, PARKED_MS)).toBe(true)
    expect(isParked({ state: 'unknown', lastActiveAt: now - 200 * MIN }, now, PARKED_MS)).toBe(true)
    // 마지막 활동을 모르면 판단하지 않는다.
    expect(isParked({ state: 'idle', lastActiveAt: null }, now, PARKED_MS)).toBe(false)
  })
})

describe('조용한 에이전트(G3c)', () => {
  /** 훅으로 작업 중이고 CPU 를 거의 쓰지 않는 에이전트(마지막 이벤트 0분). */
  const row = (over: Partial<AgentRow> = {}): AgentRow => ({
    pid: 1,
    tool: 'claude',
    worktree: null,
    workspace: null,
    startedAt: 100,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state: 'working',
    stateSource: 'hook',
    stateSince: 0,
    cpuPercent: 0.5,
    lastActiveAt: 0,
    parked: false,
    activity: null,
    quietSince: null,
    host: { pids: [], app: null },
    ...over
  })
  /** 수집을 차례로 흉내 낸다: [시각, 행] 마다 trackQuiet 를 돌려 그때의 quietSince. */
  const run = (steps: [number, AgentRow][]): (number | null)[] => {
    let memo: CalmMemo = new Map()
    return steps.map(([now, a]) => {
      const next = trackQuiet([a], memo, now)
      memo = next.memo
      return next.agents[0].quietSince
    })
  }

  test('훅으로 작업 중이고 CPU 가 낮은 채 15분이면 조용함', () => {
    // 이벤트는 0분, CPU 가 낮은 것을 처음 본 것은 1분: 그때부터 15분.
    expect(
      run([
        [1 * MIN, row()],
        [15 * MIN, row()],
        [16 * MIN - 1, row()],
        [16 * MIN, row()],
        [40 * MIN, row()]
      ])
    ).toEqual([null, null, null, 1 * MIN, 1 * MIN])
    // 막 켠 pitwall 은 이벤트가 오래전이어도 CPU 가 낮은 것을 직접 본 때부터 센다.
    expect(trackQuiet([row()], new Map(), 60 * MIN).agents[0].quietSince).toBeNull()
    // 기억에는 지금 조건이 이어지는 에이전트만 남는다(사라진 에이전트는 버린다).
    const first = trackQuiet([row()], new Map(), MIN)
    expect(first.memo).toEqual(new Map([['1:100', MIN]]))
    expect(trackQuiet([], first.memo, 2 * MIN).memo.size).toBe(0)
  })

  test('그 사이 CPU 를 쓰면 처음부터', () => {
    expect(
      run([
        [0, row()],
        // 작업 기준(2%)에 닿으면 CPU 를 쓴 것이다.
        [10 * MIN, row({ cpuPercent: 2 })],
        [11 * MIN, row()],
        [25 * MIN, row()],
        [26 * MIN, row()]
      ])
    ).toEqual([null, null, null, null, 11 * MIN])
  })

  test('그 사이 이벤트가 오면 그 시각부터 다시 센다', () => {
    expect(
      run([
        [0, row()],
        [10 * MIN, row({ lastActiveAt: 5 * MIN })],
        [20 * MIN - 1, row({ lastActiveAt: 5 * MIN })],
        [20 * MIN, row({ lastActiveAt: 5 * MIN })],
        // 조용하던 에이전트도 새 이벤트가 오면 다시 센다.
        [36 * MIN, row({ lastActiveAt: 30 * MIN })],
        [45 * MIN, row({ lastActiveAt: 30 * MIN })]
      ])
    ).toEqual([null, null, null, 5 * MIN, null, 30 * MIN])
  })

  test('CPU 추정·세션 기록 상태, 쉬는 중·권한 대기에는 붙지 않는다', () => {
    const cases: Partial<AgentRow>[] = [
      { stateSource: 'cpu' },
      { stateSource: 'rollout' },
      { stateSource: 'file' },
      { state: 'idle' },
      { state: 'waiting' }
    ]
    for (const over of cases) {
      expect(
        run([
          [0, row(over)],
          [30 * MIN, row(over)]
        ])
      ).toEqual([null, null])
      // 조건이 끊기면 기억에서 뺀다.
      const next = trackQuiet([row(over)], new Map([['1:100', 0]]), 30 * MIN)
      expect(next.agents[0].quietSince).toBeNull()
      expect(next.memo.size).toBe(0)
    }
  })

  test('CPU 를 모르면(null) 붙지 않는다', () => {
    expect(trackQuiet([row({ cpuPercent: null })], new Map(), 30 * MIN).agents[0].quietSince).toBe(
      null
    )
    // 모르는 동안은 이어지지 않는다: 다시 낮은 것을 본 때부터 센다.
    expect(
      run([
        [0, row()],
        [10 * MIN, row({ cpuPercent: null })],
        [15 * MIN, row()],
        [30 * MIN - 1, row()],
        [30 * MIN, row()]
      ])
    ).toEqual([null, null, null, null, 15 * MIN])
  })

  test('수집 사이에는 새 이벤트가 왔거나 더는 훅으로 작업 중이 아니면 지운다', () => {
    const quiet = row({ lastActiveAt: 0, quietSince: MIN })
    expect(stillQuiet(quiet)).toBe(MIN)
    expect(stillQuiet({ ...quiet, lastActiveAt: MIN })).toBe(MIN)
    expect(stillQuiet({ ...quiet, lastActiveAt: 20 * MIN })).toBeNull()
    expect(stillQuiet({ ...quiet, state: 'idle' })).toBeNull()
    expect(stillQuiet({ ...quiet, state: 'waiting' })).toBeNull()
    expect(stillQuiet({ ...quiet, stateSource: 'file' })).toBeNull()
    expect(stillQuiet(row())).toBeNull()
  })
})
