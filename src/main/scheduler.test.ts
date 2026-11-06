import { createScheduler } from './scheduler'
import type { DashboardSnapshot } from '../shared/types'

function snap(takenAt: number): DashboardSnapshot {
  return {
    takenAt,
    memory: { totalBytes: 100, usedBytes: 50, usedPercent: 50, level: 'normal' },
    ports: [],
    groups: [],
    agentProcessCount: 0,
    stale: false,
    error: null
  }
}

const intervals = { openMs: 5000, closedMs: 30000 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
})

test('시작하면 바로 수집, 창이 열려 있으면 5초, 닫히면 30초 주기', async () => {
  const collect = vi.fn(async () => snap(Date.now()))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(collect).toHaveBeenCalledTimes(1)
  s.setWindowOpen(true) // 방금 수집했으므로 바로 다시 수집하지 않는다
  await vi.advanceTimersByTimeAsync(4999)
  expect(collect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(5000)
  expect(collect).toHaveBeenCalledTimes(3)
  s.setWindowOpen(false)
  await vi.advanceTimersByTimeAsync(29999)
  expect(collect).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(4)
  s.stop()
})

test('닫혀 있다가 창을 열면, 마지막 수집이 오래됐으면 바로 수집', async () => {
  const collect = vi.fn(async () => snap(Date.now()))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.start()
  await vi.advanceTimersByTimeAsync(20000)
  expect(collect).toHaveBeenCalledTimes(1)
  s.setWindowOpen(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(collect).toHaveBeenCalledTimes(2)
  s.stop()
})

test('수집이 주기보다 길면 겹쳐 실행하지 않고, 끝난 뒤부터 주기를 센다', async () => {
  const collect = vi.fn(() => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(Date.now())), 12000)))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.setWindowOpen(true)
  s.start()
  await vi.advanceTimersByTimeAsync(11999)
  expect(collect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1 + 4999)
  expect(collect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(2)
  s.stop()
})

test('실패하면 마지막 정상 스냅샷을 stale 로 다시 보내고, 다시 성공하면 stale 해제', async () => {
  const sent: DashboardSnapshot[] = []
  let n = 0
  const collect = vi.fn(async () => {
    n++
    if (n === 2) throw new Error('timeout')
    return snap(n)
  })
  const s = createScheduler({ collect, intervals, onSnapshot: (x) => sent.push(x) })
  s.setWindowOpen(true)
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(5000)
  expect(sent[1]).toEqual({ ...snap(1), stale: true, error: 'timeout' })
  await vi.advanceTimersByTimeAsync(5000)
  expect(sent[2]).toEqual(snap(3))
  s.stop()
})

test('첫 수집부터 실패하면 빈 스냅샷을 stale + 에러로 보낸다', async () => {
  const sent: DashboardSnapshot[] = []
  const collect = vi.fn(async () => {
    throw 'boom'
  })
  const s = createScheduler({ collect, intervals, onSnapshot: (x) => sent.push(x) })
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(sent[0]).toMatchObject({ ports: [], groups: [], stale: true, error: 'boom', agentProcessCount: 0 })
  expect(sent[0].memory).toEqual({ totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' })
  s.stop()
})

test('수집 중 refreshNow 는 같은 수집을 기다린다(중복 실행 없음)', async () => {
  const collect = vi.fn(() => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(1)), 1000)))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.start()
  const refreshed = s.refreshNow()
  await vi.advanceTimersByTimeAsync(1000)
  await refreshed
  expect(collect).toHaveBeenCalledTimes(1)
  s.stop()
})

test('refreshNow 는 다음 주기를 그 시점부터 다시 센다', async () => {
  const collect = vi.fn(async () => snap(Date.now()))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.setWindowOpen(true)
  s.start()
  await vi.advanceTimersByTimeAsync(3000)
  await s.refreshNow()
  expect(collect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(4999)
  expect(collect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(3)
  s.stop()
})

test('stop 이후에는 수집하지 않고, 진행 중이던 결과도 보내지 않는다', async () => {
  const sent: DashboardSnapshot[] = []
  const collect = vi.fn(() => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(1)), 1000)))
  const s = createScheduler({ collect, intervals, onSnapshot: (x) => sent.push(x) })
  s.start()
  s.stop()
  await vi.advanceTimersByTimeAsync(60000)
  expect(collect).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([])
})

test('latest() 는 마지막으로 보낸 스냅샷', async () => {
  const collect = vi.fn(async () => snap(7))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  expect(s.latest()).toBeNull()
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(s.latest()).toEqual(snap(7))
  s.stop()
})
