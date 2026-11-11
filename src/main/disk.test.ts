import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { join, parse, sep } from 'path'
import {
  createDiskManager,
  createRepoMemory,
  measureDir,
  pathExists,
  snapshotWorktrees,
  type DiskDeps
} from './disk'
import { createGitFixture, type GitFixture } from './testing/gitFixture'
import { blankSnapshot } from '../shared/snapshot'
import type { KillConfirm } from './kill'
import type { AgentRow, DashboardSnapshot, DiskRow, ServerRow, RawSample } from '../shared/types'

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

  test('임시 폴더 아래 저장소는 기억하지 않는다', async () => {
    const temp = join(dir, 'tmp')
    const memory = createRepoMemory(join(dir, 'a.json'), 200, { tempDir: temp + sep })
    memory.add([
      join(temp, 'pitwall-disk-1', 'main', '.git'),
      temp + sep,
      join(dir, 'tmp-other', '.git'),
      join(dir, 'work', '.git')
    ])
    expect(memory.list()).toEqual([join(dir, 'tmp-other', '.git'), join(dir, 'work', '.git')])
    // Windows·macOS 는 대소문자를 가리지 않는다.
    if (process.platform === 'win32' || process.platform === 'darwin') {
      memory.add([join(temp.toUpperCase(), 'x', '.git')])
      expect(memory.list()).toHaveLength(2)
    }
    // 기본은 OS 임시 폴더.
    const byDefault = createRepoMemory(join(dir, 'b.json'))
    byDefault.add([join(tmpdir(), 'pitwall-git-x', 'main', '.git')])
    expect(byDefault.list()).toEqual([])
    // null 이면 가리지 않는다.
    const everything = createRepoMemory(join(dir, 'c.json'), 200, { tempDir: null })
    everything.add([join(tmpdir(), 'pitwall-git-x', 'main', '.git')])
    expect(everything.list()).toEqual([join(tmpdir(), 'pitwall-git-x', 'main', '.git')])
    await Promise.all([memory.flush(), byDefault.flush(), everything.flush()])
  })

  test('없어진 저장소는 prune 으로 빠지고, 모르는 것은 남는다', async () => {
    const file = join(dir, 'state.json')
    const memory = createRepoMemory(file, 200, { tempDir: null })
    await memory.load()
    memory.add([
      'C:\\work\\a\\.git',
      'C:\\work\\gone\\.git',
      'C:\\work\\nas\\.git',
      'C:\\work\\b\\.git'
    ])
    await memory.flush()
    const answers: Record<string, boolean | null> = {
      'C:\\work\\a\\.git': true,
      'C:\\work\\gone\\.git': false,
      'C:\\work\\nas\\.git': null
    }
    await memory.prune(async (d) => {
      if (d in answers) return answers[d]
      throw new Error('EIO')
    })
    await memory.flush()
    expect(memory.list()).toEqual(['C:\\work\\a\\.git', 'C:\\work\\nas\\.git', 'C:\\work\\b\\.git'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ repos: memory.list() })

    // 실제 확인: 있으면 true, 없으면(ENOENT·ENOTDIR) false, 네트워크 공유는 열지 않고 null.
    expect(await pathExists(dir)).toBe(true)
    expect(await pathExists(join(dir, 'nope', '.git'))).toBe(false)
    expect(await pathExists(join(file, 'child'))).toBe(false)
    expect(await pathExists('\\\\nas\\share\\repo\\.git')).toBeNull()
  })

  test('드라이브·볼륨이 없는 경로는 없어졌다고 보지 않는다(외장 드라이브를 뺀 경우)', async () => {
    const fail = (code: string): Error => Object.assign(new Error(code), { code })
    /** present 에 든 경로만 있다고 답하는 stat. 나머지는 ENOENT(또는 broken 이면 그 오류). */
    const probe =
      (present: string[], broken: Record<string, string> = {}) =>
      async (p: string): Promise<void> => {
        if (p in broken) throw fail(broken[p])
        if (!present.includes(p)) throw fail('ENOENT')
      }

    // Windows: 드라이브 문자가 없으면(빼 둔 외장 드라이브·끊긴 연결 드라이브) 모름, 드라이브가 있으면 없어진 것.
    expect(await pathExists('Q:\\repo\\.git', probe(['C:\\']), 'win32')).toBeNull()
    expect(await pathExists('C:\\work\\gone\\.git', probe(['C:\\']), 'win32')).toBe(false)
    expect(
      await pathExists('C:\\work\\a\\.git', probe(['C:\\', 'C:\\work\\a\\.git']), 'win32')
    ).toBe(true)
    // 드라이브를 확인하다 다른 오류가 나도 모름.
    expect(await pathExists('D:\\repo\\.git', probe([], { 'D:\\': 'EACCES' }), 'win32')).toBeNull()

    // macOS: /Volumes/<이름> 이 없으면(꺼낸 외장 디스크) 모름, 있으면 없어진 것. 그 밖의 경로는 그대로.
    expect(await pathExists('/Volumes/ext/repo/.git', probe([]), 'darwin')).toBeNull()
    expect(await pathExists('/Volumes/ext/repo/.git', probe(['/Volumes/ext']), 'darwin')).toBe(
      false
    )
    expect(await pathExists('/Users/dev/gone/.git', probe([]), 'darwin')).toBe(false)

    // prune 도 그 저장소를 잊지 않는다.
    const memory = createRepoMemory(join(dir, 'state.json'), 200, { tempDir: null })
    memory.add(['Q:\\repo\\.git', 'C:\\work\\gone\\.git'])
    await memory.prune((d) => pathExists(d, probe(['C:\\']), 'win32'))
    await memory.flush()
    expect(memory.list()).toEqual(['Q:\\repo\\.git'])
  })

  test('임시 폴더의 실제 경로(다른 표기) 아래 저장소도 기억하지 않는다', async () => {
    // macOS 의 /var/folders → /private/var/folders, Windows 의 8.3 짧은 이름처럼 같은 폴더를 다르게 쓴다.
    // 테스트 폴더는 실제 경로로 잡는다: OS 임시 폴더부터 다른 표기(CI 의 RUNNER~1·/var)면 real 이
    // 실제 경로도 링크 표기도 아닌 세 번째 표기가 되어, 링크 하나만 다루려는 이 테스트의 전제가 깨진다.
    const base = await realpath(dir)
    const real = join(base, 'real-temp')
    await mkdir(real)
    const alias = join(base, 'temp-alias')
    await symlink(real, alias, LINK_TYPE)
    const memory = createRepoMemory(join(base, 'a.json'), 200, { tempDir: alias })
    memory.add([
      join(real, 'pitwall-git-1', 'main', '.git'),
      join(alias, 'pitwall-git-2', 'main', '.git'),
      join(base, 'work', '.git')
    ])
    expect(memory.list()).toEqual([join(base, 'work', '.git')])
    // 실제 경로를 알 수 없는(없는) 임시 폴더는 주어진 그대로만 비교한다.
    const missing = createRepoMemory(join(base, 'b.json'), 200, { tempDir: join(base, 'no-temp') })
    missing.add([join(base, 'no-temp', 'x', '.git'), join(base, 'work', '.git')])
    expect(missing.list()).toEqual([join(base, 'work', '.git')])
    await Promise.all([memory.flush(), missing.flush()])
  })

  test('임시 폴더가 드라이브 루트면 그 규칙을 쓰지 않는다', async () => {
    const root = parse(dir).root
    const memory = createRepoMemory(join(dir, 'a.json'), 200, { tempDir: root })
    memory.add([join(dir, 'work', '.git')])
    expect(memory.list()).toEqual([join(dir, 'work', '.git')])
    await memory.flush()
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

  const SETTINGS = {
    dependencyDirs: ['node_modules'],
    extraRepos: [] as string[],
    staleWorktreeDays: 14
  }

  function deps(over: Partial<DiskDeps> = {}): DiskDeps & { confirm: ReturnType<typeof vi.fn> } {
    return {
      settings: () => SETTINGS,
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
        settings: () => ({ ...SETTINGS, extraRepos: [join(fx.main, 'src')] })
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
        settings: () => ({ ...SETTINGS, dependencyDirs: ['..', 'node_modules', '.venv'] })
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
    // 링크인 node_modules 는 지우지 않아 지운 것은 .venv 하나다.
    expect(result.freed).toEqual({
      count: 1,
      memoryBytes: 500,
      commitBytes: null,
      names: ['.venv']
    })
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
      message: 'node_modules 를 지웠어요. 약 3 KB 를 확보했어요.',
      freed: { count: 1, memoryBytes: 3000, commitBytes: null, names: ['node_modules'] }
    })
    const box = d.confirm.mock.calls[0][0] as KillConfirm
    expect(box.title).toBe('의존성 폴더 지우기')
    expect(box.message).toBe('feat-gone 의 node_modules 를 지울까요? 약 3 KB')
    // 폴더 지우기는 되돌릴 수 없어 확인 버튼을 빨간 계열로.
    expect(box.tone).toBe('danger')
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
        settings: () => ({ ...SETTINGS, dependencyDirs: ['node_modules', 'dist', 'build'] })
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

  test('숨긴 서버가 그 워크트리에서 돌아도 사용 중으로 표시한다', async () => {
    const server = {
      worktree: { root: gone, branch: 'feat-gone', isLinkedWorktree: true }
    } as ServerRow
    const latest = (): DashboardSnapshot => ({ ...blankSnapshot(1), hiddenServers: [server] })
    const report = await createDiskManager(deps({ latest })).scan()
    expect(report.rows[0].inUse).toBe(true)
  }, 60000)

  test('저장소 기억에 쓰는 워크트리 목록에 숨긴 서버의 워크트리도 넣는다', () => {
    const w = { root: gone, branch: 'feat-gone', isLinkedWorktree: true }
    const hidden = { worktree: w } as ServerRow
    expect(snapshotWorktrees({ ...blankSnapshot(1), hiddenServers: [hidden] })).toEqual([w])
  })

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

  test('같은 저장소를 다른 경로(정션·심볼릭 링크)로 알아도 한 번만 살펴본다', async () => {
    const alias = join(fx.dir, 'alias-main')
    await symlink(fx.main, alias, 'junction')
    const manager = createDiskManager(
      deps({ knownRepos: () => [join(fx.main, '.git'), join(alias, '.git')] })
    )
    const report = await manager.scan()
    expect(report.rows.map((r) => r.worktreeRoot)).toEqual([gone])
  }, 60000)

  test('저장소 하나를 읽지 못해도 다른 저장소는 보여 준다', async () => {
    const manager = createDiskManager(
      deps({ knownRepos: () => [join(fx.dir, 'no-such-repo', '.git'), join(fx.main, '.git')] })
    )
    const report = await manager.scan()
    expect(report.error).toBeNull()
    expect(report.rows.map((r) => r.worktreeRoot)).toEqual([gone])
  }, 60000)

  describe('오래 안 쓴 워크트리', () => {
    const DAY = 24 * 60 * 60 * 1000

    /**
     * 30일 전에 커밋한 워크트리(브랜치 또는 detached)에 의존성 폴더를 두고 색인 수정 시각을 20일 전으로 돌린다.
     * 마지막으로 만진 때는 둘 중 늦은 20일 전이다.
     */
    async function oldWorktree(name: string, detached = false): Promise<string> {
      const path = join(fx.dir, name)
      fx.git(fx.main, 'worktree', 'add', ...(detached ? ['--detach'] : ['-b', name]), path, 'main')
      fx.commit(path, `old work on ${name}`, new Date(Date.now() - 30 * DAY))
      await mkdir(join(path, 'node_modules'), { recursive: true })
      await writeFile(join(path, 'node_modules', 'c.js'), Buffer.alloc(500))
      await mkdir(join(path, 'src'), { recursive: true })
      await writeFile(join(path, 'src', 'index.js'), 'keep me')
      const index = join(fx.git(path, 'rev-parse', '--absolute-git-dir'), 'index')
      const twentyDaysAgo = new Date(Date.now() - 20 * DAY)
      await utimes(index, twentyDaysAgo, twentyDaysAgo)
      return path
    }

    test('14일 넘게 커밋·변경이 없는 워크트리는 오래 안 씀으로 뜬다, detached 도', async () => {
      const old = await oldWorktree('old-work')
      const loose = await oldWorktree('loose', true)
      const manager = createDiskManager(deps({ now: Date.now }))
      const report = await manager.scan()
      const row = (root: string): DiskRow | undefined =>
        report.rows.find((r) => r.worktreeRoot === root)
      expect(row(old)).toEqual({
        worktreeRoot: old,
        commonDir: join(fx.main, '.git'),
        branch: 'old-work',
        evidence: 'stale',
        staleDays: 20,
        folders: [{ name: 'node_modules', path: join(old, 'node_modules'), bytes: 500 }],
        totalBytes: 500,
        inUse: false
      })
      expect(row(loose)).toMatchObject({ branch: null, evidence: 'stale', staleDays: 20 })
      // 끝난 근거가 있으면 그대로, 막 만든 워크트리는 오래 안 쓴 것이 아니다.
      expect(row(gone)?.evidence).toBe('upstreamGone')
      expect(row(fresh)).toBeUndefined()

      // 기준보다 짧으면(20일 < 21일) 아니다.
      const stricter = createDiskManager(
        deps({ now: Date.now, settings: () => ({ ...SETTINGS, staleWorktreeDays: 21 }) })
      )
      expect((await stricter.scan()).rows.map((r) => r.worktreeRoot)).toEqual([gone])

      // 시간이 더 지나도 끝난 근거가 먼저다.
      const later = createDiskManager(deps({ now: () => Date.now() + 40 * DAY }))
      const laterRows = (await later.scan()).rows
      expect(laterRows.find((r) => r.worktreeRoot === gone)?.evidence).toBe('upstreamGone')
      expect(laterRows.find((r) => r.worktreeRoot === fresh)?.evidence).toBe('stale')

      // 지우는 것은 끝난 워크트리와 같다(의존성 폴더만).
      const result = await manager.remove(old)
      expect(result.status).toBe('killed')
      expect(await exists(join(old, 'node_modules'))).toBe(false)
      expect(await readFile(join(old, 'src', 'index.js'), 'utf8')).toBe('keep me')
    }, 60000)

    test('0 이면 오래 안 쓴 워크트리를 찾지 않는다', async () => {
      await oldWorktree('old-work')
      await oldWorktree('loose', true)
      const manager = createDiskManager(
        deps({ now: Date.now, settings: () => ({ ...SETTINGS, staleWorktreeDays: 0 }) })
      )
      expect((await manager.scan()).rows.map((r) => r.worktreeRoot)).toEqual([gone])
    }, 60000)

    test('오래 안 쓴 워크트리도 실행 중인 것이 있으면 지우지 않는다', async () => {
      const old = await oldWorktree('old-work')
      const server = {
        worktree: { root: old, branch: 'old-work', isLinkedWorktree: true }
      } as ServerRow
      const withServer = deps({
        now: Date.now,
        latest: () => ({ ...blankSnapshot(1), servers: [server] })
      })
      const manager = createDiskManager(withServer)
      const row = (await manager.scan()).rows.find((r) => r.worktreeRoot === old)
      expect(row).toMatchObject({ evidence: 'stale', inUse: true })
      expect(await manager.remove(old)).toEqual({
        status: 'failed',
        message: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지우지 않았어요.'
      })
      expect(withServer.confirm).not.toHaveBeenCalled()

      const withShell = deps({
        now: Date.now,
        resample: async () => ({
          processes: [
            {
              pid: 55,
              ppid: 1,
              name: 'node.exe',
              commandLine: 'node',
              memoryBytes: 1,
              startedAt: 1
            }
          ],
          tcp: [],
          cwds: { 55: join(old, 'src') },
          collectMode: 'helper-dll'
        })
      })
      const m2 = createDiskManager(withShell)
      await m2.scan()
      expect(await m2.remove(old)).toEqual({
        status: 'failed',
        message: '이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: node.exe (PID 55)'
      })
      expect(withShell.confirm).not.toHaveBeenCalled()
      expect(await exists(join(old, 'node_modules'))).toBe(true)
    }, 60000)

    test('확인 창 사이에 다시 쓰기 시작하면 지우지 않는다', async () => {
      const old = await oldWorktree('old-work')
      const d = deps({
        now: Date.now,
        confirm: vi.fn(async () => {
          fx.commit(old, 'back to work')
          return true
        })
      })
      const manager = createDiskManager(d)
      expect((await manager.scan()).rows.find((r) => r.worktreeRoot === old)?.evidence).toBe(
        'stale'
      )
      expect(await manager.remove(old)).toEqual({
        status: 'failed',
        message: '이 워크트리를 다시 쓰기 시작해 지우지 않았어요.'
      })
      expect(d.confirm).toHaveBeenCalledTimes(1)
      expect(await exists(join(old, 'node_modules'))).toBe(true)
    }, 60000)

    test('잠긴 워크트리는 잠겼다고 알리고 지우지 않는다', async () => {
      const old = await oldWorktree('old-work')
      const d = deps({ now: Date.now })
      const manager = createDiskManager(d)
      const rows = (await manager.scan()).rows
      expect(rows.map((r) => [r.worktreeRoot, r.evidence])).toEqual(
        expect.arrayContaining([
          [gone, 'upstreamGone'],
          [old, 'stale']
        ])
      )
      // 목록에 오른 뒤 다른 도구가 잠갔다(끝난 행·오래 안 쓴 행 모두).
      fx.git(fx.main, 'worktree', 'lock', gone)
      fx.git(fx.main, 'worktree', 'lock', old)
      const locked = {
        status: 'failed',
        message: '이 워크트리가 잠겨 있어(다른 도구가 쓰는 중) 지우지 않았어요.'
      }
      expect(await manager.remove(gone)).toEqual(locked)
      expect(await manager.remove(old)).toEqual(locked)
      expect(d.confirm).not.toHaveBeenCalled()
      expect(await exists(join(gone, 'node_modules'))).toBe(true)
      expect(await exists(join(old, 'node_modules'))).toBe(true)
    }, 60000)

    test('목록에 오른 뒤 기준을 0 으로 바꾸면 오래 안 쓴 워크트리는 지우지 않는다', async () => {
      const old = await oldWorktree('old-work')
      let days = 14
      const d = deps({ now: Date.now, settings: () => ({ ...SETTINGS, staleWorktreeDays: days }) })
      const manager = createDiskManager(d)
      expect((await manager.scan()).rows.find((r) => r.worktreeRoot === old)?.evidence).toBe(
        'stale'
      )
      days = 0
      expect(await manager.remove(old)).toEqual({
        status: 'failed',
        message: '이 워크트리를 다시 쓰기 시작해 지우지 않았어요.'
      })
      expect(d.confirm).not.toHaveBeenCalled()
      expect(await exists(join(old, 'node_modules'))).toBe(true)
    }, 60000)

    test('detached 인 오래 안 쓴 워크트리도 사용 중이면 지우지 않는다', async () => {
      const loose = await oldWorktree('loose', true)
      const server = {
        worktree: { root: loose, branch: null, isLinkedWorktree: true }
      } as ServerRow
      const d = deps({ now: Date.now, latest: () => ({ ...blankSnapshot(1), servers: [server] }) })
      const manager = createDiskManager(d)
      const row = (await manager.scan()).rows.find((r) => r.worktreeRoot === loose)
      expect(row).toMatchObject({ branch: null, evidence: 'stale', inUse: true })
      expect(await manager.remove(loose)).toEqual({
        status: 'failed',
        message: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지우지 않았어요.'
      })
      expect(d.confirm).not.toHaveBeenCalled()
      expect(await exists(join(loose, 'node_modules'))).toBe(true)
    }, 60000)

    describe('모두 정리', () => {
      /** 개발 서버가 도는(사용 중) 워크트리. */
      const serverIn = (root: string): DashboardSnapshot => ({
        ...blankSnapshot(1),
        servers: [{ worktree: { root, branch: null, isLinkedWorktree: true } } as ServerRow]
      })

      test('사용 중이 아닌 끝난·오래 안 쓴 워크트리를 확인 창 하나로 모두 지운다', async () => {
        const old = await oldWorktree('old-work')
        const busy = await oldWorktree('busy-work')
        const d = deps({ now: Date.now, latest: () => serverIn(busy) })
        const manager = createDiskManager(d)
        const rows = (await manager.scan()).rows
        expect(rows.map((r) => [r.worktreeRoot, r.inUse])).toEqual(
          expect.arrayContaining([
            [gone, false],
            [old, false],
            [busy, true]
          ])
        )

        const { result, removed } = await manager.removeAll()

        expect(d.confirm).toHaveBeenCalledTimes(1)
        const box = d.confirm.mock.calls[0][0] as KillConfirm
        expect(box.title).toBe('모두 정리')
        expect(box.message).toBe('워크트리 2곳의 의존성 폴더를 지울까요? 약 3 KB')
        expect(box.tone).toBe('danger')
        expect(box.buttons[0]).toBe('모두 지우기')
        expect(box.detail).toContain('• feat-gone (node_modules) — 3 KB')
        expect(box.detail).toContain('• old-work (node_modules) — 1 KB')
        expect(box.detail).not.toContain('busy-work')
        expect(box.detail).toContain('이 중 1곳은 끝났다는 근거 없이 오래 안 쓴 워크트리예요.')

        expect(result).toEqual({
          status: 'killed',
          message: '2곳을 정리했어요. 약 3 KB 를 확보했어요.',
          freed: { count: 2, memoryBytes: 3500, commitBytes: null }
        })
        // 기록은 워크트리마다 남긴다.
        expect(removed).toEqual(
          expect.arrayContaining([
            {
              worktreeRoot: gone,
              result: {
                status: 'killed',
                freed: { count: 1, memoryBytes: 3000, commitBytes: null, names: ['node_modules'] }
              }
            },
            {
              worktreeRoot: old,
              result: {
                status: 'killed',
                freed: { count: 1, memoryBytes: 500, commitBytes: null, names: ['node_modules'] }
              }
            }
          ])
        )
        expect(removed).toHaveLength(2)

        expect(await exists(join(gone, 'node_modules'))).toBe(false)
        expect(await exists(join(old, 'node_modules'))).toBe(false)
        expect(await exists(join(busy, 'node_modules'))).toBe(true)
        expect(await readFile(join(old, 'src', 'index.js'), 'utf8')).toBe('keep me')
        expect(await exists(join(store, 'keep.bin'))).toBe(true)
        expect(await exists(join(fresh, 'node_modules'))).toBe(true)
        expect(await exists(join(fx.main, 'node_modules'))).toBe(true)
        expect(manager.report().rows.map((r) => r.worktreeRoot)).toEqual([busy])
      }, 60000)

      test('지우기 직전에 워크트리마다 다시 샘플링해, 그 사이 쓰기 시작한 곳은 건너뛴다', async () => {
        const old = await oldWorktree('old-work')
        const quiet: RawSample = { processes: [], tcp: [], collectMode: 'helper-dll' }
        const usingOld: RawSample = {
          processes: [
            {
              pid: 77,
              ppid: 1,
              name: 'npm.exe',
              commandLine: 'npm i',
              memoryBytes: 1,
              startedAt: 1
            }
          ],
          tcp: [],
          cwds: { 77: old },
          collectMode: 'helper-dll'
        }
        // 확인 창 전에는 한 번만(모든 줄이 같이 쓴다), 확인 뒤에는 줄마다 새로 샘플링한다.
        const samples = [quiet]
        const resample = vi.fn(async () => samples.shift() ?? usingOld)
        const manager = createDiskManager(deps({ now: Date.now, resample }))
        await manager.scan()

        const { result, removed } = await manager.removeAll()

        expect(resample).toHaveBeenCalledTimes(3)
        expect(result).toEqual({
          status: 'killed',
          message:
            '1곳을 정리했어요. 약 3 KB 를 확보했어요. 1곳은 그 사이 쓰기 시작했거나 바뀌어 건너뛰었어요.',
          freed: { count: 1, memoryBytes: 3000, commitBytes: null }
        })
        expect(removed.map((r) => r.worktreeRoot)).toEqual([gone])
        expect(await exists(join(gone, 'node_modules'))).toBe(false)
        expect(await exists(join(old, 'node_modules'))).toBe(true)
      }, 60000)

      test('확인 창 사이에 다시 쓰기 시작한 오래 안 쓴 워크트리는 건너뛴다', async () => {
        const old = await oldWorktree('old-work')
        const d = deps({
          now: Date.now,
          confirm: vi.fn(async () => {
            fx.commit(old, 'back to work')
            return true
          })
        })
        const manager = createDiskManager(d)
        await manager.scan()
        const { result } = await manager.removeAll()
        expect(result.status).toBe('killed')
        expect(result.message).toContain('1곳은 그 사이 쓰기 시작했거나 바뀌어 건너뛰었어요.')
        expect(await exists(join(gone, 'node_modules'))).toBe(false)
        expect(await exists(join(old, 'node_modules'))).toBe(true)
      }, 60000)

      test('취소하면 아무것도 지우지 않는다', async () => {
        const old = await oldWorktree('old-work')
        const manager = createDiskManager(
          deps({ now: Date.now, confirm: vi.fn(async () => false) })
        )
        await manager.scan()
        expect(await manager.removeAll()).toEqual({ result: { status: 'cancelled' }, removed: [] })
        expect(await exists(join(gone, 'node_modules'))).toBe(true)
        expect(await exists(join(old, 'node_modules'))).toBe(true)
        expect(manager.report().rows).toHaveLength(2)
      }, 60000)

      test('지울 곳이 없으면(모두 사용 중) 확인 창 없이 gone', async () => {
        const d = deps({ latest: () => serverIn(gone) })
        const manager = createDiskManager(d)
        await manager.scan()
        expect(await manager.removeAll()).toEqual({ result: { status: 'gone' }, removed: [] })
        expect(d.confirm).not.toHaveBeenCalled()
        expect(await exists(join(gone, 'node_modules'))).toBe(true)
      }, 60000)

      test('확인 창 전에 모두 지울 수 없게 되면 그 까닭을 알린다(작업 폴더를 모르는 에이전트)', async () => {
        const agent = { pid: 5000, tool: 'claude', worktree: null } as unknown as AgentRow
        const d = deps({ latest: () => ({ ...blankSnapshot(1), agents: [agent] }) })
        const manager = createDiskManager(d)
        await manager.scan()
        expect((await manager.removeAll()).result).toEqual({
          status: 'failed',
          message:
            '작업 폴더를 모르는 에이전트가 있어 지우지 않았어요. 그 에이전트가 이 워크트리를 쓰고 있을 수 있어요.'
        })
        expect(d.confirm).not.toHaveBeenCalled()
      }, 60000)

      test('폴더를 못 지운 곳은 따로 알린다', async () => {
        const manager = createDiskManager(
          deps({
            removeDir: async () => {
              throw Object.assign(new Error('busy'), { code: 'EBUSY' })
            }
          })
        )
        await manager.scan()
        expect(await manager.removeAll()).toEqual({
          result: {
            status: 'failed',
            message: '1곳은 일부 폴더를 지우지 못했어요(파일을 쓰는 프로그램이 있을 수 있어요).'
          },
          removed: []
        })
        expect(manager.report().rows).toHaveLength(1)
      }, 60000)

      test('작업 폴더를 모두 확인할 수 없는 수집 방식이면 확인 창에 그 사실을 알린다', async () => {
        const confirm = vi.fn<(o: KillConfirm) => Promise<boolean>>(async () => false)
        const manager = createDiskManager(
          deps({ confirm, resample: async () => ({ processes: [], tcp: [], collectMode: 'safe' }) })
        )
        await manager.scan()
        await manager.removeAll()
        const box = confirm.mock.calls[0][0] as KillConfirm
        expect(box.detail).toContain('프로세스의 작업 폴더를 모두 확인할 수 없어')
      }, 60000)
    })
  })
})
