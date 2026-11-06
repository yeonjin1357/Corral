import { sample, toPlatform } from './sample'
import type { RawSample } from '../../shared/types'

const empty: RawSample = { processes: [], tcp: [] }

test('플랫폼별 샘플러를 고른다', async () => {
  const win32 = vi.fn(async () => empty)
  const darwin = vi.fn(async () => empty)
  await sample('win32', { win32, darwin })
  await sample('darwin', { win32, darwin })
  expect(win32).toHaveBeenCalledTimes(1)
  expect(darwin).toHaveBeenCalledTimes(1)
})

test('지원하지 않는 OS 는 null', () => {
  expect(toPlatform('win32')).toBe('win32')
  expect(toPlatform('darwin')).toBe('darwin')
  expect(toPlatform('linux')).toBeNull()
})
