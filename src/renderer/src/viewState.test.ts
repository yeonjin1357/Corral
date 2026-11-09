import { readServerView, writeServerView } from './viewState'

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

test('목록/묶음 전환은 기억한다(처음은 묶음)', () => {
  const storage = memoryStorage()
  expect(readServerView(storage)).toBe('group')
  writeServerView(storage, 'list')
  expect(readServerView(storage)).toBe('list')
})

test('저장소가 없거나 깨진 값이면 묶음, 저장이 막혀도 오류를 내지 않는다', () => {
  expect(readServerView(null)).toBe('group')
  expect(readServerView(memoryStorage({ 'pitwall.serverView': 'tree' }))).toBe('group')
  const blocked = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  expect(readServerView(blocked)).toBe('group')
  expect(() => writeServerView(blocked, 'list')).not.toThrow()
})
