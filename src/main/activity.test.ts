import type { AgentRow } from '../shared/types'
import {
  EMPTY_DONE,
  isParked,
  lastActiveOf,
  markDoneSeen,
  stillQuiet,
  trackDone,
  trackQuiet,
  trackSeen,
  type CalmMemo,
  type DoneMemo,
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
    ownMemoryBytes: 1,
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
    usage: null,
    waitReason: null,
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

describe('새로 끝남: 작업을 끝냈는데 아직 보지 않은 에이전트', () => {
  /** 정확한 상태(훅)를 아는 에이전트. */
  const row = (
    state: AgentRow['state'],
    stateSince: number,
    over: Partial<AgentRow> = {}
  ): AgentRow => ({
    pid: 1,
    tool: 'claude',
    worktree: null,
    workspace: null,
    startedAt: 100,
    memoryBytes: 1,
    ownMemoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state,
    stateSource: 'hook',
    stateSince,
    cpuPercent: 0.5,
    lastActiveAt: stateSince,
    parked: false,
    activity: null,
    quietSince: null,
    usage: null,
    waitReason: null,
    host: { pids: [], app: null },
    ...over
  })
  /** 수집을 차례로 흉내 낸다: 행마다 trackDone 을 돌려 그때의 doneSince(없으면 null). */
  function run(
    steps: AgentRow[],
    background: (a: AgentRow) => 'paused' | 'woken' | null = () => null
  ): { seen: (number | null)[]; memo: DoneMemo } {
    let memo: DoneMemo = EMPTY_DONE
    const seen = steps.map((a) => {
      const next = trackDone([a], memo, background)
      memo = next.memo
      return next.agents[0].doneSince ?? null
    })
    return { seen, memo }
  }

  test('2분 넘게 일하다 쉬는 중이 되면 끝난 시각을 표시하고, 볼 때까지 남긴다', () => {
    const { seen } = run([
      row('working', 0),
      row('idle', 3 * MIN),
      row('idle', 3 * MIN),
      row('idle', 3 * MIN, { parked: true })
    ])
    expect(seen).toEqual([null, 3 * MIN, 3 * MIN, 3 * MIN])
  })

  test('잠깐(2분 미만) 일한 것은 표시하지 않는다(주고받는 대화마다 뜨지 않게)', () => {
    expect(run([row('working', 0), row('idle', 1 * MIN)]).seen).toEqual([null, null])
    // 꼭 2분이면 표시한다.
    expect(run([row('working', 0), row('idle', 2 * MIN)]).seen).toEqual([null, 2 * MIN])
  })

  test('권한을 기다린 시간도 한 작업으로 센다(작업 중 → 응답 대기 → 작업 중 → 쉬는 중)', () => {
    const { seen } = run([
      row('working', 0),
      row('waiting', 1 * MIN),
      row('working', 1.5 * MIN),
      row('idle', 2.5 * MIN)
    ])
    expect(seen).toEqual([null, null, null, 2.5 * MIN])
  })

  test('다시 일하기 시작하면(새 요청을 보냈다 = 봤다) 표시를 거두고, 그 작업은 처음부터 센다', () => {
    const { seen } = run([
      row('working', 0),
      row('idle', 3 * MIN),
      row('working', 10 * MIN),
      row('idle', 11 * MIN)
    ])
    expect(seen).toEqual([null, 3 * MIN, null, null])
  })

  test('쉬는 중으로 처음 본 에이전트는 표시하지 않는다(일하는 것을 본 적이 없다)', () => {
    expect(run([row('idle', 0), row('idle', 0)]).seen).toEqual([null, null])
  })

  test('CPU 로 짐작한 상태는 표시하지 않는다(잘못 알리기 쉽다)', () => {
    const cpu = { stateSource: 'cpu' as const }
    expect(run([row('working', 0, cpu), row('idle', 3 * MIN, cpu)]).seen).toEqual([null, null])
    // 정확한 상태로 일하다가 CPU 추정으로 넘어간 쉬는 중도 표시하지 않는다.
    expect(run([row('working', 0), row('idle', 3 * MIN, cpu)]).seen).toEqual([null, null])
  })

  test('오류로 끝난 것은 표시하지 않는다(오류 상태가 따로 알린다)', () => {
    expect(run([row('working', 0), row('error', 3 * MIN)]).seen).toEqual([null, null])
    // 오류 뒤에 쉬는 중이 돼도 그 작업은 끝난 것으로 치지 않는다.
    expect(run([row('working', 0), row('error', 3 * MIN), row('idle', 4 * MIN)]).seen).toEqual([
      null,
      null,
      null
    ])
  })

  describe('백그라운드 작업을 남기고 멈춘 에이전트', () => {
    const steps = [
      row('working', 0),
      row('idle', 3 * MIN),
      row('idle', 3 * MIN),
      row('working', 5 * MIN),
      row('idle', 5.5 * MIN)
    ]
    /** 3분에 멈춘 것은 백그라운드 작업을 남겼고, 5분에 다시 일한 것은 wake 가 정한다. */
    const background =
      (wake: 'woken' | null) =>
      (a: AgentRow): 'paused' | 'woken' | null =>
        a.state === 'idle' && a.stateSince === 3 * MIN
          ? 'paused'
          : a.state === 'working'
            ? wake
            : null

    test('멈췄으면 끝난 것으로 표시한다(개발 서버를 띄워 둔 채 끝낸 작업도 놓치지 않게)', () => {
      expect(run(steps.slice(0, 3), background(null)).seen).toEqual([null, 3 * MIN, 3 * MIN])
    })

    test('백그라운드 작업이 깨워 이어 간 작업은 처음부터 이어서 센다(잠깐 일하고 끝나도 표시한다)', () => {
      expect(run(steps, background('woken')).seen).toEqual([
        null,
        3 * MIN,
        3 * MIN,
        null,
        5.5 * MIN
      ])
    })

    test('그 뒤 새 요청으로 시작한 작업은 새로 센다', () => {
      expect(run(steps, background(null)).seen).toEqual([null, 3 * MIN, 3 * MIN, null, null])
    })

    test('표시를 본 것으로 해도 이어 가는 작업은 이어서 센다', () => {
      const first = run(steps.slice(0, 2), background('woken'))
      let memo = markDoneSeen(first.memo, '1:100')
      const seen = steps.slice(2).map((a) => {
        const next = trackDone([a], memo, background('woken'))
        memo = next.memo
        return next.agents[0].doneSince ?? null
      })
      expect(seen).toEqual([null, null, 5.5 * MIN])
    })
  })

  test('본 것으로 표시하면 거두고, 그 뒤에도 다시 뜨지 않는다', () => {
    const first = run([row('working', 0), row('idle', 3 * MIN)])
    const key = '1:100'
    const memo = markDoneSeen(first.memo, key)
    const next = trackDone([row('idle', 3 * MIN)], memo, () => null)
    expect(next.agents[0].doneSince ?? null).toBeNull()
    // 모르는 키는 아무 일도 없다.
    expect(markDoneSeen(first.memo, 'nope')).toEqual(first.memo)
  })

  test('꺼진 에이전트는 기억에서 뺀다', () => {
    const { memo } = run([row('working', 0), row('idle', 3 * MIN)])
    const next = trackDone([], memo, () => 'paused')
    expect(next.memo.unseen.size).toBe(0)
    expect(next.memo.working.size).toBe(0)
    expect(next.memo.held.size).toBe(0)
  })

  test('표시가 없는 행에는 doneSince 를 붙이지 않는다(다른 값은 그대로)', () => {
    const a = row('working', 0)
    expect(trackDone([a], EMPTY_DONE, () => null).agents[0]).toEqual(a)
  })
})
