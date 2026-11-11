import {
  POINT_LIMIT,
  agentKey,
  appendSnapshot,
  emptyHistory,
  seedGroups,
  seedRam,
  selectionKey,
  splitAtGaps
} from './history'
import { GB, MB, agentRow, leftoverRow, serverRow, snapshot } from './testing/fixtures'
import type { GroupPoint } from '../../shared/types'

test('서버별 하트비트: 연결 있으면 up, 없으면 idle, 최신이 맨 뒤', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1, servers: [serverRow({ clientCount: 1 })] }))
  h = appendSnapshot(h, snapshot({ takenAt: 2, servers: [serverRow({ clientCount: 0 })] }))
  expect(h.servers[selectionKey.server(serverRow())].beats).toEqual(['up', 'idle'])
  expect(h.servers[selectionKey.server(serverRow())].memory.map((p) => p.t)).toEqual([1, 2])
})

test('RAM 추이는 사용률(%)로 쌓는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1 }))
  expect(h.ram).toEqual([{ t: 1, value: 82.2 }])
})

test('같은 takenAt 스냅샷(getLatest 와 구독이 같은 것을 줄 때)은 한 번만 쌓는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 5 }))
  h = appendSnapshot(h, snapshot({ takenAt: 5 }))
  expect(h.ram).toHaveLength(1)
})

test('지연(stale) 스냅샷은 옛 데이터의 반복이라 쌓지 않는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1 }))
  h = appendSnapshot(h, snapshot({ takenAt: 1, stale: true, error: 'timeout' }))
  h = appendSnapshot(h, snapshot({ takenAt: 9, stale: true, error: 'timeout' }))
  expect(h.ram).toHaveLength(1)
})

test('개수 제한: 하트비트 60개, 그래프 점 120개', () => {
  let h = emptyHistory()
  for (let i = 1; i <= 130; i++) h = appendSnapshot(h, snapshot({ takenAt: i }))
  const p = h.servers[selectionKey.server(serverRow())]
  expect(p.beats).toHaveLength(60)
  expect(p.memory).toHaveLength(120)
  expect(p.memory[0].t).toBe(11)
  // RAM 은 최근 120점이 그대로이고, 그보다 오래된 것은 30초에 하나만 남는다(여기서는 1~10ms 가 한 칸).
  expect(h.ram.slice(-120)[0].t).toBe(11)
  expect(h.ram).toHaveLength(121)
})

test('RAM 추이: 최근 120점은 그대로, 그보다 오래된 것은 30초에 하나씩 2시간까지(메모리 상세의 2시간 그래프)', () => {
  const SEC = 1000
  const HOUR = 3600 * SEC
  let h = emptyHistory()
  const steps = (3 * HOUR) / (5 * SEC)
  for (let i = 0; i <= steps; i++) h = appendSnapshot(h, snapshot({ takenAt: i * 5 * SEC }))
  const last = steps * 5 * SEC
  const recent = h.ram.slice(-120)
  expect(recent.every((p, i) => i === 0 || p.t - recent[i - 1].t === 5 * SEC)).toBe(true)
  const older = h.ram.slice(0, -120)
  expect(older[0].t).toBeGreaterThanOrEqual(last - 2 * HOUR)
  expect(older[0].t).toBeLessThan(last - 2 * HOUR + 30 * SEC)
  expect(older.every((p, i) => i === 0 || p.t - older[i - 1].t >= 30 * SEC)).toBe(true)
})

test('앱이 기억한 2시간 RAM 기록(30초 간격 240점)을 자르지 않고 채운다', () => {
  const seeds = Array.from({ length: 240 }, (_, i) => ({ t: i * 30_000, value: 50 }))
  expect(seedRam(emptyHistory(), seeds).ram).toHaveLength(240)
})

test('사라진 서버의 기록은 지운다(다른 pid 가 열면 새 기록)', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1, servers: [serverRow({ pid: 1 })] }))
  h = appendSnapshot(h, snapshot({ takenAt: 2, servers: [serverRow({ pid: 2 })] }))
  expect(Object.keys(h.servers)).toEqual([selectionKey.server(serverRow({ pid: 2 }))])
  expect(h.servers[selectionKey.server(serverRow({ pid: 2 }))].beats).toHaveLength(1)
})

test('원래 기록 객체는 바꾸지 않는다(Vue 반응성이 새 객체로 바뀐 것을 알도록)', () => {
  const h = appendSnapshot(emptyHistory(), snapshot({ takenAt: 1 }))
  const before = JSON.stringify(h)
  appendSnapshot(h, snapshot({ takenAt: 2 }))
  expect(JSON.stringify(h)).toBe(before)
})

describe('에이전트 기록', () => {
  test('상태를 하트비트로: 작업 중 up, 권한 대기 pending, 오류 down, 쉬는 중·확인 중 idle', () => {
    let h = emptyHistory()
    const states = ['working', 'waiting', 'error', 'idle', 'unknown'] as const
    states.forEach((state, i) => {
      h = appendSnapshot(h, snapshot({ takenAt: i + 1, agents: [agentRow({ state })] }))
    })
    const a = h.agents[agentKey(agentRow())]
    expect(a.beats).toEqual(['up', 'pending', 'down', 'idle', 'idle'])
    expect(a.memory.map((p) => p.t)).toEqual([1, 2, 3, 4, 5])
  })

  test('같은 pid 라도 시작 시각이 다르면 다른 기록, 사라진 에이전트 기록은 지운다', () => {
    let h = emptyHistory()
    h = appendSnapshot(h, snapshot({ takenAt: 1, agents: [agentRow({ startedAt: 1 })] }))
    h = appendSnapshot(h, snapshot({ takenAt: 2, agents: [agentRow({ startedAt: 2 })] }))
    expect(Object.keys(h.agents)).toEqual([agentKey(agentRow({ startedAt: 2 }))])
  })
})

