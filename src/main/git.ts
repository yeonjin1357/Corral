import { readFile, stat } from 'fs/promises'
import { join, normalize, resolve } from 'path'
import { runCommand, type CommandResult } from './collect/runCommand'

/** 디스크 정리에 쓰는 git 명령. 네트워크(fetch)는 하지 않고 이 PC 에 있는 정보만 읽는다. */

export const GIT_TIMEOUT_MS = 10000
/** 비밀번호 창을 띄우지 않고, 출력은 영어로(`[gone]` 같은 표시를 읽기 위해), 읽기만 하므로 잠금 파일도 만들지 않는다. */
export const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0' }
/** 기본 브랜치의 첫 부모 줄기를 이만큼까지만 본다(아주 오래된 저장소에서 시간이 길어지지 않게). */
const FIRST_PARENT_LIMIT = 20000

function git(args: string[]): Promise<CommandResult> {
  return runCommand(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS, env: GIT_ENV })
}

export interface GitWorktree {
  path: string
  head: string | null
  /** `refs/heads/` 를 뺀 브랜치 이름. detached·bare 면 null. */
  branch: string | null
  bare: boolean
  locked: boolean
  /** 폴더가 사라져 `git worktree prune` 으로 정리될 수 있는 항목. */
  prunable: boolean
}

/** `git worktree list --porcelain` 출력. 첫 항목이 메인 체크아웃(또는 bare 저장소)이다. */
export function parseWorktreeList(porcelain: string): GitWorktree[] {
  const result: GitWorktree[] = []
  let current: GitWorktree | null = null
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = {
        path: normalize(line.slice('worktree '.length)),
        head: null,
        branch: null,
        bare: false,
        locked: false,
        prunable: false
      }
      result.push(current)
    } else if (!current) continue
    else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim()
    else if (line.startsWith('branch '))
      current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'bare') current.bare = true
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true
  }
  return result
}

/** 이 폴더가 속한 저장소의 git 공용 폴더(메인 체크아웃의 `.git`). 저장소가 아니면 null. */
export async function gitCommonDir(path: string): Promise<string | null> {
  let r = await git(['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  // git 2.31 미만은 --path-format 을 몰라 상대 경로로 받아 직접 붙인다.
  if (r.exitCode !== 0 && /path-format/.test(r.stderr))
    r = await git(['-C', path, 'rev-parse', '--git-common-dir'])
  if (r.exitCode !== 0) return null
  const out = r.stdout.trim()
  return out ? normalize(resolve(path, out)) : null
}

/**
 * 워크트리 바로 아래 폴더(names) 가운데 git 이 무시하는 것(.gitignore·info/exclude·전역 설정 모두).
 * 무시 목록에 있어도 이미 저장소에 올라간(추적하는) 파일이 든 폴더는 뺀다 — 지우면 소스가 사라진다.
 * 저장소가 아니거나 git 을 쓸 수 없으면 null(아무것도 지우지 않게).
 */
export async function ignoredFolders(root: string, names: string[]): Promise<Set<string> | null> {
  if (names.length === 0) return new Set()
  // check-ignore 는 글자 그대로 비교(--literal-pathspecs)를 받지 않아, 패턴 글자([ ])가 든 이름은 지우지 않는다.
  const plain = names.filter((n) => !/[[\]]/.test(n))
  if (plain.length === 0) return new Set()
  const check = await git(['-C', root, 'check-ignore', '--', ...plain.map((n) => `${n}/`)])
  // 0: 하나 이상 무시, 1: 하나도 무시하지 않음, 그 밖: 오류(저장소 아님 등).
  if (check.exitCode !== 0 && check.exitCode !== 1) return null
  const ignored = new Set(
    check.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/[\\/]+$/, ''))
      .filter((name) => plain.includes(name))
  )
  if (ignored.size === 0) return ignored
  const tracked = await git(['--literal-pathspecs', '-C', root, 'ls-files', '-z', '--', ...ignored])
  if (tracked.exitCode !== 0) return null
  for (const file of tracked.stdout.split('\0').filter(Boolean)) ignored.delete(file.split('/')[0])
  return ignored
}

export async function listWorktrees(commonDir: string): Promise<GitWorktree[]> {
  const r = await git(['--git-dir', commonDir, 'worktree', 'list', '--porcelain'])
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `git worktree list (${r.exitCode})`)
  return parseWorktreeList(r.stdout)
}

