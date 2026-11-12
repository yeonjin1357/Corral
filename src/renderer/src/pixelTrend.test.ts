import { pixelBuckets } from './pixelTrend'

const END = 240_000
const WINDOW = 240_000

test('24 칸으로 나눠 칸마다 최댓값, 점이 없는 칸은 null', () => {
  const out = pixelBuckets(
    [
      { t: 15_000, value: 40 },
      { t: 18_000, value: 55 }
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
  expect(out[9]).toBe(10)
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
  // 칸 경계는 절대 시각에 붙는다: 창은 [170_000, 410_000) 칸들, 1_000 과 130_000 은 밖.
  expect(out.filter((v) => v != null)).toEqual([98])
  expect(out[23]).toBe(98)
})

test('점이 없으면 모두 null', () => {
  expect(pixelBuckets([], 0, WINDOW, 24)).toEqual(Array(24).fill(null))
})

test('수집 간격(30초)이 칸(25초)보다 길어도 덮인 구간엔 빈 칸이 없다', () => {
  const W = 600_000 // 24 칸 → 칸 25초
  const pts = Array.from({ length: 21 }, (_, i) => ({ t: 30_000 * i, value: 10 + i }))
  const out = pixelBuckets(pts, 600_000, W, 24)
  const first = out.findIndex((v) => v != null)
  expect(first).toBeGreaterThanOrEqual(0)
  expect(out.slice(first).every((v) => v != null)).toBe(true)
})

test('gapMs 보다 길게 끊긴 구간은 이어 주지 않는다', () => {
  const out = pixelBuckets(
    [
      { t: 20_000, value: 30 },
      { t: 30_000, value: 40 },
      { t: 200_000, value: 50 },
      { t: 240_000, value: 60 }
    ],
    240_000,
    240_000,
    24,
    60_000
  )
  // 30_000(칸 2) 과 200_000(칸 19) 사이는 170 초 > gapMs → 빈 칸.
  expect(out.slice(3, 19).every((v) => v === null)).toBe(true)
  // 200_000(칸 19) 과 240_000(칸 23) 사이는 40 초 ≤ gapMs → 이어짐.
  expect(out.slice(19, 24).every((v) => v != null)).toBe(true)
})

test('gapMs 가 없으면 앞뒤에 점이 있는 빈 칸은 모두 잇고, 첫 점 앞은 비운다', () => {
  const out = pixelBuckets(
    [
      { t: 100_000, value: 30 },
      { t: 240_000, value: 60 }
    ],
    240_000,
    240_000,
    24
  )
  expect(out.slice(0, 9).every((v) => v === null)).toBe(true)
  expect(out.slice(9).every((v) => v != null)).toBe(true)
})

test('end 가 한 칸보다 적게 흘러도 같은 점의 칸 값은 그대로다', () => {
  const pts = [
    { t: 100_000, value: 30 },
    { t: 170_000, value: 50 },
    { t: 232_000, value: 70 }
  ]
  const a = pixelBuckets(pts, 232_000, 240_000, 24)
  const b = pixelBuckets(pts, 238_000, 240_000, 24)
  expect(b).toEqual(a)
})

test('windowMs 나 count 가 0 이하면 모두 null', () => {
  expect(pixelBuckets([{ t: 1, value: 5 }], 1, 0, 24)).toEqual(Array(24).fill(null))
  expect(pixelBuckets([{ t: 1, value: 5 }], 1, 1000, 0)).toEqual([])
})
