import { createScheduler } from './scheduler'
import type { DashboardSnapshot } from '../shared/types'
import { blankSnapshot } from '../shared/snapshot'

function snap(takenAt: number): DashboardSnapshot {
  return {
    ...blankSnapshot(takenAt),
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      usedPercent: 50,
      availableBytes: 50,
      level: 'normal',
      ramLevel: 'normal',
      commit: null,
      kernelBytes: null
    }
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
  const collect = vi.fn(
    () => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(Date.now())), 12000))
  )
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
  expect(sent[1]).toEqual({
    ...snap(1),
    stale: true,
    error: '수집 명령이 시간 안에 끝나지 않았어요.'
  })
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
  expect(sent[0]).toMatchObject({
    servers: [],
    groups: [],
    stale: true,
    error: '수집 중 문제가 생겼어요: boom',
    agentProcessCount: 0
  })
  expect(sent[0].memory).toEqual({
    totalBytes: 0,
    usedBytes: 0,
    usedPercent: 0,
    availableBytes: 0,
    level: 'normal',
    ramLevel: 'normal',
    commit: null,
    kernelBytes: null
  })
  s.stop()
})

test('수집 중 refreshNow 는 같은 수집을 기다린다(중복 실행 없음)', async () => {
  const collect = vi.fn(
    () => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(1)), 1000))
  )
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
  const collect = vi.fn(
    () => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(1)), 1000))
  )
  const s = createScheduler({ collect, intervals, onSnapshot: (x) => sent.push(x) })
  s.start()
  s.stop()
  await vi.advanceTimersByTimeAsync(60000)
  expect(collect).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([])
})

describe('수집 제한 시간', () => {
  test('수집이 끝나지 않으면 제한 시간에 지연 표시를 보내고, 끝날 때까지 새 수집을 시작하지 않는다', async () => {
    const sent: DashboardSnapshot[] = []
    let n = 0
    const collect = vi.fn(() =>
      n++ === 0 ? Promise.resolve(snap(1)) : new Promise<DashboardSnapshot>(() => {})
    )
    const s = createScheduler({
      collect,
      intervals,
      collectTimeoutMs: 20000,
      onSnapshot: (x) => sent.push(x)
    })
    s.setWindowOpen(true)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000) // 두 번째 수집 시작(끝나지 않음)
    await vi.advanceTimersByTimeAsync(19999)
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sent[1]).toEqual({ ...snap(1), stale: true, error: '수집이 너무 오래 걸리고 있어요.' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(collect).toHaveBeenCalledTimes(2)
    s.stop()
  })

  test('제한 시간 뒤에라도 수집이 끝나면 그 결과를 보내고 다음 주기를 잡는다', async () => {
    const sent: DashboardSnapshot[] = []
    const collect = vi.fn(
      () => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(Date.now())), 25000))
    )
    const s = createScheduler({
      collect,
      intervals,
      collectTimeoutMs: 20000,
      onSnapshot: (x) => sent.push(x)
    })
    s.setWindowOpen(true)
    s.start()
    await vi.advanceTimersByTimeAsync(20000)
    expect(sent.map((x) => x.stale)).toEqual([true])
    expect(sent[0].error).toBe('수집이 너무 오래 걸리고 있어요.')
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.map((x) => x.stale)).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(5000)
    expect(collect).toHaveBeenCalledTimes(2)
    s.stop()
  })

  test('제한 시간 안에 끝나면 지연 표시를 보내지 않는다', async () => {
    const sent: DashboardSnapshot[] = []
    const collect = vi.fn(
      () => new Promise<DashboardSnapshot>((r) => setTimeout(() => r(snap(1)), 1000))
    )
    const s = createScheduler({
      collect,
      intervals,
      collectTimeoutMs: 20000,
      onSnapshot: (x) => sent.push(x)
    })
    s.start()
    await vi.advanceTimersByTimeAsync(25000)
    expect(sent.every((x) => !x.stale)).toBe(true)
    s.stop()
  })
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

test('publish: 수집 없이 받은 스냅샷을 내보내고 latest 로 삼는다(멈춘 뒤에는 무시)', async () => {
  const onSnapshot = vi.fn()
  const collect = vi.fn(async () => snap(1))
  const s = createScheduler({ collect, intervals, onSnapshot })
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  const restated = { ...snap(1), agentProcessCount: 3 }
  s.publish(restated)
  expect(onSnapshot).toHaveBeenLastCalledWith(restated)
  expect(s.latest()).toBe(restated)
  expect(collect).toHaveBeenCalledTimes(1)
  s.stop()
  s.publish(snap(9))
  expect(s.latest()).toBe(restated)
})

test('setIntervals: 바뀐 주기로 바로 다시 잡는다(이미 지난 시간은 다시 세지 않음)', async () => {
  const collect = vi.fn(async () => snap(Date.now()))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(collect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(8000)
  // 닫힌 창 주기를 30초 → 10초로: 이미 8초 지났으니 2초 뒤에 수집한다.
  s.setIntervals({ openMs: 2000, closedMs: 10000 })
  await vi.advanceTimersByTimeAsync(1999)
  expect(collect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(2)
  // 주기를 늘리면 그만큼 기다린다.
  s.setIntervals({ openMs: 15000, closedMs: 120000 })
  await vi.advanceTimersByTimeAsync(119999)
  expect(collect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(collect).toHaveBeenCalledTimes(3)
  s.stop()
})

test('setIntervals: 창을 열 때 "오래됐는지"도 새 열린 창 주기로 본다', async () => {
  const collect = vi.fn(async () => snap(Date.now()))
  const s = createScheduler({ collect, intervals, onSnapshot: () => {} })
  s.start()
  await vi.advanceTimersByTimeAsync(3000)
  s.setIntervals({ openMs: 2000, closedMs: 10000 })
  s.setWindowOpen(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(collect).toHaveBeenCalledTimes(2)
  s.stop()
})
