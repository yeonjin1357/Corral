import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addPitwallHooks,
  CLAUDE_HOOK_EVENTS,
  claudeConfigDir,
  claudeHookItems,
  ClaudeSettingsError,
  guardCommand,
  hookCommand,
  inspectPitwallHooks,
  installClaudeHooks,
  readClaudeHookState,
  removePitwallHooks,
  uninstallClaudeHooks
} from './claudeHooks'

const TOKEN = 'Ab_-0123456789abcdefghijABCDEFGHIJ0123456789'
const ENTRY = hookCommand('win32', 45123, TOKEN, 'C:\\Windows')
/** 알림 훅(비동기)만 — 무거운 작업 기다리게 하기(G7)가 꺼져 있을 때. */
const ITEMS = claudeHookItems(ENTRY)
const GUARD = guardCommand('win32', 45123, TOKEN, 'C:\\Windows')
/** 알림 훅 + 질문 훅(G7 이 켜져 있을 때). */
const WITH_GUARD = claudeHookItems(ENTRY, GUARD)
const OTHER = { type: 'command', command: 'node "C:\\tools\\orca\\hook.js"' }

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

describe('설정 폴더와 훅 명령', () => {
  test('CLAUDE_CONFIG_DIR 가 있으면 그것, 없거나 비어 있으면 ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'D:\\cfg' }, 'C:\\Users\\a')).toBe('D:\\cfg')
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' }, 'C:\\Users\\a')).toBe(
      join('C:\\Users\\a', '.claude')
    )
    expect(claudeConfigDir({}, '/Users/a')).toBe(join('/Users/a', '.claude'))
  })

  test('Windows: Git Bash·PowerShell 어디서 실행돼도 같은 한 줄(셸 형식), 끝은 항상 exit 0', () => {
    expect(ENTRY).toEqual({
      type: 'command',
      command: `C:/Windows/System32/curl.exe -s -m 2 -o NUL --data-binary '@-' 'http://127.0.0.1:45123/pitwall-hook/claude?t=${TOKEN}'; exit 0`,
      async: true,
      timeout: 5
    })
    // Windows 폴더 경로가 이상하면(공백 등) PATH 의 curl.exe 를 쓴다.
    expect(hookCommand('win32', 45123, TOKEN, 'D:\\My Windows').command).toMatch(/^curl\.exe -s /)
    expect(hookCommand('win32', 45123, TOKEN).command).toMatch(/^curl\.exe -s /)
  })

  test('macOS: /usr/bin/curl, 출력은 /dev/null', () => {
    expect(hookCommand('darwin', 45123, TOKEN).command).toBe(
      `/usr/bin/curl -s -m 2 -o /dev/null --data-binary '@-' 'http://127.0.0.1:45123/pitwall-hook/claude?t=${TOKEN}'; exit 0`
    )
  })

  test('포트·토큰이 이상하면 명령을 만들지 않는다(따옴표를 깨는 값 차단)', () => {
    expect(() => hookCommand('darwin', 0, TOKEN)).toThrow()
    expect(() => hookCommand('darwin', 70000, TOKEN)).toThrow()
    expect(() => hookCommand('darwin', 1.5, TOKEN)).toThrow()
    expect(() => hookCommand('darwin', 45123, "x'; rm -rf ~; '")).toThrow()
    expect(() => hookCommand('darwin', 45123, '')).toThrow()
  })

  test('질문 훅 명령은 연결 0.3초·전체 2초 제한이고 항상 종료 코드 0, 출력을 버리지 않는다', () => {
    // pitwall 의 답(JSON)을 표준출력으로 Claude 에 넘긴다. 꺼져 있으면(닫힌 포트) 0.3초 안에 아무것도 찍지 않고 끝난다.
    expect(GUARD).toEqual({
      type: 'command',
      command: `C:/Windows/System32/curl.exe -s --connect-timeout 0.3 -m 2 --data-binary '@-' 'http://127.0.0.1:45123/pitwall-hook/claude/guard?t=${TOKEN}'; exit 0`,
      timeout: 3
    })
    expect(guardCommand('darwin', 45123, TOKEN).command).toBe(
      `/usr/bin/curl -s --connect-timeout 0.3 -m 2 --data-binary '@-' 'http://127.0.0.1:45123/pitwall-hook/claude/guard?t=${TOKEN}'; exit 0`
    )
    // Windows 는 항상 절대 경로 — 출력이 Claude 에 들어가므로 PATH 에서 찾지 않는다(SystemRoot 를 못 쓰면 기본 위치).
    for (const odd of ['D:\\My Windows', undefined])
      expect(guardCommand('win32', 45123, TOKEN, odd).command).toMatch(
        /^C:\/Windows\/System32\/curl\.exe -s --connect-timeout 0\.3 -m 2 /
      )
    for (const platform of ['win32', 'darwin'] as const) {
      const { command } = guardCommand(platform, 45123, TOKEN, 'C:\\Windows')
      expect(command).not.toMatch(/ -o /)
      expect(command.endsWith('; exit 0')).toBe(true)
    }
    expect(() => guardCommand('darwin', 0, TOKEN)).toThrow()
    expect(() => guardCommand('win32', 45123, "x'; rm -rf ~; '")).toThrow()
  })
})

