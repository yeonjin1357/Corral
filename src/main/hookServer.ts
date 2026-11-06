import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

/** 훅 본문 상한. PostToolUse 는 도구 결과를 담아 클 수 있지만, 넘치면 그 이벤트 하나만 놓친다. */
export const HOOK_BODY_LIMIT = 1024 * 1024
export const HOOK_PATH = '/pitwall-hook/claude'
const HOST = '127.0.0.1'

export interface HookServer {
  address: string
  port: number
  close(): Promise<void>
}

function sameToken(given: string | null, token: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function reply(res: ServerResponse, status: number): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Length': '0' })
  res.end()
}

/**
 * Claude Code 훅이 curl 로 보내는 이벤트를 받는 로컬 서버.
 * 127.0.0.1 에만 열고 무작위 토큰이 맞을 때만 받는다. 브라우저가 보낸 요청(Origin 헤더가 있음)은
 * 토큰이 맞아도 거절한다 — 다른 웹페이지가 로컬 포트로 요청을 보내는 것을 막는다.
 */
export function createHookServer(opts: {
  port: number
  token: string
  onEvent: (event: Record<string, unknown>) => void
}): Promise<HookServer> {
  if (!opts.token) return Promise.reject(new Error('hook token is empty'))

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    // 토큰을 보기 전이라 누구나 보낼 수 있는 값이다. 해석이 안 되면 예외로 메인 프로세스를 흔들지 않고 400.
    let url: URL
    try {
      url = new URL(req.url ?? '/', `http://${HOST}`)
    } catch {
      return reply(res, 400)
    }
    if (req.method !== 'POST' || url.pathname !== HOOK_PATH) return reply(res, 404)
    if (req.headers.origin !== undefined || !sameToken(url.searchParams.get('t'), opts.token))
      return reply(res, 403)

    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > HOOK_BODY_LIMIT) {
        tooLarge = true
        chunks.length = 0
        res.setHeader('Connection', 'close')
        reply(res, 413)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      let event: unknown
      try {
        event = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(res, 400)
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return reply(res, 400)
      try {
        opts.onEvent(event as Record<string, unknown>)
      } catch {
        // 받은 쪽 문제는 훅(Claude)에 알릴 필요가 없다.
      }
      reply(res, 204)
    })
    req.on('error', () => reply(res, 400))
  }

  const server = createServer(handle)
  // 훅은 2초 안에 끝내므로 느린 연결을 오래 붙잡지 않는다.
  server.requestTimeout = 5000
  server.headersTimeout = 5000

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, HOST, () => {
      server.off('error', reject)
      server.on('error', () => {})
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : opts.port
      resolve({
        address: HOST,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
}
