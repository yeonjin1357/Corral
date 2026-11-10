import { PIT_EVENT_KINDS, type PitEvent, type PitEventKind } from '../shared/events'
import type {
  AgentRow,
  AgentTool,
  DashboardSnapshot,
  HeavyJobRow,
  KillResult,
  MemoryLevel,
  ServerRow,
  WorktreeInfo
} from '../shared/types'
import { portList, worktreeFolder, worktreeLabel } from '../shared/format'
import { agentKey, selectionKey } from '../shared/keys'
import { DONE_MIN_WORK_MS } from './notifier'

/*
 * 기록(G3g): 메인이 일어난 일을 기억한다. 이어지는 두 스냅샷을 견준 변화와 정리 동작만 적고,
 * 내용(프롬프트·명령·세션 제목)과 전체 경로는 담지 않는다 — 종류·시각·폴더 이름 · 브랜치·숫자·선택 키만.
 */

/** 기록은 최근 300개·24시간까지. */
export const EVENT_MAX = 300
export const EVENT_KEEP_MS = 24 * 60 * 60 * 1000

type NewEvent = Omit<PitEvent, 'id'>

/** 폴더 이름 · 브랜치. 워크트리를 모르면 넣지 않는다(지어내지 않음). */
function whereOf(worktree: WorktreeInfo | null): Pick<PitEvent, 'where'> {
  return worktree ? { where: worktreeLabel(worktree) } : {}
}

/** 정확한 상태(훅·세션 파일·Codex 세션 기록). CPU 로 짐작한 상태는 잠깐 쉬어도 바뀌어 적지 않는다. */
const exact = (a: AgentRow): boolean => a.stateSource !== 'cpu'

function agentEvents(prev: DashboardSnapshot, next: DashboardSnapshot): NewEvent[] {
  const t = next.takenAt
  const before = new Map(prev.agents.map((a) => [agentKey(a), a]))
  const present = new Set(next.agents.map(agentKey))
  const about = (a: AgentRow, kind: PitEventKind, at = t): NewEvent => ({
    t: at,
    kind,
    tool: a.tool,
    ...whereOf(a.worktree),
    key: selectionKey.agent(a)
  })
  const events: NewEvent[] = []
  for (const a of next.agents) {
    const was = before.get(agentKey(a))
    if (!was) events.push(about(a, 'agent-start'))
    // 상태가 바뀐 시각(훅 이벤트 시각 등)이 지난 스냅샷 뒤면 그 시각에 적는다. 훅으로 상태만 바꿔 다시 내보낸
    // 스냅샷은 수집 시각이 그대로라 수집 시각으로는 늦게 일어난 일이 앞당겨진다.
    const at = a.stateSince != null && a.stateSince > prev.takenAt ? a.stateSince : t
    const sameExact = !!was && exact(was) && was.state === a.state
    if (exact(a) && !sameExact) {
      if (a.state === 'waiting') events.push(about(a, 'agent-waiting', at))
      else if (a.state === 'error') events.push(about(a, 'agent-error', at))
      else if (
        a.state === 'idle' &&
        was &&
        exact(was) &&
        was.state === 'working' &&
        was.stateSince != null
      ) {
        // 작업 끝남 알림과 같은 기준: 2분 넘게 일한 것만.
        const ms = (a.stateSince ?? t) - was.stateSince
        if (ms >= DONE_MIN_WORK_MS) events.push({ ...about(a, 'agent-done', at), ms })
      }
    }
    if (was && was.quietSince == null && a.quietSince != null) events.push(about(a, 'agent-quiet'))
  }
  for (const a of prev.agents) {
    if (present.has(agentKey(a))) continue
    const abnormal = exact(a) && (a.state === 'working' || a.state === 'waiting')
    events.push({ ...about(a, 'agent-end'), abnormal })
  }
  return events
}

/** 보이는 서버만 적는다. 숨기거나 다시 보이게 한 것은 시작·꺼짐이 아니다. */
function serverEvents(prev: DashboardSnapshot, next: DashboardSnapshot): NewEvent[] {
  const keys = (s: DashboardSnapshot): Set<string> =>
    new Set([...s.servers, ...s.hiddenServers].map((r) => selectionKey.server(r)))
  const before = keys(prev)
  const after = keys(next)
  const about = (r: ServerRow, kind: PitEventKind): NewEvent => ({
    t: next.takenAt,
    kind,
    ...whereOf(r.worktree),
    label: portList(r.ports),
    key: selectionKey.server(r)
  })
  return [
    ...next.servers
      .filter((r) => !before.has(selectionKey.server(r)))
      .map((r) => about(r, 'server-start')),
    ...prev.servers
      .filter((r) => !after.has(selectionKey.server(r)))
      .map((r) => about(r, 'server-end'))
  ]
}