describe('설정 글 고치기', () => {
  const withOthers = [
    '{',
    '  // 사용자가 남긴 주석',
    '  "model": "opus",',
    '  "statusLine": { "type": "command", "command": "orca-status" },',
    '  "hooks": {',
    '    "Stop": [',
    '      { "hooks": [' + JSON.stringify(OTHER) + '] }',
    '    ],',
    '    "PreToolUse": [',
    '      { "matcher": "Bash", "hooks": [' + JSON.stringify(OTHER) + '] }',
    '    ]',
    '  },',
    '  "permissions": { "allow": ["Bash(npm test)"] },',
    '}',
    ''
  ].join('\n')

  test('빈 글이면 9개 이벤트에 pitwall 훅 그룹을 하나씩 만든다', () => {
    expect(CLAUDE_HOOK_EVENTS).toHaveLength(9)
    const next = parse(addPitwallHooks('', ITEMS))
    expect(Object.keys(next.hooks as object)).toEqual([...CLAUDE_HOOK_EVENTS])
    for (const event of CLAUDE_HOOK_EVENTS)
      expect((next.hooks as Record<string, unknown>)[event]).toEqual([{ hooks: [ENTRY] }])
  })

  test('주석·다른 키·다른 도구의 훅·순서를 그대로 두고 뒤에 더한다', () => {
    const next = addPitwallHooks(withOthers, ITEMS)
    expect(next).toContain('// 사용자가 남긴 주석')
    expect(next).toContain('"statusLine": { "type": "command", "command": "orca-status" }')
    expect(inspectPitwallHooks(next, ITEMS).state).toBe('on')
    const stop = removeComments(next).hooks.Stop as unknown[]
    expect(stop).toEqual([{ hooks: [OTHER] }, { hooks: [ENTRY] }])
    expect(Object.keys(removeComments(next))).toEqual([
      'model',
      'statusLine',
      'hooks',
      'permissions'
    ])
  })

  test('PreToolUse 에도 훅을 넣는다', () => {
    expect(CLAUDE_HOOK_EVENTS).toContain('PreToolUse')
    // 모든 도구(matcher 없음), 비동기 — 도구 실행을 기다리게 하지 않는다.
    const empty = parse(addPitwallHooks('', ITEMS)).hooks as Record<string, unknown>
    expect(empty.PreToolUse).toEqual([{ hooks: [ENTRY] }])
    expect(ENTRY.async).toBe(true)
    // 다른 도구의 PreToolUse 그룹(matcher 포함)은 그대로 두고 뒤에 더한다.
    const next = removeComments(addPitwallHooks(withOthers, ITEMS))
    expect(next.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [OTHER] }, { hooks: [ENTRY] }])
  })

  test('두 번 켜도 한 번만 들어가고, 포트·토큰이 바뀌면 바꿔 넣는다', () => {
    const once = addPitwallHooks(withOthers, ITEMS)
    expect(addPitwallHooks(once, ITEMS)).toBe(once)
    const moved = hookCommand('win32', 50000, TOKEN, 'C:\\Windows')
    const next = removeComments(addPitwallHooks(once, claudeHookItems(moved)))
    expect(next.hooks.Stop).toEqual([{ hooks: [OTHER] }, { hooks: [moved] }])
  })

  test('guard 를 켜면 PreToolUse 에 matcher Bash|PowerShell 인 동기 훅이 하나 더', () => {
    expect(WITH_GUARD).toHaveLength(CLAUDE_HOOK_EVENTS.length + 1)
    expect(WITH_GUARD.at(-1)).toEqual({
      event: 'PreToolUse',
      matcher: 'Bash|PowerShell',
      entry: GUARD
    })
    // 동기(async 없음), 제한 3초.
    expect(GUARD.async).toBeUndefined()
    expect(GUARD.timeout).toBe(3)

    const empty = parse(addPitwallHooks('', WITH_GUARD)).hooks as Record<string, unknown>
    expect(empty.PreToolUse).toEqual([
      { hooks: [ENTRY] },
      { matcher: 'Bash|PowerShell', hooks: [GUARD] }
    ])
    expect(Object.keys(empty)).toEqual([...CLAUDE_HOOK_EVENTS])

    // 다른 도구의 그룹·주석은 그대로 두고 뒤에 더한다. 알림 훅 그룹의 모양은 예전과 같다.
    const text = addPitwallHooks(withOthers, WITH_GUARD)
    expect(text).toContain('// 사용자가 남긴 주석')
    const next = removeComments(text)
    expect(next.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [OTHER] },
      { hooks: [ENTRY] },
      { matcher: 'Bash|PowerShell', hooks: [GUARD] }
    ])
    expect(next.hooks.Stop).toEqual([{ hooks: [OTHER] }, { hooks: [ENTRY] }])
    expect(inspectPitwallHooks(text, WITH_GUARD).state).toBe('on')
    // 두 번 켜도 그대로.
    expect(addPitwallHooks(text, WITH_GUARD)).toBe(text)
    // guard 없이 켜 둔 글에 guard 를 켜면 질문 훅만 는다.
    const plain = addPitwallHooks(withOthers, ITEMS)
    expect(removeComments(addPitwallHooks(plain, WITH_GUARD))).toEqual(next)
  })

  test('끄면 pitwall 훅을 모두 뺀다(guard 포함)', () => {
    for (const text of ['{}\n', withOthers, '{\r\n\t"model": "opus"\r\n}\r\n'])
      expect(removePitwallHooks(addPitwallHooks(text, WITH_GUARD))).toBe(text)
    // guard 를 끄고 다시 켜면 질문 훅만 빠진다.
    const on = addPitwallHooks(withOthers, WITH_GUARD)
    const off = addPitwallHooks(on, ITEMS)
    expect(off).not.toContain('/pitwall-hook/claude/guard')
    expect(removeComments(off).hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [OTHER] },
      { hooks: [ENTRY] }
    ])
    expect(off).toBe(addPitwallHooks(withOthers, ITEMS))
  })

  test('빈 글에서 켰다 끄면 빈 객체가 남는다(파일은 이미 만들어졌으므로)', () => {
    expect(removePitwallHooks(addPitwallHooks('', ITEMS))).toBe('{}\n')
  })

  test.each([
    ['빈 객체', '{}\n'],
    ['주석·후행 쉼표·다른 훅', withOthers],
    ['CRLF·탭 들여쓰기', '{\r\n\t"model": "opus"\r\n}\r\n']
  ])('켰다 끄면 글자 하나까지 원래대로(%s)', (_name, text) => {
    expect(removePitwallHooks(addPitwallHooks(text, ITEMS))).toBe(text)
  })

  test('들여쓰기·줄바꿈을 따라간다(탭, CRLF)', () => {
    const text = '{\r\n\t"model": "opus"\r\n}\r\n'
    const next = addPitwallHooks(text, ITEMS)
    expect(next).toContain('\r\n\t"hooks": {\r\n\t\t"SessionStart"')
    expect(next.replace(/\r\n/g, '')).not.toContain('\n')
  })

  test('pitwall 이 비운 이벤트·hooks 는 지운다(원래 빈 배열이었어도)', () => {
    const text = addPitwallHooks('{ "hooks": { "Stop": [] } }', ITEMS)
    expect(parse(removePitwallHooks(text))).toEqual({})
  })

  test('다른 도구 훅과 한 그룹에 섞여 있으면 pitwall 것만 뺀다', () => {
    const mixed = JSON.stringify({ hooks: { Stop: [{ hooks: [OTHER, ENTRY] }] } }, null, 2)
    expect(parse(removePitwallHooks(mixed))).toEqual({ hooks: { Stop: [{ hooks: [OTHER] }] } })
  })

  test('셸 없이 실행하는 형식(args)에 표시가 있어도 pitwall 훅으로 알아본다', () => {
    const execForm = {
      type: 'command',
      command: 'cmd.exe',
      args: ['/c', 'curl.exe -s http://127.0.0.1:45123/pitwall-hook/claude?t=x >nul & exit /b 0']
    }
    const text = JSON.stringify({ hooks: { Stop: [{ hooks: [execForm] }] } })
    expect(parse(removePitwallHooks(text))).toEqual({})
  })

  test('다른 도구 명령에 pitwall-hook 이라는 글자만 있으면 pitwall 훅이 아니다(지우지 않는다)', () => {
    const lookalikes = [
      { type: 'command', command: 'echo pitwall-hook' },
      { type: 'command', command: 'node ~/scripts/pitwall-hook-logger.js' },
      { type: 'command', command: 'curl https://example.com/pitwall-hook/claude' }
    ]
    const text = JSON.stringify({ hooks: { Stop: [{ hooks: lookalikes }] } }, null, 2)
    expect(parse(removePitwallHooks(text))).toEqual({ hooks: { Stop: [{ hooks: lookalikes }] } })
  })

  test.each([
    ['깨진 JSON', '{ "hooks": { ', 'parse'],
    ['최상위가 배열', '[]', 'shape'],
    ['hooks 가 배열', '{ "hooks": [] }', 'shape'],
    ['이벤트 값이 객체', '{ "hooks": { "Stop": {} } }', 'shape']
  ])('%s 이면 고치지 않고 거절한다', (_name, text, code) => {
    const attempt = (): string => addPitwallHooks(text, ITEMS)
    expect(attempt).toThrow(ClaudeSettingsError)
    try {
      attempt()
    } catch (e) {
      expect((e as ClaudeSettingsError).code).toBe(code)
    }
    expect(() => removePitwallHooks(text)).toThrow(ClaudeSettingsError)
  })
})

