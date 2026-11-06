import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureHookConfig,
  HOOK_PORT_MAX,
  HOOK_PORT_MIN,
  loadConfig,
  pickFreePort,
  randomHookToken,
  saveConfig
} from './config'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pitwall-config-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('토큰은 32바이트 무작위(base64url 43자), 매번 다르다', () => {
  const a = randomHookToken()
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(randomHookToken()).not.toBe(a)
})

test('파일이 없거나 깨졌거나 형식이 틀리면 훅 설정 없음', async () => {
  expect(await loadConfig(dir)).toEqual({ hook: null })
  await writeFile(join(dir, 'config.json'), '{ broken')
  expect(await loadConfig(dir)).toEqual({ hook: null })
  await writeFile(join(dir, 'config.json'), JSON.stringify({ hook: { port: 'x', token: 1 } }))
  expect(await loadConfig(dir)).toEqual({ hook: null })
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ hook: { port: 45000, token: "a'; rm" } })
  )
  expect(await loadConfig(dir)).toEqual({ hook: null })
})

test('저장한 값을 다시 읽고, 임시 파일이 남지 않는다', async () => {
  const config = { hook: { port: 45123, token: randomHookToken() } }
  await saveConfig(dir, config)
  expect(await loadConfig(dir)).toEqual(config)
  expect(await readdir(dir)).toEqual(['config.json'])
  expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual(config)
})

test(`빈 포트는 ${HOOK_PORT_MIN}~${HOOK_PORT_MAX} 에서 고르고, 쓰는 중인 포트는 건너뛴다`, async () => {
  const blocker = createServer()
  await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
  const busy = (blocker.address() as { port: number }).port
  const candidates = [busy, 45678]
  const port = await pickFreePort(() => candidates.shift() ?? 45679)
  expect(port).toBe(45678)
  await new Promise<void>((r) => blocker.close(() => r()))

  const real = await pickFreePort()
  expect(real).toBeGreaterThanOrEqual(HOOK_PORT_MIN)
  expect(real).toBeLessThanOrEqual(HOOK_PORT_MAX)
})

test('빈 포트를 못 찾으면 실패', async () => {
  const blocker = createServer()
  await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
  const busy = (blocker.address() as { port: number }).port
  await expect(pickFreePort(() => busy, 3)).rejects.toThrow()
  await new Promise<void>((r) => blocker.close(() => r()))
})

test('훅 설정이 없을 때만 새로 만들어 저장하고, 있으면 그대로 쓴다', async () => {
  const first = await ensureHookConfig(dir, { pickPort: async () => 45123 })
  expect(first.port).toBe(45123)
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const second = await ensureHookConfig(dir, { pickPort: async () => 50000 })
  expect(second).toEqual(first)
  expect((await loadConfig(dir)).hook).toEqual(first)
})
