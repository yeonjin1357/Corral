import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProcessInfo, WorktreeInfo } from '../shared/types'
import {
  createGradleDaemonReader,
  daemonLogCandidates,
  gradleDaemonWorktrees,
  isGradleDaemon,
  lastBuildDir,
  logEncoding
} from './gradleDaemon'

const WIN_DAEMON =
  '"C:\\Program Files\\Amazon Corretto\\jdk11.0.29_7\\bin\\java.exe" -XX:+HeapDumpOnOutOfMemoryError ' +
  '--add-opens=java.base/java.util=ALL-UNNAMED -Xmx4g -Dfile.encoding=UTF-8 ' +
  '-cp C:\\gradle-home\\wrapper\\dists\\gradle-7.6.4-bin\\8fe47filz6t3dua1jx7iefdp3\\gradle-7.6.4\\lib\\gradle-launcher-7.6.4.jar ' +
  'org.gradle.launcher.daemon.bootstrap.GradleDaemon 7.6.4'

function proc(pid: number, commandLine: string, startedAt: number | null = null): ProcessInfo {
  return { pid, ppid: 1, name: 'java.exe', commandLine, memoryBytes: 0, startedAt }
}

/** Gradle 데몬 로그의 빌드 줄(7.6.4 에서 본 모양). */
function buildLine(dir: string): string {
  return (
    '2026-11-13T11:24:55.171+0900 [INFO] [org.gradle.launcher.daemon.server.DefaultIncomingConnectionHandler] ' +
    `Received command: Build{id=c2b54d7a-4aa1-4576-92a5-d5d603a07d89, currentDir=${dir}}.\n`
  )
}
const IDLE_LINE =
  '2026-11-13T12:44:15.144+0900 [DEBUG] [org.gradle.cache.internal.DefaultFileLockManager] Lock acquired on daemon addresses registry.\n'

describe('isGradleDaemon', () => {
  test('Gradle 데몬의 명령줄이면 참', () => {
    expect(isGradleDaemon(proc(1, WIN_DAEMON))).toBe(true)
  })

  test('Gradle 래퍼(gradlew)나 빌드가 띄운 앱은 데몬이 아니다', () => {
    expect(
      isGradleDaemon(
        proc(
          2,
          'java.exe -Xmx64m -classpath C:/work/api/gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain bootRun'
        )
      )
    ).toBe(false)
    expect(
      isGradleDaemon(proc(3, 'java.exe -cp C:\\work\\api\\build\\app.jar com.example.Application'))
    ).toBe(false)
  })
})

describe('lastBuildDir', () => {
  test('마지막 빌드 줄의 폴더를 준다', () => {
    const text =
      buildLine('C:\\work\\first') + IDLE_LINE + buildLine('C:\\work\\second') + IDLE_LINE
    expect(lastBuildDir(text)).toBe('C:\\work\\second')
  })

  test('공백이 든 경로와 CRLF 줄바꿈도 읽는다', () => {
    expect(lastBuildDir(buildLine('/Users/me/My Projects/shop').replace('\n', '\r\n'))).toBe(
      '/Users/me/My Projects/shop'
    )
  })

  test('빌드 줄이 없으면 null', () => {
    expect(lastBuildDir(IDLE_LINE + IDLE_LINE)).toBeNull()
    expect(lastBuildDir('')).toBeNull()
  })
})

/** 테스트용 MS949 인코더(Node 에는 없다): 두 바이트 글자를 모두 풀어 보고 거꾸로 찾는 표를 만든다. */
let ms949Table: Map<string, number[]> | null = null
function encodeMs949(text: string): Buffer {
  if (!ms949Table) {
    ms949Table = new Map()
    const decoder = new TextDecoder('euc-kr')
    for (let lead = 0x81; lead <= 0xfe; lead++)
      for (let trail = 0x41; trail <= 0xfe; trail++) {
        const ch = decoder.decode(Uint8Array.of(lead, trail))
        if (ch.length === 1 && ch !== '\ufffd' && !ms949Table.has(ch))
          ms949Table.set(ch, [lead, trail])
      }
  }
  const table = ms949Table
  return Buffer.from(
    [...text].flatMap((ch) => (ch.charCodeAt(0) < 0x80 ? [ch.charCodeAt(0)] : table.get(ch)!))
  )
}