describe('설치 상태 읽기', () => {
  test('모든 이벤트에 지금 명령이 있으면 on, 일부·다른 명령이면 partial, 없으면 off', () => {
    const on = addPitwallHooks('', ITEMS)
    expect(inspectPitwallHooks(on, ITEMS).state).toBe('on')
    expect(inspectPitwallHooks(on, claudeHookItems(hookCommand('win32', 1234, TOKEN))).state).toBe(
      'partial'
    )
    const json = parse(on)
    delete (json.hooks as Record<string, unknown>).Stop
    expect(inspectPitwallHooks(JSON.stringify(json), ITEMS).state).toBe('partial')
    expect(inspectPitwallHooks('{}', ITEMS).state).toBe('off')
    expect(inspectPitwallHooks('', ITEMS).state).toBe('off')
  })

  test('PreToolUse 가 없는 예전 설정은 partial', () => {
    // 4단계까지 넣던 8개 이벤트(PreToolUse 없음)만 있는 설정.
    const old = Object.fromEntries(
      CLAUDE_HOOK_EVENTS.filter((e) => e !== 'PreToolUse').map((e) => [e, [{ hooks: [ENTRY] }]])
    )
    expect(Object.keys(old)).toHaveLength(8)
    expect(inspectPitwallHooks(JSON.stringify({ hooks: old }), ITEMS).state).toBe('partial')
    // 다시 켜면 on.
    expect(
      inspectPitwallHooks(addPitwallHooks(JSON.stringify({ hooks: old }), ITEMS), ITEMS).state
    ).toBe('on')
  })

  test('guard 설정과 파일이 다르면 partial', () => {
    const plain = addPitwallHooks('', ITEMS)
    const guarded = addPitwallHooks('', WITH_GUARD)
    // 예전에 켠 설정(질문 훅 없음)은 guard 가 꺼져 있으면 그대로 on — 옮기지 않는다.
    expect(inspectPitwallHooks(plain, ITEMS).state).toBe('on')
    expect(inspectPitwallHooks(guarded, WITH_GUARD).state).toBe('on')
    // guard 를 켰는데 질문 훅이 없음, 껐는데 남아 있음.
    expect(inspectPitwallHooks(plain, WITH_GUARD).state).toBe('partial')
    expect(inspectPitwallHooks(guarded, ITEMS).state).toBe('partial')
    // 질문 훅이 다른 포트·토큰이거나, 두 개이거나, matcher 가 다르면 partial.
    const otherPort = claudeHookItems(ENTRY, guardCommand('win32', 50000, TOKEN, 'C:\\Windows'))
    expect(inspectPitwallHooks(guarded, otherPort).state).toBe('partial')
    const json = parse(guarded) as { hooks: Record<string, unknown[]> }
    json.hooks.PreToolUse.push({ matcher: 'Bash|PowerShell', hooks: [GUARD] })
    expect(inspectPitwallHooks(JSON.stringify(json), WITH_GUARD).state).toBe('partial')
    json.hooks.PreToolUse.pop()
    ;(json.hooks.PreToolUse[1] as { matcher?: string }).matcher = 'Bash'
    expect(inspectPitwallHooks(JSON.stringify(json), WITH_GUARD).state).toBe('partial')
    // 알림 이벤트가 아닌 곳의 pitwall 훅도 다른 pitwall 훅이다.
    const stray = parse(plain) as { hooks: Record<string, unknown[]> }
    stray.hooks.SubagentStop = [{ hooks: [ENTRY] }]
    expect(inspectPitwallHooks(JSON.stringify(stray), ITEMS).state).toBe('partial')
  })

  test('disableAllHooks 가 켜져 있으면 알려 준다', () => {
    expect(inspectPitwallHooks('{ "disableAllHooks": true }', ITEMS).allHooksDisabled).toBe(true)
    expect(inspectPitwallHooks('{}', ITEMS).allHooksDisabled).toBe(false)
  })

  test('깨진 글이면 error', () => {
    expect(inspectPitwallHooks('{ "hooks": ', ITEMS).state).toBe('error')
  })
})

