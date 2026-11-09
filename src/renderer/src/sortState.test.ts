import { readSorts, resolveSort, writeSorts } from './sortState'
import { tableFor } from './rows'
import { snapshot } from './testing/fixtures'

const table = tableFor('ports', snapshot())

test('저장한 정렬이 지금 표에 있는 칸이면 그것을, 없으면(칸이 없어짐) 표의 기본 정렬', () => {
  expect(resolveSort({ id: 'memory', dir: 'asc' }, table)).toEqual({ id: 'memory', dir: 'asc' })
  expect(resolveSort({ id: 'tool', dir: 'asc' }, table)).toEqual(table.sort)
  expect(resolveSort(undefined, table)).toEqual(table.sort)
})

test('탭별 정렬을 저장했다가 다시 읽는다', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v)
  }
  writeSorts(storage, { ports: { id: 'memory', dir: 'desc' } })
  expect(readSorts(storage)).toEqual({ ports: { id: 'memory', dir: 'desc' } })
})

test('저장소가 없거나 깨졌거나 막혀도 빈 값으로 넘어간다(앱이 멈추지 않는다)', () => {
  expect(readSorts(null)).toEqual({})
  expect(readSorts({ getItem: () => '{ broken', setItem: () => {} })).toEqual({})
  expect(
    readSorts({ getItem: () => JSON.stringify({ ports: { id: 3, dir: 'up' } }), setItem: () => {} })
  ).toEqual({})
  const throwing = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    }
  }
  expect(readSorts(throwing)).toEqual({})
  expect(() => writeSorts(throwing, {})).not.toThrow()
})
