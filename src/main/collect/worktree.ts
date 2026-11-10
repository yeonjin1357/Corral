import { readFile, realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import * as nodePath from 'path'
import type { ProcessInfo, WorkspaceInfo, WorktreeInfo } from '../../shared/types'

const WIN_ABSOLUTE = /^[A-Za-z]:[\\/]/
const UNC = /^[\\/]{2}/
const POSIX_ABSOLUTE = /^\/(?!\/)/
/**
 * 큰따옴표 구간을 포함해 공백으로 나뉜 토큰. `--root="C:\a b\c"` 도 한 토큰이 된다.
 * 작은따옴표는 묶음 기호로 보지 않는다: Windows 명령줄은 큰따옴표만 쓰고, macOS ps 는 따옴표 없이 인자를 잇는다.
 * (`C:\Users\O'Neil\...` 같은 경로가 깨지지 않도록)
 */
const TOKEN = /(?:[^\s"]+|"[^"]*")+/g
const MAX_CLIMB = 64

/** `node_modules` 세그먼트가 있으면 그 앞(= 패키지를 설치한 프로젝트 폴더)까지만 남긴다. */
function cutAtNodeModules(path: string, separator: string): string {
  const segments = path.split(/[\\/]/)
  const index = segments.indexOf('node_modules')
  return index < 0 ? path : segments.slice(0, index).join(separator)
}

/** 판별할 수 있는 로컬 절대 경로로 바꾼다. 네트워크·WSL 경로나 상대 경로는 null. */
export function normalizeCandidate(raw: string): string | null {
  // 네트워크 공유·WSL(\\wsl.localhost\...) 경로는 접근이 느리거나 막힐 수 있어 판별하지 않는다.
  if (UNC.test(raw)) return null
  if (WIN_ABSOLUTE.test(raw)) {
    const cut = cutAtNodeModules(raw, '\\')
    if (!WIN_ABSOLUTE.test(cut)) return null
    const normalized = nodePath.win32.normalize(cut)
    return normalized[0].toUpperCase() + normalized.slice(1)
  }
  if (POSIX_ABSOLUTE.test(raw)) {
    const cut = cutAtNodeModules(raw, '/')
    if (!POSIX_ABSOLUTE.test(cut)) return null
    return nodePath.posix.normalize(cut)
  }
  return null
}

/** 명령줄에서 worktree 판별에 쓸 절대 경로 후보를 순서대로 뽑는다(상대 경로는 작업 폴더를 모르므로 버림). */
export function extractPathCandidates(commandLine: string): string[] {
  const result: string[] = []
  for (const match of commandLine.matchAll(TOKEN)) {
    let token = match[0].replace(/"/g, '')
    if (token.startsWith('-')) {
      const eq = token.indexOf('=')
      if (eq < 0) continue
      token = token.slice(eq + 1)
    }
    const candidate = normalizeCandidate(token)
    if (candidate && !result.includes(candidate)) result.push(candidate)
  }
  return result
}

async function readBranch(gitDir: string): Promise<string | null> {
  try {
    const head = await readFile(nodePath.join(gitDir, 'HEAD'), 'utf8')
    const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** `dir/.git` 이 폴더면 메인 체크아웃, `gitdir:` 파일이면 연결된 worktree 또는 서브모듈. */
async function readGitAt(dir: string): Promise<WorktreeInfo | null> {
  const dotGit = nodePath.join(dir, '.git')
  let info
  try {
    info = await stat(dotGit)
  } catch {
    return null
  }
  if (info.isDirectory()) {
    return {
      root: dir,
      branch: await readBranch(dotGit),
      isLinkedWorktree: false,
      commonDir: dotGit
    }
  }
  if (!info.isFile()) return null
  const text = await readFile(dotGit, 'utf8').catch(() => '')
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text)
  if (!m) return null
  const gitDir = nodePath.resolve(dir, m[1])
  const isLinkedWorktree = /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitDir)
  return {
    root: dir,
    branch: await readBranch(gitDir),
    isLinkedWorktree,
    commonDir: await readCommonDir(gitDir, isLinkedWorktree)
  }
}

/** 실제 경로(정션·심볼릭 링크·subst 드라이브·8.3 이름을 푼 것). 못 풀면 그대로. */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * 저장소 공용 폴더(메인 체크아웃의 `.git`). 연결된 worktree 는 gitdir 의 `commondir` 파일이 가리키고,
 * 없으면 `.git/worktrees/<이름>` 의 두 단계 위다. 서브모듈은 gitdir 자신.
 */
async function readCommonDir(gitDir: string, isLinkedWorktree: boolean): Promise<string> {
  try {
    const rel = (await readFile(nodePath.join(gitDir, 'commondir'), 'utf8')).trim()
    if (rel) return nodePath.resolve(gitDir, rel)
  } catch {
    // 파일이 없으면 아래 규칙으로.
  }
  return isLinkedWorktree ? nodePath.resolve(gitDir, '..', '..') : gitDir
}

/** 경로의 마지막 폴더 이름(Windows·POSIX 경로 모두). */
function folderName(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}

/** 바깥 저장소가 없을 때의 작업 공간: 그 워크트리 자체. */
export function selfWorkspace(worktree: WorktreeInfo): WorkspaceInfo {
  return {
    root: worktree.root,
    name: folderName(worktree.root),
    branch: worktree.branch,
    outer: false
  }
}

export interface WorktreeResolverOptions {
  /** 이 폴더(보통 사용자 홈)는 git 저장소여도 worktree 로 보지 않는다(dotfiles 저장소 대비). */
  homeDir?: string
  /** 판별 결과 캐시 시간. 브랜치 전환은 이 시간 안에 반영된다. */
  ttlMs?: number
  now?: () => number
}

export interface WorktreeResolver {
  resolveWorktree(path: string): Promise<WorktreeInfo | null>
  resolveWorkspace(worktree: WorktreeInfo): Promise<WorkspaceInfo>
  resolveProcessWorktrees(
    processes: ProcessInfo[],
    cwds?: Record<number, string>,
    cwdFirst?: Set<number>
  ): Promise<Map<number, WorktreeInfo>>
}

export function createWorktreeResolver(options: WorktreeResolverOptions = {}): WorktreeResolver {
  const ttlMs = options.ttlMs ?? 15000
  const now = options.now ?? Date.now
  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
  const keyOf = (dir: string): string => {
    const trimmed = dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir
    return caseInsensitive ? trimmed.toLowerCase() : trimmed
  }
  const homeKey = keyOf(nodePath.resolve(options.homeDir ?? homedir()))
  const cache = new Map<string, { at: number; value: Promise<WorktreeInfo | null> }>()

  function pruneExpired(): void {
    if (cache.size < 5000) return
    const t = now()
    for (const [k, v] of cache) if (t - v.at >= ttlMs) cache.delete(k)
  }

  async function lookup(dir: string, depth: number): Promise<WorktreeInfo | null> {
    const parent = nodePath.dirname(dir)
    // 홈 폴더와 드라이브 루트는 worktree 로 보지 않고 더 올라가지도 않는다.
    if (keyOf(dir) === homeKey || parent === dir || depth > MAX_CLIMB) return null
    const found = await readGitAt(dir)
    return found ?? resolveDir(parent, depth + 1)
  }

  /** 폴더마다 결과를 캐시해, 같은 상위 폴더를 공유하는 프로세스들이 같은 판별을 반복하지 않게 한다. */
  function resolveDir(dir: string, depth: number): Promise<WorktreeInfo | null> {
    const key = keyOf(dir)
    const hit = cache.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.value
    pruneExpired()
    const value = lookup(dir, depth)
    cache.set(key, { at: now(), value })
    return value
  }

  async function resolveWorktree(path: string): Promise<WorktreeInfo | null> {
    return resolveDir(nodePath.resolve(path), 0)
  }

  /**
   * 작업 공간 = 워크트리를 감싸는 가장 가까운 바깥 git 저장소(여러 저장소를 묶는 작업 공간 저장소·서브모듈의 상위).
   * 바깥 저장소가 그 워크트리와 같은 저장소(같은 공용 폴더)면 묶지 않는다: 저장소 안에 만든 병렬 워크트리
   * (`<저장소>/.claude/worktrees/x`)가 메인 체크아웃과 한 묶음이 되면 묶음 정리가 다른 세션의 서버까지 끈다.
   * 공용 폴더를 모르면 같은 저장소인지 알 수 없어 묶지 않는다. 홈 폴더·드라이브 루트에서 멈추는 규칙과
   * 폴더별 캐시는 워크트리 판별과 같다.
   */
  async function resolveWorkspace(worktree: WorktreeInfo): Promise<WorkspaceInfo> {
    const root = nodePath.resolve(worktree.root)
    const parent = nodePath.dirname(root)
    if (!worktree.commonDir || parent === root) return selfWorkspace(worktree)
    const outer = await resolveDir(parent, 0)
    if (!outer?.commonDir) return selfWorkspace(worktree)
    // 같은 저장소를 다른 경로(정션·subst·8.3 이름)로 가리킬 수 있어 실제 경로로 비교한다.
    const [a, b] = await Promise.all([canonical(outer.commonDir), canonical(worktree.commonDir)])
    if (keyOf(a) === keyOf(b)) return selfWorkspace(worktree)
    return { root: outer.root, name: folderName(outer.root), branch: outer.branch, outer: true }
  }

  /**
   * 명령줄의 절대 경로를 먼저 보고, 없으면 작업 폴더(cwd)로 판별한다.
   * cwdFirst 의 프로세스(에이전트)는 작업 폴더를 먼저 본다 — 명령줄에 `--add-dir <다른 저장소>` 나
   * 프롬프트 속 경로가 있을 수 있어서다.
   */
  async function resolveProcessWorktrees(
    processes: ProcessInfo[],
    cwds: Record<number, string> = {},
    cwdFirst: Set<number> = new Set()
  ): Promise<Map<number, WorktreeInfo>> {
    const result = new Map<number, WorktreeInfo>()
    await Promise.all(
      processes.map(async (p) => {
        const cwd = cwds[p.pid] ? normalizeCandidate(cwds[p.pid]) : null
        const candidates = extractPathCandidates(p.commandLine).filter((c) => c !== cwd)
        if (cwd) {
          if (cwdFirst.has(p.pid)) candidates.unshift(cwd)
          else candidates.push(cwd)
        }
        for (const candidate of candidates) {
          const info = await resolveWorktree(candidate)
          if (info) {
            result.set(p.pid, info)
            return
          }
        }
      })
    )
    return result
  }

  return { resolveWorktree, resolveWorkspace, resolveProcessWorktrees }
}

const defaultResolver = createWorktreeResolver()
export const resolveWorktree = defaultResolver.resolveWorktree
export const resolveWorkspace = defaultResolver.resolveWorkspace
export const resolveProcessWorktrees = defaultResolver.resolveProcessWorktrees
