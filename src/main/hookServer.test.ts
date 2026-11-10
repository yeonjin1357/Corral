import { request } from 'node:http'
import { createServer, connect } from 'node:net'
import { createHookServer, HOOK_BODY_LIMIT, type HookServer } from './hookServer'

const TOKEN = 'a'.repeat(64)

interface SendOptions {
  method?: string
  path?: string
  body?: string | Buffer
  headers?: Record<string, string>
}

/** 요청을 보내고 상태·Content-Type·본문을 받는다. */
function exchange(
  port: number,
  opts: SendOptions
): Promise<{ status: number; type: string | undefined; body: string }> {
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
        let body = ''
        res.on('data', (c: Buffer) => (body += c.toString('utf8')))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body })
        )
      }
    )
    req.on('error', reject)
    req.end(opts.body ?? '')
  })
}

async function send(port: number, opts: SendOptions): Promise<number> {
  return (await exchange(port, opts)).status
}

const GUARD = `/pitwall-hook/claude/guard?t=${TOKEN}`
const PRE_TOOL = JSON.stringify({
  session_id: 's1',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'npx vue-tsc --noEmit' }
})

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
    expect(await send(server.port, { path: `/pitwall-hook/other?t=${TOKEN}` })).toBe(404)
  })

  test('Codex 훅(/pitwall-hook/codex)은 codex 이벤트로 넘기고, 토큰이 틀린 요청은 버린다', async () => {
    const tools: string[] = []
    const codex = await createHookServer({
      port: 0,
      token: TOKEN,
      onEvent: (e, tool) => {
        events.push(e)
        tools.push(tool)
      }
    })
    try {
      const body = JSON.stringify({ session_id: 'c1', hook_event_name: 'PreToolUse' })
      expect(await send(codex.port, { path: `/pitwall-hook/codex?t=${TOKEN}`, body })).toBe(204)
      expect(await send(codex.port, { path: '/pitwall-hook/codex?t=wrong', body })).toBe(403)
      expect(await send(codex.port, { body })).toBe(204)
      expect(tools).toEqual(['codex', 'claude'])
      expect(events).toHaveLength(2)
    } finally {
      await codex.close()
    }
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

  test('해석할 수 없는 요청 주소(토큰 없이 누구나 보낼 수 있음)는 400 이고 서버는 죽지 않는다', async () => {
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.port, '127.0.0.1', () => {
        socket.write(
          [
            'POST http://%zz/ HTTP/1.1',
            'Host: x',
            'Content-Length: 0',
            'Connection: close',
            '',
            ''
          ].join('\r\n')
        )
      })
      let data = ''
      socket.on('data', (c) => (data += c.toString()))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(raw.startsWith('HTTP/1.1 400')).toBe(true)
    expect(await send(server.port, { body: '{}' })).toBe(204)
  })

  test('guard 경로는 답이 있으면 200 과 JSON, 없으면 204', async () => {
    let answer: string | null = '{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}'
    const asked: unknown[] = []
    const guarded = await createHookServer({
      port: 0,
      token: TOKEN,
      onEvent: (e) => events.push(e),
      onGuard: (e) => {
        asked.push(e)
        if (answer === 'throw') throw new Error('boom')
        return answer
      }
    })
    try {
      expect(await exchange(guarded.port, { path: GUARD, body: PRE_TOOL })).toEqual({
        status: 200,
        type: 'application/json',
        body: answer
      })
      answer = null
      expect(await exchange(guarded.port, { path: GUARD, body: PRE_TOOL })).toEqual({
        status: 204,
        type: undefined,
        body: ''
      })
      // 받는 쪽이 실패해도 훅에는 아무 말 없이(204) 넘어간다.
      answer = 'throw'
      expect(await exchange(guarded.port, { path: GUARD, body: PRE_TOOL })).toMatchObject({
        status: 204,
        body: ''
      })
      expect(asked).toEqual([JSON.parse(PRE_TOOL), JSON.parse(PRE_TOOL), JSON.parse(PRE_TOOL)])
      // 질문은 알림 이벤트가 아니다(상태는 따로 오는 비동기 PreToolUse 훅이 알린다).
      expect(events).toEqual([])
      // JSON 이 아니면 400(본문 없음).
      expect(await exchange(guarded.port, { path: GUARD, body: '{not json' })).toMatchObject({
        status: 400,
        body: ''
      })
    } finally {
      await guarded.close()
    }
    // 답하는 쪽이 없는 서버는 204.
    expect(await exchange(server.port, { path: GUARD, body: PRE_TOOL })).toMatchObject({
      status: 204,
      body: ''
    })
    expect(events).toEqual([])
  })

  test('guard 경로도 토큰이 틀리면 403', async () => {
    const onGuard = vi.fn(() => '{}')
    const guarded = await createHookServer({ port: 0, token: TOKEN, onEvent: () => {}, onGuard })
    try {
      const path = '/pitwall-hook/claude/guard'
      expect(await send(guarded.port, { path: `${path}?t=wrong`, body: PRE_TOOL })).toBe(403)
      expect(await send(guarded.port, { path, body: PRE_TOOL })).toBe(403)
      expect(
        await send(guarded.port, {
          path: GUARD,
          body: PRE_TOOL,
          headers: { Origin: 'https://example.com' }
        })
      ).toBe(403)
      expect(await send(guarded.port, { path: GUARD, method: 'GET' })).toBe(404)
      expect(await send(guarded.port, { path: `${path}/x?t=${TOKEN}`, body: PRE_TOOL })).toBe(404)
      // 본문 상한도 같다.
      const big = Buffer.alloc(HOOK_BODY_LIMIT + 1, 0x20)
      expect(
        await send(guarded.port, { path: GUARD, body: big }).catch(
          (e: NodeJS.ErrnoException) => e.code
        )
      ).toBe(413)
      expect(onGuard).not.toHaveBeenCalled()
    } finally {
      await guarded.close()
    }
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
