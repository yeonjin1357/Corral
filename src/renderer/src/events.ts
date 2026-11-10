/**
 * 기록 탭(G3g)과 "자리 비운 사이" 요약을 만드는 순수 함수. 화면 모양과 상관없이 시험한다.
 * 기록에는 내용(프롬프트·명령)이 없으니 종류·시각·이름·숫자만 보인다.
 */
import type { PitEvent, PitEventKind } from '../../shared/events'
import type { DashboardSnapshot, TrendPoint } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import { formatBytes, formatDuration, formatFreed } from '../../shared/format'
import { text } from '../../shared/text'
import type { Row, Table } from './rows'

const E = text.ui.events

/** 화면이 들고 있는 기록의 한도(메인이 기억하는 만큼: 300개·24시간). 오래 켜 둔 창이 더 쌓지 않게. */
const KEEP_COUNT = 300
const KEEP_MS = 24 * 60 * 60 * 1000

/** 오래된 것부터 놓인 기록을 최신 300개, 가장 새 기록에서 24시간 안의 것으로 줄인다. */
export function trimEvents(events: PitEvent[]): PitEvent[] {
  if (!events.length) return events
  const newest = Math.max(...events.map((e) => e.t))
  return events.filter((e) => newest - e.t <= KEEP_MS).slice(-KEEP_COUNT)
}

/** 있는 값만 ` · ` 로 잇는다(모르는 값은 칸을 비운다). */
const join = (...parts: (string | null | undefined)[]): string =>
  parts.filter((p): p is string => !!p).join(' · ')

/** 에이전트 기록의 내용 앞에는 도구 이름을 붙인다(`Claude · 12분 동안 일했어요`). */
const withTool = (e: PitEvent, detail: string): string =>
  join(e.tool ? text.ui.agent.tools[e.tool] : null, detail)

type Describe = (e: PitEvent) => { kind: string; detail: string }
const plain =
  (kind: string, detail: (e: PitEvent) => string = () => ''): Describe =>
  (e) => ({ kind, detail: detail(e) })
const agent = (kind: string, detail: (e: PitEvent) => string = () => ''): Describe =>
  plain(kind, (e) => withTool(e, detail(e)))

/** 모든 종류를 다룬다(새 종류를 더하면 여기서 컴파일이 깨진다). */
const DESCRIBE: Record<PitEventKind, Describe> = {
  'agent-start': agent(E.kinds['agent-start']),
  'agent-end': agent(E.kinds['agent-end'], (e) => (e.abnormal ? E.wasWorking : '')),
  'agent-done': agent(E.kinds['agent-done'], (e) =>
    e.ms != null ? E.worked(formatDuration(e.ms)) : ''
  ),
  'agent-waiting': agent(E.kinds['agent-waiting']),
  'agent-error': agent(E.kinds['agent-error']),
  'agent-quiet': agent(E.kinds['agent-quiet'], () => E.quiet),
  'server-start': plain(E.kinds['server-start'], (e) => e.label ?? ''),
  'server-end': plain(E.kinds['server-end'], (e) => e.label ?? ''),
  'heavy-start': plain(E.kinds['heavy-start'], (e) => e.label ?? ''),
  'heavy-end': plain(E.kinds['heavy-end'], (e) =>
    join(
      e.ms != null ? formatDuration(e.ms) : null,
      e.bytes != null ? E.peak(formatBytes(e.bytes)) : null
    )
  ),
  'memory-level': (e) => ({
    // 단계를 모르면 지어내지 않고 이름만.
    kind:
      e.level && e.level in E.levels ? E.memoryLevel(E.levels[e.level]) : E.kinds['memory-level'],
    detail: e.percent != null ? E.ram(e.percent) : ''
  }),
  cleanup: plain(E.kinds.cleanup, (e) =>
    join(
      e.count != null ? E.cleanupCount(e.count) : null,
      e.bytes != null ? formatFreed(e.bytes, null) : null
    )
  ),
  'disk-remove': plain(E.kinds['disk-remove'], (e) =>
    join(e.label, e.bytes != null ? formatBytes(e.bytes) : null)
  ),
  'heavy-defer': plain(E.kinds['heavy-defer'], (e) => e.label ?? '')
}

