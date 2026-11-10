import type { PitEvent } from '../../shared/events'
import { selectionKey } from '../../shared/keys'
import { awaySummary, awayText, eventText, eventsTable, trimEvents } from './events'
import { filterRows, sortRows } from './rows'
import { MB, serverRow, snapshot } from './testing/fixtures'

const NOW = new Date(2026, 10, 10, 15, 0).getTime()
const MIN = 60_000

let nextId = 1
const ev = (over: Partial<PitEvent> & Pick<PitEvent, 'kind'>): PitEvent => ({
  id: nextId++,
  t: NOW,
  ...over
})

test('최신 순, 지금 없는 항목은 고를 수 없다', () => {
  const live = serverRow({ pid: 7, ports: [3000] })
  const s = snapshot({ servers: [live], takenAt: NOW })
  const gone = selectionKey.server(serverRow({ pid: 9 }))
  const table = eventsTable(
    [
      ev({
        kind: 'server-start',
        t: NOW - 30 * MIN,
        where: 'shop-web · develop',
        label: ':3000',
        key: selectionKey.server(live)
      }),
      ev({ kind: 'server-end', t: NOW - 10 * MIN, where: 'api · main', label: ':8081', key: gone }),
      ev({ kind: 'agent-done', t: NOW - 2 * 24 * 60 * MIN, tool: 'claude', ms: 12 * MIN })
    ],
    s
  )
  expect(table.columns.map((c) => c.id)).toEqual(['time', 'kind', 'target', 'detail'])
  expect(table.sort).toEqual({ id: 'time', dir: 'desc' })
  expect(table.rows.map((r) => r.cells.kind.text)).toEqual(['서버 꺼짐', '서버 시작', '작업 끝남'])
  // 지금 있는 서버만 고를 수 있고, 없는 것은 글자는 남기되 key 가 null.
  expect(table.rows.map((r) => r.key)).toEqual([null, selectionKey.server(live), null])
  expect(table.rows[0].cells.target.text).toBe('api · main')
  expect(table.rows[0].cells.detail.text).toBe(':8081')
  // 오늘이면 시각만, 아니면 날짜도.
  expect(table.rows[1].cells.time.text).toMatch(/^(오전|오후) \d+:\d{2}$/)
  expect(table.rows[2].cells.time.text).toMatch(/^11월 8일 (오전|오후) \d+:\d{2}$/)
  // 시각 정렬은 t 로.
  expect(sortRows(table.rows, 'time', 'asc').map((r) => r.cells.kind.text)).toEqual([
    '작업 끝남',
    '서버 시작',
    '서버 꺼짐'
  ])
  // 검색은 종류·대상·내용.
  expect(filterRows(table.rows, '꺼짐').length).toBe(1)
  expect(filterRows(table.rows, 'api').length).toBe(1)
  expect(filterRows(table.rows, '12분').length).toBe(1)
  expect(table.rows.every((r) => r.actions.length === 0)).toBe(true)
})

test('종류마다 문구가 있다', () => {
  expect(eventText(ev({ kind: 'agent-done', tool: 'claude', ms: 12 * MIN }))).toEqual({
    kind: '작업 끝남',
    detail: 'Claude · 12분 동안 일했어요'
  })
  expect(eventText(ev({ kind: 'agent-end', tool: 'codex', abnormal: true })).detail).toBe(
    'Codex · 작업 중이었어요'
  )
  expect(eventText(ev({ kind: 'agent-end', abnormal: false }))).toEqual({
    kind: '꺼짐',
    detail: ''
  })
  expect(eventText(ev({ kind: 'agent-start', tool: 'claude' }))).toEqual({
    kind: '시작',
    detail: 'Claude'
  })
  expect(eventText(ev({ kind: 'agent-waiting' })).kind).toBe('권한 대기')
  expect(eventText(ev({ kind: 'agent-error' })).kind).toBe('오류')
  expect(eventText(ev({ kind: 'agent-quiet' })).detail).toBe('한동안 이벤트가 없었어요')
  expect(eventText(ev({ kind: 'heavy-start', label: 'vitest' }))).toEqual({
    kind: '무거운 작업 시작',
    detail: 'vitest'
  })
  expect(eventText(ev({ kind: 'heavy-end', ms: 3 * MIN, bytes: 512 * MB }))).toEqual({
    kind: '무거운 작업 끝',
    detail: '3분 · 최대 512 MB'
  })
  expect(eventText(ev({ kind: 'memory-level', level: 'danger', percent: 93 }))).toEqual({
    kind: '메모리 위험',
    detail: 'RAM 93%'
  })
  expect(eventText(ev({ kind: 'cleanup', count: 3, bytes: 512 * MB })).detail).toContain(
    '3개를 껐어요 · '
  )
  expect(eventText(ev({ kind: 'disk-remove', label: 'shop-web', bytes: 512 * MB }))).toEqual({
    kind: '디스크 정리',
    detail: 'shop-web · 512 MB'
  })
  expect(eventText(ev({ kind: 'heavy-defer', label: 'vitest' }))).toEqual({
    kind: '에이전트를 기다리게 함',
    detail: 'vitest'
  })
})

