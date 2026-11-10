// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import ToolBar from './ToolBar.vue'
import { TABS, type TabKey } from '../rows'

const counts = Object.fromEntries(TABS.map((t) => [t, 1])) as Record<TabKey, number>

test('개발 서버 탭에서만 목록/묶음 전환을 보이고, 누르면 보기를 바꾼다', async () => {
  const w = mount(ToolBar, {
    props: { tab: 'ports', query: '', counts, matching: 1, view: 'group' }
  })
  const toggle = w.find('[aria-label="개발 서버 보기"]')
  expect(toggle.exists()).toBe(true)
  const list = toggle.findAll('button').find((b) => b.text().includes('목록'))!
  await list.trigger('click')
  expect(w.emitted('update:view')?.[0]).toEqual(['list'])
  await w.setProps({ tab: 'agents' })
  expect(w.find('[aria-label="개발 서버 보기"]').exists()).toBe(false)
})

test('작업 공간이 탭의 맨 앞에 있고 숫자는 작업 공간 수다', () => {
  const w = mount(ToolBar, {
    props: { tab: 'workspaces', query: '', counts: { ...counts, workspaces: 3 }, matching: 3 }
  })
  const items = w.findAll('[data-slot="toggle-group-item"]')
  expect(items.map((b) => b.attributes('data-value'))).toEqual([
    'workspaces',
    'ports',
    'agents',
    'leftovers',
    'heavy',
    'disk',
    'apps',
    'events'
  ])
  expect(items[0].text()).toBe('작업 공간 3')
  expect(items[0].attributes('aria-pressed')).toBe('true')
  // 목록/묶음 전환은 개발 서버 탭에만.
  expect(w.find('[aria-label="개발 서버 보기"]').exists()).toBe(false)
})

test('기록이 탭의 맨 끝에 있고 숫자는 기록 수다', () => {
  const w = mount(ToolBar, {
    props: { tab: 'ports', query: '', counts: { ...counts, events: 7 }, matching: 1, view: 'group' }
  })
  const items = w
    .findAll('[data-slot="toggle-group-item"]')
    .filter((b) => b.attributes('aria-pressed') != null && !['목록', '묶음'].includes(b.text()))
  const last = items[items.length - 1]
  expect(last.text()).toContain('기록')
  expect(last.text()).toContain('7')
})

test('검색 결과 줄의 전체 수는 지금 보이는 표의 수', async () => {
  const w = mount(ToolBar, {
    props: {
      tab: 'ports',
      query: '5432',
      counts: { ...counts, ports: 2 },
      matching: 1,
      view: 'group',
      total: 300
    }
  })
  expect(w.text()).toContain('300개 중 1개')
  // 탭 숫자는 그대로 탭의 수.
  const ports = w.find('[data-slot="toggle-group-item"][data-value="ports"]')
  expect(ports.text()).toBe('개발 서버 2')
  // 따로 주지 않으면 탭의 수.
  await w.setProps({ total: undefined })
  expect(w.text()).toContain('2개 중 1개')
})
