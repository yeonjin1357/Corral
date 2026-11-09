import type { AgentState, DashboardSnapshot } from '../../shared/types'
import { agentKey, selectionKey } from '../../shared/keys'

/**
 * 하트비트 한 칸. 서버: 연결이 있었으면 up, 열려 있기만 했으면 idle.
 * 에이전트: 작업 중 up, 권한 대기 pending, 오류 down, 쉬는 중·확인 중 idle(화면 상태 점 색과 같은 뜻).
 */
export type Beat = 'up' | 'idle' | 'pending' | 'down'

export interface Point {
  t: number
  value: number
}

export interface ItemHistory {
  beats: Beat[]
  /** 서버·에이전트(+자손) 메모리 바이트. */
  memory: Point[]
}

export interface History {
  lastTakenAt: number | null
  /** RAM 사용률(%). */
  ram: Point[]
  /** 서버별(서버 선택 키) 연결 하트비트와 메모리. */
  servers: Record<string, ItemHistory>
  /** 에이전트별 상태 하트비트와 메모리(자기 + 자손). */
  agents: Record<string, ItemHistory>
}

export const BEAT_LIMIT = 60
export const POINT_LIMIT = 120

export { agentKey, selectionKey } from '../../shared/keys'

const AGENT_BEAT: Record<AgentState, Beat> = {
  working: 'up',
  waiting: 'pending',
  error: 'down',
  idle: 'idle',
  unknown: 'idle'
}

export function emptyHistory(): History {
  return { lastTakenAt: null, ram: [], servers: {}, agents: {} }
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
  const servers: Record<string, ItemHistory> = {}
  for (const row of s.servers) {
    const key = selectionKey.server(row)
    const prev = history.servers[key] ?? { beats: [], memory: [] }
    servers[key] = {
      beats: keep(prev.beats, row.clientCount > 0 ? 'up' : 'idle', BEAT_LIMIT),
      memory: keep(prev.memory, { t: s.takenAt, value: row.memoryBytes }, POINT_LIMIT)
    }
  }
  const agents: Record<string, ItemHistory> = {}
  for (const row of s.agents) {
    const key = agentKey(row)
    const prev = history.agents[key] ?? { beats: [], memory: [] }
    agents[key] = {
      beats: keep(prev.beats, AGENT_BEAT[row.state], BEAT_LIMIT),
      memory: keep(prev.memory, { t: s.takenAt, value: row.memoryBytes }, POINT_LIMIT)
    }
  }
  return {
    lastTakenAt: s.takenAt,
    ram: keep(history.ram, { t: s.takenAt, value: s.memory.usedPercent }, POINT_LIMIT),
    servers,
    agents
  }
}
