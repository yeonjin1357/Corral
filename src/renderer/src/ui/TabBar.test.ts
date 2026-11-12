// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import TabBar from './TabBar.vue'

const options = [
  { value: 'a', label: '가', count: 3 },
  { value: 'b', label: '나' },
  { value: 'c', label: '다', count: 0 }
]
const more = [
  { value: 'apps', label: '다른 앱' },
  { value: 'events', label: '기록' }
]

function make(props: Record<string, unknown> = {}): VueWrapper {
  return mount(TabBar, {
    attachTo: document.body,
    props: {
      options,
      modelValue: 'b',
      ariaLabel: '보기',
      'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }),
      ...props
    }
  })
}
let w: VueWrapper
afterEach(() => w.unmount())

test('tablist 안 탭마다 aria-selected 와 data-value, 고른 탭만 tabindex 0', () => {
  w = make()
  const list = w.find('[role="tablist"]')
  expect(list.attributes('aria-label')).toBe('보기')
  const tabs = list.findAll('[role="tab"][data-slot="tab"]')
  expect(tabs.map((t) => t.attributes('data-value'))).toEqual(['a', 'b', 'c'])
  expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
  expect(tabs.map((t) => t.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
  expect(tabs[0].text()).toBe('가 3')
  expect(tabs[2].text()).toBe('다 0')
})

test('탭을 누르면 v-model 이 바뀐다', async () => {
  w = make()
  await w.find('[data-slot="tab"][data-value="c"]').trigger('click')
  expect(w.emitted('update:modelValue')?.[0]).toEqual(['c'])
})

test('→ 는 다음 탭을 고르고 끝에서는 더 보기 단추로, 거기서 → 는 처음 탭으로', async () => {
  w = make({ more, moreLabel: '더 보기', modelValue: 'b' })
  const tab = (v: string): ReturnType<VueWrapper['find']> =>
    w.find(`[data-slot="tab"][data-value="${v}"]`)
  ;(tab('b').element as HTMLElement).focus()
  await tab('b').trigger('keydown', { key: 'ArrowRight' })
  expect(w.emitted('update:modelValue')?.[0]).toEqual(['c'])
  expect(document.activeElement).toBe(tab('c').element)
  await tab('c').trigger('keydown', { key: 'ArrowRight' })
  const moreBtn = w.find('[data-slot="tab-more"]')
  expect(document.activeElement).toBe(moreBtn.element)
  // 더 보기로 옮길 때는 값을 바꾸지 않는다.
  expect(w.emitted('update:modelValue')).toHaveLength(1)
  await moreBtn.trigger('keydown', { key: 'ArrowRight' })
  expect(document.activeElement).toBe(tab('a').element)
  expect(w.emitted('update:modelValue')?.[1]).toEqual(['a'])
  await tab('a').trigger('keydown', { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(moreBtn.element)
})

test('더 보기에서 기록을 고르면 v-model 이 events, 단추 글자가 "기록"', async () => {
  w = make({ more, moreLabel: '더 보기' })
  const moreBtn = w.find('[data-slot="tab-more"]')
  expect(moreBtn.text()).toContain('더 보기')
  expect(moreBtn.attributes('aria-haspopup')).toBe('menu')
  expect(moreBtn.attributes('aria-expanded')).toBe('false')
  await moreBtn.trigger('keydown', { key: 'ArrowDown' })
  expect(moreBtn.attributes('aria-expanded')).toBe('true')
  const items = w.findAll('[data-slot="tab-more-item"]')
  expect(items.map((i) => i.attributes('role'))).toEqual(['menuitemradio', 'menuitemradio'])
  await w.find('[data-slot="tab-more-item"][data-value="events"]').trigger('click')
  expect(w.emitted('update:modelValue')?.[0]).toEqual(['events'])
  expect(w.find('[data-slot="tab-more"]').text()).toContain('기록')
  expect(w.find('[data-slot="tab-more"]').attributes('tabindex')).toBe('0')
  expect(w.find('[data-slot="tab-more-item"]').exists()).toBe(false)
})

test('more 가 없으면 더 보기 단추도 없다', () => {
  w = make()
  expect(w.find('[data-slot="tab-more"]').exists()).toBe(false)
})
