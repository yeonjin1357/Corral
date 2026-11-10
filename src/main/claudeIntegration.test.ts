import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeIntegration, type ClaudeIntegrationDeps } from './claudeIntegration'
import { claudeHookItems, guardCommand, hookCommand, inspectPitwallHooks } from './claudeHooks'
import { loadConfig, pickFreePort, saveConfig, updateConfig } from './config'
import { DEFAULT_SETTINGS } from '../shared/settings'
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
    guard: () => false,
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
  expect(
    inspectPitwallHooks(await readFile(settingsPath(), 'utf8'), claudeHookItems(entry)).state
  ).toBe('on')
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
    lastActivityAt: 1,
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
  await updateConfig(userData, (c) => ({ ...c, settings: { ...c.settings, refresh: 'saver' } }))

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
    // 포트를 바꿔 저장할 때 다른 설정을 지우지 않는다.
    expect((await loadConfig(userData)).settings.refresh).toBe('saver')
    const entry = hookCommand('win32', moved.port, moved.token, 'C:\\Windows')
    expect(
      inspectPitwallHooks(await readFile(settingsPath(), 'utf8'), claudeHookItems(entry)).state
    ).toBe('on')
    expect(await second.status()).toMatchObject({ state: 'on', problem: null })
    await second.stop()
  } finally {
    await new Promise<void>((r) => blocker.close(() => r()))
  }
})

test('pitwall 설정이 없는데 settings.json 에 pitwall 훅이 남아 있으면 partial', async () => {
  const { deps } = setup()
  await saveConfig(userData, {
    hook: { port: 45123, token: 'a'.repeat(43) },
    settings: DEFAULT_SETTINGS
  })
  const integration = createClaudeIntegration(deps)
  await integration.enable()
  await integration.stop()
  await rm(join(userData, 'config.json'))
  const again = createClaudeIntegration(deps)
  expect((await again.status()).state).toBe('partial')
  await again.stop()
})

test('무거운 작업 기다리게 하기(guard)가 켜져 있으면 켜기가 질문 훅도 넣고, 설정과 파일이 다르면 partial', async () => {
  let guard = true
  const { deps } = setup({ guard: () => guard })
  const original = '{\n  "model": "opus"\n}\n'
  await writeFile(settingsPath(), original)
  const integration = createClaudeIntegration(deps)
  expect((await integration.enable()).status).toBe('done')
  const { hook } = await loadConfig(userData)
  const entry = hookCommand('win32', hook!.port, hook!.token, 'C:\\Windows')
  const withGuard = claudeHookItems(
    entry,
    guardCommand('win32', hook!.port, hook!.token, 'C:\\Windows')
  )
  const text = await readFile(settingsPath(), 'utf8')
  expect(inspectPitwallHooks(text, withGuard).state).toBe('on')
  expect(text).toContain(`/pitwall-hook/claude/guard?t=${hook!.token}`)
  expect((await integration.status()).state).toBe('on')

  // 설정을 끄면 파일과 달라 partial, 다시 켜기(확인 창·백업)로 질문 훅을 뺀다.
  guard = false
  expect((await integration.status()).state).toBe('partial')
  expect((await integration.enable()).status).toBe('done')
  expect(await readFile(settingsPath(), 'utf8')).not.toContain('/pitwall-hook/claude/guard')
  expect((await integration.status()).state).toBe('on')

  // 연동 끄기는 질문 훅까지 모두 뺀다.
  guard = true
  await integration.enable()
  await integration.disable()
  expect(await readFile(settingsPath(), 'utf8')).toBe(original)
  await integration.stop()
})

test('기다리게 하기 켜기·끄기는 따로 된 확인 창으로 묻고, 질문 훅만 넣거나 뺀다', async () => {
  // 설정 값과 상관없이 무엇을 하는지는 부른 쪽이 정한다(켜기는 저장 전, 끄기는 저장 뒤에 부른다).
  const { deps, confirm } = setup({ guard: () => false })
  const original = '{\n  "model": "opus"\n}\n'
  await writeFile(settingsPath(), original)
  const integration = createClaudeIntegration(deps)
  await integration.enable()
  type Dialog = { title: string; message: string; detail: string; buttons: string[] }
  const dialog = (): Dialog => confirm.mock.calls.at(-1)![0] as Dialog

  expect((await integration.enable('guardOn')).status).toBe('done')
  expect(dialog()).toEqual(
    expect.objectContaining({
      title: '에이전트 기다리게 하기 켜기',
      message: 'Claude Code 설정 파일에 질문 훅을 더할까요?',
      detail: `${settingsPath()} 의 pitwall 훅을 다시 써서, Claude 가 Bash·PowerShell 명령을 실행하기 전에 pitwall 에 묻는 훅을 하나 더해요. 무거운 작업이 겹치고 메모리가 부족할 때만 그 명령을 잠깐 미루게 해요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. 이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있어요.`,
      buttons: ['켜기', '취소']
    })
  )
  expect(await readFile(settingsPath(), 'utf8')).toContain('/pitwall-hook/claude/guard')

  expect((await integration.enable('guardOff')).status).toBe('done')
  expect(dialog()).toEqual(
    expect.objectContaining({
      title: '에이전트 기다리게 하기 끄기',
      message: 'Claude Code 설정 파일에서 질문 훅을 뺄까요?',
      detail: `기능은 이미 껐어요. ${settingsPath()} 에서 Bash·PowerShell 명령 전에 pitwall 에 묻는 훅도 빼요. 남겨 두면 명령마다 pitwall 에 한 번 묻기만 하고 아무것도 미루지 않아요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요.`,
      buttons: ['빼기', '취소']
    })
  )
  const text = await readFile(settingsPath(), 'utf8')
  expect(text).not.toContain('/pitwall-hook/claude/guard')
  expect(text).toContain('/pitwall-hook/claude?t=')

  // 취소하면 아무것도 바꾸지 않는다.
  confirm.mockImplementation(async () => false)
  expect(await integration.enable('guardOn')).toEqual({ status: 'cancelled' })
  expect(await readFile(settingsPath(), 'utf8')).toBe(text)
  await integration.stop()
})

test('연동 켜기 확인 창은 기다리게 하기가 켜져 있으면 질문 훅도 더한다고 알린다', async () => {
  let guard = false
  const { deps, confirm } = setup({ guard: () => guard })
  const integration = createClaudeIntegration(deps)
  const detail = (): string => (confirm.mock.calls.at(-1)![0] as { detail: string }).detail
  const plain = `${settingsPath()} 에 세션 시작·프롬프트·권한 요청·알림·도구 사용·응답 끝·오류·세션 끝 이벤트를 pitwall 로 보내는 훅을 더해요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. 이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있어요.`
  await integration.enable()
  expect(detail()).toBe(plain)
  guard = true
  await integration.enable()
  expect(detail()).toBe(
    plain +
      ' "겹치면 에이전트가 기다리게 하기"가 켜져 있어, Bash·PowerShell 명령 전에 pitwall 에 묻는 훅도 하나 더해요.'
  )
  await integration.stop()
})

test('disableAllHooks 를 알려 준다', async () => {
  const { deps } = setup()
  await writeFile(settingsPath(), '{ "disableAllHooks": true }')
  const integration = createClaudeIntegration(deps)
  expect((await integration.status()).allHooksDisabled).toBe(true)
  await integration.stop()
})