test('자리 비운 사이: since 뒤의 것만 세고, 셀 것이 없으면 null', () => {
  const since = NOW - 42 * MIN
  const events = [
    ev({ kind: 'agent-done', t: since - MIN }), // 이전
    ev({ kind: 'agent-done', t: since + MIN }),
    ev({ kind: 'agent-done', t: since + 2 * MIN }),
    ev({ kind: 'agent-waiting', t: since + 3 * MIN }),
    ev({ kind: 'agent-quiet', t: since + 4 * MIN }),
    ev({ kind: 'server-start', t: since + 5 * MIN })
  ]
  const ram = [
    { t: since - MIN, value: 99 }, // 이전
    { t: since + MIN, value: 70.2 },
    { t: since + 9 * MIN, value: 96.4 }
  ]
  const a = awaySummary(events, ram, since, NOW)
  expect(a).toEqual({ minutes: 42, done: 2, waiting: 1, gone: 0, quiet: 1, maxRam: 96 })
  expect(awayText(a!)).toBe('42분 동안: 작업 끝남 2 · 권한 대기 1 · 조용함 1 · RAM 최고 96%')
  expect(awaySummary([ev({ kind: 'server-start', t: since + MIN })], ram, since, NOW)).toBeNull()
  expect(awaySummary([], [], since, NOW)).toBeNull()
  expect(awaySummary(events, [], since, NOW)?.maxRam).toBeNull()
})

test('꺼진 에이전트는 작업 중이던 것만 센다', () => {
  const since = NOW - 20 * MIN
  const a = awaySummary(
    [
      ev({ kind: 'agent-end', t: since + MIN, abnormal: true }),
      ev({ kind: 'agent-end', t: since + 2 * MIN, abnormal: false }),
      ev({ kind: 'agent-end', t: since + 3 * MIN })
    ],
    [],
    since,
    NOW
  )
  expect(a?.gone).toBe(1)
  expect(awayText(a!)).toBe('20분 동안: 꺼진 에이전트 1')
  expect(
    awaySummary([ev({ kind: 'agent-end', t: since + MIN, abnormal: false })], [], since, NOW)
  ).toBeNull()
})

test('기록은 최신 300개, 가장 새 기록에서 24시간 안의 것만 둔다', () => {
  const HOUR = 60 * MIN
  const old = ev({ kind: 'agent-start', t: NOW - 25 * HOUR })
  const edge = ev({ kind: 'agent-start', t: NOW - 24 * HOUR })
  const fresh = ev({ kind: 'agent-start', t: NOW })
  expect(trimEvents([old, edge, fresh]).map((e) => e.id)).toEqual([edge.id, fresh.id])
  const many = Array.from({ length: 305 }, (_, i) => ev({ kind: 'agent-quiet', t: NOW - 305 + i }))
  const kept = trimEvents(many)
  expect(kept).toHaveLength(300)
  expect(kept[kept.length - 1]).toBe(many[304])
  expect(kept[0]).toBe(many[5])
  expect(trimEvents([])).toEqual([])
})

test('level 이 없는 memory-level 은 지어내지 않는다', () => {
  expect(eventText(ev({ kind: 'memory-level', percent: 88 }))).toEqual({
    kind: '메모리',
    detail: 'RAM 88%'
  })
  expect(eventText(ev({ kind: 'memory-level' }))).toEqual({ kind: '메모리', detail: '' })
  const odd = ev({ kind: 'memory-level', level: 'bogus' as never })
  expect(eventText(odd).kind).toBe('메모리')
})

test('where·label 이 없는 기록도 undefined 글자 없이 보인다', () => {
  const s = snapshot({ takenAt: NOW })
  const table = eventsTable(
    [ev({ kind: 'cleanup' }), ev({ kind: 'memory-level' }), ev({ kind: 'agent-start' })],
    s
  )
  for (const row of table.rows)
    for (const cell of Object.values(row.cells)) {
      expect(cell.text).not.toMatch(/undefined|null/)
      expect(cell.text).not.toBe('')
    }
})
