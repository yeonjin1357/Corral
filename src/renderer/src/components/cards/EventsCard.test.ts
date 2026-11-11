// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import EventsCard from './EventsCard.vue'
import type { PitEvent } from '../../../../shared/events'

const NOW = new Date(2026, 10, 10, 15, 0).getTime()

function card(events: PitEvent[], compact = false): VueWrapper {
  return mount(EventsCard, { props: { events, now: NOW, compact } })
}
/** 줄마다 [종류, 시각, 대상·내용]. */
const lines = (w: VueWrapper): string[][] =>
  w
    .findAll('[data-event]')
    .map((li) =>
      ['[data-event-kind]', '[data-event-time]', '[data-event-detail]'].map((s) =>
        li.find(s).exists() ? li.find(s).text() : ''
      )
    )

test('최근 기록 세 줄, 누르면 기록 탭', async () => {
  // 오래된 것부터 놓인 기록.
  const events: PitEvent[] = [
    { id: 1, t: NOW - 60 * 60_000, kind: 'server-start', label: ':3000' },
    {
      id: 2,
      t: NOW - 30 * 60_000,
      kind: 'agent-done',
      tool: 'claude',
      where: 'wt-a · main',
      ms: 12 * 60_000
    },
    { id: 3, t: NOW - 10 * 60_000, kind: 'server-end', label: ':5173' },
    { id: 4, t: NOW - 60_000, kind: 'memory-level', level: 'warn', percent: 86 }
  ]
  const w = card(events)
  expect(w.find('[data-slot=card-title]').text()).toBe('최근 기록')
  // 새 것부터 세 줄. 같은 글(대상 = 내용)은 한 번만.
  const shown = lines(w)
  expect(shown.map(([kind, , detail]) => [kind, detail])).toEqual([
    ['메모리 경고', 'RAM 86%'],
    ['서버 꺼짐', ':5173'],
    ['작업 끝남', 'wt-a · main · Claude · 12분 동안 일했어요']
  ])
  // 시각은 짧게(오늘이면 시·분만).
  for (const [, time] of shown) expect(time).toMatch(/^(오전|오후) \d+:\d{2}$/)
  // 한 줄을 누르거나 ↗ 를 누르면 기록 탭.
  await w.findAll('[data-event] button')[2].trigger('click')
  await w.find('button[aria-label="목록에서 보기"]').trigger('click')
  expect(w.emitted('tab')).toEqual([['events'], ['events']])
  // 오늘이 아니면 날짜도.
  const old = card([{ id: 9, t: NOW - 24 * 60 * 60_000, kind: 'cleanup', count: 2 }])
  expect(lines(old)[0][1]).toMatch(/^11월 9일 (오전|오후) \d+:\d{2}$/)

  // 간단히: 가장 새 기록의 시각과 한 줄, 누르면 기록 탭.
  const compact = card(events, true)
  expect(compact.find('[data-compact-value]').text()).toMatch(/^(오전|오후) \d+:\d{2}$/)
  expect(compact.find('[data-compact-sub]').text()).toBe('메모리 경고 · RAM 86%')
  await compact.find('[data-compact-body]').trigger('click')
  expect(compact.emitted('tab')).toEqual([['events']])

  // 없으면 안내 문구.
  expect(card([]).text()).toContain('아직 기록이 없어요')
  expect(card([]).find('[data-event]').exists()).toBe(false)
  expect(card([], true).find('[data-compact-sub]').text()).toBe('아직 기록이 없어요')
})
