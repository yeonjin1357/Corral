import { readFile, rename, rm, writeFile } from 'fs/promises'
import type { AgentState, GroupPoint, GroupUsage, TrendPoint } from '../shared/types'
import type { PitEvent } from '../shared/events'
import { groupPoint } from '../shared/memoryGroups'
import type { ServerHistoryData } from './serverHistory'

const MIN = 60_000
/** 꺼져 있던 시간이 이보다 길면 정리 판단 기억은 버린다(꺼진 동안 쓰였는지 모르므로). */
export const RESUME_JUDGEMENT_MS = 10 * MIN
/** RAM·묶음 추이: 30초 간격으로 줄여 2시간. */
const RAM_EVERY_MS = 30_000
const RAM_KEEP_MS = 120 * MIN
const MAX_ENTRIES = 500

const AGENT_STATES: readonly AgentState[] = ['working', 'waiting', 'idle', 'error', 'unknown']

/** 서버별 정리 판단 기억. shielded: 지난 샘플에 활동 중인 에이전트가 그 서버를 덮고 있었는지. */
export type ServerMemoData = Record<
  string,
  { state: 'idle' | 'tabs'; since: number; shielded?: boolean }
>
export type AgentStateData = Record<string, { state: AgentState; since: number }>
/** 에이전트별 pitwall 이 처음 본 시각·마지막으로 작업 중으로 본 시각(G2, CPU 추정의 마지막 활동). */
export type AgentSeenData = Record<string, { firstSeen: number; lastWorking: number | null }>

/**
 * userData/history.json 의 모양. version 2: 서버 메모리 기록이 커밋(알 때)으로 바뀌었다.
 * version 1 의 작업 세트 기록 뒤에 커밋 기록을 이어 붙이면 가짜 메모리 증가가 되므로 예전 파일은 버린다.
 * 나중에 더한 칸은 판을 올리지 않는다: 예전 버전은 모르는 칸을 버리고 읽으므로 기록이 사라지지 않는다.
 */
export interface HistoryFile {
  version: 2
  savedAt: number
  ram: TrendPoint[]
  /** 묶음별 메모리 추이(G6). 나중에 더한 값이라 예전에 저장한 파일에는 없다. */
  groups?: GroupPoint[]
  servers: ServerHistoryData
  serverMemo: ServerMemoData
  agentStates: AgentStateData
  /** 나중에 더한 값이라 예전에 저장한 파일에는 없다. */
  agentSeen?: AgentSeenData
  /** 기록(G3g). 나중에 더한 값이라 예전에 저장한 파일에는 없다. */
  events?: PitEvent[]
}

export interface LoadedHistory {
  ram: TrendPoint[]
  /** 묶음별 메모리 추이(G6). 없거나(예전 파일) 모양이 틀린 점은 버린다. */
  groups: GroupPoint[]
  servers: ServerHistoryData
  /** 꺼져 있던 시간이 10분을 넘었거나 시계가 뒤로 갔으면 null(판단 기억을 버림). */
  serverMemo: ServerMemoData | null
  agentStates: AgentStateData | null
  agentSeen: AgentSeenData | null
  /**
   * 기록(G3g). 꺼져 있던 시간과 상관없이 돌려준다(지난 일이라 판단 기억과 달리 버릴 까닭이 없다).
   * 항목 모양·24시간 확인은 기록이 불러올 때 한다(createEventLog().import). 없으면 빈 목록.
   */
  events: unknown[]
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

const GROUP_KEYS = ['devServer', 'agent', 'heavy', 'otherApps', 'system'] as const
const bytesOk = (v: unknown): boolean => Number.isFinite(v) && (v as number) >= 0

/** 묶음 추이: 시각이 수이고 다섯 묶음이 모두 0 이상의 수인 점만, 아는 칸만 남긴다. */
function validGroupPoints(value: unknown): GroupPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (p): p is GroupPoint =>
        isRecord(p) && Number.isFinite(p.t) && GROUP_KEYS.every((k) => bytesOk(p[k]))
    )
    .slice(-MAX_ENTRIES * 2)
    .map((p) => ({
      t: p.t,
      devServer: p.devServer,
      agent: p.agent,
      heavy: p.heavy,
      otherApps: p.otherApps,
      system: p.system
    }))
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

/** 서버 판단 기억: 상태·시각이 맞는 항목만, shielded 는 불리언일 때만 남긴다. */
function validServerMemo(value: unknown): ServerMemoData {
  const result: ServerMemoData = validStates(value, ['idle', 'tabs'] as const)
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(result)) {
    const shielded = (value[key] as Record<string, unknown>).shielded
    if (typeof shielded === 'boolean') entry.shielded = shielded
  }
  return result
}

/** 에이전트를 본 기록: 처음 본 시각이 수이고 마지막 작업 시각이 수 또는 null 인 항목만 남긴다. */
function validSeen(value: unknown): AgentSeenData {
  const result: AgentSeenData = {}
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (!isRecord(entry) || !Number.isFinite(entry.firstSeen)) continue
    const lastWorking = entry.lastWorking
    if (lastWorking !== null && !Number.isFinite(lastWorking)) continue
    result[key] = {
      firstSeen: entry.firstSeen as number,
      lastWorking: lastWorking as number | null
    }
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
  if (!isRecord(raw) || raw.version !== 2 || !Number.isFinite(raw.savedAt)) return null
  const savedAt = raw.savedAt as number
  const resume = savedAt <= now && now - savedAt <= RESUME_JUDGEMENT_MS
  return {
    ram: validPoints(raw.ram),
    groups: validGroupPoints(raw.groups),
    servers: isRecord(raw.servers) ? (raw.servers as ServerHistoryData) : {},
    serverMemo: resume ? validServerMemo(raw.serverMemo) : null,
    agentStates: resume ? validStates(raw.agentStates, AGENT_STATES) : null,
    agentSeen: resume ? validSeen(raw.agentSeen) : null,
    events: Array.isArray(raw.events) ? raw.events : []
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

/** 30초에 한 점, 2시간까지 남기는 추이(RAM·묶음 추이가 같은 규칙을 쓴다). */
function createTimedHistory<P extends { t: number }>(
  valid: (list: unknown) => P[]
): { add(point: P): void; points(): P[]; import(list: P[], now: number): void } {
  let points: P[] = []
  return {
    add(point) {
      const last = points[points.length - 1]
      if (last && point.t - last.t < RAM_EVERY_MS) return
      points = [...points.filter((p) => point.t - p.t <= RAM_KEEP_MS), point]
    },
    points() {
      return points.map((p) => ({ ...p }))
    },
    import(list, now) {
      points = valid(list)
        .filter((p) => p.t <= now && now - p.t <= RAM_KEEP_MS)
        .sort((a, b) => a.t - b.t)
    }
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
  const history = createTimedHistory(validPoints)
  return {
    record: (t, value) => history.add({ t, value }),
    points: history.points,
    import: history.import
  }
}

/** 묶음별 메모리 추이(G6, 메인 프로세스). RAM 추이와 같이 30초에 한 점, 2시간까지. */
export function createGroupHistory(): {
  record(t: number, groups: GroupUsage[]): void
  points(): GroupPoint[]
  import(points: GroupPoint[], now: number): void
} {
  const history = createTimedHistory(validGroupPoints)
  return {
    record: (t, groups) => history.add(groupPoint(t, groups)),
    points: history.points,
    import: history.import
  }
}
