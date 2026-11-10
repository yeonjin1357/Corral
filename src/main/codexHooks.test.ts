import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ClaudeSettingsError } from './claudeHooks'
import {
  CODEX_HOOK_EVENTS,
  CODEX_HOOK_FILE,
  codexHookCommand,
  installCodexHooks,
  readCodexHookState,
  uninstallCodexHooks
} from './codexHooks'

const TOKEN = 'a'.repeat(43)

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pitwall-codex-hooks-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

test('Codex 훅 명령: 표준입력을 로컬 훅 서버의 codex 경로로 보내고, Windows 는 commandWindows', () => {
  const mac = codexHookCommand('darwin', 45123, TOKEN)
  expect(mac).toEqual({
    type: 'command',
    command: `/usr/bin/curl -s -m 2 -o /dev/null --data-binary @- 'http://127.0.0.1:45123/pitwall-hook/codex?t=${TOKEN}'; exit 0`,
    async: true,
    timeout: 5
  })
  // pitwall 이 꺼져 있어도 Codex 가 훅 실패로 보지 않게 종료 코드를 0 으로 둔다(cmd·PowerShell 어느 셸로 돌려도 같게:
  // cmd 를 직접 부르고, 그 안의 경로는 역슬래시 — cmd 는 슬래시 경로 명령을 구문 오류로 본다).
  const win = codexHookCommand('win32', 45123, TOKEN, 'C:\\Windows')
  const expected = `C:\\Windows\\System32\\cmd.exe /d /c "C:\\Windows\\System32\\curl.exe -s -m 2 -o NUL --data-binary @- http://127.0.0.1:45123/pitwall-hook/codex?t=${TOKEN} & exit /b 0"`
  expect(win).toEqual({
    type: 'command',
    command: expected,
    commandWindows: expected,
    async: true,
    timeout: 5
  })
  expect(() => codexHookCommand('win32', 0, TOKEN)).toThrow()
  expect(() => codexHookCommand('win32', 45123, 'bad token')).toThrow()
})

test('Codex 이벤트: 작업 중·권한 대기·쉬는 중을 알 수 있는 것', () => {
  expect([...CODEX_HOOK_EVENTS].sort()).toEqual(
    [
      'Interrupt',
      'PermissionRequest',
      'PostToolUse',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit'
    ].sort()
  )
})

test('켜면 pitwall 항목만 더하고 기존 훅을 지키며 백업한다', async () => {
  const other = { type: 'command', command: 'python3 ~/.codex/hooks/guard.py', timeout: 30 }
  const original = JSON.stringify(
    {
      description: '내 훅',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] }
    },
    null,
    2
  )
  await writeFile(join(home, 'hooks.json'), original)
  const entry = codexHookCommand('darwin', 45123, TOKEN)
  const result = await installCodexHooks({ dir: home, entry, now: Date.UTC(2026, 10, 9) })
  expect(result.changed).toBe(true)
  expect(result.backupPath).toMatch(/hooks\.json\.pitwall-backup-/)
  expect(await readFile(result.backupPath!, 'utf8')).toBe(original)

  const written = JSON.parse(await readFile(join(home, 'hooks.json'), 'utf8'))
  expect(written.description).toBe('내 훅')
  expect(written.hooks.PreToolUse).toEqual([
    { matcher: 'Bash', hooks: [other] },
    { hooks: [entry] }
  ])
  for (const event of CODEX_HOOK_EVENTS)
    expect(written.hooks[event]).toContainEqual({ hooks: [entry] })
  expect(await readCodexHookState(home, entry)).toEqual({ state: 'on', allHooksDisabled: false })

  // 두 번 켜도 하나.
  expect((await installCodexHooks({ dir: home, entry, now: 1 })).changed).toBe(false)
})

test('끄면 pitwall 항목만 걷어낸다', async () => {
  const other = { type: 'command', command: 'echo hi' }
  await writeFile(
    join(home, 'hooks.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [other] }] } }, null, 2)
  )
  const entry = codexHookCommand('win32', 45123, TOKEN, 'C:\\Windows')
  await installCodexHooks({ dir: home, entry, now: 1 })
  const result = await uninstallCodexHooks({ dir: home, now: 2 })
  expect(result.changed).toBe(true)
  expect(JSON.parse(await readFile(join(home, 'hooks.json'), 'utf8'))).toEqual({
    hooks: { Stop: [{ hooks: [other] }] }
  })
  expect(await readCodexHookState(home, entry)).toEqual({ state: 'off', allHooksDisabled: false })
})

test('hooks.json 이 없으면 새로 만들고(백업 없음), 끄면 빈 객체로 둔다', async () => {
  const entry = codexHookCommand('darwin', 45123, TOKEN)
  const on = await installCodexHooks({ dir: home, entry, now: 1 })
  expect(on).toMatchObject({ changed: true, backupPath: null })
  await uninstallCodexHooks({ dir: home, now: 2 })
  expect(JSON.parse(await readFile(join(home, 'hooks.json'), 'utf8'))).toEqual({})
})

test('깨진 hooks.json 은 고치지 않고 알린다', async () => {
  const broken = '{ "hooks": { "Stop": [ '
  await writeFile(join(home, 'hooks.json'), broken)
  const entry = codexHookCommand('darwin', 45123, TOKEN)
  await expect(installCodexHooks({ dir: home, entry, now: 1 })).rejects.toBeInstanceOf(
    ClaudeSettingsError
  )
  expect(await readFile(join(home, 'hooks.json'), 'utf8')).toBe(broken)
  expect((await readdir(home)).sort()).toEqual(['hooks.json'])
  expect((await readCodexHookState(home, entry)).state).toBe('error')
})

test('Claude 훅 주소가 든 항목은 Codex 훅으로 보지 않는다', async () => {
  const claudeLike = {
    type: 'command',
    command: `curl --data-binary @- 'http://127.0.0.1:45123/pitwall-hook/claude?t=${TOKEN}'`
  }
  await writeFile(
    join(home, 'hooks.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [claudeLike] }] } })
  )
  await uninstallCodexHooks({ dir: home, now: 1 })
  expect(JSON.parse(await readFile(join(home, CODEX_HOOK_FILE.file), 'utf8')).hooks.Stop).toEqual([
    { hooks: [claudeLike] }
  ])
})
