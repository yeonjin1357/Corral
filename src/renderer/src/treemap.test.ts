import { squarify, type TreemapRect } from './treemap'

const RECT: TreemapRect = { x: 10, y: 20, w: 400, h: 240 }
const area = (r: TreemapRect): number => r.w * r.h
const aspect = (r: TreemapRect): number => Math.max(r.w, r.h) / Math.min(r.w, r.h)

/** 두 사각형이 넓이를 가진 채 겹치는지(맞닿기만 한 것은 겹침이 아니다). */
function overlaps(a: TreemapRect, b: TreemapRect): boolean {
  const e = 1e-6
  return a.x + e < b.x + b.w && b.x + e < a.x + a.w && a.y + e < b.y + b.h && b.y + e < a.y + a.h
}

test('넓이는 값에 비례하고 직사각형을 빈틈없이 채운다', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ id: `n${i}`, value }))
  const total = items.reduce((sum, i) => sum + i.value, 0)
  const out = squarify(items, RECT)

  expect(out).toHaveLength(items.length)
  // 큰 값부터.
  expect(out.map((r) => r.item.value)).toEqual([6, 6, 4, 3, 2, 2, 1])
  for (const r of out) {
    expect(area(r)).toBeCloseTo((r.item.value / total) * area(RECT), 6)
    // 직사각형 안에 있다.
    expect(r.x).toBeGreaterThanOrEqual(RECT.x - 1e-9)
    expect(r.y).toBeGreaterThanOrEqual(RECT.y - 1e-9)
    expect(r.x + r.w).toBeLessThanOrEqual(RECT.x + RECT.w + 1e-9)
    expect(r.y + r.h).toBeLessThanOrEqual(RECT.y + RECT.h + 1e-9)
  }
  // 겹치지 않고 넓이 합이 직사각형과 같다 = 빈틈이 없다.
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i], out[j])).toBe(false)
  expect(out.reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(area(RECT), 6)
  // 항목이 하나면 직사각형 전체.
  expect(squarify([{ value: 5 }], RECT)).toEqual([{ ...RECT, item: { value: 5 } }])
})

test('0 이하 값은 빠진다', () => {
  const out = squarify(
    [{ value: 3 }, { value: 0 }, { value: -2 }, { value: Number.NaN }, { value: 1 }],
    RECT
  )
  expect(out.map((r) => r.item.value)).toEqual([3, 1])
  expect(out.reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(area(RECT), 6)
  expect(squarify([{ value: 0 }], RECT)).toEqual([])
  expect(squarify([], RECT)).toEqual([])
  // 넓이가 없는 직사각형에는 놓을 수 없다.
  expect(squarify([{ value: 1 }], { x: 0, y: 0, w: 0, h: 100 })).toEqual([])
})

test('가로세로 비가 한쪽으로 치우치지 않는다(가장 긴 변/짧은 변 ≤ 4, 항목이 비슷할 때)', () => {
  const similar = [10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5].map((value) => ({ value }))
  for (const rect of [RECT, { x: 0, y: 0, w: 240, h: 400 }, { x: 0, y: 0, w: 600, h: 200 }]) {
    const out = squarify(similar, rect)
    expect(out).toHaveLength(similar.length)
    for (const r of out) expect(aspect(r)).toBeLessThanOrEqual(4)
  }
})
