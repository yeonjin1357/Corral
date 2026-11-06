import { readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import * as nodePath from 'path'
import type { ProcessInfo, WorktreeInfo } from '../../shared/types'

const WIN_ABSOLUTE = /^[A-Za-z]:[\\/]/
const UNC = /^[\\/]{2}/
const POSIX_ABSOLUTE = /^\/(?!\/)/
/** 따옴표 구간을 포함해 공백으로 나뉜 토큰. `--root="C:\a b\c"` 도 한 토큰이 된다. */
const TOKEN = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g
const MAX_CLIMB = 64

/** `node_modules` 세그먼트가 있으면 그 앞(= 패키지를 설치한 프로젝트 폴더)까지만 남긴다. */
function cutAtNodeModules(path: string, separator: string): string {
  const segments = path.split(/[\\/]/)
  const index = segments.indexOf('node_modules')
  return index < 0 ? path : segments.slice(0, index).join(separator)
}

function normalizeCandidate(raw: string): string | null {
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
    let token = match[0].replace(/["']/g, '')
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
    return { root: dir, branch: await readBranch(dotGit), isLinkedWorktree: false }
  }
  if (!info.isFile()) return null
  const text = await readFile(dotGit, 'utf8').catch(() => '')
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text)
  if (!m) return null
  const gitDir = nodePath.resolve(dir, m[1])
  const isLinkedWorktree = /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitDir)
  return { root: dir, branch: await readBranch(gitDir), isLinkedWorktree }
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
  resolveProcessWorktrees(processes: ProcessInfo[]): Promise<Map<number, WorktreeInfo>>
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

  async function resolveProcessWorktrees(processes: ProcessInfo[]): Promise<Map<number, WorktreeInfo>> {
    const result = new Map<number, WorktreeInfo>()
    await Promise.all(
      processes.map(async (p) => {
        for (const candidate of extractPathCandidates(p.commandLine)) {
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

  return { resolveWorktree, resolveProcessWorktrees }
}

const defaultResolver = createWorktreeResolver()
export const resolveWorktree = defaultResolver.resolveWorktree
export const resolveProcessWorktrees = defaultResolver.resolveProcessWorktrees
