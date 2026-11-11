import { fitGroups, groupPoint, safeBytes, usedWithin } from './memoryGroups'
import type { GroupUsage, ProcessGroup } from './types'

function groups(bytes: Partial<Record<ProcessGroup, number>>): GroupUsage[] {
  return (Object.keys(bytes) as ProcessGroup[]).map((group) => ({
    group,
    memoryBytes: bytes[group]!,
    commitBytes: null,
    processCount: 2
  }))
}
const bytesOf = (list: GroupUsage[]): Record<string, number> =>
  Object.fromEntries(list.map((g) => [g.group, g.memoryBytes]))

test('바이트 값: 유한한 수가 아니면 0, 음수는 0', () => {
  expect([5, 0, -3, Number.NaN, Infinity, -Infinity].map(safeBytes)).toEqual([5, 0, 0, 0, 0, 0])
})

test('사용량은 전체 안으로 자르고, 믿을 수 없는 값은 0', () => {
  expect(usedWithin({ totalBytes: 100, usedBytes: 60 })).toEqual({ total: 100, used: 60 })
  expect(usedWithin({ totalBytes: 100, usedBytes: 150 })).toEqual({ total: 100, used: 100 })
  expect(usedWithin({ totalBytes: 100, usedBytes: Number.NaN })).toEqual({ total: 100, used: 0 })
  expect(usedWithin({ totalBytes: Number.NaN, usedBytes: 60 })).toEqual({ total: 0, used: 0 })
})

test('묶음 합이 사용량을 넘으면 모든 묶음을 같은 비율로 줄이고(메인 기록·화면이 같은 규칙), 아니면 그대로', () => {
  const memory = { totalBytes: 100, usedBytes: 60 }
  // 80 > 60 → 모두 ×0.75. 묶음의 다른 값(커밋·프로세스 수)은 그대로.
  const fitted = fitGroups(memory, groups({ devServer: 20, agent: 10, otherApps: 40, system: 10 }))
  expect(bytesOf(fitted)).toEqual({ devServer: 15, agent: 7.5, otherApps: 30, system: 7.5 })
  expect(fitted.every((g) => g.processCount === 2 && g.commitBytes === null)).toBe(true)
  // 50 ≤ 60 → 그대로.
  expect(bytesOf(fitGroups(memory, groups({ devServer: 20, otherApps: 30 })))).toEqual({
    devServer: 20,
    otherApps: 30
  })
  // 사용량이 전체보다 크면 전체까지만.
  const over = fitGroups({ totalBytes: 100, usedBytes: 150 }, groups({ otherApps: 200 }))
  expect(bytesOf(over)).toEqual({ otherApps: 100 })
})

test('믿을 수 없는 묶음 값·사용량은 0 으로 본다', () => {
  const memory = { totalBytes: 100, usedBytes: 60 }
  expect(
    bytesOf(fitGroups(memory, groups({ devServer: Number.NaN, agent: -5, system: 10 })))
  ).toEqual({ devServer: 0, agent: 0, system: 10 })
  expect(
    bytesOf(fitGroups({ totalBytes: 100, usedBytes: Number.NaN }, groups({ system: 10 })))
  ).toEqual({ system: 0 })
})

test('묶음 추이의 한 점: 없는 묶음과 유한하지 않은 값은 0', () => {
  expect(
    groupPoint(7, groups({ devServer: 3, agent: Number.NaN, heavy: Infinity, otherApps: -1 }))
  ).toEqual({ t: 7, devServer: 3, agent: 0, heavy: 0, otherApps: 0, system: 0 })
})
