import type { ConfirmOptions, ConfirmRequest } from '../shared/types'

/**
 * 확인 창 중개(메인이 묻고 화면은 그리기만 한다).
 *
 * 메인은 "이 내용으로 물어봐 줘"라고 메인 창 화면에 보내고, 화면은 그려서 누른 버튼 번호만 돌려준다.
 * 판단은 모두 여기서 한다:
 * - 답은 메인이 화면에 건넨(보냈거나 pending 으로 받아 간), 아직 답이 없는 요청 id 에만 받는다. 한 요청에 한 번만.
 * - 화면이 시간 안에 그렸다고 알리지 않으면 OS 확인 창으로 대신 묻는다(실행 쪽으로 기울지 않는다).
 *   시계는 요청을 화면에 내놓을 때(창을 보이게 할 때)부터 센다 — 창이 끝내 뜨지 않아도 OS 창으로 넘어간다.
 * - 그린 뒤에는 시간 제한이 없다(사용자가 오래 생각할 수 있다). 창이 다시 로드되면(flush) 다시 센다.
 * - 창을 닫거나(숨김) 창이 없어지거나 렌더러가 죽으면(cancelAll) 답이 없는 요청은 모두 취소(cancelId)로 끝낸다.
 * - 화면에 건넨 요청을 OS 창으로 넘기거나 취소하면 화면에서도 거둔다(withdraw) — 늦게 그린 창이 남지 않게.
 * - defaultId·cancelId 가 버튼 범위 밖인 요청은 묻지 않고 바로 취소로 끝낸다.
 * - 화면은 한 번에 하나만 보이므로 요청은 차례로 묻는다.
 */

/** 화면이 요청을 받아 그렸다고 알려야 하는 시간. 넘으면 OS 확인 창으로 묻는다. */
export const CONFIRM_ACK_TIMEOUT_MS = 10_000

type Timer = ReturnType<typeof setTimeout>

export interface ConfirmBrokerDeps {
  /** 메인 창 화면에 그려 달라고 보낸다(pitwall:confirm-request). */
  send(request: ConfirmRequest): void
  /** 건넨 요청을 화면에서 거둔다(pitwall:confirm-withdraw) — 더는 화면에서 답할 수 없게 됐을 때. */
  withdraw(id: number): void
  /** 메인 창이 있고 다 떠서 보내면 바로 받을 수 있는지. */
  ready(): boolean
  /** 메인 창을 보이게 한다(없으면 만든다). */
  showWindow(): void
  /** 화면이 그리지 못할 때 OS 기본 확인 창으로 묻는다. 누른 버튼 번호. */
  native(options: ConfirmOptions): Promise<number>
  /** 기본 CONFIRM_ACK_TIMEOUT_MS. */
  ackTimeoutMs?: number
  setTimeout?: (fn: () => void, ms: number) => Timer
  clearTimeout?: (timer: Timer) => void
}

export interface ConfirmBroker {
  /**
   * 묻는다. 누른 버튼 번호(취소는 cancelId). defaultId·cancelId 가 버튼 범위 밖이면 묻지 않고 바로
   * cancelId(그것도 범위 밖이면 어느 버튼도 아닌 -1)로 끝낸다.
   */
  ask(options: ConfirmOptions): Promise<number>
  /** 화면이 그 요청을 그렸다(이제 시간 제한 없음). */
  shown(id: number): void
  /** 화면에서 누른 버튼 번호. 건넨 요청·범위 안 번호·처음 답만 받는다. */
  reply(id: number, index: number): void
  /**
   * 아직 답이 없고 화면에 보낼 요청(지금 묻는 것 하나 — 차례를 기다리는 요청은 아직 내놓지 않는다).
   * 화면이 처음 그려질 때·다시 로드됐을 때 받아 가며, 받아 간 요청은 건넨 것으로 본다.
   */
  pending(): ConfirmRequest[]
  /**
   * 창이 다 떴을 때(did-finish-load, 다시 로드돼도): 화면에 보낼 요청을 (다시) 보낸다. 이미 그렸다고 들은 요청이면
   * 시계를 다시 켠다(다시 로드된 화면이 그리지 못하면 OS 창으로 넘어가게).
   */
  flush(): void
  /** 창을 닫음(숨김)·창이 없어짐·렌더러가 죽음: 답이 없는 요청을 모두 취소(cancelId)로 끝낸다. */
  cancelAll(): void
}

interface Entry {
  request: ConfirmRequest
  options: ConfirmOptions
  resolve: (index: number) => void
  /** 화면에 건넸는지(send 또는 pending). 건넨 요청에만 화면의 알림·답을 받는다. */
  delivered: boolean
  /** OS 창으로 넘겼는지. 넘긴 뒤에는 화면의 알림·답을 받지 않고, 화면에 다시 건네지 않는다. */
  native: boolean
  done: boolean
  timer: Timer | null
}

function validIndex(options: ConfirmOptions, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < options.buttons.length
}

