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
