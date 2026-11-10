import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { countChanges, createChangeCounter } from './gitStatus'
import type { CommandOptions, CommandResult } from './collect/runCommand'
import { createGitFixture, type GitFixture } from './testing/gitFixture'

const MIN = 60 * 1000
const ROOT = 'C:\\work\\shop-web'

/** 대기 중인 프로미스 콜백을 모두 돌린다. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** 바깥에서 끝낼 수 있는 세기(돌기 시작한 루트를 순서대로 담는다). */
function pendingRuns(): {
  run: (root: string) => Promise<number | null>
  started: string[]
  finish: (index: number, value: number | null) => void
} {
  const started: string[] = []
  const resolvers: ((value: number | null) => void)[] = []
  return {
    started,
    run: (root) =>
      new Promise((resolve) => {
        started.push(root)
        resolvers.push(resolve)
      }),
    finish: (index, value) => resolvers[index](value)
  }
}

describe('createChangeCounter', () => {
  test('get 은 기다리지 않고 기억한 값을 준다', async () => {
    const clock = { now: 0 }
    const runs = pendingRuns()
    const counter = createChangeCounter({ run: runs.run, now: () => clock.now })
    counter.want([ROOT])
    expect(runs.started).toEqual([ROOT])
    // 아직 세는 중이면 모른다(기다리지 않는다).
    expect(counter.get(ROOT)).toBeNull()
    runs.finish(0, 3)
    await settle()
    expect(counter.get(ROOT)).toBe(3)
    // 경로 표기(대소문자·끝 구분자)가 달라도 같은 루트.
    expect(counter.get('c:\\WORK\\shop-web\\')).toBe(3)
    // 다시 세는 동안에도 기억한 값을 준다.
    clock.now += 5 * MIN
    counter.want([ROOT])
    expect(runs.started).toHaveLength(2)
    expect(counter.get(ROOT)).toBe(3)
    runs.finish(1, 7)
    await settle()
    expect(counter.get(ROOT)).toBe(7)
  })

  test('5분 안에는 다시 세지 않는다', async () => {
    const clock = { now: 0 }
    const run = vi.fn(async () => 1)
    const counter = createChangeCounter({ run, now: () => clock.now })
    counter.want([ROOT])
    await settle()
    clock.now += 5 * MIN - 1
    counter.want([ROOT, 'c:\\work\\shop-web'])
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    clock.now += 1
    counter.want([ROOT])
    await settle()
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('세다가 실패하면 null 로 두고 5분 뒤에 다시 센다', async () => {
    const clock = { now: 0 }
    const run = vi.fn<(root: string) => Promise<number | null>>(async () => 4)
    const counter = createChangeCounter({ run, now: () => clock.now })
    counter.want([ROOT])
    await settle()
    expect(counter.get(ROOT)).toBe(4)
    clock.now += 5 * MIN
    run.mockRejectedValueOnce(new Error('timeout'))
    counter.want([ROOT])
    await settle()
    expect(counter.get(ROOT)).toBeNull()
    clock.now += MIN
    counter.want([ROOT])
    await settle()
    expect(run).toHaveBeenCalledTimes(2)
    clock.now += 4 * MIN
    counter.want([ROOT])
    await settle()
    expect(run).toHaveBeenCalledTimes(3)
    expect(counter.get(ROOT)).toBe(4)
  })

  test('한 번에 둘까지만 돈다', async () => {
    const runs = pendingRuns()
    const counter = createChangeCounter({ run: runs.run, now: () => 0 })
    counter.want(['C:\\work\\a', 'C:\\work\\b', 'C:\\work\\c'])
    // 같은 루트를 다시 찾아도 겹쳐 돌리지 않는다.
    counter.want(['C:\\work\\a'])
    expect(runs.started).toEqual(['C:\\work\\a', 'C:\\work\\b'])
    runs.finish(0, 1)
    await settle()
    expect(runs.started).toEqual(['C:\\work\\a', 'C:\\work\\b', 'C:\\work\\c'])
    runs.finish(1, 2)
    runs.finish(2, 3)
    await settle()
    expect(['C:\\work\\a', 'C:\\work\\b', 'C:\\work\\c'].map((r) => counter.get(r))).toEqual([
      1, 2, 3
    ])
  })

  test('네트워크 경로는 세지 않는다', () => {
    const run = vi.fn(async () => 1)
    const counter = createChangeCounter({ run, now: () => 0 })
    counter.want(['\\\\nas\\share\\repo', '//nas/share/repo'])
    expect(run).not.toHaveBeenCalled()
    expect(counter.get('\\\\nas\\share\\repo')).toBeNull()
  })

  test('30분 동안 찾지 않은 루트는 잊는다', async () => {
    const clock = { now: 0 }
    const run = vi.fn(async () => 2)
    const counter = createChangeCounter({ run, now: () => clock.now })
    counter.want([ROOT])
    await settle()
    clock.now += 30 * MIN
    counter.want(['C:\\work\\other'])
    await settle()
    expect(counter.get(ROOT)).toBe(2)
    clock.now += 1
    counter.want(['C:\\work\\other'])
    expect(counter.get(ROOT)).toBeNull()
    expect(counter.get('C:\\work\\other')).toBe(2)
  })
})

describe('countChanges', () => {
  test('git status 는 저장소 설정의 fsmonitor 를 끄고, 저장소를 cwd 로 쓰지 않는다', async () => {
    const calls: { argv: string[]; opts?: CommandOptions }[] = []
    const run = async (argv: string[], opts?: CommandOptions): Promise<CommandResult> => {
      calls.push({ argv, opts })
      return { stdout: ' M src/a.ts\n?? new.ts\n\n', stderr: '', exitCode: 0 }
    }
    expect(await countChanges(ROOT, run)).toBe(2)
    expect(calls).toHaveLength(1)
    const [{ argv, opts }] = calls
    expect(argv).toEqual([
      'git',
      '-C',
      ROOT,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      'status',
      '--porcelain'
    ])
    expect(opts).toEqual({
      timeoutMs: 10000,
      env: expect.objectContaining({
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C'
      })
    })
    expect(opts).not.toHaveProperty('cwd')
  })

  test('저장소가 아니거나 시간 안에 끝나지 않으면 null', async () => {
    const notRepo = async (): Promise<CommandResult> => ({
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128
    })
    expect(await countChanges(ROOT, notRepo)).toBeNull()
    const timeout = async (): Promise<CommandResult> => {
      throw new Error('timeout')
    }
    expect(await countChanges(ROOT, timeout)).toBeNull()
  })

  describe('실제 git', () => {
    let fx: GitFixture
    beforeEach(async () => {
      fx = await createGitFixture('pitwall-status-')
    }, 60000)
    afterEach(async () => {
      await fx.cleanup()
    })

    test('바꾼 파일·새 파일 수를 센다', async () => {
      await writeFile(join(fx.main, 'a.txt'), 'one')
      await writeFile(join(fx.main, 'b.txt'), 'two')
      fx.git(fx.main, 'add', '.')
      fx.git(fx.main, 'commit', '-m', 'files')
      expect(await countChanges(fx.main)).toBe(0)

      await writeFile(join(fx.main, 'a.txt'), 'changed')
      await writeFile(join(fx.main, 'new.txt'), 'new')
      await mkdir(join(fx.main, 'dir'))
      await writeFile(join(fx.main, 'dir', 'x.txt'), 'x')
      // 바꾼 파일 1 + 새 파일 1 + 새 폴더 1(폴더째 한 줄).
      expect(await countChanges(fx.main)).toBe(3)
    }, 60000)
  })
})
