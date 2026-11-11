// @vitest-environment happy-dom
import { fakeResizeObserver } from './resizeObserver'

test('restore() 는 ResizeObserver 만 되돌리고 다른 전역 스텁은 그대로 둔다', () => {
  const original = globalThis.ResizeObserver
  vi.stubGlobal('otherStub', 1)
  try {
    const resize = fakeResizeObserver()
    expect(globalThis.ResizeObserver).not.toBe(original)
    resize.restore()
    expect(globalThis.ResizeObserver).toBe(original)
    expect((globalThis as Record<string, unknown>).otherStub).toBe(1)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('지켜보는 요소마다 그 관찰자가 끊겼는지 따로 안다', () => {
  const resize = fakeResizeObserver()
  try {
    const a = document.createElement('div')
    const b = document.createElement('div')
    const first = new ResizeObserver(() => {})
    const second = new ResizeObserver(() => {})
    first.observe(a)
    second.observe(b)
    first.disconnect()
    expect(resize.watches.map((w) => [w.el, w.disconnected()])).toEqual([
      [a, true],
      [b, false]
    ])
    expect(resize.disconnected()).toBe(1)
  } finally {
    resize.restore()
  }
})
