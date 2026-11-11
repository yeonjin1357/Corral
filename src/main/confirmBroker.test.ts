import type { Mock } from 'vitest'
import {
  CONFIRM_ACK_TIMEOUT_MS,
  confirmIpcHandlers,
  confirmed,
  createConfirmBroker,
  type ConfirmBroker
} from './confirmBroker'
import type { ConfirmOptions, ConfirmRequest } from '../shared/types'

const KILL: ConfirmOptions = {
  title: '개발 서버 내리기',
  message: ':3000 (shop-web · develop) 을(를) 내릴까요?',
  detail: 'node.exe (PID 4100) 가 종료돼요.',
  buttons: ['내리기', '취소'],
  defaultId: 1,
  cancelId: 1,
  tone: 'danger'
}

const HOOK: ConfirmOptions = {
  title: 'Claude 연동 켜기',
  message: 'Claude Code 설정 파일에 Corral 훅을 더할까요?',
  detail: '설정 파일에 훅을 더해요.',
  buttons: ['켜기', '건너뛰기', '취소'],
  defaultId: 2,
  cancelId: 2
}

interface Setup {
  broker: ConfirmBroker
  sent: ConfirmRequest[]
  native: Mock<(o: ConfirmOptions) => Promise<number>>
  showWindow: Mock<() => void>
  withdraw: Mock<(id: number) => void>
  setReady: (v: boolean) => void
}

function setup(
  over: { ready?: boolean; native?: (o: ConfirmOptions) => Promise<number> } = {}
): Setup {
  let ready = over.ready ?? true
  const sent: ConfirmRequest[] = []
  const native = vi.fn<(o: ConfirmOptions) => Promise<number>>(over.native ?? (async () => 1))
  const showWindow = vi.fn<() => void>()
  const withdraw = vi.fn<(id: number) => void>()
  const broker = createConfirmBroker({
    send: (request) => sent.push(request),
    withdraw,
    ready: () => ready,
    showWindow,
    native,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer)
  })
  return {
    broker,
    sent,
    native,
    showWindow,
    withdraw,
    setReady: (v) => {
      ready = v
    }
  }
}

