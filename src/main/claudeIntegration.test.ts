import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeIntegration, type ClaudeIntegrationDeps } from './claudeIntegration'
import { inspectPitwallHooks, hookCommand } from './claudeHooks'
import { loadConfig, pickFreePort, saveConfig } from './config'
import type { Sessions } from './sessions'

let userData: string
let configDir: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'pitwall-userdata-'))
  configDir = await mkdtemp(join(tmpdir(), 'pitwall-claude-config-'))
})
afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
  await rm(configDir, { recursive: true, force: true })
})

function post(port: number, token: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'POST', path: `/pitwall-hook/claude?t=${token}` },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

function setup(over: Partial<ClaudeIntegrationDeps> = {}): {
  deps: ClaudeIntegrationDeps
  sessions: Sessions
  confirm: ReturnType<typeof vi.fn>
  onEvent: ReturnType<typeof vi.fn>
} {
  const sessions: Sessions = new Map()
  const confirm = vi.fn(async () => true)
  const onEvent = vi.fn()
  const deps: ClaudeIntegrationDeps = {
    userData,
    configDir,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    sessions,
    now: () => new Date(2026, 10, 6, 9, 0, 0).getTime(),
    confirm,
    onEvent,
    pickPort: () => pickFreePort(),
    ...over
  }
  return { deps, sessions, confirm, onEvent }
}

const settingsPath = (): string => join(configDir, 'settings.json')

test('처음에는 꺼져 있고 서버도 없다', async () => {
  const { deps } = setup()
  const integration = createClaudeIntegration(deps)
  await integration.start()
  expect(await integration.status()).toEqual({
    state: 'off',
    problem: null,
    allHooksDisabled: false,
    settingsPath: settingsPath()
  })
  await integration.stop()
})

test('켜기: 설정 파일 경로를 보여 주는 확인 창 → 훅 설치 → 서버가 이벤트를 받는다', async () => {
  const { deps, sessions, confirm, onEvent } = setup()
  await writeFile(settingsPath(), '{\n  "model": "opus"\n}\n')
  const integration = createClaudeIntegration(deps)
  await integration.start()

  const result = await integration.enable()
  expect(result).toEqual({
    status: 'done',
    message: expect.stringContaining('settings.json.pitwall-backup-20261106-090000')
  })
  const dialog = confirm.mock.calls[0][0] as { title: string; detail: string; buttons: string[] }
  expect(dialog.title).toBe('Claude 연동 켜기')
  expect(dialog.detail).toContain(settingsPath())
  expect(dialog.buttons).toEqual(['켜기', '취소'])

  const { hook } = await loadConfig(userData)
  const entry = hookCommand('win32', hook!.port, hook!.token, 'C:\\Windows')
  expect(inspectPitwallHooks(await readFile(settingsPath(), 'utf8'), entry).state).toBe('on')
  expect((await integration.status()).state).toBe('on')

  const status = await post(
    hook!.port,
    hook!.token,
    JSON.stringify({ session_id: 's1', cwd: 'C:\\work', hook_event_name: 'UserPromptSubmit' })
  )
  expect(status).toBe(204)
  expect(sessions.get('s1')?.state).toBe('working')
  expect(onEvent).toHaveBeenCalledTimes(1)
  await integration.stop()
})

test('켜기를 취소하면 아무것도 바꾸지 않는다', async () => {
  const { deps } = setup({ confirm: vi.fn(async () => false) })
  const integration = createClaudeIntegration(deps)
  expect(await integration.enable()).toEqual({ status: 'cancelled' })
  expect(await readdir(configDir)).toEqual([])
  expect((await loadConfig(userData)).hook).toBeNull()
  await integration.stop()
})

