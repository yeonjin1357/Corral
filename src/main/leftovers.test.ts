import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findLeftovers, isLeftoverTool, LEFTOVER_MIN_AGE_MS, processLabel } from './leftovers'
import { createKiller } from './kill'
import { buildSnapshot } from './snapshot'
import { sampleWindows } from './collect/windows'
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
        workspace: null,
        memoryBytes: 500 * MB,
        commitBytes: null,
        descendantPids: [7001],
        processes: [
          {
            name: 'chrome.exe',
            hint: 'Playwright 브라우저',
            count: 2,
            memoryBytes: 500 * MB,
            commitBytes: null
          }
        ],
        startedAt: 100,
        agentInWorktree: false
      },
      {
        pid: 7100,
        processName: 'node.exe',
        label: 'Vitest',
        commandLine: VITEST,
        worktree: W1,
        workspace: null,
        memoryBytes: 150 * MB,
        commitBytes: null,
        descendantPids: [],
        processes: [
          { name: 'node.exe', hint: 'Vitest', count: 1, memoryBytes: 150 * MB, commitBytes: null }
        ],
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

  test('에이전트가 상위 폴더 저장소에서 일해도 표시한다', () => {
    const rows = findLeftovers(
      sample([proc(7100, 6998, 'node.exe', VITEST)]),
      new Map([[7100, W1]]),
      { exclude: new Set(), agentRoots: new Set(['c:\\work']) }
    )
    expect(rows[0].agentInWorktree).toBe(true)
  })

  test('막 시작한 프로세스(10분 미만)는 아직 남은 것으로 보지 않는다(에이전트가 띄운 백그라운드 작업 등)', () => {
    const MIN = 60 * 1000
    const now = 100 * MIN
    const rows = (startedAt: number | null): number =>
      findLeftovers(sample([proc(7100, 6998, 'node.exe', VITEST, { startedAt })]), new Map(), {
        exclude: new Set(),
        now
      }).length
    expect(rows(now - 5 * MIN)).toBe(0)
    expect(rows(now - 10 * MIN)).toBe(1)
    // 시작 시각을 모르면 나이로 거르지 않는다.
    expect(rows(null)).toBe(1)
    // 기준 시각을 주지 않으면(워크트리 조회 대상 고르기) 거르지 않는다.
    expect(
      findLeftovers(sample([proc(7100, 6998, 'node.exe', VITEST, { startedAt: now })]), new Map(), {
        exclude: new Set()
      })
    ).toHaveLength(1)
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

describe.runIf(process.platform === 'win32')('실제 Windows 에서', () => {
  test('부모가 끝난 개발 도구 프로세스를 남은 프로세스로 찾고, 확인 후 끈다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pitwall-leftover-'))
    const bin = join(dir, 'node_modules', '.bin')
    await mkdir(bin, { recursive: true })
    const script = join(bin, 'fake-tool.js')
    await writeFile(script, 'setInterval(() => {}, 1000)')
    const marker = `pitwall-leftover-${process.pid}-${Date.now()}`
    let pid: number | undefined
    try {
      // cmd 가 start 로 띄우고 바로 끝나면 node 는 부모 없는 프로세스가 된다(에이전트가 끝난 뒤 남은 도구처럼).
      spawnSync('cmd.exe', ['/d', '/c', 'start', '""', '/b', process.execPath, script, marker], {
        stdio: 'ignore',
        windowsHide: true
      })
      let raw = await sampleWindows()
      for (let i = 0; i < 20 && !raw.processes.some((p) => p.commandLine.includes(marker)); i++) {
        await new Promise((r) => setTimeout(r, 250))
        raw = await sampleWindows()
      }
      pid = raw.processes.find((p) => p.commandLine.includes(marker))?.pid
      expect(pid).toBeDefined()

      const snapshot = buildSnapshot({
        sample: raw,
        worktrees: new Map(),
        totalBytes: 1,
        freeBytes: 1,
        thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
        // 10분 뒤라고 본다(막 띄운 프로세스는 아직 남은 것으로 보지 않으므로).
        now: Date.now() + LEFTOVER_MIN_AGE_MS,
        selfPid: process.pid,
        platform: 'win32'
      })
      const row = snapshot.leftovers.find((r) => r.pid === pid)
      expect(row).toMatchObject({ label: 'fake-tool.js', processName: 'node.exe' })

      const killer = createKiller({
        latest: () => snapshot,
        resample: sampleWindows,
        confirm: async () => true,
        signal: (target, sig) => {
          process.kill(target, sig)
        },
        wait: async () => {},
        platform: 'win32'
      })
      expect(await killer.killLeftover(pid!)).toEqual({ status: 'killed' })
      const after = await sampleWindows()
      expect(after.processes.some((p) => p.commandLine.includes(marker))).toBe(false)
      pid = undefined
    } finally {
      if (pid) {
        try {
          process.kill(pid)
        } catch {
          // 이미 끝났으면 됐다.
        }
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 60000)
})
