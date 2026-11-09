import { execFileSync } from 'child_process'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, normalize } from 'path'
import {
  defaultBranch,
  finishedEvidence,
  gitCommonDir,
  listWorktrees,
  parseWorktreeList
} from './git'

describe('parseWorktreeList', () => {
  test('메인·연결된 워크트리·detached·bare·잠김·정리 가능 표시를 읽는다', () => {
    const porcelain = [
      'worktree C:/work/shop-web',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/develop',
      '',
      'worktree C:/work/wt-a',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feat/a',
      'locked',
      '',
      'worktree C:/work/wt-b',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: normalize('C:/work/shop-web'),
        head: '1111111111111111111111111111111111111111',
        branch: 'develop',
        bare: false,
        locked: false,
        prunable: false
      },
      {
        path: normalize('C:/work/wt-a'),
        head: '2222222222222222222222222222222222222222',
        branch: 'feat/a',
        bare: false,
        locked: true,
        prunable: false
      },
      {
        path: normalize('C:/work/wt-b'),
        head: '3333333333333333333333333333333333333333',
        branch: null,
        bare: false,
        locked: false,
        prunable: true
      }
    ])
  })

  test('bare 저장소 줄, 줄바꿈 CRLF, 빈 입력', () => {
    expect(parseWorktreeList('worktree /srv/repo.git\r\nbare\r\n\r\n')).toEqual([
      {
        path: normalize('/srv/repo.git'),
        head: null,
        branch: null,
        bare: true,
        locked: false,
        prunable: false
      }
    ])
    expect(parseWorktreeList('')).toEqual([])
  })
})