describe('logEncoding', () => {
  const cmd = (encoding: string | null): string =>
    `java.exe -Xmx512m ${encoding ? `-Dfile.encoding=${encoding} ` : ''}-Duser.country=KR ` +
    'org.gradle.launcher.daemon.bootstrap.GradleDaemon 7.6.4'

  test('데몬의 명령줄에 적힌 글자 인코딩을 쓴다', () => {
    expect(logEncoding(cmd('UTF-8'))).toBe('utf-8')
    expect(logEncoding(cmd('windows-1252'))).toBe('windows-1252')
  })

  test('한글 Windows 의 MS949 는 자바가 부르는 이름이 달라도 알아본다', () => {
    expect(logEncoding(cmd('x-windows-949'))).toBe('euc-kr')
    expect(logEncoding(cmd('MS949'))).toBe('euc-kr')
    expect(logEncoding(cmd('Cp949'))).toBe('euc-kr')
  })

  test('적혀 있지 않거나 모르는 이름이면 UTF-8 로 읽는다', () => {
    expect(logEncoding(cmd(null))).toBe('utf-8')
    expect(logEncoding(cmd('Cp99999'))).toBe('utf-8')
  })
})

describe('daemonLogCandidates', () => {
  test('쉬는 데몬이 서 있는 폴더(데몬 폴더)의 로그가 먼저다', () => {
    expect(
      daemonLogCandidates(
        proc(56028, WIN_DAEMON),
        'C:\\gradle-home\\daemon\\7.6.4\\',
        'C:\\Users\\me'
      )
    ).toEqual([
      'C:\\gradle-home\\daemon\\7.6.4\\daemon-56028.out.log',
      'C:\\Users\\me\\.gradle\\daemon\\7.6.4\\daemon-56028.out.log'
    ])
  })

  test('작업 폴더를 모르면 명령줄의 래퍼 경로에서 Gradle 폴더를 찾고, 그다음이 홈의 기본 폴더다', () => {
    expect(daemonLogCandidates(proc(7, WIN_DAEMON), undefined, 'C:\\Users\\me')).toEqual([
      'C:\\gradle-home\\daemon\\7.6.4\\daemon-7.out.log',
      'C:\\Users\\me\\.gradle\\daemon\\7.6.4\\daemon-7.out.log'
    ])
  })

  test('작업 폴더가 데몬 폴더가 아니면(빌드 중) 그 폴더에서는 찾지 않는다', () => {
    expect(daemonLogCandidates(proc(7, WIN_DAEMON), 'C:\\work\\api', 'C:\\Users\\me')).toEqual([
      'C:\\gradle-home\\daemon\\7.6.4\\daemon-7.out.log',
      'C:\\Users\\me\\.gradle\\daemon\\7.6.4\\daemon-7.out.log'
    ])
  })

  test('따옴표로 묶인 래퍼 경로(공백이 든 사용자 폴더)도 읽는다', () => {
    const cmd =
      'java.exe -cp "C:\\Users\\A B\\.gradle\\wrapper\\dists\\gradle-8.5-bin\\abc\\gradle-8.5\\lib\\gradle-launcher-8.5.jar" ' +
      'org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5'
    expect(daemonLogCandidates(proc(9, cmd), undefined, 'C:\\Users\\A B')).toEqual([
      'C:\\Users\\A B\\.gradle\\daemon\\8.5\\daemon-9.out.log'
    ])
  })

  test('macOS: 따로 설치한 Gradle 은 홈의 기본 폴더에서 찾는다', () => {
    const cmd =
      '/opt/homebrew/opt/openjdk/bin/java -Xmx512m -cp /opt/homebrew/Cellar/gradle/8.10/libexec/lib/gradle-daemon-main-8.10.jar ' +
      '-javaagent:/opt/homebrew/Cellar/gradle/8.10/libexec/lib/agents/gradle-instrumentation-agent-8.10.jar ' +
      'org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.10'
    expect(daemonLogCandidates(proc(4321, cmd), undefined, '/Users/me')).toEqual([
      '/Users/me/.gradle/daemon/8.10/daemon-4321.out.log'
    ])
    expect(
      daemonLogCandidates(proc(4321, cmd), '/Users/me/.gradle/daemon/8.10', '/Users/me')
    ).toEqual(['/Users/me/.gradle/daemon/8.10/daemon-4321.out.log'])
  })

  test('버전을 모르면 서 있는 폴더의 로그만 본다', () => {
    const cmd = 'java.exe org.gradle.launcher.daemon.bootstrap.GradleDaemon'
    expect(daemonLogCandidates(proc(5, cmd), undefined, 'C:\\Users\\me')).toEqual([])
    expect(daemonLogCandidates(proc(5, cmd), 'D:\\g\\daemon\\9.0', 'C:\\Users\\me')).toEqual([
      'D:\\g\\daemon\\9.0\\daemon-5.out.log'
    ])
  })

  test('버전 자리에 경로를 벗어나는 글자가 있으면 쓰지 않는다', () => {
    const cmd = 'java.exe org.gradle.launcher.daemon.bootstrap.GradleDaemon ..\\..\\x'
    expect(daemonLogCandidates(proc(5, cmd), undefined, 'C:\\Users\\me')).toEqual([])
  })

  test('네트워크 경로의 데몬 폴더는 보지 않는다', () => {
    const cmd = 'java.exe org.gradle.launcher.daemon.bootstrap.GradleDaemon'
    expect(daemonLogCandidates(proc(5, cmd), '\\\\nas\\g\\daemon\\9.0', 'C:\\Users\\me')).toEqual(
      []
    )
  })
})

