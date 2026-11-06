import { findLeftovers, isLeftoverTool, processLabel } from './leftovers'
import type { ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'

const MB = 1024 * 1024
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }

function proc(
  pid: number,
  ppid: number,
  name: string,
  commandLine: string,
  opts: { mb?: number; startedAt?: number | null } = {}
): ProcessInfo {
  return {
    pid,
    ppid,
    name,
    commandLine,
    memoryBytes: (opts.mb ?? 1) * MB,
    startedAt: opts.startedAt === undefined ? 100 : opts.startedAt,
    cpuMs: 0
  }
}

const CHROME =
  'C:\\Users\\김개발\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win\\chrome.exe --remote-debugging-pipe --headless --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-x'
const VITEST =
  '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\shop-web\\node_modules\\vitest\\dist\\workers\\forks.js'

function sample(processes: ProcessInfo[]): RawSample {
  return { processes, tcp: [] }
}

describe('남은 프로세스 찾기', () => {
  test('부모가 없는 개발 도구 프로세스와 그 자손을 한 행으로', () => {
    const rows = findLeftovers(
      sample([
        proc(7000, 6999, 'chrome.exe', CHROME, { mb: 300 }),
        proc(7001, 7000, 'chrome.exe', CHROME + ' --type=renderer', { mb: 200, startedAt: 110 }),
        proc(7100, 6998, 'node.exe', VITEST, { mb: 150 })
      ]),
      new Map([[7100, W1]]),
      { exclude: new Set() }
    )
    expect(rows).toEqual([
      {
        pid: 7000,
        processName: 'chrome.exe',
        label: 'Playwright 브라우저',
        commandLine: CHROME,
        worktree: null,
        memoryBytes: 500 * MB,
        descendantPids: [7001],
        startedAt: 100,
        agentInWorktree: false
      },
      {
        pid: 7100,
        processName: 'node.exe',
        label: 'Vitest',
        commandLine: VITEST,
        worktree: W1,
        memoryBytes: 150 * MB,
        descendantPids: [],
        startedAt: 100,
        agentInWorktree: false
      }
    ])
  })

  test('부모가 살아 있으면 남은 프로세스가 아니다', () => {
    const rows = findLeftovers(
      sample([
        proc(7000, 1, 'node.exe', 'npm test', { startedAt: 50 }),
        proc(7100, 7000, 'node.exe', VITEST)
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows).toEqual([])
  })

  test('부모 pid 가 다른 프로세스에 재사용됐으면(부모가 더 늦게 시작) 부모가 없는 것으로 본다', () => {
    const rows = findLeftovers(
      sample([
        proc(7000, 1, 'explorer.exe', 'explorer', { startedAt: 500 }),
        proc(7100, 7000, 'node.exe', VITEST, { startedAt: 100 })
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows.map((r) => r.pid)).toEqual([7100])
  })

  test('macOS 는 부모가 launchd(1)면 남은 프로세스로 본다', () => {
    const rows = findLeftovers(
      sample([
        proc(1, 0, 'launchd', '/sbin/launchd', { startedAt: 1 }),
        proc(7100, 1, 'node', '/usr/local/bin/node /Users/dev/shop-web/node_modules/.bin/vitest'),
        proc(7200, 1, 'Safari', '/Applications/Safari.app/Contents/MacOS/Safari')
      ]),
      new Map(),
      { exclude: new Set(), platform: 'darwin' }
    )
    expect(rows.map((r) => r.pid)).toEqual([7100])
  })

  test('개발 도구가 아니면 부모가 없어도 올리지 않는다', () => {
    const rows = findLeftovers(
      sample([
        proc(7000, 6999, 'svchost.exe', 'C:\\Windows\\system32\\svchost.exe -k netsvcs'),
        proc(7100, 6999, 'Code.exe', '"C:\\Program Files\\Microsoft VS Code\\Code.exe"')
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows).toEqual([])
  })

  test('제외 목록(개발 서버·에이전트·pitwall 트리)에 든 프로세스는 올리지 않는다', () => {
    const rows = findLeftovers(
      sample([proc(7000, 6999, 'chrome.exe', CHROME), proc(7100, 6998, 'node.exe', VITEST)]),
      new Map(),
      { exclude: new Set([7000]) }
    )
    expect(rows.map((r) => r.pid)).toEqual([7100])
  })

  test('하위에 에이전트가 있으면 올리지 않는다(끄면 세션이 같이 꺼지므로)', () => {
    const rows = findLeftovers(
      sample([
        proc(7100, 6998, 'node.exe', VITEST),
        proc(7101, 7100, 'claude.exe', '"C:\\Users\\a\\.local\\bin\\claude.exe"', {
          startedAt: 200
        })
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows).toEqual([])
  })

  test('개발 도구 프로세스 아래의 개발 도구는 맨 위 하나만 행이 된다', () => {
    const rows = findLeftovers(
      sample([
        proc(7100, 6998, 'node.exe', VITEST),
        proc(
          7101,
          7100,
          'esbuild.exe',
          'C:\\work\\shop-web\\node_modules\\esbuild\\esbuild.exe --service',
          {
            startedAt: 200
          }
        )
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows.map((r) => [r.pid, r.descendantPids])).toEqual([[7100, [7101]]])
  })

  test('같은 워크트리에 에이전트가 있으면 표시한다', () => {
    const rows = findLeftovers(
      sample([proc(7100, 6998, 'node.exe', VITEST)]),
      new Map([[7100, W1]]),
      {
        exclude: new Set(),
        agentRoots: new Set(['c:\\work\\shop-web'])
      }
    )
    expect(rows[0].agentInWorktree).toBe(true)
  })

  test('메모리가 큰 순서', () => {
    const rows = findLeftovers(
      sample([
        proc(7000, 6999, 'node.exe', VITEST, { mb: 10 }),
        proc(
          7100,
          6998,
          'java.exe',
          'java org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.10',
          {
            mb: 900
          }
        )
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows.map((r) => r.label)).toEqual(['Gradle 데몬', 'Vitest'])
  })

  test('ppid 고리(서로를 부모로)여도 끝난다', () => {
    const rows = findLeftovers(
      sample([
        proc(7100, 7101, 'node.exe', VITEST, { startedAt: null }),
        proc(7101, 7100, 'node.exe', VITEST, { startedAt: null })
      ]),
      new Map(),
      { exclude: new Set() }
    )
    expect(rows).toEqual([])
  })
})

describe('개발 도구 판별과 이름표', () => {
  test.each<[string, string, string]>([
    ['chrome.exe', CHROME, 'Playwright 브라우저'],
    [
      'node.exe',
      'node C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\x\\node_modules\\@playwright\\mcp\\cli.js',
      'Playwright MCP'
    ],
    ['node.exe', 'node C:\\work\\shop-web\\node_modules\\playwright\\lib\\runner.js', 'Playwright'],
    ['msedge.exe', 'msedge.exe --headless --remote-debugging-port=0', '헤드리스 브라우저'],
    ['node.exe', VITEST, 'Vitest'],
    [
      'node.exe',
      'node C:\\work\\a\\node_modules\\jest-worker\\build\\workers\\processChild.js',
      'Jest 워커'
    ],
    [
      'esbuild.exe',
      'C:\\work\\a\\node_modules\\@esbuild\\win32-x64\\esbuild.exe --service=0.25.0 --ping',
      'esbuild'
    ],
    ['node.exe', 'node C:\\work\\a\\node_modules\\webpack\\bin\\webpack.js --watch', 'webpack'],
    ['node.exe', 'node C:\\work\\a\\node_modules\\typescript\\lib\\tsserver.js', 'TypeScript 서버'],
    [
      'java.exe',
      'java -Xmx2g org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.10',
      'Gradle 데몬'
    ],
    [
      'java.exe',
      'java -cp kotlin-compiler.jar org.jetbrains.kotlin.daemon.KotlinCompileDaemon',
      'Kotlin 데몬'
    ],
    ['node', '/usr/local/bin/node /Users/dev/a/node_modules/.bin/nodemon server.js', 'nodemon']
  ])('%s %s → %s', (name, commandLine, label) => {
    const p = proc(1, 0, name, commandLine)
    expect(isLeftoverTool(p)).toBe(true)
    expect(processLabel(p)).toBe(label)
  })

  test('개발 도구가 아니면 false, 이름표는 프로세스 이름', () => {
    const p = proc(1, 0, 'python.exe', 'python app.py')
    expect(isLeftoverTool(p)).toBe(false)
    expect(processLabel(p)).toBe('python.exe')
  })
})
