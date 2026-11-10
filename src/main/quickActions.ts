import type { DashboardSnapshot, Platform } from '../shared/types'
import type { QuickKind } from '../shared/ipc'
import { worktreeKey } from '../shared/format'

export type { QuickKind }

const KINDS: readonly QuickKind[] = ['copy', 'folder', 'terminal']

/** 화면이 보낸 동작 이름이 바로 가기 셋 가운데 하나인지(IPC 인자는 믿지 않는다). */
export function isQuickKind(value: unknown): value is QuickKind {
  return KINDS.includes(value as QuickKind)
}

/**
 * 바로 가기로 다룰 수 있는 폴더: 지금 스냅샷의 서버(숨긴 것 포함)·에이전트·남은 프로세스·무거운 작업의
 * 워크트리 루트와 작업 공간 루트, 디스크 정리 행의 워크트리.
 */
export function knownPaths(s: DashboardSnapshot | null): string[] {
  if (!s) return []
  const rows = [...s.servers, ...s.hiddenServers, ...s.agents, ...s.leftovers, ...s.heavyJobs]
  const paths = rows.flatMap((r) => [r.worktree?.root, r.workspace?.root])
  for (const row of s.disk?.rows ?? []) paths.push(row.worktreeRoot)
  return [...new Set(paths.filter((p): p is string => !!p))]
}

type SpawnOptions = { cwd?: string; detached: true; stdio: 'ignore' }

/** 띄운 프로세스. spawn: 띄웠음, error: 띄우지 못함(없는 프로그램·없는 작업 폴더). */
interface Spawned {
  on(event: 'spawn' | 'error', cb: () => void): void
  unref(): void
}

/** 공백·따옴표·셸 특수 문자가 없는 Windows 폴더 경로만 그대로 쓴다(claudeHooks·codexHooks 와 같은 기준). */
const SAFE_WINDOWS_DIR = /^[A-Za-z]:\\[A-Za-z0-9_.\\-]*$/
/**
 * 드라이브 문자로 시작하는 절대 경로. 사용자 폴더(LOCALAPPDATA)는 이름에 공백·한글이 흔해 위 기준을 쓰지 않는다
 * (셸을 거치지 않으니 그런 글자는 문제가 아니다. 막아야 하는 것은 작업 폴더 기준으로 찾게 되는 상대 경로다).
 */
const LOCAL_ABSOLUTE = /^[A-Za-z]:\\/
/** 네트워크 경로(\\server\share). cmd 는 이것을 현재 폴더로 쓰지 못해 다른 폴더에서 열린다. */
const UNC = /^[\\/]{2}/

const withoutTrailing = (dir: string): string => dir.replace(/\\+$/, '')

/**
 * Windows 에서 띄울 프로그램의 절대 경로. 이름만 주면 작업 폴더(= 워크트리)의 같은 이름 파일을 PATH 보다 먼저 찾으므로
 * 저장소에 든 wt.exe·cmd.exe 가 실행될 수 있다. 워크트리 내용은 믿지 않는다.
 */
export function windowsPrograms(env: Record<string, string | undefined>): {
  cmd: string
  wt: string | null
} {
  const systemRoot = env.SystemRoot
  const root =
    systemRoot && SAFE_WINDOWS_DIR.test(systemRoot) ? withoutTrailing(systemRoot) : 'C:\\Windows'
  const local = env.LOCALAPPDATA
  return {
    cmd: `${root}\\System32\\cmd.exe`,
    // Windows Terminal(스토어·기본 설치)의 실행 별칭.
    wt:
      local && LOCAL_ABSOLUTE.test(local)
        ? `${withoutTrailing(local)}\\Microsoft\\WindowsApps\\wt.exe`
        : null
  }
}

/**
 * 상세 패널의 바로 가기(G3f). 화면이 준 경로는 찾는 열쇠일 뿐이고, 지금 스냅샷에 있는 같은 폴더(대소문자·끝 구분자 무시)의
 * 경로로 한다. 셸을 거치지 않고(인자 배열만) 경로를 명령 문자열에 넣지 않으며, 띄우는 프로그램은 모두 절대 경로다.
 */
export function createQuickActions(deps: {
  latest: () => DashboardSnapshot | null
  platform: Platform
  /** 환경 변수(Windows 의 SystemRoot·LOCALAPPDATA 로 프로그램의 절대 경로를 만든다). */
  env: Record<string, string | undefined>
  /** 파일이 있는지(Windows Terminal 실행 별칭). */
  exists: (p: string) => Promise<boolean>
  /** 지금도 폴더인지(스냅샷은 오래됐을 수 있고, 파일이면 기본 앱이 그 파일을 실행할 수 있다). */
  isDirectory: (p: string) => Promise<boolean>
  /** Electron shell.openPath: 성공하면 '', 아니면 오류 문구. */
  openPath: (p: string) => Promise<string>
  /** Electron clipboard.writeText. */
  writeClipboard: (text: string) => void
  /** child_process.spawn. */
  spawn: (command: string, args: string[], options: SpawnOptions) => Spawned
}): { run(kind: QuickKind, path: string): Promise<boolean> } {
  /** 띄웠으면 true. 결과를 기다린다(Node 는 다음 차례에 spawn·error 를 알린다). */
  const launch = (command: string, args: string[], options: SpawnOptions): Promise<boolean> =>
    new Promise((resolve) => {
      try {
        const child = deps.spawn(command, args, options)
        child.on('error', () => resolve(false))
        child.on('spawn', () => resolve(true))
        child.unref()
      } catch {
        resolve(false)
      }
    })

  async function openTerminal(path: string): Promise<boolean> {
    const detached = { detached: true, stdio: 'ignore' } as const
    if (deps.platform === 'darwin')
      return launch('/usr/bin/open', ['-a', 'Terminal', path], detached)
    const { cmd, wt } = windowsPrograms(deps.env)
    // 경로는 작업 폴더로만 넘긴다: wt 는 인자 속 ';' 를 명령 구분자로 읽어 경로를 인자로 주면 폴더 이름이 명령이 될 수 있다.
    if (
      wt &&
      (await deps.exists(wt)) &&
      (await launch(wt, ['-d', '.'], { ...detached, cwd: path }))
    )
      return true
    // 없으면 cmd 의 start 로 새 콘솔 창을 그 폴더에서 연다(stdio 를 버린 cmd 는 바로 끝난다).
    // 빈 인자는 Node 가 "" 로 써서 창 제목이 된다(start 가 따옴표로 묶인 프로그램 경로를 제목으로 읽지 않게).
    return launch(cmd, ['/d', '/c', 'start', '', cmd], { ...detached, cwd: path })
  }

  return {
    async run(kind, path) {
      if (!isQuickKind(kind) || typeof path !== 'string') return false
      const key = worktreeKey(path)
      const target = knownPaths(deps.latest()).find((p) => worktreeKey(p) === key)
      if (!target) return false
      try {
        if (kind === 'copy') {
          deps.writeClipboard(target)
          return true
        }
        if (kind === 'terminal' && deps.platform === 'win32' && UNC.test(target)) return false
        // 스냅샷 뒤에 지워졌거나 파일로 바뀌었으면 열지 않는다(파일이면 기본 앱이 실행하거나 터미널이 스크립트로 돌린다).
        if (!(await deps.isDirectory(target))) return false
        if (kind === 'folder') return (await deps.openPath(target)) === ''
        return await openTerminal(target)
      } catch {
        return false
      }
    }
  }
}
