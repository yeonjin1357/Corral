import { execFileSync, spawn, spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CommandResult } from './collect/runCommand'
import {
  bundleOf,
  createMacInstaller,
  feedBase,
  MAC_FEED,
  MacUpdateError,
  parseLatestMac,
  swapArgv,
  type MacRelease
} from './macUpdate'

/** v0.2.0 릴리스에 실제로 올라간 latest-mac.yml. */
const LATEST = `version: 0.2.0
files:
  - url: corral-0.2.0-x64.dmg
    sha512: 0Gkck7/a/qlWhKzi4R8dKnSKJQX9HzSfGV6fZ0JOYw7eZX48uoZTI4F+xqhTw7WkMCTzekSLOi2g9Dq9DwS5Ug==
    size: 129553840
  - url: corral-0.2.0-arm64.dmg
    sha512: kdUvtiB20qgTtljEmBEZ87y5MOvcPQztLuay9SiD+rdbSaSU0e8+Nle4QcWx/mgnVxd9LHdRpI7AG855SX0VJQ==
    size: 122571627
path: corral-0.2.0-x64.dmg
sha512: 0Gkck7/a/qlWhKzi4R8dKnSKJQX9HzSfGV6fZ0JOYw7eZX48uoZTI4F+xqhTw7WkMCTzekSLOi2g9Dq9DwS5Ug==
releaseDate: '2026-11-12T04:24:38.360Z'
`

describe('parseLatestMac', () => {
  test('이 Mac 에 맞는 설치 파일의 이름과 확인 값을 꺼낸다', () => {
    expect(parseLatestMac(LATEST, 'arm64')).toEqual({
      version: '0.2.0',
      file: 'corral-0.2.0-arm64.dmg',
      sha512:
        'kdUvtiB20qgTtljEmBEZ87y5MOvcPQztLuay9SiD+rdbSaSU0e8+Nle4QcWx/mgnVxd9LHdRpI7AG855SX0VJQ=='
    })
    expect(parseLatestMac(LATEST, 'x64')).toEqual({
      version: '0.2.0',
      file: 'corral-0.2.0-x64.dmg',
      sha512:
        '0Gkck7/a/qlWhKzi4R8dKnSKJQX9HzSfGV6fZ0JOYw7eZX48uoZTI4F+xqhTw7WkMCTzekSLOi2g9Dq9DwS5Ug=='
    })
  })

  test.each([
    ['이 Mac 용 파일이 없다', LATEST.replace(/arm64/g, 'riscv')],
    ['버전이 없다', LATEST.replace('version: 0.2.0\n', '')],
    ['확인 값이 없다', LATEST.replace(/ {4}sha512: kdUv.*\n/, '')],
    [
      '파일 이름에 경로가 들었다',
      LATEST.replace('corral-0.2.0-arm64.dmg', '../../corral-0.2.0-arm64.dmg')
    ],
    ['다른 이름의 파일이다', LATEST.replace('corral-0.2.0-arm64.dmg', 'evil-arm64.dmg')],
    ['형식이 다르다', '<html>Not Found</html>']
  ])('%s → null', (_name, yml) => {
    expect(parseLatestMac(yml, 'arm64')).toBeNull()
  })
})

describe('feedBase', () => {
  test.each([
    [null, MAC_FEED],
    ['', MAC_FEED],
    // 검증용: 이 PC 안의 주소만 받는다.
    ['http://127.0.0.1:8765', 'http://127.0.0.1:8765'],
    ['http://127.0.0.1:8765/', 'http://127.0.0.1:8765'],
    ['http://localhost:9000/feed/', 'http://localhost:9000/feed'],
    // 그 밖의 주소는 무시하고 원래 주소를 쓴다.
    ['https://evil.example/feed', MAC_FEED],
    ['http://127.0.0.1.evil.example:8765', MAC_FEED],
    ['http://evil.example/?x=http://127.0.0.1:8765', MAC_FEED],
    ['file:///tmp/feed', MAC_FEED],
    ['not a url', MAC_FEED]
  ])('%s → %s', (override, want) => {
    expect(feedBase(override)).toBe(want)
  })
})

describe('bundleOf', () => {
  test.each([
    ['/Applications/Corral.app/Contents/MacOS/Corral', '/Applications/Corral.app'],
    [
      '/Users/dev/Applications/Corral.app/Contents/MacOS/Corral',
      '/Users/dev/Applications/Corral.app'
    ],
    // 바꿔 넣을 수 없는 자리: macOS 가 임시로 옮겨 실행한 앱, 설치 파일 안에서 바로 실행한 앱.
    ['/private/var/folders/ab/T/AppTranslocation/1234/d/Corral.app/Contents/MacOS/Corral', null],
    ['/Volumes/Corral 0.2.0-arm64/Corral.app/Contents/MacOS/Corral', null],
    ['/usr/local/bin/corral', null],
    ['Corral.app/Contents/MacOS/Corral', null]
  ])('%s → %s', (execPath, want) => {
    expect(bundleOf(execPath)).toBe(want)
  })
})