/** 답이 났는지 볼 수 있게 감싼다. */
function track(promise: Promise<number>): { value: number | null } {
  const state = { value: null as number | null }
  void promise.then((v) => (state.value = v))
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('창을 보이게 하고 요청을 보낸다. 첫 버튼이면 0, 취소하면 cancelId', async () => {
  const { broker, sent, showWindow } = setup()
  const first = broker.ask(KILL)
  expect(showWindow).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([{ ...KILL, id: sent[0].id }])
  broker.shown(sent[0].id)
  broker.reply(sent[0].id, 0)
  await expect(first).resolves.toBe(0)

  const second = broker.ask(KILL)
  broker.shown(sent[1].id)
  broker.reply(sent[1].id, KILL.cancelId)
  await expect(second).resolves.toBe(1)
  expect(sent[1].id).not.toBe(sent[0].id)
})

test('창이 아직 다 뜨지 않았으면 보내지 않고, flush 때 보낸다', async () => {
  const { broker, sent, showWindow, setReady } = setup({ ready: false })
  const answer = track(broker.ask(KILL))
  expect(showWindow).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([])
  // 보내기 전에는 답을 받지 않는다(메인이 보낸 요청에만 답한다).
  for (let id = 0; id < 5; id++) broker.reply(id, 0)
  setReady(true)
  broker.flush()
  expect(sent).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBeNull()
  broker.shown(sent[0].id)
  broker.reply(sent[0].id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(0)
})

test(`화면이 ${CONFIRM_ACK_TIMEOUT_MS / 1000}초 안에 그렸다고 알리지 않으면 OS 확인 창으로 묻고 그 답을 쓴다`, async () => {
  const { broker, sent, native } = setup({ native: async () => 0 })
  const answer = track(broker.ask(KILL))
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS - 1)
  expect(native).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(native).toHaveBeenCalledWith(KILL)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(0)
  // OS 창으로 넘긴 요청은 화면에 다시 건네지 않고, 늦게 온 화면의 알림·답도 받지 않는다.
  expect(broker.pending()).toEqual([])
  broker.shown(sent[0].id)
  broker.reply(sent[0].id, 1)
  expect(native).toHaveBeenCalledTimes(1)
})

test('창이 끝내 뜨지 않아도(flush 가 없어도) 시간이 지나면 OS 확인 창으로 묻는다', async () => {
  const { broker, sent, native } = setup({ ready: false })
  const answer = track(broker.ask(KILL))
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
  expect(sent).toEqual([])
  expect(native).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(1)
})

test('OS 확인 창이 실패하면 취소(cancelId)로 끝낸다', async () => {
  const { broker } = setup({
    native: async () => {
      throw new Error('no window')
    }
  })
  const answer = track(broker.ask(KILL))
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(KILL.cancelId)
})

test('그렸다고 알린 뒤에는 시간 제한이 없다(사용자가 오래 생각할 수 있다)', async () => {
  const { broker, sent, native } = setup()
  const answer = track(broker.ask(KILL))
  broker.shown(sent[0].id)
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
  expect(native).not.toHaveBeenCalled()
  expect(answer.value).toBeNull()
  broker.reply(sent[0].id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(0)
})

test('모르는 id·범위 밖 번호·두 번째 답은 버린다', async () => {
  const { broker, sent } = setup()
  const first = track(broker.ask(HOOK))
  const id = sent[0].id
  broker.shown(id)
  for (const index of [3, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) broker.reply(id, index)
  broker.reply(id + 100, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(first.value).toBeNull()
  broker.reply(id, 1)
  await vi.advanceTimersByTimeAsync(0)
  expect(first.value).toBe(1)

  // 같은 id 에 두 번째 답은 다음 요청에 닿지 않는다.
  const second = track(broker.ask(HOOK))
  broker.reply(id, 0)
  broker.shown(sent[1].id)
  broker.reply(id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(second.value).toBeNull()
  broker.reply(sent[1].id, 2)
  await vi.advanceTimersByTimeAsync(0)
  expect(second.value).toBe(2)
})

test('cancelAll(창이 없어짐·렌더러 죽음)은 답 없는 요청을 모두 cancelId 로 끝낸다', async () => {
  const { broker, sent, native } = setup()
  const a = track(broker.ask(KILL))
  const b = track(broker.ask(HOOK))
  broker.cancelAll()
  await vi.advanceTimersByTimeAsync(0)
  expect(a.value).toBe(KILL.cancelId)
  expect(b.value).toBe(HOOK.cancelId)
  expect(broker.pending()).toEqual([])
  // 남은 시계도 멈춘다(OS 창으로 다시 묻지 않는다).
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS * 2)
  expect(native).not.toHaveBeenCalled()
  expect(sent).toHaveLength(1)
  // 끝난 뒤의 답은 버린다.
  broker.reply(sent[0].id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(a.value).toBe(KILL.cancelId)
})

test('요청 둘은 차례로: 앞의 답이 난 뒤에 다음을 보낸다', async () => {
  const { broker, sent, showWindow } = setup()
  const a = track(broker.ask(KILL))
  const b = track(broker.ask(HOOK))
  expect(sent.map((r) => r.title)).toEqual([KILL.title])
  // 아직 보내지 않은 요청에는 답할 수 없다.
  broker.reply(sent[0].id + 1, 0)
  broker.shown(sent[0].id)
  broker.reply(sent[0].id, 1)
  await vi.advanceTimersByTimeAsync(0)
  expect(a.value).toBe(1)
  expect(b.value).toBeNull()
  expect(sent.map((r) => r.title)).toEqual([KILL.title, HOOK.title])
  expect(showWindow).toHaveBeenCalledTimes(2)
  // 다음 요청의 시계는 그 요청을 보낼 때부터 센다.
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS - 1)
  broker.shown(sent[1].id)
  broker.reply(sent[1].id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(b.value).toBe(0)
})

test('pending() 은 답 없는 요청을 돌려준다(다시 로드된 화면이 받아 가고, 받아 간 요청에는 답할 수 있다)', async () => {
  const { broker, sent } = setup({ ready: false })
  expect(broker.pending()).toEqual([])
  const answer = track(broker.ask(KILL))
  broker.ask(HOOK)
  // 차례를 기다리는 요청은 아직 화면에 건네지 않는다.
  const [request] = broker.pending()
  expect(broker.pending()).toEqual([{ ...KILL, id: request.id }])
  expect(sent).toEqual([])
  broker.shown(request.id)
  broker.reply(request.id, 0)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(0)
  expect(broker.pending().map((r) => r.title)).toEqual([HOOK.title])
})

test('flush 는 답을 기다리는 요청을 다시 보낸다(창이 다시 로드됐을 때)', () => {
  const { broker, sent } = setup()
  broker.ask(KILL)
  broker.shown(sent[0].id)
  broker.flush()
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  broker.reply(sent[0].id, 1)
  broker.flush()
  expect(sent).toHaveLength(2)
})

test('그린 뒤에도 cancelAll(창을 닫아 숨김)이면 취소로 끝내고 화면에서도 거둔다', async () => {
  const { broker, sent, withdraw } = setup()
  const answer = track(broker.ask(KILL))
  broker.shown(sent[0].id)
  broker.cancelAll()
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(KILL.cancelId)
  expect(withdraw.mock.calls).toEqual([[sent[0].id]])
})

describe('거두기(withdraw): 화면에 건넨 요청이 더는 화면에서 답할 수 없게 될 때만', () => {
  test('OS 창으로 넘길 때 거둔다(OS 창보다 먼저)', async () => {
    const order: string[] = []
    const { broker, sent, withdraw, native } = setup({
      native: async () => {
        order.push('native')
        return 1
      }
    })
    withdraw.mockImplementation(() => order.push('withdraw'))
    broker.ask(KILL)
    await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
    expect(native).toHaveBeenCalledTimes(1)
    expect(withdraw.mock.calls).toEqual([[sent[0].id]])
    expect(order).toEqual(['withdraw', 'native'])
  })

  test('화면에 건네지 않은 요청은 OS 창으로 넘겨도 거두지 않는다', async () => {
    const { broker, withdraw, native } = setup({ ready: false })
    broker.ask(KILL)
    await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
    expect(native).toHaveBeenCalledTimes(1)
    expect(withdraw).not.toHaveBeenCalled()
  })

  test('cancelAll 은 건넨 요청만 거둔다(차례를 기다리던 것·건네지 않은 것은 거두지 않는다)', async () => {
    const delivered = setup()
    delivered.broker.ask(KILL)
    delivered.broker.ask(HOOK)
    delivered.broker.cancelAll()
    expect(delivered.withdraw.mock.calls).toEqual([[delivered.sent[0].id]])

    const waiting = setup({ ready: false })
    waiting.broker.ask(KILL)
    waiting.broker.cancelAll()
    expect(waiting.withdraw).not.toHaveBeenCalled()
  })

  test('OS 창이 떠 있는 중에 cancelAll: 다시 거두지 않고 취소로 끝내며, 늦게 온 OS 창 답은 버린다', async () => {
    let answerNative: (index: number) => void = () => {}
    const { broker, sent, withdraw } = setup({
      native: () => new Promise<number>((resolve) => (answerNative = resolve))
    })
    const answer = track(broker.ask(KILL))
    await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
    expect(withdraw).toHaveBeenCalledTimes(1)
    broker.cancelAll()
    await vi.advanceTimersByTimeAsync(0)
    expect(answer.value).toBe(KILL.cancelId)
    expect(withdraw).toHaveBeenCalledTimes(1)
    answerNative(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(answer.value).toBe(KILL.cancelId)
    // 다음 요청은 그대로 묻는다.
    broker.ask(HOOK)
    expect(sent.map((r) => r.title)).toEqual([KILL.title, HOOK.title])
  })
})

test('OS 창이 범위 밖 번호를 돌려주면 취소(cancelId)', async () => {
  const { broker } = setup({ native: async () => 7 })
  const answer = track(broker.ask(KILL))
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(KILL.cancelId)
})

test('defaultId·cancelId 가 버튼 범위 밖이면 묻지 않고 바로 취소로 끝낸다', async () => {
  const { broker, sent, showWindow, native } = setup()
  // 기본 버튼이 잘못됐으면 cancelId 로.
  await expect(broker.ask({ ...KILL, defaultId: 2 })).resolves.toBe(KILL.cancelId)
  await expect(broker.ask({ ...KILL, defaultId: 0.5 })).resolves.toBe(KILL.cancelId)
  // 취소 버튼이 잘못됐으면 어느 버튼도 아닌 -1 로.
  await expect(broker.ask({ ...KILL, cancelId: 2 })).resolves.toBe(-1)
  await expect(broker.ask({ ...KILL, cancelId: -1 })).resolves.toBe(-1)
  await expect(broker.ask({ ...KILL, buttons: [], defaultId: 0, cancelId: 0 })).resolves.toBe(-1)
  expect(sent).toEqual([])
  expect(showWindow).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
  expect(native).not.toHaveBeenCalled()
  // 다음 정상 요청은 그대로 묻는다.
  broker.ask(KILL)
  expect(sent).toHaveLength(1)
})

test('confirmed: 첫 버튼이고 첫 버튼이 취소가 아닐 때만 "예"', () => {
  expect(confirmed(KILL, 0)).toBe(true)
  expect(confirmed(KILL, 1)).toBe(false)
  expect(confirmed(KILL, -1)).toBe(false)
  expect(confirmed({ ...KILL, cancelId: 0, defaultId: 0 }, 0)).toBe(false)
})

test('다시 로드된 화면(flush)이 다시 그렸다고 알리지 않으면 OS 창으로 묻는다', async () => {
  const { broker, sent, native } = setup()
  const answer = track(broker.ask(KILL))
  broker.shown(sent[0].id)
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
  expect(native).not.toHaveBeenCalled()
  broker.flush()
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS - 1)
  expect(native).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(native).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(answer.value).toBe(1)
})

test('다시 로드된 화면이 다시 그렸다고 알리면 시간 제한이 다시 없어진다', async () => {
  const { broker, sent, native } = setup()
  broker.ask(KILL)
  broker.shown(sent[0].id)
  broker.flush()
  broker.shown(sent[0].id)
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS * 3)
  expect(native).not.toHaveBeenCalled()
})

test('처음 뜰 때의 flush 는 이미 도는 시계를 늘리지 않는다', async () => {
  const { broker, native, setReady } = setup({ ready: false })
  broker.ask(KILL)
  await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS - 1000)
  setReady(true)
  broker.flush()
  await vi.advanceTimersByTimeAsync(1000)
  expect(native).toHaveBeenCalledTimes(1)
})

describe('IPC 핸들러', () => {
  const MAIN = { name: 'main' }
  const TRAY = { name: 'tray' }

  function wire(): Setup & { ipc: ReturnType<typeof confirmIpcHandlers<object>> } {
    const s = setup()
    const ipc = confirmIpcHandlers(s.broker, (sender: object) => sender === MAIN)
    return { ...s, ipc }
  }

  test('메인 창이 아닌 곳에서 온 것은 버린다', async () => {
    const { broker, sent, ipc, native } = wire()
    const answer = track(broker.ask(KILL))
    const id = sent[0].id
    expect(ipc.pending(TRAY)).toEqual([])
    ipc.shown(TRAY, id)
    ipc.reply(TRAY, id, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(answer.value).toBeNull()
    // 그렸다는 알림도 받지 않았으니 시간이 지나면 OS 창으로 묻는다.
    await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
    expect(native).toHaveBeenCalledTimes(1)
  })

  test('메인 창에서 온 것은 형식을 보고 넘긴다', async () => {
    const { broker, sent, ipc, native } = wire()
    const answer = track(broker.ask(KILL))
    const id = sent[0].id
    expect(ipc.pending(MAIN)).toEqual([sent[0]])
    ipc.shown(MAIN, String(id))
    ipc.reply(MAIN, String(id), 0)
    ipc.reply(MAIN, id, '0')
    await vi.advanceTimersByTimeAsync(0)
    expect(answer.value).toBeNull()
    ipc.shown(MAIN, id)
    await vi.advanceTimersByTimeAsync(CONFIRM_ACK_TIMEOUT_MS)
    expect(native).not.toHaveBeenCalled()
    ipc.reply(MAIN, id, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(answer.value).toBe(0)
  })
})
