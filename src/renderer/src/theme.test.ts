// @vitest-environment happy-dom
import { watchColorScheme } from './theme'

function fakeMatchMedia(initial: boolean): {
  matchMedia: (q: string) => MediaQueryList
  set(dark: boolean): void
} {
  let listener: ((e: MediaQueryListEvent) => void) | null = null
  const mql = {
    matches: initial,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => (listener = l),
    removeEventListener: () => (listener = null)
  } as unknown as MediaQueryList
  return {
    matchMedia: () => mql,
    set(dark) {
      ;(mql as { matches: boolean }).matches = dark
      listener?.({ matches: dark } as MediaQueryListEvent)
    }
  }
}

test('OS 다크 모드를 따라 body.dark 를 켜고 끄며, 해제하면 더 이상 따라가지 않는다', () => {
  const fake = fakeMatchMedia(true)
  const stop = watchColorScheme(fake.matchMedia, document.body)
  expect(document.body.classList.contains('dark')).toBe(true)
  fake.set(false)
  expect(document.body.classList.contains('dark')).toBe(false)
  stop()
  fake.set(true)
  expect(document.body.classList.contains('dark')).toBe(false)
})