describe('createMacInstaller', () => {
  const TARGET = '/Applications/Corral.app'
  const RELEASE: MacRelease = {
    version: '0.3.0',
    file: 'corral-0.3.0-arm64.dmg',
    sha512: 'GOODSUM=='
  }
  const ok = (stdout = ''): CommandResult => ({ stdout, stderr: '', exitCode: 0 })
  const failed = (stderr: string): CommandResult => ({ stdout: '', stderr, exitCode: 1 })

  /** 가짜 Mac: 명령마다 답하고, 무슨 일이 있었는지 적는다. */
  function fakes(
    over: {
      execPath?: string
      sha?: string
      download?: Error
      reply?: (argv: string[]) => CommandResult | undefined
    } = {}
  ): {
    installer: ReturnType<typeof createMacInstaller>
    commands: string[][]
    downloads: [string, string][]
    spawned: string[][]
    removed: string[]
  } {
    const commands: string[][] = []
    const downloads: [string, string][] = []
    const spawned: string[][] = []
    const removed: string[] = []
    const installer = createMacInstaller({
      base: 'https://example.invalid/feed',
      execPath: over.execPath ?? `${TARGET}/Contents/MacOS/Corral`,
      pid: 4242,
      failedMarker: '/Users/dev/Library/Application Support/pitwall/update-failed',
      tmpDir: async () => '/tmp/corral-update-1',
      download: async (url, file) => {
        downloads.push([url, file])
        if (over.download) throw over.download
        return over.sha ?? 'GOODSUM=='
      },
      run: async (argv) => {
        commands.push(argv)
        const custom = over.reply?.(argv)
        if (custom) return custom
        if (argv[0] === '/usr/bin/plutil')
          return ok(
            argv.includes('CFBundleIdentifier') ? 'io.github.yeonjin1357.pitwall\n' : '0.3.0\n'
          )
        return ok()
      },
      spawnDetached: (argv) => {
        spawned.push(argv)
      },
      remove: async (path) => {
        removed.push(path)
      }
    })
    return { installer, commands, downloads, spawned, removed }
  }
  const tools = (f: ReturnType<typeof fakes>): string[] =>
    f.commands.map(
      (c) => c[0].slice(c[0].lastIndexOf('/') + 1) + (c[1] === 'detach' ? ' detach' : '')
    )

  test('내려받아 확인하고, 새 앱을 옆에 풀어 검사한 뒤, 앱이 끝나면 바꿔 넣을 도우미를 띄운다', async () => {
    const f = fakes()
    await f.installer.install(RELEASE)
    expect(f.downloads).toEqual([
      [
        'https://example.invalid/feed/corral-0.3.0-arm64.dmg',
        '/tmp/corral-update-1/corral-0.3.0-arm64.dmg'
      ]
    ])
    expect(tools(f)).toEqual(['hdiutil', 'ditto', 'codesign', 'plutil', 'plutil', 'hdiutil detach'])
    // 새 앱은 지금 앱 옆에 풀어 둔다(같은 폴더라 바꿔 넣기가 이름 바꾸기 한 번이다).
    expect(f.commands[1]).toEqual([
      '/usr/bin/ditto',
      '/tmp/corral-update-1/volume/Corral.app',
      `${TARGET}.updating`
    ])
    expect(f.spawned).toEqual([
      swapArgv(
        4242,
        `${TARGET}.updating`,
        TARGET,
        '/Users/dev/Library/Application Support/pitwall/update-failed'
      )
    ])
    // 임시 폴더는 치우고, 풀어 둔 새 앱은 도우미가 쓸 때까지 둔다.
    expect(f.removed).toContain('/tmp/corral-update-1')
    expect(f.removed.filter((p) => p === `${TARGET}.updating`)).toHaveLength(1) // 풀기 전에 남은 것 치우기 한 번뿐
  })

  test('내려받은 파일의 확인 값이 다르면 아무것도 풀지 않는다', async () => {
    const f = fakes({ sha: 'BADSUM==' })
    await expect(f.installer.install(RELEASE)).rejects.toMatchObject({ code: 'checksum' })
    expect(f.commands).toEqual([])
    expect(f.spawned).toEqual([])
    expect(f.removed).toContain('/tmp/corral-update-1')
  })

  test('내려받지 못하면 그만둔다', async () => {
    const f = fakes({ download: new Error('HTTP 404') })
    await expect(f.installer.install(RELEASE)).rejects.toMatchObject({ code: 'download' })
    expect(f.spawned).toEqual([])
  })

  test('응용 프로그램 폴더에 쓸 수 없으면 그만두고, 풀다 만 것을 치운다', async () => {
    const f = fakes({
      reply: (argv) =>
        argv[0] === '/usr/bin/ditto' ? failed('ditto: Operation not permitted') : undefined
    })
    await expect(f.installer.install(RELEASE)).rejects.toMatchObject({ code: 'write' })
    expect(f.spawned).toEqual([])
    expect(f.removed.filter((p) => p === `${TARGET}.updating`)).toHaveLength(2)
    // 열어 둔 설치 파일은 닫는다.
    expect(tools(f)).toContain('hdiutil detach')
  })

  test.each([
    [
      '서명이 깨졌다',
      (argv: string[]) =>
        argv[0] === '/usr/bin/codesign' ? failed('invalid signature') : undefined
    ],
    [
      '다른 앱이다',
      (argv: string[]) =>
        argv[0] === '/usr/bin/plutil' && argv.includes('CFBundleIdentifier')
          ? ok('com.example.other\n')
          : undefined
    ],
    [
      '알린 버전과 다르다',
      (argv: string[]) =>
        argv[0] === '/usr/bin/plutil' && argv.includes('CFBundleShortVersionString')
          ? ok('0.2.9\n')
          : undefined
    ]
  ])('풀어 놓은 앱이 %s → 바꿔 넣지 않고 치운다', async (_name, reply) => {
    const f = fakes({ reply })
    await expect(f.installer.install(RELEASE)).rejects.toMatchObject({ code: 'verify' })
    expect(f.spawned).toEqual([])
    expect(f.removed.filter((p) => p === `${TARGET}.updating`)).toHaveLength(2)
  })

  test('바꿔 넣을 수 없는 자리에서 실행 중이면 내려받지도 않는다', async () => {
    const f = fakes({ execPath: '/Volumes/Corral 0.2.0-arm64/Corral.app/Contents/MacOS/Corral' })
    const error = await f.installer.install(RELEASE).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MacUpdateError)
    expect(error).toMatchObject({ code: 'location' })
    expect(f.downloads).toEqual([])
  })
})