/** 원격 기본 브랜치(`origin/HEAD` → `origin/main` → `origin/master`). 모르면 null. */
export async function defaultBranch(commonDir: string): Promise<string | null> {
  const head = await git([
    '--git-dir',
    commonDir,
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD'
  ])
  if (head.exitCode === 0 && head.stdout.trim()) return head.stdout.trim()
  for (const name of ['origin/main', 'origin/master']) {
    const r = await git([
      '--git-dir',
      commonDir,
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/${name}`
    ])
    if (r.exitCode === 0) return name
  }
  return null
}

export type FinishedEvidence = 'upstreamGone' | 'merged'

/**
 * 워크트리의 브랜치가 끝났다고 볼 근거(보수적으로).
 * - upstreamGone: 원격에 올렸던 브랜치가 원격에서 지워졌다(머지 후 삭제가 흔하다, 스쿼시 머지 포함).
 * - merged: 원격에 올린 브랜치의 커밋과 원격 브랜치 끝이 모두 기본 브랜치에 들어갔고, 그 커밋이 기본 브랜치의
 *   첫 부모 줄기에 있지 않다(첫 부모 줄기에 있으면 머지된 것이 아니라 기본 브랜치에서 막 갈라져 나온 것이다).
 * 원격에 올린 적 없는 브랜치, detached HEAD, 기본 브랜치를 따라가는 브랜치, 기본 브랜치를 모르면 null.
 */
export async function finishedEvidence(
  commonDir: string,
  wt: GitWorktree,
  defaultRef: string | null
): Promise<FinishedEvidence | null> {
  if (!wt.branch || !wt.head) return null
  const ref = `refs/heads/${wt.branch}`
  const r = await git([
    '--git-dir',
    commonDir,
    'for-each-ref',
    '--format=%(refname)%09%(upstream)%09%(upstream:short)%09%(upstream:track)',
    ref
  ])
  if (r.exitCode !== 0) return null
  // for-each-ref 는 앞부분이 같은 하위 브랜치(feat → feat/x)도 돌려주므로 정확히 같은 줄만 본다.
  const line = r.stdout.split(/\r?\n/).find((l) => l.split('\t')[0] === ref)
  const [, upstreamRef = '', upstream = '', track = ''] = line?.split('\t') ?? []
  // 원격 추적 브랜치(refs/remotes/…)를 따라가야 "원격에 올린 적 있는" 브랜치다. 로컬 브랜치를 따라가는 브랜치는
  // 따라가던 브랜치를 지우면 [gone] 이 되지만 원격에 올린 적이 없다.
  if (!upstream || !upstreamRef.startsWith('refs/remotes/')) return null
  if (track.includes('gone')) return 'upstreamGone'
  if (!defaultRef || upstream === defaultRef) return null
  const isAncestor = async (commit: string): Promise<boolean> =>
    (await git(['--git-dir', commonDir, 'merge-base', '--is-ancestor', commit, defaultRef]))
      .exitCode === 0
  // 이 워크트리의 커밋과 원격 브랜치 끝이 모두 기본 브랜치에 들어가 있어야 한다.
  // 원격 브랜치에 그 뒤 새 커밋이 있으면(머지 뒤에도 계속 쓰는 릴리스 브랜치 등) 끝난 것이 아니다.
  if (!(await isAncestor(wt.head)) || !(await isAncestor(upstreamRef))) return null
  const firstParents = await git([
    '--git-dir',
    commonDir,
    'rev-list',
    '--first-parent',
    `--max-count=${FIRST_PARENT_LIMIT}`,
    defaultRef
  ])
  if (firstParents.exitCode !== 0) return null
  return firstParents.stdout.split(/\r?\n/).includes(wt.head) ? null : 'merged'
}

/** 커밋 시각(ms, 커밋한 시각 %ct). 커밋 이름이 아니거나 읽을 수 없으면 null. */
async function commitTime(commonDir: string, head: string): Promise<number | null> {
  // HEAD 는 `worktree list` 가 알려 준 커밋 해시다. 해시 모양이 아니면 git 에 넘기지 않는다.
  if (!/^[0-9a-f]{7,64}$/i.test(head)) return null
  const r = await git(['--git-dir', commonDir, 'log', '-1', '--format=%ct', head, '--'])
  const seconds = Number(r.stdout.trim())
  return r.exitCode === 0 && r.stdout.trim() && Number.isFinite(seconds) ? seconds * 1000 : null
}

/**
 * 그 워크트리의 git 폴더에 있는 색인(index) 파일의 수정 시각(ms). 연결된 워크트리는 `<워크트리>/.git` 파일의
 * `gitdir:` 이 가리키는 폴더(`.git/worktrees/<이름>`), 메인 체크아웃은 `.git` 폴더다. 모르면 null.
 */
async function indexTime(worktree: string): Promise<number | null> {
  try {
    const dotGit = join(worktree, '.git')
    let gitDir = dotGit
    if (!(await stat(dotGit)).isDirectory()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))
      if (!m) return null
      gitDir = resolve(worktree, m[1])
    }
    return (await stat(join(gitDir, 'index'))).mtimeMs
  } catch {
    return null
  }
}

/**
 * 워크트리를 마지막으로 만진 시각(ms): HEAD 커밋 시각과 그 워크트리 색인 파일 수정 시각 중 늦은 쪽(G5d).
 * 색인은 add·checkout·commit 등을 하면 바뀐다(pitwall 은 잠금 없이 읽기만 해 바꾸지 않는다).
 * 하나라도 모르면 null — 오래 안 쓴 것으로 보지 않는다.
 */
export async function lastTouched(
  wt: { path: string; head: string | null },
  commonDir: string
): Promise<number | null> {
  if (!wt.head) return null
  const [committed, indexed] = await Promise.all([
    commitTime(commonDir, wt.head),
    indexTime(wt.path)
  ])
  return committed == null || indexed == null ? null : Math.max(committed, indexed)
}