/**
 * 무거운 작업 시작·끝. peaks 에 작업마다 지금까지 본 최대 메모리(커밋, 모르면 RAM)를 갱신하고, 끝난 작업은 지운다.
 * prev 가 없으면(기준선) 재기만 한다.
 */
function heavyEvents(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot,
  peaks: Map<string, number>
): NewEvent[] {
  const size = (j: HeavyJobRow): number => j.commitBytes ?? j.memoryBytes
  const present = new Set(next.heavyJobs.map((j) => selectionKey.heavy(j)))
  for (const j of next.heavyJobs) {
    const key = selectionKey.heavy(j)
    peaks.set(key, Math.max(peaks.get(key) ?? 0, size(j)))
  }
  const events: NewEvent[] = []
  if (prev) {
    const before = new Set(prev.heavyJobs.map((j) => selectionKey.heavy(j)))
    const about = (j: HeavyJobRow, kind: PitEventKind): NewEvent => ({
      t: next.takenAt,
      kind,
      label: j.label,
      ...whereOf(j.worktree),
      key: selectionKey.heavy(j)
    })
    for (const j of next.heavyJobs)
      if (!before.has(selectionKey.heavy(j))) events.push(about(j, 'heavy-start'))
    for (const j of prev.heavyJobs) {
      const key = selectionKey.heavy(j)
      if (present.has(key)) continue
      events.push({
        ...about(j, 'heavy-end'),
        ...(j.startedAt != null ? { ms: next.takenAt - j.startedAt } : {}),
        bytes: Math.max(peaks.get(key) ?? 0, size(j))
      })
    }
  }
  for (const key of peaks.keys()) if (!present.has(key)) peaks.delete(key)
  return events
}

function memoryEvents(prev: DashboardSnapshot, next: DashboardSnapshot): NewEvent[] {
  const { memory } = next
  // RAM 정보가 없는 스냅샷으로는 단계가 바뀌었다고 보지 않는다(알림과 같은 기준).
  if (prev.memory.totalBytes <= 0 || memory.totalBytes <= 0) return []
  if (prev.memory.level === memory.level) return []
  return [
    { t: next.takenAt, kind: 'memory-level', level: memory.level, percent: memory.usedPercent }
  ]
}

/**
 * 이어지는 두 스냅샷의 변화를 기록 줄로 바꾼다. prev 가 없으면(첫 스냅샷은 기준선) 또는 둘 중 하나가 지연된
 * 스냅샷(옛 데이터)이면 빈 목록 — 사라졌다·바뀌었다고 보지 않는다. 바뀐 것이 없으면(다시 내보낸 스냅샷) 빈 목록.
 * - 에이전트(agentKey): 새로 보임 agent-start, 사라짐 agent-end(abnormal = 정확한 상태로 작업 중·응답 대기였음).
 *   정확한 상태(CPU 추정 아님)로 넘어갈 때만: 작업 중 → 쉬는 중이고 2분 넘게 일했으면 agent-done(ms),
 *   응답 대기 agent-waiting, 오류 agent-error. 조용해지면 agent-quiet.
 * - 보이는 서버: server-start·server-end(label = 포트 목록).
 * - 무거운 작업: heavy-start, heavy-end(ms = 시작부터, bytes = 그동안의 최대 메모리). peaks 를 이 함수가 갱신한다.
 * - 메모리 단계가 바뀌면 memory-level(level·percent = RAM %).
 */
export function diffEvents(
  prev: DashboardSnapshot | null,
  next: DashboardSnapshot,
  peaks: Map<string, number>
): NewEvent[] {
  if (next.stale) return []
  const base = prev && !prev.stale ? prev : null
  const heavy = heavyEvents(base, next, peaks)
  if (!base) return []
  return [
    ...agentEvents(base, next),
    ...serverEvents(base, next),
    ...heavy,
    ...memoryEvents(base, next)
  ]
}

const KINDS: ReadonlySet<string> = new Set(PIT_EVENT_KINDS)
const TOOLS: readonly AgentTool[] = ['claude', 'codex']
const LEVELS: readonly MemoryLevel[] = ['normal', 'warn', 'danger']
const TEXT_FIELDS = ['where', 'label', 'key'] as const
const NUMBER_FIELDS = ['ms', 'bytes', 'count', 'percent'] as const

