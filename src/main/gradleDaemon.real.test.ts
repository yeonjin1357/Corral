import { spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { setTimeout as sleep } from 'timers/promises'
import type { ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'
import { sample as takeSample, toPlatform } from './collect/sample'
import { createWorktreeResolver } from './collect/worktree'
import {
  createGradleDaemonReader,
  daemonLogCandidates,
  gradleDaemonWorktrees,
  isGradleDaemon
} from './gradleDaemon'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'

/**
 * 진짜 Gradle 데몬으로 "쉬는 데몬의 프로젝트 찾기"를 확인한다. `CORRAL_REAL_GRADLE=1` 일 때만 돈다(macOS smoke 의
 * collect 작업, 또는 Gradle 이 깔린 PC 에서 직접). gradleDaemon.test.ts 는 손으로 쓴 로그로 보므로, 진짜 데몬이
 * 그 모양으로 로그를 쓰는지·어디에 서 있는지·명령줄이 어떤지는 여기서 본다.
 *
 * 쓰던 데몬을 건드리지 않게 Gradle 폴더(GRADLE_USER_HOME)를 임시 폴더로 따로 두고, 끝나면 띄운 데몬만 끈다.
 */
const platform = toPlatform(process.platform)
const enabled = platform !== null && process.env.CORRAL_REAL_GRADLE === '1'
/** gradle 실행 파일. PATH 의 gradle 을 못 쓰는 PC 에서는 CORRAL_REAL_GRADLE_BIN 으로 경로를 준다. */
const GRADLE = process.env.CORRAL_REAL_GRADLE_BIN || 'gradle'
const onWindows = process.platform === 'win32'

/** 같은 폴더인가(대소문자·8.3 이름·한글 조합 방식의 차이는 무시). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let real = p
    try {
      real = realpathSync.native(p)
    } catch {
      // 없는 경로는 그대로 비교한다.
    }
    const trimmed = real.normalize('NFC').replace(/[\\/]+$/, '')
    return onWindows ? trimmed.toLowerCase() : trimmed
  }
  return norm(a) === norm(b)
}

describe.skipIf(!enabled)('진짜 Gradle 데몬: 쉬는 데몬의 프로젝트', () => {
  let base = ''
  let repo = ''
  let gradleHome = ''
  let daemonPid = 0
  let sample: RawSample
  let daemon: ProcessInfo | undefined
  let known = new Map<number, WorktreeInfo>()
  let fromLog = new Map<number, WorktreeInfo>()
  let buildDir: string | null = null
  const resolver = createWorktreeResolver()

  const run = (cmd: string, args: string[], cwd: string): ReturnType<typeof spawnSync> =>
    spawnSync(cmd, args, {
      cwd,
      env: { ...process.env, GRADLE_USER_HOME: gradleHome },
      shell: onWindows,
      encoding: 'utf8',
      timeout: 240_000
    })

  beforeAll(async () => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'corral-gradle-')))
    // 공백과 한글이 든 프로젝트 폴더(git 저장소).
    repo = join(base, '쇼핑 api')
    gradleHome = join(base, 'gradle-home')
    mkdirSync(repo)
    mkdirSync(gradleHome)
    writeFileSync(join(repo, 'settings.gradle'), "rootProject.name = 'corral-gradle-fixture'\n")
    // 혹시 남아도 2분 뒤 스스로 끝나게.
    writeFileSync(join(gradleHome, 'gradle.properties'), 'org.gradle.daemon.idletimeout=120000\n')
    const git = run('git', ['init', '-q'], repo)
    expect(git.status, String(git.stderr)).toBe(0)

    const version = run(GRADLE, ['--version'], repo)
    console.log(`gradle --version:\n${String(version.stdout).trim()}`)
    const build = run(GRADLE, ['--daemon', '-q', 'help'], repo)
    expect(build.status, `${String(build.stdout)}\n${String(build.stderr)}`).toBe(0)

    // 띄운 데몬: 임시 Gradle 폴더의 daemon/<버전>/daemon-<pid>.out.log.
    const daemonRoot = join(gradleHome, 'daemon')
    // daemon 폴더에는 버전 폴더 말고 파일(CACHEDIR.TAG, Gradle 9)도 있다.
    const logs = readdirSync(daemonRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(daemonRoot, entry.name))
          .filter((name) => /^daemon-\d+\.out\.log$/.test(name))
          .map((name) => join(daemonRoot, entry.name, name))
      )
    console.log(`데몬 로그: ${JSON.stringify(logs)}`)
    expect(logs.length).toBe(1)
    daemonPid = Number(/daemon-(\d+)\.out\.log$/.exec(logs[0])![1])

    // 빌드를 시킨 gradle 명령이 끝나 데몬만 남을 때까지 기다린다(부모가 없어야 남은 프로세스다).
    for (let i = 0; i < 20; i++) {
      sample = await takeSample(platform!)
      daemon = sample.processes.find((p) => p.pid === daemonPid)
      const parentAlive =
        daemon && daemon.ppid !== 1 && sample.processes.some((p) => p.pid === daemon!.ppid)
      if (daemon && !parentAlive) break
      await sleep(1000)
    }
    const cwds = sample.cwds ?? {}
    const needed = pidsForWorktreeLookup(sample, platform!)
    const lookedUp = sample.processes.filter((p) => needed.has(p.pid))
    known = await resolver.resolveProcessWorktrees(lookedUp, cwds)
    const reader = createGradleDaemonReader({ homeDir: homedir() })
    if (daemon) buildDir = await reader.buildDir(daemon, cwds[daemonPid])
    fromLog = await gradleDaemonWorktrees({
      reader,
      resolveWorktree: resolver.resolveWorktree
    })(lookedUp, cwds, known)

    // CI 로그에서 진짜 모양을 볼 수 있게 남긴다.
    console.log(`데몬: ${JSON.stringify(daemon)}`)
    console.log(`서 있는 폴더: ${JSON.stringify(cwds[daemonPid])}`)
    console.log(
      `연 포트: ${JSON.stringify(sample.tcp.filter((t) => t.pid === daemonPid && t.state === 'Listen').map((t) => `${t.localAddress}:${t.localPort}`))}`
    )
    console.log(`판별 대상에 들어갔나: ${needed.has(daemonPid)}`)
    if (daemon)
      console.log(
        `로그 후보: ${JSON.stringify(daemonLogCandidates(daemon, cwds[daemonPid], homedir()).map((f) => [f, existsSync(f)]))}`
      )
    console.log(
      `로그에서 읽은 폴더: ${JSON.stringify(buildDir)} (프로젝트: ${JSON.stringify(repo)})`
    )
    console.log(`기본 판별이 찾은 워크트리: ${JSON.stringify(known.get(daemonPid) ?? null)}`)
    console.log(`로그로 찾은 워크트리: ${JSON.stringify(fromLog.get(daemonPid) ?? null)}`)
  }, 300_000)

  afterAll(() => {
    if (daemonPid) {
      try {
        process.kill(daemonPid, 'SIGKILL')
      } catch {
        // 이미 끝났다.
      }
    }
    if (base) rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  })

  test('띄운 데몬을 Gradle 데몬으로 알아본다', () => {
    expect(daemon).toBeDefined()
    expect(isGradleDaemon(daemon!)).toBe(true)
  })

  test('쉬는 데몬은 프로젝트 폴더가 아니라 자기 폴더(daemon/<버전>)에 서 있다', () => {
    const cwd = sample.cwds?.[daemonPid]
    expect(cwd).toBeDefined()
    expect(samePath(join(cwd!, '..'), join(gradleHome, 'daemon'))).toBe(true)
  })

  test('명령줄·작업 폴더만으로는 프로젝트를 알 수 없다', () => {
    expect(known.get(daemonPid) ?? null).toBeNull()
  })

  test('로그에서 마지막으로 빌드한 폴더를 읽는다(공백·한글 경로)', () => {
    expect(buildDir).not.toBeNull()
    expect(samePath(buildDir!, repo)).toBe(true)
  })

  test('남은 프로세스로 뜨고 그 프로젝트가 붙으며, 데몬이 연 포트 때문에 개발 서버가 되지 않는다', () => {
    expect(samePath(fromLog.get(daemonPid)?.root ?? '', repo)).toBe(true)
    const snapshot = buildSnapshot({
      sample,
      worktrees: known,
      leftoverWorktrees: fromLog,
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 8 * 1024 ** 3,
      thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
      // 남은 프로세스는 10분 넘게 산 것만 올린다. 방금 띄운 데몬이라 시각을 앞당겨 본다.
      now: Date.now() + 15 * 60 * 1000,
      selfPid: process.pid,
      platform: platform!,
      cpuCount: 8
    })
    const row = snapshot.leftovers.find((l) => l.pid === daemonPid)
    console.log(
      `남은 프로세스 줄: ${JSON.stringify(row && { label: row.label, worktree: row.worktree })}`
    )
    expect(row?.label).toBe('Gradle 데몬')
    expect(samePath(row?.worktree?.root ?? '', repo)).toBe(true)
    const serverPids = snapshot.servers.flatMap((s) => [s.pid, ...s.descendantPids])
    expect(serverPids).not.toContain(daemonPid)
  })
})