describe('createGradleDaemonReader', () => {
  let base: string
  let home: string
  let daemonDir: string
  let projectA: string
  let projectB: string
  const PID = 4242
  const logFile = (): string => join(daemonDir, `daemon-${PID}.out.log`)
  /** 데몬 폴더에 서 있는(쉬는) 데몬. 명령줄에는 Gradle 폴더가 없어 서 있는 폴더로만 로그를 찾는다. */
  const daemon = (startedAt: number | null = null): ProcessInfo =>
    proc(
      PID,
      'java -cp /opt/gradle/lib/gradle-launcher-7.6.4.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 7.6.4',
      startedAt
    )

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pitwall-gradle-'))
    home = join(base, 'home')
    daemonDir = join(base, 'gradle-home', 'daemon', '7.6.4')
    projectA = join(base, 'work', 'api')
    projectB = join(base, 'work', 'web')
    await Promise.all(
      [home, daemonDir, projectA, projectB].map((d) => mkdir(d, { recursive: true }))
    )
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  test('쉬는 데몬의 로그에서 마지막으로 빌드한 폴더를 읽는다', async () => {
    await writeFile(logFile(), buildLine(projectB) + IDLE_LINE + buildLine(projectA) + IDLE_LINE)
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
  })

  test('서 있는 폴더를 몰라도 홈의 기본 폴더에서 로그를 찾는다', async () => {
    const dir = join(home, '.gradle', 'daemon', '7.6.4')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `daemon-${PID}.out.log`), buildLine(projectB))
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), undefined)).toBe(projectB)
  })

  test('로그가 없으면 null', async () => {
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBeNull()
  })

  test('빌드한 폴더가 지금은 없으면 null(지운 워크트리를 바깥 저장소로 잘못 잇지 않는다)', async () => {
    await writeFile(logFile(), buildLine(join(base, 'work', 'gone')))
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBeNull()
  })

  test('데몬이 다른 프로젝트를 새로 빌드하면 그 폴더로 바뀐다', async () => {
    await writeFile(logFile(), buildLine(projectA) + IDLE_LINE)
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    await appendFile(logFile(), IDLE_LINE + buildLine(projectB) + IDLE_LINE)
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectB)
  })

  test('새로 붙은 줄에 빌드가 없으면 전에 읽은 폴더를 그대로 준다', async () => {
    await writeFile(logFile(), buildLine(projectA))
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    await appendFile(logFile(), IDLE_LINE + IDLE_LINE)
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
  })

  test('이미 읽은 부분은 다시 읽지 않는다(늘어난 만큼만 읽는다)', async () => {
    const first = buildLine(projectA)
    await writeFile(logFile(), first)
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    // 앞부분을 같은 길이의 다른 폴더로 바꿔 쓰고 뒤에 쉬는 줄만 붙인다: 앞을 다시 읽으면 B 가 나온다.
    const swapped = buildLine(projectB)
    expect(swapped.length).toBe(first.length)
    await writeFile(logFile(), swapped + IDLE_LINE)
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
  })

  test('아직 끝나지 않은 마지막 줄은 다음에 읽는다', async () => {
    await writeFile(logFile(), buildLine(projectA))
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    const line = buildLine(projectB)
    const cut = line.indexOf('currentDir=') + 'currentDir='.length + 5
    await appendFile(logFile(), line.slice(0, cut))
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    await appendFile(logFile(), line.slice(cut))
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectB)
  })

  test('로그가 줄어들었으면(새로 쓰인 파일) 처음부터 다시 읽는다', async () => {
    await writeFile(logFile(), IDLE_LINE + IDLE_LINE + buildLine(projectA))
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    await writeFile(logFile(), buildLine(projectB))
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectB)
  })

  test('프로세스가 시작하기 전에 마지막으로 쓰인 로그는 다른 데몬의 것이라 쓰지 않는다', async () => {
    await writeFile(logFile(), buildLine(projectA))
    const old = new Date('2026-11-01T00:00:00Z')
    await utimes(logFile(), old, old)
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(
      await reader.buildDir(daemon(new Date('2026-11-13T02:00:00Z').getTime()), daemonDir)
    ).toBeNull()
    // 시작 시각을 모르면 가릴 수 없어 그대로 읽는다.
    expect(await reader.buildDir(daemon(null), daemonDir)).toBe(projectA)
  })

  test('한 번에 읽는 크기를 넘는 로그는 끝부분만 읽는다', async () => {
    await writeFile(logFile(), buildLine(projectB) + IDLE_LINE.repeat(40) + buildLine(projectA))
    const tail = createGradleDaemonReader({ homeDir: home, maxReadBytes: 1024 })
    expect(await tail.buildDir(daemon(), daemonDir)).toBe(projectA)
    // 마지막 빌드 줄이 그 범위 밖이면 모른다(다음 빌드부터 안다).
    await writeFile(logFile(), buildLine(projectB) + IDLE_LINE.repeat(40))
    const none = createGradleDaemonReader({ homeDir: home, maxReadBytes: 1024 })
    expect(await none.buildDir(daemon(), daemonDir)).toBeNull()
  })

  test('데몬이 MS949 로 쓴 로그의 한글 경로를 읽는다(명령줄의 인코딩으로 푼다)', async () => {
    const korean = join(base, 'work', '쇼핑 api')
    await mkdir(korean, { recursive: true })
    await writeFile(logFile(), encodeMs949(buildLine(korean) + IDLE_LINE))
    const ms949 = proc(
      PID,
      'java -Dfile.encoding=x-windows-949 -cp /opt/gradle/lib/gradle-launcher-7.6.4.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 7.6.4'
    )
    expect(await createGradleDaemonReader({ homeDir: home }).buildDir(ms949, daemonDir)).toBe(
      korean
    )
    // 같은 로그를 UTF-8 로 풀면 한글이 깨져 그 폴더를 찾지 못한다.
    const utf8 = proc(
      PID,
      'java -Dfile.encoding=UTF-8 -cp /opt/gradle/lib/gradle-launcher-7.6.4.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 7.6.4'
    )
    expect(await createGradleDaemonReader({ homeDir: home }).buildDir(utf8, daemonDir)).toBeNull()
  })

  test('keep 에 없는 데몬의 기억은 버린다', async () => {
    const first = buildLine(projectA)
    await writeFile(logFile(), first)
    const reader = createGradleDaemonReader({ homeDir: home })
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectA)
    reader.keep([])
    await writeFile(logFile(), buildLine(projectB))
    expect(await reader.buildDir(daemon(), daemonDir)).toBe(projectB)
  })
})

