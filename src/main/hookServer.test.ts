import { request } from 'node:http'
import { createServer } from 'node:net'
import { createHookServer, HOOK_BODY_LIMIT, type HookServer } from './hookServer'

const TOKEN = 'a'.repeat(64)

function send(
  port: number,
  opts: { method?: string; path?: string; body?: string | Buffer; headers?: Record<string, string> }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'POST',
        path: opts.path ?? `/pitwall-hook/claude?t=${TOKEN}`,
        headers: opts.headers
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(opts.body ?? '')
  })
}

describe('훅 서버', () => {
  let server: HookServer
  const events: unknown[] = []

  beforeEach(async () => {
    events.length = 0
    server = await createHookServer({ port: 0, token: TOKEN, onEvent: (e) => events.push(e) })
  })
  afterEach(async () => {
    await server.close()
  })

  test('127.0.0.1 에만 열린다', () => {
    expect(server.address).toBe('127.0.0.1')
    expect(server.port).toBeGreaterThan(0)
  })

  test('토큰이 맞는 POST /pitwall-hook/claude 는 204 로 받고 이벤트를 넘긴다', async () => {
    const body = JSON.stringify({
      session_id: 's1',
      hook_event_name: 'Stop',
      cwd: 'C:\\작업\\폴더'
    })
    expect(await send(server.port, { body })).toBe(204)
    expect(events).toEqual([{ session_id: 's1', hook_event_name: 'Stop', cwd: 'C:\\작업\\폴더' }])
  })

  test('토큰이 틀리거나 없으면 403', async () => {
    const body = '{}'
    expect(await send(server.port, { path: '/pitwall-hook/claude?t=wrong', body })).toBe(403)
    expect(await send(server.port, { path: '/pitwall-hook/claude', body })).toBe(403)
    expect(events).toEqual([])
  })

  test('다른 경로·메서드는 404', async () => {
    expect(await send(server.port, { path: `/other?t=${TOKEN}` })).toBe(404)
    expect(await send(server.port, { method: 'GET' })).toBe(404)
    expect(await send(server.port, { path: `/pitwall-hook/codex?t=${TOKEN}` })).toBe(404)
  })

  test('브라우저가 보낸 요청(Origin 헤더)은 토큰이 맞아도 403', async () => {
    const status = await send(server.port, {
      body: '{"session_id":"s1"}',
      headers: { Origin: 'https://example.com' }
    })
    expect(status).toBe(403)
    expect(events).toEqual([])
  })

  test('JSON 이 아니거나 객체가 아니면 400', async () => {
    expect(await send(server.port, { body: '{not json' })).toBe(400)
    expect(await send(server.port, { body: '[1,2]' })).toBe(400)
    expect(await send(server.port, { body: '' })).toBe(400)
    expect(events).toEqual([])
  })

  test(`본문이 ${HOOK_BODY_LIMIT / 1024 / 1024}MB 를 넘으면 413 이고 서버는 계속 동작한다`, async () => {
    const big = Buffer.alloc(HOOK_BODY_LIMIT + 1, 0x20)
    const status = await send(server.port, { body: big }).catch(
      (e: NodeJS.ErrnoException) => e.code
    )
    expect(status).toBe(413)
    expect(events).toEqual([])
    expect(await send(server.port, { body: '{"session_id":"s1"}' })).toBe(204)
  })

  test('onEvent 가 예외를 던져도 204 로 답하고 서버는 계속 동작한다', async () => {
    await server.close()
    server = await createHookServer({
      port: 0,
      token: TOKEN,
      onEvent: () => {
        throw new Error('boom')
      }
    })
    expect(await send(server.port, { body: '{}' })).toBe(204)
    expect(await send(server.port, { body: '{}' })).toBe(204)
  })
})

test('포트를 이미 다른 프로그램이 쓰고 있으면 실패로 알린다', async () => {
  const blocker = createServer()
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const port = (blocker.address() as { port: number }).port
  await expect(createHookServer({ port, token: TOKEN, onEvent: () => {} })).rejects.toThrow(
    /EADDRINUSE/
  )
  await new Promise<void>((resolve) => blocker.close(() => resolve()))
})

test('토큰이 비어 있으면 서버를 열지 않는다', async () => {
  await expect(createHookServer({ port: 0, token: '', onEvent: () => {} })).rejects.toThrow()
})
