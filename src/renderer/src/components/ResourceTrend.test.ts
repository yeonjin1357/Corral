// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import ResourceTrend from './ResourceTrend.vue'

const points = [
  { t: 1_000, value: 50 },
  { t: 2_000, value: 91 }
]

function trend() {
  return mount(ResourceTrend, {
    attachTo: document.body,
    props: {
      points,
      windowMs: 10_000,
      max: 100,
      label: '메모리',
      format: (v: number) => `${v}%`,
      range: '0–100%'
    }
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('마우스를 올리면 바로(기다림 없이) 그 시각·값 툴팁이 뜨고, 떠나면 사라진다', async () => {
  const w = trend()
  const box = w.find('[role=img]')
  await box.trigger('pointermove', { clientX: 0 })
  const tip = document.body.querySelector('[data-slot=chart-tooltip]')
  expect(tip).not.toBeNull()
  expect(tip!.textContent).toContain('메모리')
  expect(tip!.textContent).toMatch(/\d+%/)
  await box.trigger('pointerleave')
  expect(document.body.querySelector('[data-slot=chart-tooltip]')).toBeNull()
  w.unmount()
})

test('브라우저 기본 풍선(title)은 쓰지 않는다(늦게 뜨고 모양을 못 바꾼다)', () => {
  const w = trend()
  expect(w.find('[role=img]').attributes('title')).toBeUndefined()
  w.unmount()
})
