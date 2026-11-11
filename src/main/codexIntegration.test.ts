import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexIntegration, type CodexIntegrationDeps } from './codexIntegration'
import { createClaudeIntegration } from './claudeIntegration'
import { createHookHub } from './hookHub'
import { loadConfig, pickFreePort } from './config'
import { applyHookEvent, hookViewForAgent, type Sessions } from './sessions'
import type { KillConfirm } from './kill'

let userData: string
let codexDir: string
let claudeDir: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'pitwall-userdata-'))
  codexDir = await mkdtemp(join(tmpdir(), 'pitwall-codex-home-'))
  claudeDir = await mkdtemp(join(tmpdir(), 'pitwall-claude-config-'))
})
afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
  await rm(codexDir, { recursive: true, force: true })
  await rm(claudeDir, { recursive: true, force: true })
})

function post(port: number, path: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function setup(over: Partial<CodexIntegrationDeps> = {}): {
  deps: CodexIntegrationDeps
  sessions: Sessions
  confirm: ReturnType<typeof vi.fn>
} {
  const sessions: Sessions = new Map()
  const confirm = vi.fn<(o: KillConfirm) => Promise<boolean>>(async () => true)
  const now = (): number => new Date(2026, 10, 9, 9, 0, 0).getTime()
  const hub = createHookHub({
    onEvent: (event, tool) => applyHookEvent(sessions, event, now(), tool)
  })
  const deps: CodexIntegrationDeps = {
    userData,
    codexHome: codexDir,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    hub,
    sessions,
    now,
    confirm,
    pickPort: () => pickFreePort(),
    ...over
  }
  return { deps, sessions, confirm }
}

const hooksPath = (): string => join(codexDir, 'hooks.json')

test('처음에는 꺼져 있다(hooks.json 을 만들지 않는다)', async () => {
  const { deps } = setup()
  const codex = createCodexIntegration(deps)
  await codex.start()
  expect(await codex.status()).toEqual({ state: 'off', problem: null, path: hooksPath() })
  await expect(readFile(hooksPath(), 'utf8')).rejects.toThrow()
  await deps.hub.stop()
})

test('켜기: 확인 창 → hooks.json 에 더함 → /hooks 승인 안내 → Codex 이벤트를 받는다', async () => {
  const { deps, sessions, confirm } = setup()
  const codex = createCodexIntegration(deps)
  const result = await codex.enable()
  expect(confirm).toHaveBeenCalledTimes(1)
  expect((confirm.mock.calls[0][0] as KillConfirm).detail).toContain(hooksPath())
  expect(result.status).toBe('done')
  expect(result.status === 'done' && result.message).toContain('/hooks')
  // /hooks 의 항목에는 내부 이름이 든 주소(…/pitwall-hook/codex…)가 보여 어느 훅인지 함께 알린다.
  expect(result.status === 'done' && result.message).toContain(
    '(주소에 pitwall-hook 이 들어 있는 훅)'
  )
  expect(await codex.status()).toMatchObject({ state: 'on', problem: null })

  const { hook } = await loadConfig(userData)
  const body = JSON.stringify({
    session_id: 'c1',
    cwd: 'C:\\work\\shop-web',
    hook_event_name: 'PermissionRequest'
  })
  expect(await post(hook!.port, `/pitwall-hook/codex?t=${hook!.token}`, body)).toBe(204)
  const root = (cwd: string): string | null => cwd
  expect(
    hookViewForAgent(sessions, { key: '1:1', rootKey: 'C:\\work\\shop-web', tool: 'codex' }, root)
      ?.state
  ).toBe('waiting')
  await deps.hub.stop()
})

test('켜기를 취소하면 아무것도 바꾸지 않는다', async () => {
  const { deps } = setup({ confirm: vi.fn(async () => false) })
  const codex = createCodexIntegration(deps)
  expect(await codex.enable()).toEqual({ status: 'cancelled' })
  await expect(readFile(hooksPath(), 'utf8')).rejects.toThrow()
})

test('깨진 hooks.json 은 고치지 않고 이유를 알린다', async () => {
  await writeFile(hooksPath(), '{ "hooks": ')
  const { deps } = setup()
  const codex = createCodexIntegration(deps)
  const result = await codex.enable()
  expect(result.status).toBe('failed')
  expect(result.status === 'failed' && result.message).toContain('hooks.json')
  expect(await readFile(hooksPath(), 'utf8')).toBe('{ "hooks": ')
  expect((await codex.status()).state).toBe('error')
  await deps.hub.stop()
})

test('끄기: pitwall 항목만 빼고 Codex 세션만 비운다(Claude 세션은 그대로)', async () => {
  const { deps, sessions } = setup()
  const codex = createCodexIntegration(deps)
  await codex.enable()
  applyHookEvent(sessions, { session_id: 'claude-1', cwd: 'C:\\a', hook_event_name: 'Stop' }, 1)
  applyHookEvent(
    sessions,
    { session_id: 'codex-1', cwd: 'C:\\a', hook_event_name: 'Stop' },
    1,
    'codex'
  )
  const result = await codex.disable()
  expect(result.status).toBe('done')
  expect(JSON.parse(await readFile(hooksPath(), 'utf8'))).toEqual({})
  expect([...sessions.keys()]).toEqual(['claude-1'])
  expect((await codex.status()).state).toBe('off')
  await deps.hub.stop()
})

test('Claude 연동과 훅 서버를 같이 쓴다: 한쪽을 꺼도 다른 쪽 이벤트는 계속 받는다', async () => {
  const { deps, sessions } = setup()
  const codex = createCodexIntegration(deps)
  const claude = createClaudeIntegration({
    userData,
    configDir: claudeDir,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    sessions,
    hub: deps.hub,
    now: deps.now,
    confirm: async () => true,
    pickPort: () => pickFreePort(),
    guard: () => false
  })
  await claude.enable()
  await codex.enable()
  await claude.disable()
  const { hook } = await loadConfig(userData)
  const body = JSON.stringify({ session_id: 'c2', cwd: 'C:\\b', hook_event_name: 'Stop' })
  expect(await post(hook!.port, `/pitwall-hook/codex?t=${hook!.token}`, body)).toBe(204)
  expect(sessions.has('c2')).toBe(true)
  await codex.disable()
  await expect(post(hook!.port, `/pitwall-hook/codex?t=${hook!.token}`, body)).rejects.toThrow()
})
