// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { Globe } from '@lucide/vue'
import IconChip from './IconChip.vue'
import PanelHeader from './PanelHeader.vue'
import CompactCard from './CompactCard.vue'

test('색이 있으면 그 색 칩, 없으면 회색 칩(읽어 주지 않는다)', () => {
  const colored = mount(IconChip, { props: { icon: Globe, color: 'var(--chart-1)' } })
  expect(colored.classes()).toEqual(expect.arrayContaining(['bg-primary/10', 'text-primary']))
  expect((colored.element as HTMLElement).style.getPropertyValue('--primary')).toBe(
    'var(--chart-1)'
  )
  expect(colored.attributes('aria-hidden')).toBe('true')
  expect(colored.find('svg').exists()).toBe(true)

  const plain = mount(IconChip, { props: { icon: Globe } })
  expect(plain.classes()).toEqual(expect.arrayContaining(['bg-muted', 'text-muted-foreground']))
  expect(plain.attributes('style')).toBeUndefined()
})

test('카드 머리와 간단히 카드가 같은 칩을 쓴다', () => {
  const props = { icon: Globe, title: '개발 서버', color: 'var(--chart-1)', actionLabel: '보기' }
  for (const w of [
    mount(PanelHeader, { props }),
    mount(CompactCard, { props: { ...props, value: '3' } })
  ])
    expect(w.findComponent(IconChip).props()).toEqual({ icon: Globe, color: 'var(--chart-1)' })
})
