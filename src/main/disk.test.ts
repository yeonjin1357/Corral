import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createDiskManager, createRepoMemory, measureDir, type DiskDeps } from './disk'
import { createGitFixture, type GitFixture } from './testing/gitFixture'
import { blankSnapshot } from '../shared/snapshot'
import type { KillConfirm } from './kill'
import type { AgentRow, DashboardSnapshot, ServerRow, RawSample } from '../shared/types'

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir'

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

describe('measureDir', () => {
  let dir: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'pitwall-measure-')))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('하위 폴더까지 파일 크기를 더하고, 링크(정션·심볼릭 링크)는 따라가지 않는다', async () => {
    const root = join(dir, 'node_modules')
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'x.js'), Buffer.alloc(1000))
    await writeFile(join(root, 'a', 'y.js'), Buffer.alloc(2000))
    await writeFile(join(root, 'a', 'b', 'z.js'), Buffer.alloc(3000))
    const outside = join(dir, 'store')
    await mkdir(outside)
    await writeFile(join(outside, 'big.bin'), Buffer.alloc(50000))
    await symlink(outside, join(root, 'linked'), LINK_TYPE)
    expect(await measureDir(root)).toEqual({ bytes: 6000, files: 3 })
  })

  test('없는 폴더는 0', async () => {
    expect(await measureDir(join(dir, 'nope'))).toEqual({ bytes: 0, files: 0 })
  })
})

describe('createRepoMemory', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pitwall-repos-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('더한 저장소를 기억해 파일에 남기고 다시 읽는다(중복·최대 개수)', async () => {
    const file = join(dir, 'state.json')
    const memory = createRepoMemory(file, 3)
    await memory.load()
    memory.add(['C:\\work\\a\\.git', 'C:\\work\\b\\.git'])
    memory.add(['C:\\work\\a\\.git', 'C:\\work\\c\\.git', 'C:\\work\\d\\.git'])
    await memory.flush()
    expect(memory.list()).toEqual(['C:\\work\\b\\.git', 'C:\\work\\c\\.git', 'C:\\work\\d\\.git'])
    const again = createRepoMemory(file, 3)
    await again.load()
    expect(again.list()).toEqual(memory.list())
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ repos: memory.list() })
  })

  test('깨진 파일이면 빈 목록', async () => {
    const file = join(dir, 'state.json')
    await writeFile(file, '{ nope')
    const memory = createRepoMemory(file)
    await memory.load()
    expect(memory.list()).toEqual([])
  })
})

