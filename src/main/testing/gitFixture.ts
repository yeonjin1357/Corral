import { execFileSync } from 'child_process'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** 테스트용: 실제 git 으로 "원격(bare) + 메인 체크아웃 + 연결된 워크트리" 상황을 만든다(앱 코드에서는 쓰지 않는다). */
export interface GitFixture {
  dir: string
  main: string
  origin: string
  git(cwd: string, ...args: string[]): string
  /** 빈 커밋 하나. at 을 주면 그 시각에 한 커밋으로(작성·커밋 시각 모두) 남긴다. */
  commit(cwd: string, message: string, at?: Date): void
  /** 브랜치를 만들어 커밋 하나를 올리고(원격에도, upstream 설정) 워크트리로 꺼낸다. */
  pushedBranchWorktree(name: string): string
  /** 원격에 올린 브랜치를 원격에서 지우고 fetch --prune(머지 후 삭제된 상황). */
  goneBranchWorktree(name: string): string
  cleanup(): Promise<void>
}

export async function createGitFixture(prefix = 'pitwall-git-'): Promise<GitFixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  const origin = join(dir, 'origin.git')
  const main = join(dir, 'main')
  const run = (cwd: string, args: string[], env?: Record<string, string>): string =>
    execFileSync(
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
      {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env ? { ...process.env, ...env } : undefined
      }
    ).trim()
  const git = (cwd: string, ...args: string[]): string => run(cwd, args)
  const commit = (cwd: string, message: string, at?: Date): void => {
    // git 내부 형식 "<유닉스 초> <시간대>".
    const date = at ? `${Math.floor(at.getTime() / 1000)} +0000` : null
    run(
      cwd,
      ['commit', '--allow-empty', '-m', message],
      date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : undefined
    )
  }
  git(dir, 'init', '--bare', origin)
  git(dir, 'clone', origin, main)
  commit(main, 'first')
  git(main, 'push', 'origin', 'main')
  git(main, 'remote', 'set-head', 'origin', 'main')

  const pushedBranchWorktree = (name: string): string => {
    const path = join(dir, name)
    git(main, 'worktree', 'add', '-b', name, path, 'main')
    commit(path, `work on ${name}`)
    git(path, 'push', '-u', 'origin', name)
    return path
  }

  return {
    dir,
    main,
    origin,
    git,
    commit,
    pushedBranchWorktree,
    goneBranchWorktree(name) {
      const path = pushedBranchWorktree(name)
      git(main, 'push', 'origin', '--delete', name)
      git(main, 'fetch', '--prune')
      return path
    },
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}
