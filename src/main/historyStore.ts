import { readFile, rename, rm, writeFile } from 'fs/promises'
import type { AgentState, TrendPoint } from '../shared/types'
import type { ServerHistoryData } from './serverHistory'

const MIN = 60_000
/** 꺼져 있던 시간이 이보다 길면 정리 판단 기억은 버린다(꺼진 동안 쓰였는지 모르므로). */
export const RESUME_JUDGEMENT_MS = 10 * MIN
/** RAM 추이: 30초 간격으로 줄여 2시간. */
const RAM_EVERY_MS = 30_000
const RAM_KEEP_MS = 120 * MIN
const MAX_ENTRIES = 500

const AGENT_STATES: readonly AgentState[] = ['working', 'waiting', 'idle', 'error', 'unknown']

export type ServerMemoData = Record<string, { state: 'idle' | 'tabs'; since: number }>
export type AgentStateData = Record<string, { state: AgentState; since: number }>

/** userData/history.json 의 모양. */
export interface HistoryFile {
  version: 1
  savedAt: number
  ram: TrendPoint[]
  servers: ServerHistoryData
  serverMemo: ServerMemoData
  agentStates: AgentStateData
}

export interface LoadedHistory {
  ram: TrendPoint[]
  servers: ServerHistoryData
  /** 꺼져 있던 시간이 10분을 넘었거나 시계가 뒤로 갔으면 null(판단 기억을 버림). */
  serverMemo: ServerMemoData | null
  agentStates: AgentStateData | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function validPoints(value: unknown): TrendPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is TrendPoint => isRecord(p) && Number.isFinite(p.t) && Number.isFinite(p.value))
    .slice(-MAX_ENTRIES * 2)
    .map((p) => ({ t: p.t, value: p.value }))
}

/** 상태·시각이 맞는 항목만 남긴다. */
function validStates<S extends string>(
  value: unknown,
  states: readonly S[]
): Record<string, { state: S; since: number }> {
  const result: Record<string, { state: S; since: number }> = {}
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!isRecord(entry) || !Number.isFinite(entry.since)) continue
    if (!states.includes(entry.state as S)) continue
    result[key] = { state: entry.state as S, since: entry.since as number }
  }
  return result
}

/**
 * history.json 을 읽는다. 없거나 깨졌거나 형식(버전)이 다르면 null(새로 시작).
 * 저장한 지 10분이 넘었으면(또는 저장 시각이 지금보다 뒤면) 정리 판단 기억은 버리고 기록만 돌려준다.
 */
export async function loadHistory(path: string, now: number): Promise<LoadedHistory | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.version !== 1 || !Number.isFinite(raw.savedAt)) return null
  const savedAt = raw.savedAt as number
  const resume = savedAt <= now && now - savedAt <= RESUME_JUDGEMENT_MS
  return {
    ram: validPoints(raw.ram),
    servers: isRecord(raw.servers) ? (raw.servers as ServerHistoryData) : {},
    serverMemo: resume ? validStates(raw.serverMemo, ['idle', 'tabs'] as const) : null,
    agentStates: resume ? validStates(raw.agentStates, AGENT_STATES) : null
  }
}

/** 임시 파일에 쓰고 바꿔 넣는다(쓰다가 꺼져도 예전 파일이 남는다). config.json 과 같은 방식. */
export async function saveHistory(path: string, data: HistoryFile): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    await writeFile(tmp, JSON.stringify(data))
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/**
 * RAM 사용률 추이(메인 프로세스). 30초에 한 점, 2시간까지. 창을 다시 열거나 앱을 다시 켜도 그래프를 채운다.
 */
export function createRamHistory(): {
  record(t: number, value: number): void
  points(): TrendPoint[]
  import(points: TrendPoint[], now: number): void
} {
  let points: TrendPoint[] = []
  return {
    record(t, value) {
      const last = points[points.length - 1]
      if (last && t - last.t < RAM_EVERY_MS) return
      points = [...points.filter((p) => t - p.t <= RAM_KEEP_MS), { t, value }]
    },
    points() {
      return points.map((p) => ({ ...p }))
    },
    import(list, now) {
      points = validPoints(list)
        .filter((p) => p.t <= now && now - p.t <= RAM_KEEP_MS)
        .sort((a, b) => a.t - b.t)
    }
  }
}
