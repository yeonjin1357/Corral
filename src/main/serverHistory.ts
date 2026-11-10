import type { MemoryGrowth, ServerRow } from '../shared/types'
import { selectionKey } from '../shared/keys'

const MIN = 60_000
const GB = 1024 ** 3
/** 서버별 메모리 기록 보관 시간과 간격. */
const KEEP_MS = 60 * MIN
const RECORD_EVERY_MS = MIN
/** 메모리 증가 판단 기준(F6): 30분 이상 기록에서 +50% 그리고 +1 GB, 1분 변화의 80% 이상이 줄지 않음. */
const MIN_SPAN_MS = 30 * MIN
const MIN_RATIO = 1.5
const MIN_GROWTH_BYTES = GB
const STEADY_SHARE = 0.8
/** 기록 사이가 이보다 벌어지면(앱이 꺼져 있었음) 끊긴 것으로 보고 그 뒤의 이어진 기록만 판단한다. */
const MAX_GAP_MS = 5 * MIN
/** 불러올 때 받을 서버 수 상한(깨진 파일이 메모리를 잡아먹지 않게). */
const MAX_SERVERS = 200

export interface MemorySample {
  t: number
  bytes: number
}

/** 서버 선택 키 → 메모리 기록(시간 순). history.json 에 그대로 쓴다. */
export type ServerHistoryData = Record<string, MemorySample[]>

/**
 * 최근 60분 기록(5분 넘게 끊겼으면 끊긴 뒤의 이어진 기록)에서 메모리가 계속 늘고 있으면 그 근거. 기록이 30분이 안 되거나, 처음보다 50% 그리고 1 GB 이상
 * 늘지 않았거나, 1분 간격 변화 가운데 줄어든 것이 20% 를 넘으면(오르내리는 캐시 등) null.
 * 샘플은 시간 순이어야 한다.
 */
export function memoryGrowth(samples: MemorySample[], now: number): MemoryGrowth | null {
  const kept = samples.filter((s) => s.t <= now && now - s.t <= KEEP_MS)
  // 꺼져 있던 동안 꾸준히 늘었는지는 모르므로, 마지막으로 끊긴 뒤의 이어진 기록만 본다.
  let from = 0
  for (let i = 1; i < kept.length; i++) if (kept[i].t - kept[i - 1].t > MAX_GAP_MS) from = i
  const recent = kept.slice(from)
  if (recent.length < 2) return null
  const first = recent[0]
  const last = recent[recent.length - 1]
  const span = last.t - first.t
  if (span < MIN_SPAN_MS) return null
  if (last.bytes - first.bytes < MIN_GROWTH_BYTES || last.bytes < first.bytes * MIN_RATIO)
    return null
  let steady = 0
  for (let i = 1; i < recent.length; i++) if (recent[i].bytes >= recent[i - 1].bytes) steady++
  if (steady / (recent.length - 1) < STEADY_SHARE) return null
  return { fromBytes: first.bytes, toBytes: last.bytes, minutes: Math.round(span / MIN) }
}

function validSamples(value: unknown): value is MemorySample[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        Number.isFinite((s as MemorySample).t) &&
        Number.isFinite((s as MemorySample).bytes) &&
        (s as MemorySample).bytes >= 0
    )
  )
}

/**
 * 서버별 메모리 기록(F6). 메인 프로세스가 1분에 한 번 남기고 60분만 보관한다. 지금 없는 서버의 기록은 지운다
 * (서버 키에 시작 시각이 있어 다시 뜬 서버는 새로 센다). history.json 으로 내보내고 불러온다(F8).
 */
export function createServerHistory(): {
  record(servers: Pick<ServerRow, 'pid' | 'startedAt' | 'memoryBytes'>[], now: number): void
  growthOf(key: string, now: number): MemoryGrowth | null
  export(): ServerHistoryData
  import(data: unknown, now: number): void
} {
  let data = new Map<string, MemorySample[]>()

  return {
    record(servers, now) {
      const next = new Map<string, MemorySample[]>()
      for (const row of servers) {
        const key = selectionKey.server(row)
        const list = (data.get(key) ?? []).filter((s) => now - s.t <= KEEP_MS)
        const last = list[list.length - 1]
        if (!last || now - last.t >= RECORD_EVERY_MS) list.push({ t: now, bytes: row.memoryBytes })
        next.set(key, list)
      }
      data = next
    },
    growthOf(key, now) {
      return memoryGrowth(data.get(key) ?? [], now)
    },
    export() {
      return Object.fromEntries([...data].map(([k, v]) => [k, v.map((s) => ({ ...s }))]))
    },
    import(raw, now) {
      const next = new Map<string, MemorySample[]>()
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
          if (next.size >= MAX_SERVERS) break
          if (!key.startsWith('server:') || !validSamples(value)) continue
          const kept = value
            .filter((s) => s.t <= now && now - s.t <= KEEP_MS)
            .map((s) => ({ t: s.t, bytes: s.bytes }))
            .sort((a, b) => a.t - b.t)
          if (kept.length) next.set(key, kept)
        }
      }
      data = next
    }
  }
}