describe('createDiskManager (실제 git)', () => {
  let fx: GitFixture
  let gone: string
  let fresh: string
  let store: string

  beforeEach(async () => {
    fx = await createGitFixture('pitwall-disk-')
    gone = fx.goneBranchWorktree('feat-gone')
    fresh = join(fx.dir, 'fresh')
    fx.git(fx.main, 'worktree', 'add', '-b', 'fresh', fresh, 'main')
    for (const root of [gone, fresh, fx.main]) {
      await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(root, 'node_modules', 'a.js'), Buffer.alloc(1000))
      await writeFile(join(root, 'node_modules', 'pkg', 'b.js'), Buffer.alloc(2000))
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'index.js'), 'keep me')
    }
    // 의존성 폴더는 git 이 무시해야 지울 대상이다(저장소 공용 폴더의 exclude 는 모든 워크트리에 적용).
    await writeFile(join(fx.main, '.git', 'info', 'exclude'), 'node_modules/\ndist/\n.venv/\n')
    // pnpm 처럼 node_modules 안에서 바깥 저장소를 가리키는 링크.
    store = join(fx.dir, 'store')
    await mkdir(store)
    await writeFile(join(store, 'keep.bin'), Buffer.alloc(100))
    await symlink(store, join(gone, 'node_modules', 'linked'), LINK_TYPE)
  }, 60000)
  afterEach(async () => {
    await fx.cleanup()
  })

  function deps(over: Partial<DiskDeps> = {}): DiskDeps & { confirm: ReturnType<typeof vi.fn> } {
    return {
      settings: () => ({ dependencyDirs: ['node_modules'], extraRepos: [] }),
      knownRepos: () => [join(fx.main, '.git')],
      latest: () => blankSnapshot(1),
      resample: async (): Promise<RawSample> => ({
        processes: [],
        tcp: [],
        collectMode: 'helper-dll'
      }),
      confirm: vi.fn(async () => true),
      now: () => 1000,
      onChange: () => {},
      ...over
    } as DiskDeps & { confirm: ReturnType<typeof vi.fn> }
  }

  test('끝난 연결된 워크트리의 의존성 폴더만 찾고 크기를 잰다(메인·막 만든 워크트리는 뺀다)', async () => {
    const manager = createDiskManager(deps())
    const report = await manager.scan()
    expect(report.error).toBeNull()
    expect(report.scanning).toBe(false)
    expect(report.scannedAt).toBe(1000)
    expect(report.rows).toEqual([
      {
        worktreeRoot: gone,
        commonDir: join(fx.main, '.git'),
        branch: 'feat-gone',
        evidence: 'upstreamGone',
        folders: [{ name: 'node_modules', path: join(gone, 'node_modules'), bytes: 3000 }],
        totalBytes: 3000,
        inUse: false
      }
    ])
  }, 60000)

  test('메인 체크아웃은 끝난 브랜치(원격 삭제)에 있어도 대상이 아니다', async () => {
    fx.git(fx.main, 'checkout', '-b', 'feat-main')
    fx.commit(fx.main, 'main checkout work')
    fx.git(fx.main, 'push', '-u', 'origin', 'feat-main')
    fx.git(fx.main, 'push', 'origin', '--delete', 'feat-main')
    fx.git(fx.main, 'fetch', '--prune')
    const manager = createDiskManager(deps())
    expect((await manager.scan()).rows.map((r) => r.worktreeRoot)).toEqual([gone])
    expect(await manager.remove(fx.main)).toEqual({ status: 'gone' })
  }, 60000)

  test('설정에 추가한 저장소(폴더 경로)도 살펴본다', async () => {
    const manager = createDiskManager(
      deps({
        knownRepos: () => [],
        settings: () => ({ dependencyDirs: ['node_modules'], extraRepos: [join(fx.main, 'src')] })
      })
    )
    expect((await manager.scan()).rows.map((r) => r.worktreeRoot)).toEqual([gone])
  }, 60000)

  test('의존성 폴더 자체가 링크면 지우지 않을 것으로 표시하고, 잘못된 폴더 이름은 무시한다', async () => {
    await rm(join(gone, 'node_modules'), { recursive: true, force: true })
    await symlink(store, join(gone, 'node_modules'), LINK_TYPE)
    await mkdir(join(gone, '.venv'))
    await writeFile(join(gone, '.venv', 'x'), Buffer.alloc(500))
    const manager = createDiskManager(
      deps({
        settings: () => ({ dependencyDirs: ['..', 'node_modules', '.venv'], extraRepos: [] })
      })
    )
    const [row] = (await manager.scan()).rows
    expect(row.folders).toEqual([
      { name: 'node_modules', path: join(gone, 'node_modules'), bytes: null, skipped: 'link' },
      { name: '.venv', path: join(gone, '.venv'), bytes: 500 }
    ])
    expect(row.totalBytes).toBe(500)
    const result = await manager.remove(gone)
    expect(result.status).toBe('killed')
    expect(await exists(join(store, 'keep.bin'))).toBe(true)
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
    expect(await exists(join(gone, '.venv'))).toBe(false)
  }, 60000)

  test('확인 후 의존성 폴더만 지운다(링크 너머·소스·다른 워크트리는 그대로)', async () => {
    const d = deps()
    const manager = createDiskManager(d)
    await manager.scan()
    const result = await manager.remove(gone)
    expect(result).toEqual({
      status: 'killed',
      message: 'node_modules 를 지웠어요. 약 3 KB 를 확보했어요.'
    })
    const box = d.confirm.mock.calls[0][0] as KillConfirm
    expect(box.title).toBe('의존성 폴더 지우기')
    expect(box.message).toBe('feat-gone 의 node_modules 를 지울까요? 약 3 KB')
    expect(box.detail).toContain(join(gone, 'node_modules'))
    expect(await exists(join(gone, 'node_modules'))).toBe(false)
    expect(await readFile(join(gone, 'src', 'index.js'), 'utf8')).toBe('keep me')
    expect(await exists(join(store, 'keep.bin'))).toBe(true)
    expect(await exists(join(fresh, 'node_modules'))).toBe(true)
    expect(await exists(join(fx.main, 'node_modules'))).toBe(true)
    expect(manager.report().rows).toEqual([])
  }, 60000)

  test('그 워크트리를 쓰는 프로세스가 있으면(명령줄·작업 폴더) 확인 창 없이 거절한다', async () => {
    const byCommandLine = deps({
      resample: async () => ({
        processes: [
          {
            pid: 4321,
            ppid: 1,
            name: 'Code.exe',
            commandLine: `"C:\\Code.exe" ${gone}`,
            memoryBytes: 1,
            startedAt: 1
          }
        ],
        tcp: []
      })
    })
    const manager = createDiskManager(byCommandLine)
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message: '이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: Code.exe (PID 4321)'
    })
    expect(byCommandLine.confirm).not.toHaveBeenCalled()

    const byCwd = deps({
      resample: async () => ({
        processes: [
          {
            pid: 55,
            ppid: 1,
            name: 'node.exe',
            commandLine: 'node server.js',
            memoryBytes: 1,
            startedAt: 1
          }
        ],
        tcp: [],
        cwds: { 55: join(gone, 'src') }
      })
    })
    const m2 = createDiskManager(byCwd)
    await m2.scan()
    expect((await m2.remove(gone)).status).toBe('failed')
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
  }, 60000)

  test('git 이 무시하는 폴더만 지울 대상, 무시하지 않는 폴더(저장소에 올라간 build 등)는 건너뛴다(tracked)', async () => {
    await mkdir(join(gone, 'dist'), { recursive: true })
    await writeFile(join(gone, 'dist', 'app.js'), Buffer.alloc(500))
    // build 는 무시 목록에 없다(저장소에 올라간 소스 폴더일 수 있음).
    await mkdir(join(gone, 'build'), { recursive: true })
    await writeFile(join(gone, 'build', 'gen.sh'), 'echo')
    const manager = createDiskManager(
      deps({
        settings: () => ({ dependencyDirs: ['node_modules', 'dist', 'build'], extraRepos: [] })
      })
    )
    const report = await manager.scan()
    const folders = report.rows.find((r) => r.worktreeRoot === gone)!.folders
    expect(folders.map((f) => [f.name, f.skipped ?? null])).toEqual([
      ['node_modules', null],
      ['dist', null],
      ['build', 'tracked']
    ])
    expect((await manager.remove(gone)).status).toBe('killed')
    expect(await exists(join(gone, 'node_modules'))).toBe(false)
    expect(await exists(join(gone, 'dist'))).toBe(false)
    expect(await exists(join(gone, 'build', 'gen.sh'))).toBe(true)
  }, 60000)

  test('최신 스냅샷에 그 워크트리의 포트·에이전트가 있으면 사용 중으로 표시하고 지우지 않는다', async () => {
    const server = {
      worktree: { root: gone, branch: 'feat-gone', isLinkedWorktree: true }
    } as ServerRow
    const latest = (): DashboardSnapshot => ({ ...blankSnapshot(1), servers: [server] })
    const manager = createDiskManager(deps({ latest }))
    const report = await manager.scan()
    expect(report.rows[0].inUse).toBe(true)
    expect((await manager.remove(gone)).status).toBe('failed')
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
  }, 60000)

  test('취소하면 그대로, 목록에 없는 경로(메인 체크아웃 등)는 gone', async () => {
    const manager = createDiskManager(deps({ confirm: vi.fn(async () => false) }))
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({ status: 'cancelled' })
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
    expect(await manager.remove(fx.main)).toEqual({ status: 'gone' })
    expect(await manager.remove(fresh)).toEqual({ status: 'gone' })
    expect(await exists(join(fx.main, 'node_modules'))).toBe(true)
  }, 60000)

  test('지우기 직전에 다시 보니 끝난 상태가 아니면(브랜치를 다시 올림) 거절한다', async () => {
    const manager = createDiskManager(deps())
    await manager.scan()
    fx.commit(gone, 'more work')
    fx.git(gone, 'push', '-u', 'origin', 'feat-gone')
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message: '이 워크트리의 브랜치가 더는 끝난 상태가 아니라 지우지 않았어요.'
    })
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
  }, 60000)

  test('일부 폴더를 못 지우면(파일 잠김 등) 그대로 알린다', async () => {
    const manager = createDiskManager(
      deps({
        removeDir: async () => {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
      })
    )
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message:
        '지우지 못한 폴더가 있어요(파일을 쓰는 프로그램이 있을 수 있어요): node_modules. 일부만 지워졌을 수 있으니 이 워크트리를 다시 쓰려면 의존성을 다시 설치해 주세요.'
    })
    expect(manager.report().rows).toHaveLength(1)
  }, 60000)

  test('확인 창을 띄운 사이 그 워크트리를 쓰기 시작하면(확인 뒤 다시 보기) 지우지 않는다', async () => {
    const using: RawSample = {
      processes: [
        {
          pid: 77,
          ppid: 1,
          name: 'npm.exe',
          commandLine: 'npm install',
          memoryBytes: 1,
          startedAt: 1
        }
      ],
      tcp: [],
      cwds: { 77: gone },
      collectMode: 'helper-dll'
    }
    const samples: RawSample[] = [{ processes: [], tcp: [], collectMode: 'helper-dll' }, using]
    const d = deps({ resample: async () => samples.shift() ?? using })
    const manager = createDiskManager(d)
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message: '이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: npm.exe (PID 77)'
    })
    expect(d.confirm).toHaveBeenCalledTimes(1)
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
  }, 60000)

  test('상위 폴더에서 일하는 에이전트가 있으면 사용 중으로 보고 지우지 않는다', async () => {
    const agent = {
      pid: 5000,
      tool: 'claude',
      worktree: { root: fx.dir, branch: 'main', isLinkedWorktree: false },
      startedAt: 1,
      memoryBytes: 1,
      descendantCount: 0,
      state: 'idle',
      stateSource: 'cpu',
      cpuPercent: 0
    } as AgentRow
    const manager = createDiskManager(
      deps({ latest: () => ({ ...blankSnapshot(1), agents: [agent] }) })
    )
    expect((await manager.scan()).rows[0].inUse).toBe(true)
    expect((await manager.remove(gone)).status).toBe('failed')
    expect(await exists(join(gone, 'node_modules'))).toBe(true)
  }, 60000)

  test('작업 폴더를 모르는 에이전트가 있으면(그 에이전트가 쓰고 있을 수 있어) 지우지 않는다', async () => {
    const agent = {
      pid: 5000,
      tool: 'codex',
      worktree: null,
      startedAt: 1,
      memoryBytes: 1,
      descendantCount: 0,
      state: 'idle',
      stateSource: 'cpu',
      cpuPercent: 0
    } as AgentRow
    const d = deps({ latest: () => ({ ...blankSnapshot(1), agents: [agent] }) })
    const manager = createDiskManager(d)
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message:
        '작업 폴더를 모르는 에이전트가 있어 지우지 않았어요. 그 에이전트가 이 워크트리를 쓰고 있을 수 있어요.'
    })
    expect(d.confirm).not.toHaveBeenCalled()
  }, 60000)

  test('수집이 모든 작업 폴더를 읽지 못하면(macOS 등) 지우기 직전에 전체 작업 폴더를 따로 읽어 확인한다', async () => {
    const partial: RawSample = {
      processes: [
        { pid: 55, ppid: 1, name: 'zsh', commandLine: '-zsh', memoryBytes: 1, startedAt: 1 }
      ],
      tcp: [],
      collectMode: 'darwin'
    }
    const fullCwds = vi.fn(async () => ({ 55: join(gone, 'src') }))
    const manager = createDiskManager(deps({ resample: async () => partial, fullCwds }))
    await manager.scan()
    expect(await manager.remove(gone)).toEqual({
      status: 'failed',
      message: '이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: zsh (PID 55)'
    })
    expect(fullCwds).toHaveBeenCalled()
  }, 60000)

  test('작업 폴더를 확인할 수 없는 수집 방식이면 확인 창에 그 사실을 알린다', async () => {
    const d = deps({ resample: async () => ({ processes: [], tcp: [], collectMode: 'safe' }) })
    const manager = createDiskManager(d)
    await manager.scan()
    await manager.remove(gone)
    expect((d.confirm.mock.calls[0][0] as KillConfirm).detail).toContain(
      '이 PC 에서는 프로세스의 작업 폴더를 모두 확인할 수 없어'
    )
  }, 60000)

  test('잠긴 워크트리(다른 도구가 쓰는 중)는 대상이 아니다', async () => {
    fx.git(fx.main, 'worktree', 'lock', gone)
    expect((await createDiskManager(deps()).scan()).rows).toEqual([])
  }, 60000)

  test('저장소 하나를 읽지 못해도 다른 저장소는 보여 준다', async () => {
    const manager = createDiskManager(
      deps({ knownRepos: () => [join(fx.dir, 'no-such-repo', '.git'), join(fx.main, '.git')] })
    )
    const report = await manager.scan()
    expect(report.error).toBeNull()
    expect(report.rows.map((r) => r.worktreeRoot)).toEqual([gone])
  }, 60000)
})