/** 실제 git 으로 "원격(bare) + 메인 체크아웃 + 연결된 워크트리" 상황을 만든다. */
describe('실제 git 저장소에서', () => {
  let dir: string
  let main: string
  let origin: string

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=pitwall-test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'init.defaultBranch=main',
        ...args
      ],
      { cwd, encoding: 'utf8', windowsHide: true }
    ).trim()
  }

  function commit(cwd: string, message: string): void {
    git(cwd, 'commit', '--allow-empty', '-m', message)
  }

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'pitwall-git-')))
    origin = join(dir, 'origin.git')
    main = join(dir, 'main')
    git(dir, 'init', '--bare', origin)
    git(dir, 'clone', origin, main)
    commit(main, 'first')
    git(main, 'push', 'origin', 'main')
    git(main, 'remote', 'set-head', 'origin', 'main')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  })

  /** 브랜치를 만들어 커밋 하나를 올리고(원격에도) 워크트리로 꺼낸다. */
  function pushedBranchWorktree(name: string): string {
    const path = join(dir, name)
    git(main, 'worktree', 'add', '-b', name, path, 'main')
    commit(path, `work on ${name}`)
    git(path, 'push', '-u', 'origin', name)
    return path
  }

  test('공용 폴더: 메인과 연결된 워크트리 모두 메인의 .git', async () => {
    const wt = pushedBranchWorktree('feat-a')
    const expected = normalize(join(main, '.git')).toLowerCase()
    expect((await gitCommonDir(main))?.toLowerCase()).toBe(expected)
    expect((await gitCommonDir(wt))?.toLowerCase()).toBe(expected)
    expect(await gitCommonDir(dir)).toBeNull()
  })

  test('워크트리 목록과 기본 브랜치(origin/HEAD)', async () => {
    const wt = pushedBranchWorktree('feat-a')
    const common = (await gitCommonDir(main))!
    const list = await listWorktrees(common)
    expect(list.map((w) => [w.path.toLowerCase(), w.branch])).toEqual([
      [main.toLowerCase(), 'main'],
      [wt.toLowerCase(), 'feat-a']
    ])
    expect(await defaultBranch(common)).toBe('origin/main')
  })

  test('원격 브랜치가 지워졌으면(머지 후 삭제) upstreamGone', async () => {
    const wt = pushedBranchWorktree('feat-gone')
    git(main, 'push', 'origin', '--delete', 'feat-gone')
    git(main, 'fetch', '--prune')
    const common = (await gitCommonDir(main))!
    const entry = (await listWorktrees(common)).find(
      (w) => w.path.toLowerCase() === wt.toLowerCase()
    )!
    expect(await finishedEvidence(common, entry, 'origin/main')).toBe('upstreamGone')
  })

  test('원격에 올린 브랜치가 머지 커밋으로 기본 브랜치에 들어갔으면 merged', async () => {
    const wt = pushedBranchWorktree('feat-merged')
    git(main, 'fetch')
    commit(main, 'other work on main')
    git(main, 'merge', '--no-ff', '-m', 'merge feat', 'origin/feat-merged')
    git(main, 'push', 'origin', 'main')
    git(main, 'fetch')
    const common = (await gitCommonDir(main))!
    const entry = (await listWorktrees(common)).find(
      (w) => w.path.toLowerCase() === wt.toLowerCase()
    )!
    expect(await finishedEvidence(common, entry, 'origin/main')).toBe('merged')
  })

  test('막 만든 워크트리(기본 브랜치와 같은 커밋)는 원격에 올렸어도 끝난 것이 아니다', async () => {
    const path = join(dir, 'fresh')
    git(main, 'worktree', 'add', '-b', 'fresh', path, 'main')
    const common = (await gitCommonDir(main))!
    const before = (await listWorktrees(common)).find((w) => w.branch === 'fresh')!
    expect(await finishedEvidence(common, before, 'origin/main')).toBeNull()
    git(path, 'push', '-u', 'origin', 'fresh')
    commit(main, 'main moved on')
    git(main, 'push', 'origin', 'main')
    git(main, 'fetch')
    const after = (await listWorktrees(common)).find((w) => w.branch === 'fresh')!
    expect(await finishedEvidence(common, after, 'origin/main')).toBeNull()
  })

  test('기본 브랜치를 따라가는 브랜치(upstream = origin/main)는 끝난 것이 아니다', async () => {
    const path = join(dir, 'tracking')
    git(main, 'worktree', 'add', '-b', 'tracking', path, 'origin/main')
    const common = (await gitCommonDir(main))!
    const entry = (await listWorktrees(common)).find((w) => w.branch === 'tracking')!
    expect(await finishedEvidence(common, entry, 'origin/main')).toBeNull()
  })

  test('원격에 올리지 않은 브랜치·detached HEAD·기본 브랜치를 모르면 끝난 것이 아니다', async () => {
    const local = join(dir, 'local')
    git(main, 'worktree', 'add', '-b', 'local', local, 'main')
    commit(local, 'local only')
    const detached = join(dir, 'detached')
    git(main, 'worktree', 'add', '--detach', detached, 'main')
    const merged = pushedBranchWorktree('feat-x')
    const common = (await gitCommonDir(main))!
    const list = await listWorktrees(common)
    const find = (p: string): (typeof list)[number] =>
      list.find((w) => w.path.toLowerCase() === p.toLowerCase())!
    expect(await finishedEvidence(common, find(local), 'origin/main')).toBeNull()
    expect(await finishedEvidence(common, find(detached), 'origin/main')).toBeNull()
    expect(await finishedEvidence(common, find(merged), null)).toBeNull()
  })

  test('origin/HEAD 가 없으면 origin/main → origin/master 순으로, 둘 다 없으면 null', async () => {
    git(main, 'remote', 'set-head', 'origin', '--delete')
    const common = (await gitCommonDir(main))!
    expect(await defaultBranch(common)).toBe('origin/main')
    const lonely = join(dir, 'lonely')
    git(dir, 'init', lonely)
    expect(await defaultBranch((await gitCommonDir(lonely))!)).toBeNull()
  })
}, 60000)
