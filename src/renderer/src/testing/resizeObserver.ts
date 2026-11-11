/**
 * 시험용 ResizeObserver 가 지켜보는 요소 하나: 요소·옵션, 그 요소가 바뀐 것처럼 콜백을 부르는 함수, 그 요소를 지켜보는
 * 관찰자가 끊겼는지(disconnect). 한 화면에 관찰자가 여럿이어도(카드 줄·추이 그래프 너비) 어느 것이 끊겼는지 가른다.
 */
export interface ResizeWatch {
  el: Element
  options: ResizeObserverOptions | undefined
  fire: () => void
  disconnected: () => boolean
}

/**
 * happy-dom 의 ResizeObserver 는 부르지 않으므로 바꿔 끼운다. 지켜보는 요소마다 콜백을 기억해 두고 시험이 원할 때 부른다.
 * 시험이 끝나면 restore() 로 ResizeObserver 만 되돌린다(시험이 따로 바꿔 둔 다른 전역은 그대로).
 */
export function fakeResizeObserver(): {
  watches: ResizeWatch[]
  /** 모든 관찰자의 disconnect 횟수. */
  disconnected: () => number
  restore: () => void
} {
  const watches: ResizeWatch[] = []
  let disconnected = 0
  class FakeResizeObserver {
    private readonly callback: ResizeObserverCallback
    private stopped = false
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(el: Element, options?: ResizeObserverOptions): void {
      watches.push({
        el,
        options,
        fire: () => this.callback([], this as unknown as ResizeObserver),
        disconnected: () => this.stopped
      })
    }
    unobserve(el: Element): void {
      const i = watches.findIndex((w) => w.el === el)
      if (i >= 0) watches.splice(i, 1)
    }
    disconnect(): void {
      this.stopped = true
      disconnected++
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: FakeResizeObserver
  })
  return {
    watches,
    disconnected: () => disconnected,
    restore: () => {
      if (original) Object.defineProperty(globalThis, 'ResizeObserver', original)
      else Reflect.deleteProperty(globalThis, 'ResizeObserver')
    }
  }
}

/** 요소의 바깥 높이(offsetHeight)와 안쪽 높이(clientHeight)를 정한다(happy-dom 은 늘 0). */
export function setBoxHeights(el: Element, offsetHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: offsetHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
}