test('고른 항목 키는 종류를 앞에 붙여 서로 겹치지 않는다', () => {
  expect(selectionKey.server(serverRow())).toBe('server:4100:200')
  expect(selectionKey.agent(agentRow())).toBe('agent:5000:100')
  expect(selectionKey.leftover(leftoverRow())).toBe('leftover:7000:300')
})

test('앱이 기억한 RAM 기록으로 처음 추이를 채운다(겹치는 시각은 한 번, 시간 순)', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 100 }))
  h = seedRam(h, [
    { t: 40, value: 60 },
    { t: 100, value: 99 },
    { t: 70, value: 65 }
  ])
  expect(h.ram).toEqual([
    { t: 40, value: 60 },
    { t: 70, value: 65 },
    { t: 100, value: 82.2 }
  ])
  // 기록이 없으면 그대로.
  expect(seedRam(h, [])).toBe(h)
})

test('스냅샷마다 묶음 점을 더하고 메인 기록으로 처음 채운다', () => {
  // fixtures 의 snapshot(): 개발 서버 2200 MB·에이전트 500 MB·무거운 작업 0·다른 앱 18 GB·시스템 2 GB.
  const at = (t: number): GroupPoint => ({
    t,
    devServer: 2200 * MB,
    agent: 500 * MB,
    heavy: 0,
    otherApps: 18 * GB,
    system: 2 * GB
  })
  let h = emptyHistory()
  expect(h.groups).toEqual([])
  h = appendSnapshot(h, snapshot({ takenAt: 100 }))
  // 같은 takenAt·지연 스냅샷은 RAM 처럼 건너뛴다.
  h = appendSnapshot(h, snapshot({ takenAt: 100 }))
  h = appendSnapshot(h, snapshot({ takenAt: 105, stale: true, error: 'timeout' }))
  expect(h.groups).toEqual([at(100)])

  // 메인이 기억한 기록으로 채운다: 겹치는 시각은 방금 받은 점을 쓰고 시간 순.
  h = seedGroups(h, [{ ...at(70), devServer: 1 }, { ...at(100), devServer: 99 }, at(40)])
  expect(h.groups).toEqual([at(40), { ...at(70), devServer: 1 }, at(100)])
  expect(seedGroups(h, [])).toBe(h)

  // RAM 과 같은 규칙으로 솎는다: 최근 120점은 그대로, 그보다 오래된 것은 30초에 하나, 2시간까지.
  const SEC = 1000
  let long = emptyHistory()
  for (let i = 0; i <= (3 * 3600) / 5; i++)
    long = appendSnapshot(long, snapshot({ takenAt: i * 5 * SEC }))
  expect(long.groups.map((p) => p.t)).toEqual(long.ram.map((p) => p.t))
  expect(
    long.groups.slice(-POINT_LIMIT).every((p, i, all) => i === 0 || p.t - all[i - 1].t === 5 * SEC)
  ).toBe(true)
  // 앱이 기억한 2시간 기록(30초 간격 240점)은 자르지 않는다.
  const seeds = Array.from({ length: 240 }, (_, i) => at(i * 30_000))
  expect(seedGroups(emptyHistory(), seeds).groups).toHaveLength(240)
})

test('묶음 점은 메모리 카드·지도와 같이 사용량에 맞춰 줄인 값(그래프 맨 위가 사용량을 넘지 않게)', () => {
  const s = snapshot({
    takenAt: 1,
    memory: { ...snapshot().memory, totalBytes: 32 * GB, usedBytes: 10 * GB },
    groups: [
      { group: 'devServer', memoryBytes: 4 * GB, commitBytes: null, processCount: 1 },
      { group: 'otherApps', memoryBytes: 16 * GB, commitBytes: null, processCount: 1 }
    ]
  })
  // 묶음 합 20 GB > 사용 10 GB → 모두 절반.
  expect(appendSnapshot(emptyHistory(), s).groups).toEqual([
    { t: 1, devServer: 2 * GB, agent: 0, heavy: 0, otherApps: 8 * GB, system: 0 }
  ])
})

describe('끊긴 곳에서 나누기(추이 그래프가 같이 쓴다)', () => {
  const at = (...ts: number[]): { t: number }[] => ts.map((t) => ({ t }))

  test('끊김이 없으면 한 구간', () => {
    expect(splitAtGaps(at(0, 10, 20), 60)).toEqual([at(0, 10, 20)])
  })

  test('gapMs 보다 벌어진 곳에서 나눈다(같은 간격은 잇는다)', () => {
    expect(splitAtGaps(at(0, 10, 100, 160, 300), 60)).toEqual([at(0, 10), at(100, 160), at(300)])
  })

  test('gapMs 가 없거나(null·undefined) 0 이하면 나누지 않는다', () => {
    for (const gap of [null, undefined, 0, -1])
      expect(splitAtGaps(at(0, 1_000_000), gap)).toEqual([at(0, 1_000_000)])
  })

  test('기록이 없으면 구간도 없다', () => {
    expect(splitAtGaps([], 60)).toEqual([])
  })
})
