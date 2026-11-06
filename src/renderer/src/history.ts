import type { DashboardSnapshot, PortRow } from '../../shared/types'

/** 하트비트 한 칸: 그 시점에 브라우저 등 연결이 있었으면 up, 열려 있기만 했으면 idle. */
export type Beat = 'up' | 'idle'

export interface Point {
  t: number
  value: number
}

export interface PortHistory {
  beats: Beat[]
  /** 포트를 연 프로세스(+자손) 메모리 바이트. */
  memory: Point[]
}

export interface History {
  lastTakenAt: number | null
  /** RAM 사용률(%). */
  ram: Point[]
  ports: Record<string, PortHistory>
}

export const BEAT_LIMIT = 60
export const POINT_LIMIT = 120

/** 같은 포트를 다른 프로세스가 열면 다른 항목이 되도록 포트와 pid 를 함께 쓴다. */
export function portKey(row: Pick<PortRow, 'port' | 'pid'>): string {
  return `${row.port}:${row.pid}`
}

export function emptyHistory(): History {
  return { lastTakenAt: null, ram: [], ports: {} }
}

function keep<T>(list: T[], item: T, limit: number): T[] {
  return [...list, item].slice(-limit)
}

/**
 * 새 스냅샷을 기록에 더한 새 객체를 돌려준다(원본은 그대로).
 * 지연(stale) 스냅샷은 옛 데이터의 반복이고, 같은 takenAt 은 이미 더한 것이라 건너뛴다.
 */
export function appendSnapshot(history: History, s: DashboardSnapshot): History {
  if (s.stale || s.takenAt === history.lastTakenAt) return history
  const ports: Record<string, PortHistory> = {}
  for (const row of s.ports) {
    const key = portKey(row)
    const prev = history.ports[key] ?? { beats: [], memory: [] }
    ports[key] = {
      beats: keep(prev.beats, row.clientCount > 0 ? 'up' : 'idle', BEAT_LIMIT),
      memory: keep(prev.memory, { t: s.takenAt, value: row.memoryBytes }, POINT_LIMIT)
    }
  }
  return {
    lastTakenAt: s.takenAt,
    ram: keep(history.ram, { t: s.takenAt, value: s.memory.usedPercent }, POINT_LIMIT),
    ports
  }
}
