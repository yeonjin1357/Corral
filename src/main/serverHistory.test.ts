import { createServerHistory, memoryGrowth } from './serverHistory'
import type { ServerRow } from '../shared/types'

const MIN = 60_000
const GB = 1024 ** 3

/** 1분 간격 메모리 기록. values 는 GB. */
function series(values: number[], start = 0): { t: number; bytes: number }[] {
  return values.map((gb, i) => ({ t: start + i * MIN, bytes: Math.round(gb * GB) }))
}

/** from → to 로 1분마다 고르게 오른다. */
function rising(from: number, to: number, minutes: number): number[] {
  return Array.from({ length: minutes + 1 }, (_, i) => from + ((to - from) * i) / minutes)
}

describe('memoryGrowth', () => {
  test('30분 동안 +50% 그리고 +1GB 이고 대부분 줄지 않으면 메모리 증가', () => {
    const s = series(rising(2, 3.6, 30))
    expect(memoryGrowth(s, 30 * MIN)).toEqual({
      fromBytes: 2 * GB,
      toBytes: Math.round(3.6 * GB),
      minutes: 30
    })
  })

  test('기록이 5분 넘게 끊겼으면(앱을 껐다 켬) 끊긴 뒤의 이어진 기록만 본다', () => {
    // 10분 평평 → 앱이 25분 꺼짐(그 사이 한 번에 오름) → 10분 평평. 꺼진 동안 꾸준히 늘었는지 모른다.
    const before = series(Array(11).fill(2), 0)
    const after = series(Array(11).fill(3.5), 35 * MIN)
    expect(memoryGrowth([...before, ...after], 45 * MIN)).toBeNull()
  })

  test('끊긴 뒤 이어진 기록이 30분 넘게 늘면 그 구간으로 판단한다', () => {
    const before = series(Array(5).fill(1), 0)
    const after = series(rising(2, 3.6, 30), 20 * MIN)
    expect(memoryGrowth([...before, ...after], 50 * MIN)).toEqual({
      fromBytes: 2 * GB,
      toBytes: Math.round(3.6 * GB),
      minutes: 30
    })
  })

  test('30분이 안 되면 아직 판단하지 않는다', () => {
    expect(memoryGrowth(series(rising(2, 4, 29)), 29 * MIN)).toBeNull()
  })

  test('오르내림이 크면(줄어든 변화가 20% 넘음) 아니다', () => {
    // 2 → 4 GB 로 늘었지만 30번 변화 중 7번이 줄었다(23%).
    const values = rising(2, 4, 30).map((v, i) => (i % 4 === 3 ? v - 0.2 : v))
    expect(values.slice(1).filter((v, i) => v < values[i]).length).toBeGreaterThan(6)
    expect(memoryGrowth(series(values), 30 * MIN)).toBeNull()
  })

  test('1GB 미만 증가는 아니다', () => {
    // 1 → 1.9 GB: 90% 늘었지만 0.9 GB.
    expect(memoryGrowth(series(rising(1, 1.9, 30)), 30 * MIN)).toBeNull()
  })

  test('50% 미만 증가는 아니다', () => {
    // 4 → 5.9 GB: 1.9 GB 늘었지만 47.5%.
    expect(memoryGrowth(series(rising(4, 5.9, 30)), 30 * MIN)).toBeNull()
  })

  test('60분보다 오래된 기록은 보지 않는다', () => {
    const old = series([0.5])
    const recent = series(rising(3, 3.2, 40), 30 * MIN)
    // 0.5 GB(70분 전)부터 보면 늘었지만, 최근 60분(3 → 3.2 GB)은 아니다.
    expect(memoryGrowth([...old, ...recent], 70 * MIN)).toBeNull()
  })
})

