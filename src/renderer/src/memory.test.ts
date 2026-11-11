import { GROUP_ORDER, memoryComposition, tipPercent } from './memory'
import type { GroupUsage } from '../../shared/types'

/** 묶음 순서(GROUP_ORDER)대로 바이트를 받아 GroupUsage 목록을 만든다. */
function usage(...bytes: number[]): GroupUsage[] {
  return GROUP_ORDER.map((group, i) => ({
    group,
    memoryBytes: bytes[i],
    commitBytes: null,
    processCount: 1
  }))
}

test('묶음은 정해진 순서로, 전체 RAM 대비 비율과 남은 메모리', () => {
  const c = memoryComposition(
    { totalBytes: 100, usedBytes: 60 },
    usage(10, 5, 0, 30, 15).reverse()
  )!
  expect(c.parts.map((p) => p.group)).toEqual([
    'devServer',
    'agent',
    'heavy',
    'otherApps',
    'system'
  ])
  expect(c.parts.map((p) => p.bytes)).toEqual([10, 5, 0, 30, 15])
  expect(c.parts.map((p) => p.share)).toEqual([0.1, 0.05, 0, 0.3, 0.15])
  expect(c.freeBytes).toBe(40)
  expect(c.freeShare).toBe(0.4)
})

test('묶음 합이 사용량을 넘으면 같은 비율로 줄여 사용량에 맞춘다', () => {
  // 측정 시점이 달라 묶음 합(80)이 사용량(60)보다 크다 → 모두 ×0.75.
  const c = memoryComposition({ totalBytes: 100, usedBytes: 60 }, usage(20, 10, 0, 40, 10))!
  const expected = [15, 7.5, 0, 30, 7.5]
  c.parts.forEach((p, i) => {
    expect(p.bytes).toBeCloseTo(expected[i])
    expect(p.share).toBeCloseTo(expected[i] / 100)
  })
  expect(c.parts.reduce((sum, p) => sum + p.bytes, 0)).toBeCloseTo(60)
  expect(c.freeBytes).toBe(40)
  expect(c.freeShare).toBe(0.4)
})

test('전체를 모르면(0) null', () => {
  expect(memoryComposition({ totalBytes: 0, usedBytes: 0 }, usage(10, 5, 0, 30, 15))).toBeNull()
  expect(
    memoryComposition({ totalBytes: Number.NaN, usedBytes: 50 }, usage(10, 5, 0, 30, 15))
  ).toBeNull()
})

test('믿을 수 없는 값(NaN 묶음·NaN 사용량)은 0, 사용량이 전체보다 크면 전체까지', () => {
  // NaN 묶음은 0: 나머지는 그대로이고 막대가 NaN 이 되지 않는다.
  const nanGroup = memoryComposition({ totalBytes: 100, usedBytes: 60 }, usage(10, NaN, 0, 30, 15))!
  expect(nanGroup.parts.map((p) => p.bytes)).toEqual([10, 0, 0, 30, 15])
  expect(nanGroup.parts.every((p) => Number.isFinite(p.share))).toBe(true)
  // NaN 사용량은 0: 묶음도 0 으로 줄고 남은 메모리는 전체.
  const nanUsed = memoryComposition({ totalBytes: 100, usedBytes: NaN }, usage(10, 5, 0, 30, 15))!
  expect(nanUsed.parts.map((p) => p.bytes)).toEqual([0, 0, 0, 0, 0])
  expect(nanUsed.freeBytes).toBe(100)
  // 사용량 150 > 전체 100: 전체까지 쓰인 것으로, 묶음 합(120)은 100 에 맞춘다.
  const over = memoryComposition({ totalBytes: 100, usedBytes: 150 }, usage(40, 20, 0, 40, 20))!
  expect(over.parts.reduce((sum, p) => sum + p.bytes, 0)).toBeCloseTo(100)
  expect(over.freeBytes).toBe(0)
  expect(over.freeShare).toBe(0)
})

test('풍선말의 %: 반올림하되 0 보다 크고 1% 아래는 소수 한 자리', () => {
  expect([0, 0.125, 0.0937, 1].map(tipPercent)).toEqual([0, 13, 9, 100])
  // "0%" 로 보이지 않게.
  expect([0.004, 0.0030518].map(tipPercent)).toEqual([0.4, 0.3])
})

test('없는 묶음은 0', () => {
  const c = memoryComposition({ totalBytes: 100, usedBytes: 50 }, [
    { group: 'agent', memoryBytes: 20, commitBytes: null, processCount: 3 }
  ])!
  expect(c.parts.map((p) => [p.group, p.bytes, p.share])).toEqual([
    ['devServer', 0, 0],
    ['agent', 20, 0.2],
    ['heavy', 0, 0],
    ['otherApps', 0, 0],
    ['system', 0, 0]
  ])
  expect(c.freeBytes).toBe(50)
})
