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
  saveConfig,
  updateConfig
} from './config'
import { DEFAULT_SETTINGS } from '../shared/settings'

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

const EMPTY = { hook: null, settings: DEFAULT_SETTINGS }

test('파일이 없거나 깨졌거나 형식이 틀리면 훅 설정 없음·기본 설정', async () => {
  expect(await loadConfig(dir)).toEqual(EMPTY)
  await writeFile(join(dir, 'config.json'), '{ broken')
  expect(await loadConfig(dir)).toEqual(EMPTY)
  await writeFile(join(dir, 'config.json'), JSON.stringify({ hook: { port: 'x', token: 1 } }))
  expect(await loadConfig(dir)).toEqual(EMPTY)
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ hook: { port: 45000, token: "a'; rm" } })
  )
  expect(await loadConfig(dir)).toEqual(EMPTY)
})

test('설정은 읽을 때 범위 안으로 고친다', async () => {
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ settings: { ramWarnPercent: 5, refresh: 'fast' } })
  )
  expect((await loadConfig(dir)).settings).toMatchObject({ ramWarnPercent: 50, refresh: 'fast' })
})

test('훅 설정과 일반 설정을 동시에 저장해도 둘 다 남는다', async () => {
  const hook = { port: 45123, token: randomHookToken() }
  await Promise.all([
    updateConfig(dir, (c) => ({ ...c, hook })),
    updateConfig(dir, (c) => ({ ...c, settings: { ...c.settings, refresh: 'saver' } })),
    updateConfig(dir, (c) => ({ ...c, settings: { ...c.settings, idlePortMinutes: 45 } }))
  ])
  const saved = await loadConfig(dir)
  expect(saved.hook).toEqual(hook)
  expect(saved.settings).toMatchObject({ refresh: 'saver', idlePortMinutes: 45 })
})

test('고치는 중 실패해도 다음 저장은 계속된다', async () => {
  await expect(
    updateConfig(dir, () => {
      throw new Error('boom')
    })
  ).rejects.toThrow('boom')
  await updateConfig(dir, (c) => ({ ...c, settings: { ...c.settings, theme: 'dark' } }))
  expect((await loadConfig(dir)).settings.theme).toBe('dark')
})

test('깨진 config.json 은 덮어쓰기 전에 따로 남긴다(훅 포트·토큰을 잃지 않게)', async () => {
  await writeFile(join(dir, 'config.json'), '{ "hook": { "port": 45123, "token": "aaaa')
  await updateConfig(dir, (c) => ({ ...c, settings: { ...c.settings, theme: 'dark' } }))
  const files = (await readdir(dir)).sort()
  expect(files).toHaveLength(2)
  const broken = files.find((f) => f.startsWith('config.json.broken-'))!
  expect(await readFile(join(dir, broken), 'utf8')).toBe(
    '{ "hook": { "port": 45123, "token": "aaaa'
  )
  expect((await loadConfig(dir)).settings.theme).toBe('dark')
})

test('바뀐 것이 없으면 파일을 쓰지 않는다', async () => {
  await updateConfig(dir, (c) => c)
  expect(await readdir(dir)).toEqual([])
})

test('저장한 값을 다시 읽고, 임시 파일이 남지 않는다', async () => {
  const config = { hook: { port: 45123, token: randomHookToken() }, settings: DEFAULT_SETTINGS }
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

test('훅 설정을 만들 때 기존 일반 설정을 지우지 않는다', async () => {
  await updateConfig(dir, (c) => ({ ...c, settings: { ...c.settings, refresh: 'fast' } }))
  await ensureHookConfig(dir, { pickPort: async () => 45123 })
  expect((await loadConfig(dir)).settings.refresh).toBe('fast')
})

test('훅 포트 범위는 OS 가 임시로 쓰는 동적 포트(49152~)와 겹치지 않는다', () => {
  // 동적 포트와 겹치면 나가는 연결이 그 번호를 잡아 재부팅 뒤 서버를 못 여는 일이 생긴다.
  expect(HOOK_PORT_MIN).toBeGreaterThanOrEqual(1024)
  expect(HOOK_PORT_MAX).toBeLessThan(49152)
})