/** 확인 창의 답이 "예"(실행)인지: 첫 버튼이고, 첫 버튼이 취소 버튼이 아닐 때만. */
export function confirmed(options: ConfirmOptions, index: number): boolean {
  return index === 0 && options.cancelId !== 0
}

export function createConfirmBroker(deps: ConfirmBrokerDeps): ConfirmBroker {
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number): Timer => setTimeout(fn, ms))
  const unschedule = deps.clearTimeout ?? ((timer: Timer): void => clearTimeout(timer))
  const ackMs = deps.ackTimeoutMs ?? CONFIRM_ACK_TIMEOUT_MS
  let nextId = 1
  let active: Entry | null = null
  const queue: Entry[] = []

  function stopClock(entry: Entry): void {
    if (entry.timer) unschedule(entry.timer)
    entry.timer = null
  }

  function finish(entry: Entry, index: number): void {
    if (entry.done) return
    entry.done = true
    stopClock(entry)
    entry.resolve(index)
    if (active === entry) {
      active = null
      startNext()
    }
  }

  function deliver(entry: Entry): void {
    entry.delivered = true
    deps.send(entry.request)
  }

  /** 화면이 그렸다고 알릴 때까지 센다(넘으면 OS 창으로). */
  function startClock(entry: Entry): void {
    stopClock(entry)
    entry.timer = schedule(() => fallBack(entry), ackMs)
  }

  function startNext(): void {
    if (active) return
    const entry = queue.shift()
    if (!entry) return
    active = entry
    startClock(entry)
    deps.showWindow()
    if (deps.ready()) deliver(entry)
  }

  /** 화면이 시간 안에 그리지 못했다: 화면에서 거두고 OS 확인 창으로 묻는다(실패하면 취소). */
  function fallBack(entry: Entry): void {
    entry.timer = null
    if (entry.done || entry.native) return
    entry.native = true
    if (entry.delivered) deps.withdraw(entry.request.id)
    const cancel = entry.options.cancelId
    deps.native(entry.options).then(
      (index) => finish(entry, validIndex(entry.options, index) ? index : cancel),
      () => finish(entry, cancel)
    )
  }

  /** 화면의 알림·답을 받을 요청: 지금 묻는, 화면에 건넨, OS 창으로 넘기지 않은, 답이 없는 요청. */
  function onScreen(id: number): Entry | null {
    const entry = active
    if (!entry || entry.done || entry.native || !entry.delivered) return null
    return entry.request.id === id ? entry : null
  }

  return {
    ask(options) {
      // 버튼이 잘못된 요청은 묻지 않는다(첫 버튼이 기본·취소로 잘못 잡히지 않게).
      if (!validIndex(options, options.defaultId) || !validIndex(options, options.cancelId))
        return Promise.resolve(validIndex(options, options.cancelId) ? options.cancelId : -1)
      return new Promise<number>((resolve) => {
        queue.push({
          request: { ...options, id: nextId++ },
          options,
          resolve,
          delivered: false,
          native: false,
          done: false,
          timer: null
        })
        startNext()
      })
    },
    shown(id) {
      const entry = onScreen(id)
      if (entry) stopClock(entry)
    },
    reply(id, index) {
      const entry = onScreen(id)
      if (entry && validIndex(entry.options, index)) finish(entry, index)
    },
    pending() {
      const entry = active
      if (!entry || entry.done || entry.native) return []
      entry.delivered = true
      return [entry.request]
    },
    flush() {
      const entry = active
      if (!entry || entry.done || entry.native) return
      if (!entry.timer) startClock(entry)
      deliver(entry)
    },
    cancelAll() {
      const current = active
      const all = [...(current ? [current] : []), ...queue.splice(0)]
      active = null
      // 화면에 남아 있는 요청(건넸고 OS 창으로 넘기지 않은 것)은 화면에서도 거둔다.
      if (current && current.delivered && !current.native && !current.done)
        deps.withdraw(current.request.id)
      for (const entry of all) finish(entry, entry.options.cancelId)
    }
  }
}

/**
 * 화면에서 오는 IPC(pitwall:confirm-*)를 받는 함수들. 메인 창에서 온 것만, 형식이 맞는 것만 넘긴다
 * (트레이 요약 창 등 다른 곳에서 온 답은 버린다).
 */
export function confirmIpcHandlers<S>(
  broker: ConfirmBroker,
  fromMainWindow: (sender: S) => boolean
): {
  pending(sender: S): ConfirmRequest[]
  shown(sender: S, id: unknown): void
  reply(sender: S, id: unknown, index: unknown): void
} {
  return {
    pending: (sender) => (fromMainWindow(sender) ? broker.pending() : []),
    shown(sender, id) {
      if (fromMainWindow(sender) && typeof id === 'number') broker.shown(id)
    },
    reply(sender, id, index) {
      if (fromMainWindow(sender) && typeof id === 'number' && typeof index === 'number')
        broker.reply(id, index)
    }
  }
}