export function eventText(e: PitEvent): { kind: string; detail: string } {
  return DESCRIBE[e.kind](e)
}

/** `오전 9:10`, 오늘이 아니면 `11월 9일 오전 9:10`. 오늘은 스냅샷 시각 기준. */
function timeText(t: number, now: number): string {
  const when = new Date(t)
  const today = new Date(now)
  const clock = when.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  const same =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate()
  return same
    ? clock
    : `${when.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ${clock}`
}

/** 지금 스냅샷에 있는 항목의 선택 키(기록의 key 가 아직 유효한지 보는 데 쓴다). */
function liveKeys(s: DashboardSnapshot): Set<string> {
  return new Set([
    ...s.servers.map(selectionKey.server),
    ...s.agents.map(selectionKey.agent),
    ...s.leftovers.map(selectionKey.leftover),
    ...s.heavyJobs.map(selectionKey.heavy),
    ...(s.disk?.rows ?? []).map((r) => selectionKey.disk(r.worktreeRoot))
  ])
}

export function eventsTable(events: PitEvent[], s: DashboardSnapshot): Table {
  const c = text.ui.columns
  const live = liveKeys(s)
  const rows: Row[] = [...events]
    .sort((a, b) => b.t - a.t || b.id - a.id)
    .map((e) => {
      const { kind, detail } = eventText(e)
      const target = e.where ?? e.label ?? ''
      return {
        key: e.key && live.has(e.key) ? e.key : null,
        id: `event:${e.id}`,
        cells: {
          time: { text: timeText(e.t, s.takenAt), sort: e.t, muted: true },
          kind: { text: kind },
          target: { text: target || text.ui.none, title: target || undefined },
          detail: { text: detail || text.ui.none, muted: true, title: detail || undefined }
        },
        actions: [],
        search: [kind, target, detail].join(' ').toLowerCase()
      }
    })
  return {
    columns: [
      { id: 'time', label: c.time, width: 150 },
      { id: 'kind', label: c.kind, width: 150 },
      { id: 'target', label: c.target, width: 260 },
      { id: 'detail', label: c.detail, width: 400 }
    ],
    rows,
    sort: { id: 'time', dir: 'desc' }
  }
}

export interface AwaySummary {
  minutes: number
  done: number
  waiting: number
  gone: number
  quiet: number
  maxRam: number | null
}

/**
 * since 뒤의 기록을 센다: 작업 끝남·응답 대기·꺼진 에이전트(작업 중이던 것만)·조용함, 그 사이 RAM 최고.
 * 넷이 모두 0 이면 보여 줄 것이 없어 null.
 */
export function awaySummary(
  events: PitEvent[],
  ram: TrendPoint[],
  since: number,
  now: number
): AwaySummary | null {
  const recent = events.filter((e) => e.t > since && e.t <= now)
  const count = (pick: (e: PitEvent) => boolean): number => recent.filter(pick).length
  const done = count((e) => e.kind === 'agent-done')
  const waiting = count((e) => e.kind === 'agent-waiting')
  const gone = count((e) => e.kind === 'agent-end' && !!e.abnormal)
  const quiet = count((e) => e.kind === 'agent-quiet')
  if (done + waiting + gone + quiet === 0) return null
  const values = ram.filter((p) => p.t > since && p.t <= now).map((p) => p.value)
  return {
    minutes: Math.max(1, Math.round((now - since) / 60_000)),
    done,
    waiting,
    gone,
    quiet,
    maxRam: values.length ? Math.round(Math.max(...values)) : null
  }
}

/** 카드 한 줄: `42분 동안: 작업 끝남 2 · 응답 대기 1 · RAM 최고 96%`(0 인 것은 뺀다). */
export function awayText(a: AwaySummary): string {
  const A = text.ui.away
  const parts = [
    a.done ? A.done(a.done) : null,
    a.waiting ? A.waiting(a.waiting) : null,
    a.gone ? A.gone(a.gone) : null,
    a.quiet ? A.quiet(a.quiet) : null,
    a.maxRam != null ? A.maxRam(a.maxRam) : null
  ].filter((p): p is string => p != null)
  return A.summary(a.minutes, parts)
}