/** 저장된 기록 한 줄. 아는 값만 옮기고, 모양이 틀린 값이 하나라도 있으면 그 줄을 버린다. */
function parseEvent(value: unknown): PitEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const { id, t, kind } = v
  if (!Number.isInteger(id) || (id as number) <= 0 || !Number.isFinite(t)) return null
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null
  const event: PitEvent = { id: id as number, t: t as number, kind: kind as PitEventKind }
  for (const field of TEXT_FIELDS) {
    const x = v[field]
    if (x === undefined) continue
    if (typeof x !== 'string') return null
    event[field] = x
  }
  for (const field of NUMBER_FIELDS) {
    const x = v[field]
    if (x === undefined) continue
    if (typeof x !== 'number' || !Number.isFinite(x)) return null
    event[field] = x
  }
  if (v.tool !== undefined) {
    if (!TOOLS.includes(v.tool as AgentTool)) return null
    event.tool = v.tool as AgentTool
  }
  if (v.level !== undefined) {
    if (!LEVELS.includes(v.level as MemoryLevel)) return null
    event.level = v.level as MemoryLevel
  }
  if (v.abnormal !== undefined) {
    if (typeof v.abnormal !== 'boolean') return null
    event.abnormal = v.abnormal
  }
  return event
}

/**
 * 기록(메모리, 최근 max 개·keepMs 동안). 더하면 id 를 매기고 onAdded 로 알린다.
 * 24시간이 지난 것은 더할 때·읽을 때 버린다(들어올 것이 없어도).
 */
export function createEventLog(
  o: {
    max?: number
    keepMs?: number
    onAdded?: (events: PitEvent[]) => void
    now?: () => number
  } = {}
): {
  add(events: NewEvent[]): void
  list(): PitEvent[]
  /** history.json 에 쓸 것(list 와 같다). */
  export(): PitEvent[]
  /**
   * history.json 에서 읽은 것을 들인다(앱이 켜질 때 기록을 쌓기 전에 한 번 — 있던 기록을 바꾼다).
   * 모양이 맞는 것만, 24시간이 지난 것은 버리고, id 는 읽은 것 가운데 가장 큰 것 다음부터 센다.
   * 꺼져 있던 시간과는 상관없다(지난 일이라).
   */
  import(data: unknown, now: number): void
} {
  const max = o.max ?? EVENT_MAX
  const keepMs = o.keepMs ?? EVENT_KEEP_MS
  const now = o.now ?? Date.now
  let events: PitEvent[] = []
  let nextId = 1

  function trim(at: number): void {
    events = events.filter((e) => at - e.t <= keepMs).slice(-max)
  }
  const copy = (list: PitEvent[]): PitEvent[] => list.map((e) => ({ ...e }))
  function list(): PitEvent[] {
    trim(now())
    return copy(events)
  }

  return {
    add(added) {
      if (added.length === 0) return
      const numbered = added.map((e): PitEvent => ({ ...e, id: nextId++ }))
      events.push(...numbered)
      trim(now())
      const kept = new Set(events)
      const fresh = numbered.filter((e) => kept.has(e))
      if (fresh.length > 0) o.onAdded?.(copy(fresh))
    },
    list,
    export: list,
    import(data, at) {
      if (!Array.isArray(data)) return
      const ids = new Set<number>()
      const loaded: PitEvent[] = []
      for (const item of data) {
        const e = parseEvent(item)
        if (!e || ids.has(e.id)) continue
        ids.add(e.id)
        loaded.push(e)
        nextId = Math.max(nextId, e.id + 1)
      }
      // 시계가 뒤로 갔으면 앞날의 것은 버린다(RAM 추이와 같은 기준).
      events = loaded.filter((e) => e.t <= at).sort((a, b) => a.id - b.id)
      trim(at)
    }
  }
}

/** 끄기·정리(서버·남은 프로세스·한꺼번에·작업 공간)로 끈 것이 있으면 cleanup: 끈 개수와 확보한 RAM. */
export function cleanupEvent(result: KillResult, t: number): NewEvent | null {
  if (result.status !== 'killed' || !result.freed) return null
  return { t, kind: 'cleanup', count: result.freed.count, bytes: result.freed.memoryBytes }
}

/**
 * 디스크 정리로 지운 것이 있으면 disk-remove: 워크트리 폴더 이름(전체 경로는 담지 않는다)·지운 폴더 이름·
 * 확보한 크기.
 */
export function diskRemoveEvent(
  worktreeRoot: string,
  result: KillResult,
  t: number
): NewEvent | null {
  const freed = result.status === 'killed' ? result.freed : undefined
  if (!freed || freed.count === 0) return null
  return {
    t,
    kind: 'disk-remove',
    where: worktreeFolder({ root: worktreeRoot, branch: null, isLinkedWorktree: true }),
    ...(freed.names?.length ? { label: freed.names.join(', ') } : {}),
    bytes: freed.memoryBytes
  }
}