describe('createServerHistory', () => {
  const row = (
    bytes: number,
    pid = 4100,
    commitBytes: number | null = null
  ): Pick<ServerRow, 'pid' | 'startedAt' | 'memoryBytes' | 'commitBytes'> => ({
    pid,
    startedAt: 1,
    memoryBytes: bytes,
    commitBytes
  })

  test('서버마다 1분에 한 번 기록하고 60분만 보관, 사라진 서버는 지운다', () => {
    const h = createServerHistory()
    for (let t = 0; t <= 70 * MIN; t += 20_000) h.record([row(t)], t)
    const data = h.export()
    const samples = data['server:4100:1']
    expect(samples[0].t).toBeGreaterThanOrEqual(10 * MIN)
    expect(samples.every((s, i) => i === 0 || s.t - samples[i - 1].t >= MIN)).toBe(true)
    h.record([row(1, 9)], 71 * MIN)
    expect(Object.keys(h.export())).toEqual(['server:9:1'])
  })

  test('계속 느는 서버는 growthOf 가 근거를 준다', () => {
    const h = createServerHistory()
    rising(2, 3.6, 30).forEach((gb, i) => h.record([row(Math.round(gb * GB))], i * MIN))
    expect(h.growthOf('server:4100:1', 30 * MIN)?.minutes).toBe(30)
    expect(h.growthOf('server:1:1', 30 * MIN)).toBeNull()
  })

  test('커밋이 있으면 커밋으로 적는다', () => {
    const h = createServerHistory()
    h.record([row(GB, 4100, 3 * GB), row(GB, 9)], 0)
    expect(h.export()).toStrictEqual({
      'server:4100:1': [{ t: 0, bytes: 3 * GB, commit: true }],
      // 커밋을 모르면(macOS·보조 코드가 막힌 PC) 작업 세트로.
      'server:9:1': [{ t: 0, bytes: GB }]
    })
  })

  test('작업 세트 기록 뒤에 커밋 기록이 이어지면 처음부터 다시 센다(가짜 증가 없음)', () => {
    const h = createServerHistory()
    for (let m = 0; m <= 35; m++) h.record([row(GB)], m * MIN)
    h.record([row(GB, 4100, 4 * GB)], 36 * MIN)
    expect(h.growthOf('server:4100:1', 36 * MIN)).toBeNull()
    expect(h.export()['server:4100:1']).toStrictEqual([
      { t: 36 * MIN, bytes: 4 * GB, commit: true }
    ])
    // 커밋을 다시 모르게 돼도 처음부터 센다.
    h.record([row(GB)], 37 * MIN)
    expect(h.export()['server:4100:1']).toStrictEqual([{ t: 37 * MIN, bytes: GB }])
  })

  test('불러오기는 형식이 맞는 기록만, 60분 안의 것만 받는다', () => {
    const h = createServerHistory()
    h.import(
      {
        'server:1:1': [
          { t: 0, bytes: 1 },
          { t: 50 * MIN, bytes: 2 }
        ],
        'server:2:2': 'broken',
        'server:3:3': [{ t: 'x', bytes: 1 }]
      } as never,
      100 * MIN
    )
    expect(h.export()).toEqual({ 'server:1:1': [{ t: 50 * MIN, bytes: 2 }] })
  })

  test('불러오기는 커밋 표시를 지키고, 종류가 섞인 기록은 마지막 종류로 이어진 부분만 받는다', () => {
    const h = createServerHistory()
    h.import(
      {
        'server:1:1': [
          { t: 10 * MIN, bytes: 1 },
          { t: 20 * MIN, bytes: 4, commit: true },
          { t: 30 * MIN, bytes: 5, commit: true }
        ],
        'server:2:2': [{ t: 30 * MIN, bytes: 1, commit: false }],
        'server:3:3': [{ t: 30 * MIN, bytes: 1, commit: 'yes' }]
      } as never,
      40 * MIN
    )
    expect(h.export()).toStrictEqual({
      'server:1:1': [
        { t: 20 * MIN, bytes: 4, commit: true },
        { t: 30 * MIN, bytes: 5, commit: true }
      ],
      'server:2:2': [{ t: 30 * MIN, bytes: 1 }]
    })
  })
})