describe('설정 파일 설치·해제(임시 폴더)', () => {
  let dir: string
  const NOW = new Date(2026, 10, 6, 9, 5, 7).getTime()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pitwall-claude-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const settingsPath = (): string => join(dir, 'settings.json')

  test('파일이 없으면 폴더까지 만들고, 백업은 없다', async () => {
    const nested = join(dir, 'new', '.claude')
    const result = await installClaudeHooks({ dir: nested, items: ITEMS, now: NOW })
    expect(result).toEqual({ path: join(nested, 'settings.json'), backupPath: null, changed: true })
    const text = await readFile(join(nested, 'settings.json'), 'utf8')
    expect(inspectPitwallHooks(text, ITEMS).state).toBe('on')
    expect(text.endsWith('\n')).toBe(true)
  })

  test('있으면 시각을 붙인 백업을 남기고 바꾼다. 끄면 원래 내용으로 돌아온다', async () => {
    const original = '{\n  // 주석\n  "model": "opus",\n}\n'
    await writeFile(settingsPath(), original)
    const on = await installClaudeHooks({ dir, items: ITEMS, now: NOW })
    expect(on.backupPath).toBe(join(dir, 'settings.json.pitwall-backup-20261106-090507'))
    expect(await readFile(on.backupPath!, 'utf8')).toBe(original)
    expect(inspectPitwallHooks(await readFile(settingsPath(), 'utf8'), ITEMS).state).toBe('on')

    const off = await uninstallClaudeHooks({ dir, now: NOW + 1000 })
    expect(off.changed).toBe(true)
    expect(off.backupPath).toBe(join(dir, 'settings.json.pitwall-backup-20261106-090508'))
    expect(await readFile(settingsPath(), 'utf8')).toBe(original)
    // 임시 파일이 남지 않는다.
    expect((await readdir(dir)).filter((n) => n.includes('tmp'))).toEqual([])
  })

  test('같은 초에 두 번 바꿔도 백업이 덮이지 않는다', async () => {
    await writeFile(settingsPath(), '{}\n')
    const a = await installClaudeHooks({ dir, items: ITEMS, now: NOW })
    const b = await installClaudeHooks({
      dir,
      items: claudeHookItems(hookCommand('win32', 50000, TOKEN)),
      now: NOW
    })
    expect(a.backupPath).not.toBe(b.backupPath)
    expect(await readFile(a.backupPath!, 'utf8')).toBe('{}\n')
  })

  test('이미 켜져 있으면 파일·백업을 건드리지 않는다', async () => {
    await installClaudeHooks({ dir, items: ITEMS, now: NOW })
    const again = await installClaudeHooks({ dir, items: ITEMS, now: NOW + 5000 })
    expect(again).toEqual({ path: settingsPath(), backupPath: null, changed: false })
  })

  test('파일이 없을 때 끄기는 아무것도 하지 않는다', async () => {
    expect(await uninstallClaudeHooks({ dir, now: NOW })).toEqual({
      path: settingsPath(),
      backupPath: null,
      changed: false
    })
    expect(await readdir(dir)).toEqual([])
  })

  test('깨진 파일은 고치지 않고 거절하고, 백업도 만들지 않는다', async () => {
    await writeFile(settingsPath(), '{ "hooks": ')
    await expect(installClaudeHooks({ dir, items: ITEMS, now: NOW })).rejects.toMatchObject({
      code: 'parse'
    })
    expect(await readFile(settingsPath(), 'utf8')).toBe('{ "hooks": ')
    expect(await readdir(dir)).toEqual(['settings.json'])
  })

  test('UTF-8 이 아닌 글자(예: CP949 로 저장한 한글 주석)가 있으면 고치지 않고 거절, 백업도 없다', async () => {
    const bytes = Buffer.concat([
      Buffer.from('{\n  // '),
      Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]),
      Buffer.from('\n  "model": "opus"\n}\n')
    ])
    await writeFile(settingsPath(), bytes)
    await expect(installClaudeHooks({ dir, items: ITEMS, now: NOW })).rejects.toMatchObject({
      code: 'encoding'
    })
    expect((await readFile(settingsPath())).equals(bytes)).toBe(true)
    expect(await readdir(dir)).toEqual(['settings.json'])
    expect((await readClaudeHookState(dir, ITEMS)).state).toBe('error')
  })

  test.runIf(process.platform !== 'win32')(
    '백업은 원본과 같은 권한(예: 0600)으로 만든다',
    async () => {
      const { chmod, stat } = await import('node:fs/promises')
      await writeFile(settingsPath(), '{}\n')
      await chmod(settingsPath(), 0o600)
      const { backupPath } = await installClaudeHooks({ dir, items: ITEMS, now: NOW })
      expect((await stat(backupPath!)).mode & 0o777).toBe(0o600)
      expect((await stat(settingsPath())).mode & 0o777).toBe(0o600)
    }
  )

  test('UTF-8 BOM 이 있으면 지킨다', async () => {
    const bom = String.fromCharCode(0xfeff)
    await writeFile(settingsPath(), bom + '{}\n')
    await installClaudeHooks({ dir, items: ITEMS, now: NOW })
    const text = await readFile(settingsPath(), 'utf8')
    expect(text.startsWith(bom + '{')).toBe(true)
    await uninstallClaudeHooks({ dir, now: NOW + 1000 })
    expect(await readFile(settingsPath(), 'utf8')).toBe(bom + '{}\n')
  })

  test('settings.json 이 링크(dotfiles 관리)면 링크는 두고 원본 파일을 고친다', async () => {
    const real = join(dir, 'dotfiles', 'claude-settings.json')
    await mkdir(join(dir, 'dotfiles'))
    await writeFile(real, '{}\n')
    try {
      await symlink(real, settingsPath(), 'file')
    } catch {
      return // Windows 에서 링크 만들기 권한이 없으면 건너뛴다.
    }
    await installClaudeHooks({ dir, items: ITEMS, now: NOW })
    expect(inspectPitwallHooks(await readFile(real, 'utf8'), ITEMS).state).toBe('on')
    const { lstat } = await import('node:fs/promises')
    expect((await lstat(settingsPath())).isSymbolicLink()).toBe(true)
  })
})

