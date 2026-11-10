// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import ResourceTrend from './ResourceTrend.vue'

const points = [
  { t: 1_000, value: 50 },
  { t: 2_000, value: 91 }
]

function trend(): VueWrapper {
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

describe('끊긴 구간', () => {
  // happy-dom 은 배치를 하지 않아 너비가 0 이다. 그래프를 그리도록 너비를 준다.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 300
    })
  })
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
  })
  const gapped = [
    { t: 0, value: 10 },
    { t: 1_000, value: 20 },
    { t: 100_000, value: 30 },
    { t: 101_000, value: 40 }
  ]
  async function paths(gapMs?: number): Promise<{ line: string; area: string }> {
    const w = mount(ResourceTrend, {
      props: {
        points: gapped,
        windowMs: 200_000,
        max: 100,
        label: '메모리',
        format: (v: number) => `${v}%`,
        ...(gapMs ? { gapMs } : {})
      }
    })
    await w.vm.$nextTick()
    const all = w.findAll('path')
    return {
      line: all.find((p) => p.attributes('fill') === 'none')!.attributes('d')!,
      area: all.find((p) => p.attributes('fill')?.startsWith('url('))!.attributes('d')!
    }
  }

  test('기록이 gapMs 보다 오래 끊긴 곳은 선·면을 잇지 않고 비운다(앱이 꺼져 있던 동안)', async () => {
    const { line, area } = await paths(60_000)
    expect(line.match(/M/g)).toHaveLength(2)
    expect(area.match(/Z/g)).toHaveLength(2)
  })

  test('gapMs 를 주지 않으면 하나로 잇는다', async () => {
    const { line, area } = await paths()
    expect(line.match(/M/g)).toHaveLength(1)
    expect(area.match(/Z/g)).toHaveLength(1)
  })
})
