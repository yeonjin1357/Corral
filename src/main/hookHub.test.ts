import { createHookHub } from './hookHub'
import type { HookServer } from './hookServer'

/** 같은 포트를 두 번 열면 실패하는 가짜 서버(실제 listen 의 EADDRINUSE 처럼). 여는 데 시간이 걸린다. */
function fakeOpen(): { open: Parameters<typeof createHookHub>[0]['open']; opened: number[] } {
  const listening = new Set<number>()
  const opened: number[] = []
  const open = async (o: { port: number }): Promise<HookServer> => {
    await new Promise((r) => setTimeout(r, 5))
    if (listening.has(o.port)) throw new Error('EADDRINUSE')
    listening.add(o.port)
    opened.push(o.port)
    return {
      port: o.port,
      close: async () => {
        listening.delete(o.port)
      }
    } as unknown as HookServer
  }
  return { open: open as never, opened }
}

const hook = { port: 47001, token: 'tok' }

test('Claude·Codex 연동이 동시에 서버를 잡아도 한 번만 열고 둘 다 성공한다(시작할 때)', async () => {
  const f = fakeOpen()
  const hub = createHookHub({ onEvent: () => {}, open: f.open })
  await expect(Promise.all([hub.claim('claude', hook), hub.claim('codex', hook)])).resolves.toEqual(
    [undefined, undefined]
  )
  expect(f.opened).toEqual([47001])
  await hub.stop()
})

test('놓기와 잡기가 겹쳐도 순서대로 처리해 마지막에 잡은 쪽이 서버를 갖는다', async () => {
  const f = fakeOpen()
  const hub = createHookHub({ onEvent: () => {}, open: f.open })
  await hub.claim('claude', hook)
  await Promise.all([hub.release('claude'), hub.claim('codex', hook)])
  // 놓은 뒤 다시 열었으므로 서버가 살아 있다.
  await expect(hub.claim('claude', hook)).resolves.toBeUndefined()
  expect(f.opened).toEqual([47001, 47001])
  await hub.stop()
})

test('여는 데 실패하면 그 잡기만 실패하고 다음 잡기는 다시 시도한다', async () => {
  let fail = true
  const f = fakeOpen()
  const hub = createHookHub({
    onEvent: () => {},
    open: (async (o: { port: number }) => {
      if (fail) throw new Error('EACCES')
      return f.open!(o as never)
    }) as never
  })
  await expect(hub.claim('claude', hook)).rejects.toThrow('EACCES')
  fail = false
  await expect(hub.claim('claude', hook)).resolves.toBeUndefined()
  await hub.stop()
})
