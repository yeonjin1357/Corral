import type { DashboardSnapshot } from '../shared/types'
import { text } from '../shared/text'
import { describeCollectError } from '../shared/format'

export const DEFAULT_COLLECT_TIMEOUT_MS = 20000

export interface Scheduler {
  start(): void
  stop(): void
  setWindowOpen(open: boolean): void
  refreshNow(): Promise<void>
  latest(): DashboardSnapshot | null
}

function emptySnapshot(takenAt: number, error: string): DashboardSnapshot {
  return {
    takenAt,
    memory: { totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' },
    ports: [],
    leftovers: [],
    groups: [],
    agentProcessCount: 0,
    stale: true,
    error
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 수집을 주기적으로 돌린다.
 * - 한 번에 하나만 돈다(수집이 주기보다 길어도 겹쳐 쌓이지 않음). 다음 주기는 수집이 끝난 시점부터 센다.
 * - 창이 열려 있으면 짧게, 닫혀 있으면 길게. 오래 닫혀 있다가 열리면 바로 한 번 수집한다.
 * - 실패하면 마지막 정상 스냅샷을 stale 로 다시 보낸다.
 */
export function createScheduler(o: {
  collect: () => Promise<DashboardSnapshot>
  intervals: { openMs: number; closedMs: number }
  onSnapshot: (s: DashboardSnapshot) => void
  /** 수집이 이 시간을 넘기면 결과를 기다리는 동안 지연 표시(stale)를 먼저 보낸다. */
  collectTimeoutMs?: number
  now?: () => number
}): Scheduler {
  const now = o.now ?? Date.now
  const collectTimeoutMs = o.collectTimeoutMs ?? DEFAULT_COLLECT_TIMEOUT_MS
  let running = false
  let open = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let last: DashboardSnapshot | null = null
  let lastRunAt = Number.NEGATIVE_INFINITY

  const interval = (): number => (open ? o.intervals.openMs : o.intervals.closedMs)

  function clearTimer(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule(): void {
    clearTimer()
    if (!running) return
    const delay = Math.max(0, lastRunAt + interval() - now())
    timer = setTimeout(() => void refreshNow(), delay)
  }

  function emitStale(error: string): void {
    last = last ? { ...last, stale: true, error } : emptySnapshot(now(), error)
    o.onSnapshot(last)
  }

  function refreshNow(): Promise<void> {
    if (inFlight) return inFlight
    clearTimer()
    // 수집이 멈춰도(응답 없는 네트워크 드라이브 등) 화면이 옛 데이터를 최신처럼 보여 주지 않게 지연을 먼저 알린다.
    // 새 수집은 이 수집이 끝날 때까지 시작하지 않는다(한 번에 하나).
    let deadline: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      deadline = null
      if (running) emitStale(text.collectSlow)
    }, collectTimeoutMs)
    inFlight = (async () => {
      try {
        const snapshot = await o.collect()
        if (!running) return
        last = snapshot
        o.onSnapshot(snapshot)
      } catch (e) {
        if (!running) return
        emitStale(describeCollectError(errorMessage(e)))
      } finally {
        if (deadline) clearTimeout(deadline)
        lastRunAt = now()
        inFlight = null
        schedule()
      }
    })()
    return inFlight
  }

  return {
    start() {
      if (running) return
      running = true
      void refreshNow()
    },
    stop() {
      running = false
      clearTimer()
    },
    setWindowOpen(value: boolean) {
      open = value
      if (!running || inFlight) return
      if (value && now() - lastRunAt >= o.intervals.openMs) void refreshNow()
      else schedule()
    },
    refreshNow,
    latest: () => last
  }
}
