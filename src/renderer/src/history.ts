import type { AgentState, DashboardSnapshot, GroupPoint, TrendPoint } from '../../shared/types'
import { agentKey, selectionKey } from '../../shared/keys'
import { fitGroups, groupPoint } from '../../shared/memoryGroups'

/**
 * 하트비트 한 칸. 서버: 연결이 있었으면 up, 열려 있기만 했으면 idle.
 * 에이전트: 작업 중 up, 응답 대기 pending, 오류 down, 쉬는 중·확인 중 idle(화면 상태 점 색과 같은 뜻).
 */
export type Beat = 'up' | 'idle' | 'pending' | 'down'

export type Point = TrendPoint

export interface ItemHistory {
  beats: Beat[]
  /** 서버·에이전트(+자손) 메모리 바이트. */
  memory: Point[]
}

export interface History {
  lastTakenAt: number | null
  /** RAM 사용률(%). */
  ram: Point[]
  /** 묶음별 메모리 바이트(G6, 메모리 상세의 묶음별 추이). RAM 과 같은 규칙으로 쌓고 솎는다. */
  groups: GroupPoint[]
  /** 서버별(서버 선택 키) 연결 하트비트와 메모리. */
  servers: Record<string, ItemHistory>
  /** 에이전트별 상태 하트비트와 메모리(자기 + 자손). */
  agents: Record<string, ItemHistory>
}

export const BEAT_LIMIT = 60
export const POINT_LIMIT = 120
/** RAM 추이 보관 시간(메모리 상세의 그래프 가로축). 앱(메인)이 기억하는 기록과 같다. */
export const RAM_KEEP_MS = 2 * 60 * 60 * 1000
/** 최근 POINT_LIMIT 점보다 오래된 RAM 기록은 이 간격에 하나만 둔다(메인 기록과 같은 30초). */
const RAM_BUCKET_MS = 30_000

/**
 * RAM·묶음 기록을 줄인다: 가장 새 점에서 2시간 안의 것만, 최근 POINT_LIMIT 점은 그대로(작은 그래프의 가로축),
 * 그보다 오래된 것은 30초 칸마다 첫 점 하나. 시간 순이어야 한다.
 */
function thin<P extends { t: number }>(points: P[]): P[] {
  if (points.length === 0) return points
  const cutoff = points[points.length - 1].t - RAM_KEEP_MS
  const fineFrom = Math.max(0, points.length - POINT_LIMIT)
  const out: P[] = []
  let lastBucket: number | null = null
  for (let i = 0; i < fineFrom; i++) {
    const p = points[i]
    if (p.t < cutoff) continue
    const bucket = Math.floor(p.t / RAM_BUCKET_MS)
    if (bucket === lastBucket) continue
    lastBucket = bucket
    out.push(p)
  }
  for (let i = fineFrom; i < points.length; i++) if (points[i].t >= cutoff) out.push(points[i])
  return out
}

/**
 * 이웃한 기록이 gapMs 보다 벌어진 곳(앱이 꺼져 있었음)에서 나눈 이어진 구간들(추이 그래프가 그 사이를 잇지 않게).
 * gapMs 가 없거나(null·undefined) 0 이하면 나누지 않는다. 시간 순이어야 한다.
 */
export function splitAtGaps<P extends { t: number }>(
  points: P[],
  gapMs: number | null | undefined
): P[][] {
  const out: P[][] = []
  for (const p of points) {
    const seg = out[out.length - 1]
    const prev = seg?.[seg.length - 1]
    if (!seg || (gapMs != null && gapMs > 0 && prev && p.t - prev.t > gapMs)) out.push([p])
    else seg.push(p)
  }
  return out
}

export { agentKey, selectionKey } from '../../shared/keys'

const AGENT_BEAT: Record<AgentState, Beat> = {
  working: 'up',
  waiting: 'pending',
  error: 'down',
  idle: 'idle',
  unknown: 'idle'
}

export function emptyHistory(): History {
  return { lastTakenAt: null, ram: [], groups: [], servers: {}, agents: {} }
}

/** 앱(메인)이 기억한 점과 지금 기록을 시각으로 합친다. 같은 시각은 지금 기록(방금 받은 스냅샷)을 쓴다. */
function merge<P extends { t: number }>(seeds: P[], have: P[]): P[] {
  const byTime = new Map<number, P>()
  for (const p of seeds) byTime.set(p.t, p)
  for (const p of have) byTime.set(p.t, p)
  return thin([...byTime.values()].sort((a, b) => a.t - b.t))
}

/**
 * 앱(메인)이 기억한 RAM 기록으로 추이를 채운다. 창을 다시 열거나 앱을 다시 켰을 때 그래프가 빈 채로 시작하지 않게.
 * 같은 시각은 이미 있는 점(방금 받은 스냅샷)을 쓰고, 시간 순으로 2시간까지 둔다(thin).
 */
export function seedRam(history: History, points: Point[]): History {
  if (points.length === 0) return history
  const seeds = points.map((p) => ({ t: p.t, value: p.value }))
  return { ...history, ram: merge(seeds, history.ram) }
}

/** 앱(메인)이 기억한 묶음 기록으로 묶음별 추이를 채운다(seedRam 과 같은 규칙). */
export function seedGroups(history: History, points: GroupPoint[]): History {
  if (points.length === 0) return history
  const seeds = points.map((p) => ({
    t: p.t,
    devServer: p.devServer,
    agent: p.agent,
    heavy: p.heavy,
    otherApps: p.otherApps,
    system: p.system
  }))
  return { ...history, groups: merge(seeds, history.groups) }
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
    ram: thin([...history.ram, { t: s.takenAt, value: s.memory.usedPercent }]),
    // 메인 기록과 같이 사용량에 맞춰 줄인 값(메모리 카드·지도와 같은 값).
    groups: thin([...history.groups, groupPoint(s.takenAt, fitGroups(s.memory, s.groups))]),
    servers,
    agents
  }
}
