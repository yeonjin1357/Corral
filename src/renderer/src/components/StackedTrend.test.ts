// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import StackedTrend from './StackedTrend.vue'
import type { GroupPoint } from '../../../shared/types'

const GB = 1024 ** 3

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
  document.body.innerHTML = ''
})

const at = (t: number): GroupPoint => ({
  t,
  devServer: 2 * GB,
  agent: GB,
  heavy: 0,
  otherApps: 8 * GB,
  system: 3 * GB
})

async function trend(points: GroupPoint[], gapMs?: number): Promise<VueWrapper> {
  const w = mount(StackedTrend, {
    attachTo: document.body,
    props: { points, windowMs: 200_000, totalBytes: 16 * GB, ...(gapMs ? { gapMs } : {}) }
  })
  await nextTick()
  return w
}

/** 면 경로의 첫 점(그 묶음 윗선의 왼쪽 끝) y. */
const topY = (d: string): number => Number(/^M[\d.]+,([\d.]+)/.exec(d)![1])

test('묶음을 쌓아 그린다', async () => {
  const w = await trend([at(0), at(100_000), at(200_000)])
  const areas = w.findAll('path[data-trend-group]')
  // 0 인 묶음(무거운 작업)은 그리지 않고, 나머지는 GROUP_ORDER 순서로 아래에서 위로 쌓는다.
  expect(areas.map((p) => p.attributes('data-trend-group'))).toEqual([
    'devServer',
    'agent',
    'otherApps',
    'system'
  ])
  const ys = areas.map((p) => topY(p.attributes('d')!))
  // 위로 갈수록 y 가 작다(쌓인 높이가 크다).
  expect(ys.every((y, i) => i === 0 || y < ys[i - 1])).toBe(true)
  // 맨 위 = 묶음 합(14 GB) / 전체(16 GB). 그래프 높이 112, 여백 위 3·아래 2.
  expect(ys[3]).toBeCloseTo(3 + (1 - 14 / 16) * (112 - 5), 0)
  // 범례: 그린 묶음 이름.
  const legend = w.findAll('[data-trend-legend]').map((e) => e.text())
  expect(legend).toEqual(['개발 서버', '에이전트', '다른 앱', '시스템·공유'])
  w.unmount()
})

test('끊긴 구간은 잇지 않는다', async () => {
  const points = [at(0), at(1_000), at(100_000), at(101_000)]
  let w = await trend(points, 60_000)
  for (const p of w.findAll('path[data-trend-group]'))
    expect(p.attributes('d')!.match(/Z/g)).toHaveLength(2)
  w.unmount()
  w = await trend(points)
  for (const p of w.findAll('path[data-trend-group]'))
    expect(p.attributes('d')!.match(/Z/g)).toHaveLength(1)
  w.unmount()
})
