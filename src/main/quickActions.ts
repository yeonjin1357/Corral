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

/**
 * 상세 패널의 바로 가기(G3f). 화면이 준 경로는 찾는 열쇠일 뿐이고, 지금 스냅샷에 있는 같은 폴더(대소문자·끝 구분자 무시)의
 * 경로로 한다. 셸을 거치지 않고(인자 배열만) 경로를 명령 문자열에 넣지 않는다.
 */
export function createQuickActions(deps: {
  latest: () => DashboardSnapshot | null
  platform: Platform
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
    // 경로는 작업 폴더로만 넘긴다: wt 는 인자 속 ';' 를 명령 구분자로 읽어 경로를 인자로 주면 폴더 이름이 명령이 될 수 있다.
    // wt(Windows 터미널)가 없으면 cmd 의 start 로 새 콘솔 창을 그 폴더에서 연다(stdio 를 버린 cmd 는 바로 끝난다).
    return (
      (await launch('wt.exe', ['-d', '.'], { ...detached, cwd: path })) ||
      launch('cmd.exe', ['/c', 'start', 'cmd.exe'], { ...detached, cwd: path })
    )
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
        if (kind === 'folder') return (await deps.openPath(target)) === ''
        return await openTerminal(target)
      } catch {
        return false
      }
    }
  }
}
