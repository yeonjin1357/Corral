import { open, stat } from 'fs/promises'
import * as nodePath from 'path'
import type { ProcessInfo, WorktreeInfo } from '../shared/types'
import { normalizeCandidate } from './collect/worktree'

/**
 * 쉬는 Gradle 데몬의 프로젝트 찾기.
 *
 * Gradle 데몬은 빌드하는 동안에만 프로젝트 폴더에 서 있고, 끝나면 자기 폴더(`<Gradle 폴더>/daemon/<버전>`)로
 * 돌아간다. 명령줄에도 Gradle 설치 경로뿐이라, 쉬는 데몬은 명령줄·작업 폴더로는 어느 프로젝트 것인지 알 수 없다.
 * 데몬은 빌드 요청을 받을 때마다 자기 로그(`daemon-<pid>.out.log`)에 그 요청의 폴더를 적으므로
 * (`Build{id=…, currentDir=<폴더>}`), 마지막으로 적힌 폴더를 그 데몬의 프로젝트로 본다.
 *
 * 로그에서 쓰는 것은 그 폴더 경로뿐이다. 다른 내용은 보관하지 않고 어디에도 내보내지 않는다.
 */

/** 데몬의 시작 클래스와 그 뒤의 버전(`… GradleDaemon 7.6.4`). */
const DAEMON_MAIN = /org\.gradle\.launcher\.daemon\.bootstrap\.GradleDaemon(?:\s+(\S+))?/
/** 버전은 폴더 이름으로 쓰므로 경로를 벗어나는 글자(구분자, 맨 앞의 점)는 받지 않는다. */
const VERSION = /^[0-9A-Za-z][\w.+-]*$/
/** 데몬 폴더: `…/daemon/<버전>`. */
const DAEMON_DIR = /[\\/]daemon[\\/][^\\/]+[\\/]*$/
/** 큰따옴표 구간을 포함해 공백으로 나뉜 토큰(collect/worktree 와 같은 규칙). */
const TOKEN = /(?:[^\s"]+|"[^"]*")+/g
const WRAPPER_DISTS = '/wrapper/dists/'
const BUILD_DIR = /\bcurrentDir=([^}\r\n]+)\}/g
/** 데몬은 글자 인코딩을 명령줄에 적어 띄운다(`-Dfile.encoding=…`). 로그도 그 인코딩으로 쓰인다. */
const FILE_ENCODING = /(?:^|\s)"?-Dfile\.encoding=([\w.:+-]+)/

/**
 * 한 번에 읽는 크기 상한. 며칠 된 데몬의 로그도 수 MB 이고 쉬는 동안에는 한 시간에 수백 KB 쯤 늘어, 마지막 빌드
 * 줄은 보통 이 안에 있다. 넘으면 끝부분만 읽는다(마지막 빌드 줄이 그 앞이면 다음 빌드부터 안다).
 */
const MAX_READ_BYTES = 8 * 1024 * 1024
/** 로그는 데몬이 시작한 뒤에 쓰인다. 파일 시각의 정밀도(FAT 2초 등)만큼 여유를 둔다. */
const START_SLACK_MS = 5000

export function isGradleDaemon(p: ProcessInfo): boolean {
  return DAEMON_MAIN.test(p.commandLine)
}

function versionOf(commandLine: string): string | null {
  const version = DAEMON_MAIN.exec(commandLine)?.[1]
  return version && VERSION.test(version) ? version : null
}

const flavorOf = (path: string): nodePath.PlatformPath =>
  /^[A-Za-z]:[\\/]|^\\\\/.test(path) ? nodePath.win32 : nodePath.posix

/** 네트워크·WSL·상대 경로가 아닌 로컬 절대 경로인가(네트워크 경로는 응답이 없으면 수집이 멈출 수 있다). */
const isLocal = (path: string): boolean => normalizeCandidate(path) !== null

/**
 * 명령줄의 래퍼 배포판 경로(`<Gradle 폴더>/wrapper/dists/…`)에서 Gradle 폴더를 찾는다. 래퍼(gradlew)로 띄운 데몬은
 * 클래스 경로가 여기를 가리킨다. 따로 설치한 Gradle 은 여기에 없어 null.
 */