describe('gradleDaemonWorktrees', () => {
  const worktree = (root: string): WorktreeInfo => ({
    root,
    branch: 'main',
    isLinkedWorktree: false,
    commonDir: `${root}\\.git`
  })
  const gradle = proc(10, WIN_DAEMON)
  const other = proc(11, 'node.exe C:\\tools\\x.js')

  /** 데몬 로그에서 읽힌 폴더(pid → 폴더). */
  let dirs: Record<number, string | null>
  const buildDir = vi.fn(async (p: ProcessInfo) => dirs[p.pid] ?? null)
  const keep = vi.fn()
  const resolveWorktree = vi.fn(async (path: string) =>
    path.startsWith('C:\\work\\api') ? worktree('C:\\work\\api') : null
  )
  const find = gradleDaemonWorktrees({ reader: { buildDir, keep }, resolveWorktree })
  beforeEach(() => {
    vi.clearAllMocks()
    dirs = {}
  })

  test('워크트리를 모르는 Gradle 데몬은 로그의 마지막 빌드 폴더로 잇는다(다른 프로세스는 보지 않는다)', async () => {
    dirs = { 10: 'C:\\work\\api\\module', 11: 'C:\\work\\api' }
    const cwds = { 10: 'C:\\gradle-home\\daemon\\7.6.4\\' }
    const result = await find([gradle, other], cwds, new Map())
    expect([...result]).toEqual([[10, worktree('C:\\work\\api')]])
    expect(buildDir).toHaveBeenCalledTimes(1)
    expect(buildDir).toHaveBeenCalledWith(gradle, 'C:\\gradle-home\\daemon\\7.6.4\\')
  })

  test('이미 워크트리를 아는 데몬(빌드 중이라 프로젝트 폴더에 서 있다)은 로그를 읽지 않는다', async () => {
    dirs = { 10: 'C:\\work\\api' }
    const result = await find([gradle], {}, new Map([[10, worktree('C:\\work\\web')]]))
    expect(result.size).toBe(0)
    expect(buildDir).not.toHaveBeenCalled()
  })

  test('로그의 폴더가 저장소가 아니면 모르는 채로 둔다', async () => {
    dirs = { 10: 'C:\\temp\\scratch' }
    expect((await find([gradle], {}, new Map())).size).toBe(0)
  })

  test('네트워크 경로는 판별하지 않는다', async () => {
    dirs = { 10: '\\\\nas\\work\\api' }
    expect((await find([gradle], {}, new Map())).size).toBe(0)
    expect(resolveWorktree).not.toHaveBeenCalled()
  })

  test('로그 읽기가 실패하면 그 데몬만 모르는 채로 둔다', async () => {
    const second = proc(12, WIN_DAEMON)
    dirs = { 10: 'C:\\work\\api', 12: 'C:\\work\\api' }
    buildDir.mockRejectedValueOnce(new Error('EBUSY'))
    const result = await find([gradle, second], {}, new Map())
    expect([...result.keys()]).toEqual([12])
  })

  test('이번에 본 Gradle 데몬만 기억에 남긴다(워크트리를 아는 데몬도 남긴다)', async () => {
    const busy = proc(12, WIN_DAEMON)
    await find([gradle, other, busy], {}, new Map([[12, worktree('C:\\work\\web')]]))
    expect(keep).toHaveBeenCalledWith([gradle, busy])
  })
})
