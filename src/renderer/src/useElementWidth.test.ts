// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useElementWidth } from './useElementWidth'
import { fakeResizeObserver } from './testing/resizeObserver'

/** 요소 하나의 너비를 재어 글로 보이는 시험용 컴포넌트. */
const Probe = defineComponent({
  setup() {
    const box = ref<HTMLElement | null>(null)
    const width = useElementWidth(box)
    return () => h('div', { ref: box }, String(width.value))
  }
})

function setWidth(el: Element, value: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value })
}

test('붙을 때 너비를 재고, 크기가 바뀌면 다시 재고, 떨어질 때 지켜보기를 멈춘다', async () => {
  const ro = fakeResizeObserver()
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 320
  })
  try {
    const w = mount(Probe)
    await nextTick()
    expect(w.text()).toBe('320')
    expect(ro.watches).toHaveLength(1)
    expect(ro.watches[0].el).toBe(w.element)

    setWidth(w.element, 480)
    ro.watches[0].fire()
    await nextTick()
    expect(w.text()).toBe('480')

    w.unmount()
    expect(ro.disconnected()).toBe(1)
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
    ro.restore()
  }
})