test('settings.json 이 깨져 있으면 고치지 않고 이유를 알린다', async () => {
  const { deps } = setup()
  await writeFile(settingsPath(), '{ "hooks": ')
  const integration = createClaudeIntegration(deps)
  const result = await integration.enable()
  expect(result).toEqual({
    status: 'failed',
    message: 'settings.json 을 읽을 수 없어 바꾸지 않았어요. 주석·쉼표 같은 형식을 확인해 주세요.'
  })
  expect(await readFile(settingsPath(), 'utf8')).toBe('{ "hooks": ')
  expect(await integration.status()).toMatchObject({ state: 'error', problem: 'settings' })
  await integration.stop()
})

test('끄기: 확인 후 pitwall 훅만 빼고 서버를 닫고 세션을 비운다', async () => {
  const { deps, sessions, confirm } = setup()
  const original = '{\n  "model": "opus"\n}\n'
  await writeFile(settingsPath(), original)
  const integration = createClaudeIntegration(deps)
  await integration.enable()
  const { hook } = await loadConfig(userData)
  sessions.set('s1', {
    id: 's1',
    cwd: 'C:\\work',
    state: 'working',
    updatedAt: 1,
    firstSeen: 1,
    processKey: null
  })

  const result = await integration.disable()
  expect(result.status).toBe('done')
  expect((confirm.mock.calls[1][0] as { title: string }).title).toBe('Claude 연동 끄기')
  expect(await readFile(settingsPath(), 'utf8')).toBe(original)
  expect(sessions.size).toBe(0)
  expect((await integration.status()).state).toBe('off')
  await expect(post(hook!.port, hook!.token, '{}')).rejects.toThrow()
  await integration.stop()
})

test('앱을 다시 켜면(설정에 훅이 있으면) 같은 포트·토큰으로 서버를 연다', async () => {
  const { deps } = setup()
  const first = createClaudeIntegration(deps)
  await first.enable()
  await first.stop()
  const { hook } = await loadConfig(userData)

  const second = createClaudeIntegration(deps)
  await second.start()
  expect((await second.status()).state).toBe('on')
  expect(await post(hook!.port, hook!.token, '{}')).toBe(204)
  await second.stop()
})

test('저장된 포트를 다른 프로그램이 쓰고 있으면 상태는 error(server), 다시 켜면 새 포트로 바꾼다', async () => {
  const { deps } = setup()
  const first = createClaudeIntegration(deps)
  await first.enable()
  await first.stop()
  const { hook } = await loadConfig(userData)

  const blocker = createServer()
  await new Promise<void>((r) => blocker.listen(hook!.port, '127.0.0.1', r))
  try {
    const second = createClaudeIntegration(deps)
    await second.start()
    expect(await second.status()).toMatchObject({ state: 'error', problem: 'server' })
    expect((await second.enable()).status).toBe('done')
    const moved = (await loadConfig(userData)).hook!
    expect(moved.port).not.toBe(hook!.port)
    expect(moved.token).toBe(hook!.token)
    const entry = hookCommand('win32', moved.port, moved.token, 'C:\\Windows')
    expect(inspectPitwallHooks(await readFile(settingsPath(), 'utf8'), entry).state).toBe('on')
    expect(await second.status()).toMatchObject({ state: 'on', problem: null })
    await second.stop()
  } finally {
    await new Promise<void>((r) => blocker.close(() => r()))
  }
})

test('pitwall 설정이 없는데 settings.json 에 pitwall 훅이 남아 있으면 partial', async () => {
  const { deps } = setup()
  await saveConfig(userData, { hook: { port: 45123, token: 'a'.repeat(43) } })
  const integration = createClaudeIntegration(deps)
  await integration.enable()
  await integration.stop()
  await rm(join(userData, 'config.json'))
  const again = createClaudeIntegration(deps)
  expect((await again.status()).state).toBe('partial')
  await again.stop()
})

test('disableAllHooks 를 알려 준다', async () => {
  const { deps } = setup()
  await writeFile(settingsPath(), '{ "disableAllHooks": true }')
  const integration = createClaudeIntegration(deps)
  expect((await integration.status()).allHooksDisabled).toBe(true)
  await integration.stop()
})