function wrapperHome(commandLine: string): string | null {
  for (const match of commandLine.matchAll(TOKEN)) {
    let token = match[0].replace(/"/g, '')
    if (token.startsWith('-') && token.includes('=')) token = token.slice(token.indexOf('=') + 1)
    const at = token.replace(/\\/g, '/').indexOf(WRAPPER_DISTS)
    if (at <= 0) continue
    const home = token.slice(0, at)
    if (isLocal(home)) return home
  }
  return null
}

/**
 * 이 데몬의 로그가 있을 만한 곳(먼저 볼 순서).
 * 1. 서 있는 폴더가 데몬 폴더면 그 폴더(쉬는 데몬은 여기에 서 있다. GRADLE_USER_HOME 을 옮겼어도 맞다).
 * 2. 명령줄의 래퍼 경로에서 찾은 Gradle 폴더(작업 폴더를 못 읽는 수집 방식용).
 * 3. 홈의 기본 폴더(`~/.gradle`).
 * 네트워크 경로는 넣지 않는다.
 */
export function daemonLogCandidates(
  p: ProcessInfo,
  cwd: string | undefined,
  homeDir: string
): string[] {
  const name = `daemon-${p.pid}.out.log`
  const files: string[] = []
  const add = (dir: string): void => {
    if (!isLocal(dir)) return
    const file = flavorOf(dir).join(dir, name)
    if (!files.includes(file)) files.push(file)
  }
  if (cwd && DAEMON_DIR.test(cwd)) add(cwd)
  const version = versionOf(p.commandLine)
  if (version) {
    const home = wrapperHome(p.commandLine)
    if (home) add(flavorOf(home).join(home, 'daemon', version))
    add(flavorOf(homeDir).join(homeDir, '.gradle', 'daemon', version))
  }
  return files
}

/** TextDecoder 가 아는 이름이면 그 표준 이름, 모르면 null. */
function decoderName(label: string): string | null {
  try {
    return new TextDecoder(label).encoding
  } catch {
    return null
  }
}

/**
 * 이 데몬의 로그를 풀 글자 인코딩(TextDecoder 의 이름). 명령줄에 없거나 모르는 이름이면 UTF-8.
 * 한글 Windows 의 자바 17 이하는 MS949 로 쓰는데(자바는 `x-windows-949`·`MS949`·`Cp949` 로 부른다), UTF-8 로 풀면
 * 한글이 든 경로가 깨진다. 영문·숫자뿐인 경로는 어느 쪽으로 풀어도 같다.
 */
export function logEncoding(commandLine: string): string {
  const name = FILE_ENCODING.exec(commandLine)?.[1]
  if (!name) return 'utf-8'
  return (
    decoderName(name) ??
    decoderName(name.replace(/^x-/i, '')) ??
    decoderName(name.replace(/^(?:ms|cp)(\d+)$/i, 'windows-$1')) ??
    'utf-8'
  )
}

/** 로그 글에서 마지막 빌드 요청의 폴더. 없으면 null. */
export function lastBuildDir(text: string): string | null {
  let last: string | null = null
  for (const match of text.matchAll(BUILD_DIR)) last = match[1]
  return last
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export interface GradleDaemonReader {
  /**
   * 이 데몬이 마지막으로 빌드한 폴더. 로그가 없거나, 빌드 줄을 못 찾았거나, 그 폴더가 지금 없으면 null
   * (지운 워크트리를 그 바깥 저장소로 잘못 잇지 않게).
   */
  buildDir(p: ProcessInfo, cwd: string | undefined): Promise<string | null>
  /** 이 데몬들의 기억만 남긴다(끝난 데몬의 기억을 버린다). */
  keep(live: ProcessInfo[]): void
}

/** 데몬 하나의 기억: 찾은 로그 파일과 그 글자 인코딩, 어디까지 읽었는지, 마지막으로 본 빌드 폴더. */
interface Memo {
  file: string
  encoding: string
  offset: number
  dir: string | null
}

export function createGradleDaemonReader(options: {
  homeDir: string
  maxReadBytes?: number
}): GradleDaemonReader {
  const maxRead = options.maxReadBytes ?? MAX_READ_BYTES
  const memos = new Map<string, Memo>()
  const keyOf = (p: ProcessInfo): string => `${p.pid}:${p.startedAt ?? ''}`

  /**
   * 로그에서 지난번 뒤로 늘어난 부분만 읽어 기억을 새로 한다. 쉬는 데몬도 몇 초마다 로그에 줄을 쓰므로 통째로
   * 다시 읽지 않는다. 이 데몬의 로그로 볼 수 없으면(없음, 프로세스가 시작하기 전에 마지막으로 쓰임) false.
   */
  async function readNew(memo: Memo, startedAt: number | null): Promise<boolean> {
    let handle
    try {
      handle = await open(memo.file, 'r')
    } catch {
      return false
    }
    try {
      const info = await handle.stat()
      if (!info.isFile()) return false
      // 같은 pid 를 쓰던 예전 데몬의 로그일 수 있다(다른 후보 폴더에 남은 것).
      if (startedAt != null && info.mtimeMs < startedAt - START_SLACK_MS) return false
      if (info.size < memo.offset) {
        memo.offset = 0
        memo.dir = null
      }
      if (info.size === memo.offset) return true
      const start = Math.max(memo.offset, info.size - maxRead)
      const buffer = Buffer.alloc(info.size - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      const data = buffer.subarray(0, bytesRead)
      // 끝난 줄까지만 쓴다(쓰는 중인 마지막 줄은 다음에 읽는다).
      const end = data.lastIndexOf(0x0a) + 1
      if (end === 0) {
        if (data.length >= maxRead) memo.offset = start + data.length
        return true
      }
      const dir = lastBuildDir(new TextDecoder(memo.encoding).decode(data.subarray(0, end)))
      if (dir) memo.dir = dir
      memo.offset = start + end
      return true
    } catch {
      // 읽다가 실패하면(잠깐의 잠금 등) 지금 기억을 그대로 두고 다음에 다시 읽는다.
      return true
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async function buildDir(p: ProcessInfo, cwd: string | undefined): Promise<string | null> {
    const key = keyOf(p)
    let memo = memos.get(key)
    if (memo && !(await readNew(memo, p.startedAt))) {
      memos.delete(key)
      memo = undefined
    }
    if (!memo) {
      const encoding = logEncoding(p.commandLine)
      for (const file of daemonLogCandidates(p, cwd, options.homeDir)) {
        const fresh: Memo = { file, encoding, offset: 0, dir: null }
        if (await readNew(fresh, p.startedAt)) {
          memos.set(key, fresh)
          memo = fresh
          break
        }
      }
    }
    const dir = memo?.dir
    return dir && isLocal(dir) && (await isDirectory(dir)) ? dir : null
  }

  function keep(live: ProcessInfo[]): void {
    const keys = new Set(live.map(keyOf))
    for (const key of memos.keys()) if (!keys.has(key)) memos.delete(key)
  }

  return { buildDir, keep }
}

/**
 * 쉬는 Gradle 데몬의 워크트리(pid → 워크트리): 명령줄·작업 폴더로 워크트리를 못 찾은(known 에 없는) Gradle 데몬을
 * 마지막으로 빌드한 폴더의 워크트리로 잇는다. 이미 찾은 것(빌드 중이라 프로젝트 폴더에 서 있는 데몬)은 보지 않는다.
 * 로그를 못 읽거나 그 폴더가 저장소가 아니면 넣지 않는다(지금처럼 모르는 채로).
 *
 * 이 결과는 남은 프로세스의 프로젝트에만 쓴다. 개발 서버 판별에 섞으면, 데몬이 빌드 요청을 받으려고 열어 둔 포트
 * 때문에 쉬는 데몬이 개발 서버로 잡힌다.
 */
export function gradleDaemonWorktrees(deps: {
  reader: GradleDaemonReader
  resolveWorktree: (path: string) => Promise<WorktreeInfo | null>
}): (
  processes: ProcessInfo[],
  cwds: Record<number, string>,
  known: Map<number, WorktreeInfo>
) => Promise<Map<number, WorktreeInfo>> {
  return async (processes, cwds, known) => {
    const result = new Map<number, WorktreeInfo>()
    const daemons = processes.filter(isGradleDaemon)
    await Promise.all(
      daemons
        .filter((p) => !known.has(p.pid))
        .map(async (p) => {
          try {
            const dir = await deps.reader.buildDir(p, cwds[p.pid])
            const local = dir ? normalizeCandidate(dir) : null
            const worktree = local ? await deps.resolveWorktree(local) : null
            if (worktree) result.set(p.pid, worktree)
          } catch {
            // 모르는 채로 둔다.
          }
        })
    )
    deps.reader.keep(daemons)
    return result
  }
}
