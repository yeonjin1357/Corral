import { pixelBuckets } from './pixelTrend'

const END = 240_000
const WINDOW = 240_000

test('24 칸으로 나눠 칸마다 최댓값, 점이 없는 칸은 null', () => {
  const out = pixelBuckets(
    [
      { t: 5_000, value: 40 },
      { t: 8_000, value: 55 }
    ],
    END,
    WINDOW,
    24
  )
  expect(out).toHaveLength(24)
  expect(out[0]).toBe(55)
  expect(out[1]).toBeNull()
  expect(out.slice(1).every((v) => v === null)).toBe(true)
})

test('끝 시각의 점은 마지막 칸에 든다', () => {
  const out = pixelBuckets(
    [
      { t: 100_000, value: 10 },
      { t: END, value: 77 }
    ],
    END,
    WINDOW,
    24
  )
  expect(out[23]).toBe(77)
  expect(out[10]).toBe(10)
})

test('창 밖(오래된) 점은 버린다', () => {
  const out = pixelBuckets(
    [
      { t: 1_000, value: 99 },
      { t: 130_000, value: 20 },
      { t: 400_000, value: 98 }
    ],
    400_000,
    WINDOW,
    24
  )
  // 창은 [160_000, 400_000): 1_000 과 130_000 은 밖.
  expect(out.filter((v) => v != null)).toEqual([98])
  expect(out[23]).toBe(98)
})

test('점이 없으면 모두 null', () => {
  expect(pixelBuckets([], 0, WINDOW, 24)).toEqual(Array(24).fill(null))
})
