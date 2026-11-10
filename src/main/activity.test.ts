import { isParked, lastActiveOf, trackSeen, type SeenMemo } from './activity'

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
