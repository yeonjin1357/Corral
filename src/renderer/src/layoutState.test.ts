import { TOP_HEIGHTS, readTopMode, snapTopMode, writeTopMode } from './layoutState'

function memoryStorage(
  initial: Record<string, string> = {}
): Storage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  } as Storage & { data: Record<string, string> }
}

test('단계는 저장한 값, 모르거나 읽지 못하면 자세히', () => {
  const storage = memoryStorage()
  // 처음은 자세히.
  expect(readTopMode(storage)).toBe('full')
  writeTopMode(storage, 'collapsed')
  expect(storage.data['pitwall.topMode']).toBe('collapsed')
  expect(readTopMode(storage)).toBe('collapsed')
  writeTopMode(storage, 'compact')
  expect(readTopMode(storage)).toBe('compact')
  // 모르는 값·저장소 없음·막힌 저장소는 자세히, 쓰기가 막혀도 오류를 내지 않는다.
  expect(readTopMode(memoryStorage({ 'pitwall.topMode': 'tiny' }))).toBe('full')
  expect(readTopMode(null)).toBe('full')
  const blocked = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  expect(readTopMode(blocked)).toBe('full')
  expect(() => writeTopMode(blocked, 'compact')).not.toThrow()
  expect(() => writeTopMode(null, 'compact')).not.toThrow()
})

test('놓은 높이에 가장 가까운 단계', () => {
  const heights = { full: 260, compact: 92, collapsed: 0 }
  expect(snapTopMode(300, heights)).toBe('full')
  expect(snapTopMode(200, heights)).toBe('full')
  expect(snapTopMode(150, heights)).toBe('compact')
  expect(snapTopMode(92, heights)).toBe('compact')
  expect(snapTopMode(50, heights)).toBe('compact')
  expect(snapTopMode(40, heights)).toBe('collapsed')
  expect(snapTopMode(-20, heights)).toBe('collapsed')
  // 두 단계의 가운데면 큰 쪽.
  expect(snapTopMode(176, heights)).toBe('full')
  expect(snapTopMode(46, heights)).toBe('compact')
  // 숫자가 아니면 가장 큰 단계.
  expect(snapTopMode(NaN, heights)).toBe('full')
  // 화면이 쓰는 높이는 큰 단계일수록 높다(접기는 0).
  expect(TOP_HEIGHTS.full).toBeGreaterThan(TOP_HEIGHTS.compact)
  expect(TOP_HEIGHTS.compact).toBeGreaterThan(TOP_HEIGHTS.collapsed)
  expect(TOP_HEIGHTS.collapsed).toBe(0)
})