/** 바꿔 넣는 도우미(bash)를 진짜로 돌려 본다. macOS 에서만 돈다. */
describe.skipIf(process.platform !== 'darwin')('바꿔 넣는 도우미(실제 실행)', () => {
  let base = ''
  let target = ''
  let staged = ''
  let marker = ''
  let opened = ''

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'corral-swap-')))
    mkdirSync(join(base, 'apps'))
    target = join(base, 'apps', 'Corral.app')
    staged = `${target}.updating`
    marker = join(base, 'update-failed')
    opened = join(base, 'opened.txt')
    mkdirSync(target)
    writeFileSync(join(target, 'version'), 'old')
    mkdirSync(staged)
    writeFileSync(join(staged, 'version'), 'new')
    // 가짜 open: 무엇을 열라고 했는지만 적는다.
    mkdirSync(join(base, 'bin'))
    writeFileSync(join(base, 'bin', 'open'), `#!/bin/bash\necho "$1" >> "${opened}"\n`)
    chmodSync(join(base, 'bin', 'open'), 0o755)
  })
  afterEach(() => {
    spawnSync('/bin/chmod', ['-R', 'u+w', base])
    rmSync(base, { recursive: true, force: true })
  })

  /** 도우미를 끝까지 돌린다. pid 는 "끝나기를 기다릴 앱". */
  const swap = (pid: number, tries = 8): number | null => {
    const [command, ...args] = swapArgv(pid, staged, target, marker)
    return spawnSync(command, [...args, String(tries)], {
      env: { PATH: `${join(base, 'bin')}:/usr/bin:/bin` }
    }).status
  }
  /** 이미 끝난 프로세스의 pid. */
  const exitedPid = (): number => Number(execFileSync('/bin/sh', ['-c', 'echo $$']).toString())

  test('앱이 끝나면 새 앱으로 바꿔 넣고 다시 연다', () => {
    expect(swap(exitedPid())).toBe(0)
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('new')
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(`${target}.previous`)).toBe(false)
    expect(readFileSync(opened, 'utf8').trim()).toBe(target)
    expect(existsSync(marker)).toBe(false)
  })

  test('앱이 끝나지 않으면 바꾸지 않고, 풀어 둔 새 앱을 치우고, 실패를 적어 둔다', () => {
    const app = spawn('/bin/sleep', ['30'])
    try {
      expect(swap(app.pid!, 2)).not.toBe(0)
    } finally {
      app.kill('SIGKILL')
    }
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('old')
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(marker)).toBe(true)
    // 앱이 아직 떠 있으니 다시 열지 않는다.
    expect(existsSync(opened)).toBe(false)
  })

  test('바꿔 넣지 못하면(폴더에 쓸 수 없음) 예전 앱을 그대로 두고 다시 열며, 실패를 적어 둔다', () => {
    chmodSync(join(base, 'apps'), 0o555)
    expect(swap(exitedPid())).not.toBe(0)
    chmodSync(join(base, 'apps'), 0o755)
    expect(readFileSync(join(target, 'version'), 'utf8')).toBe('old')
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(opened, 'utf8').trim()).toBe(target)
  })
})