/** 실제 셸로 훅 명령을 돌려 본다(Claude Code 가 하는 것처럼 표준입력에 JSON). */
function runHook(
  argv: string[],
  stdin: string,
  cwd?: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

function hookShells(command: string): [string, string[]][] {
  if (process.platform === 'darwin') return [['sh', ['/bin/sh', '-c', command]]]
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const shells: [string, string[]][] = [
    [
      'PowerShell',
      [
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        command
      ]
    ]
  ]
  const gitBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  if (existsSync(gitBash)) shells.push(['Git Bash', [gitBash, '-c', command]])
  return shells
}

describe.runIf(process.platform === 'win32' || process.platform === 'darwin')(
  '실제 셸에서 훅 명령',
  () => {
    test('이벤트가 그대로 도착하고(한글·따옴표·$() 포함), 종료 코드 0', async () => {
      const got: string[] = []
      const server = createServer((req, res) => {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString('utf8')))
        req.on('end', () => {
          got.push(`${req.url} ${body}`)
          res.writeHead(204).end()
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const port = (server.address() as { port: number }).port
      const entry = hookCommand(
        process.platform === 'darwin' ? 'darwin' : 'win32',
        port,
        TOKEN,
        process.env.SystemRoot
      )
      const cwd = await mkdtemp(join(tmpdir(), 'pitwall 공백 폴더 '))
      try {
        for (const [name, argv] of hookShells(entry.command)) {
          const payload = JSON.stringify({
            via: name,
            cwd,
            prompt: `"$(echo pwned)" & echo x \`id\``
          })
          const result = await runHook(argv, payload, cwd)
          expect({ name, code: result.code }).toEqual({ name, code: 0 })
          expect(got.pop()).toBe(`/pitwall-hook/claude?t=${TOKEN} ${payload}`)
        }
      } finally {
        await new Promise<void>((r) => server.close(() => r()))
        await rm(cwd, { recursive: true, force: true })
      }
    }, 30000)

    test('pitwall 이 꺼져 있어도 종료 코드 0, 오류 출력 없음', async () => {
      const blocker = createServer()
      await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
      const port = (blocker.address() as { port: number }).port
      await new Promise<void>((r) => blocker.close(() => r()))
      const entry = hookCommand(
        process.platform === 'darwin' ? 'darwin' : 'win32',
        port,
        TOKEN,
        process.env.SystemRoot
      )
      for (const [name, argv] of hookShells(entry.command)) {
        const result = await runHook(argv, '{}')
        expect({ name, code: result.code, stderr: result.stderr }).toEqual({
          name,
          code: 0,
          stderr: ''
        })
      }
    }, 30000)

    test('질문 훅: pitwall 의 답(JSON)만 표준출력으로, 204 면 아무것도 찍지 않고 종료 코드 0', async () => {
      const got: string[] = []
      let answer: string | null = null
      const server = createServer((req, res) => {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString('utf8')))
        req.on('end', () => {
          got.push(`${req.url} ${body}`)
          if (answer === null) res.writeHead(204).end()
          else res.writeHead(200, { 'Content-Type': 'application/json' }).end(answer)
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const port = (server.address() as { port: number }).port
      const guard = guardCommand(
        process.platform === 'darwin' ? 'darwin' : 'win32',
        port,
        TOKEN,
        process.env.SystemRoot
      )
      try {
        for (const [name, argv] of hookShells(guard.command)) {
          const payload = JSON.stringify({ via: name, tool_input: { command: 'npx tsc "$(id)"' } })
          answer =
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"\\uc5ec"}}'
          const told = await runHook(argv, payload)
          expect({ name, code: told.code, out: told.stdout.trim(), err: told.stderr }).toEqual({
            name,
            code: 0,
            out: answer,
            err: ''
          })
          expect(got.pop()).toBe(`/pitwall-hook/claude/guard?t=${TOKEN} ${payload}`)
          answer = null
          const quiet = await runHook(argv, payload)
          expect({ name, code: quiet.code, out: quiet.stdout, err: quiet.stderr }).toEqual({
            name,
            code: 0,
            out: '',
            err: ''
          })
        }
      } finally {
        await new Promise<void>((r) => server.close(() => r()))
      }
    }, 30000)

    test('질문 훅: 받기만 하고 답하지 않으면 2초(-m 2)에 끝나고 아무것도 찍지 않고 종료 코드 0', async () => {
      const got: string[] = []
      // 요청을 끝까지 받지만 답하지 않는다(멈춘 pitwall).
      const server = createServer((req) => {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString('utf8')))
        req.on('end', () => got.push(body))
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const port = (server.address() as { port: number }).port
      const guard = guardCommand(
        process.platform === 'darwin' ? 'darwin' : 'win32',
        port,
        TOKEN,
        process.env.SystemRoot
      )
      try {
        for (const [name, argv] of hookShells(guard.command)) {
          const payload = JSON.stringify({ via: name })
          const startedAt = Date.now()
          const result = await runHook(argv, payload)
          const ms = Date.now() - startedAt
          expect({ name, code: result.code, out: result.stdout, err: result.stderr }).toEqual({
            name,
            code: 0,
            out: '',
            err: ''
          })
          expect(got.pop()).toBe(payload)
          // -m 2 로 끝난다(셸을 띄우는 시간이 느린 PC 도 있어 5초까지 둔다).
          expect(ms, name).toBeGreaterThanOrEqual(1900)
          expect(ms, name).toBeLessThan(5000)
        }
      } finally {
        server.closeAllConnections()
        await new Promise<void>((r) => server.close(() => r()))
      }
    }, 30000)

    test('질문 훅: pitwall 이 꺼져 있으면(닫힌 포트) 아무것도 찍지 않고 종료 코드 0', async () => {
      const blocker = createServer()
      await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
      const port = (blocker.address() as { port: number }).port
      await new Promise<void>((r) => blocker.close(() => r()))
      const guard = guardCommand(
        process.platform === 'darwin' ? 'darwin' : 'win32',
        port,
        TOKEN,
        process.env.SystemRoot
      )
      for (const [name, argv] of hookShells(guard.command)) {
        const result = await runHook(argv, '{}')
        expect({ name, code: result.code, out: result.stdout, err: result.stderr }).toEqual({
          name,
          code: 0,
          out: '',
          err: ''
        })
      }
    }, 30000)
  }
)

function removeComments(text: string): {
  hooks: Record<string, unknown>
  [key: string]: unknown
} {
  // 테스트에서 비교하려고 주석·후행 쉼표를 걷어 낸 값을 얻는다.
  const stripped = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped) as { hooks: Record<string, unknown> }
}
