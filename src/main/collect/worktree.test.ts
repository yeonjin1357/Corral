import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractPathCandidates, createWorktreeResolver } from './worktree'
import type { ProcessInfo } from '../../shared/types'

describe('extractPathCandidates', () => {
  test('따옴표·섞인 슬래시·node_modules 앞에서 자르기·인자 무시', () => {
    const cl =
      '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\김개발\\work\\shop-web\\node_modules\\.bin/../vite/bin/vite.js --port=3000'
    expect(extractPathCandidates(cl)).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Users\\김개발\\work\\shop-web'
    ])
    expect(
      extractPathCandidates('/usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite')
    ).toEqual(['/usr/local/bin/node', '/Users/dev/work/shop-web'])
    expect(extractPathCandidates('claude')).toEqual([])
  })

  test('--옵션=경로 의 값도 후보', () => {
    expect(extractPathCandidates('node --config=C:\\work\\shop-web\\vite.config.ts')).toEqual([
      'C:\\work\\shop-web\\vite.config.ts'
    ])
    expect(extractPathCandidates('vite "--root=/Users/dev/My App"')).toEqual(['/Users/dev/My App'])
  })

  test('작은따옴표는 묶음 기호가 아니라 경로 글자다(Windows 명령줄·macOS ps 출력 모두)', () => {
    expect(extractPathCandidates("node C:\\Users\\O'Neil\\work\\app\\server.js")).toEqual([
      "C:\\Users\\O'Neil\\work\\app\\server.js"
    ])
    expect(extractPathCandidates("\"C:\\Users\\O'Neil\\My App\\node_modules\\.bin\\vite\"")).toEqual(
      ["C:\\Users\\O'Neil\\My App"]
    )
    expect(extractPathCandidates("/usr/local/bin/node /Users/o'neil/app/server.js")).toEqual([
      '/usr/local/bin/node',
      "/Users/o'neil/app/server.js"
    ])
  })

  test('네트워크(UNC)·WSL 경로는 건너뛴다(응답 없는 드라이브에 막히지 않도록)', () => {
    expect(
      extractPathCandidates(
        'node \\\\wsl.localhost\\Ubuntu\\home\\dev\\app\\server.js \\\\nas\\share\\x.js'
      )
    ).toEqual([])
  })

  test('소문자 드라이브·.. 정리·중복 제거', () => {
    expect(
      extractPathCandidates('c:\\work\\a\\..\\shop-web\\run.js C:\\work\\shop-web\\run.js')
    ).toEqual(['C:\\work\\shop-web\\run.js'])
  })
})

describe('createWorktreeResolver', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pitwall-wt-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  async function makeRepo(dir: string, head = 'ref: refs/heads/develop\n'): Promise<string> {
    await mkdir(join(dir, '.git'), { recursive: true })
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, '.git', 'HEAD'), head)
    return dir
  }

  test('메인 체크아웃: .git 폴더 + 브랜치', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(join(repo, 'src'))).toEqual({
      root: repo,
      branch: 'develop',
      isLinkedWorktree: false
    })
  })

  test('연결된 worktree: .git 파일의 gitdir 을 따라가 HEAD 읽기', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const gitdir = join(repo, '.git', 'worktrees', 'wt-a')
    await mkdir(gitdir, { recursive: true })
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/feat/a\n')
    const wt = join(tmp, 'wt-a')
    await mkdir(wt)
    await writeFile(join(wt, '.git'), `gitdir: ${gitdir}\n`)
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(wt)).toEqual({
      root: wt,
      branch: 'feat/a',
      isLinkedWorktree: true
    })
  })

  test('상대 경로 gitdir 도 따라간다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const gitdir = join(repo, '.git', 'worktrees', 'wt-b')
    await mkdir(gitdir, { recursive: true })
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/feat/b\n')
    const wt = join(tmp, 'wt-b')
    await mkdir(wt)
    await writeFile(join(wt, '.git'), 'gitdir: ../shop-web/.git/worktrees/wt-b\n')
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(wt)).toEqual({
      root: wt,
      branch: 'feat/b',
      isLinkedWorktree: true
    })
  })

  test('서브모듈은 연결된 worktree 가 아니다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const gitdir = join(repo, '.git', 'modules', 'lib')
    await mkdir(gitdir, { recursive: true })
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/main\n')
    const sub = join(repo, 'lib')
    await mkdir(sub)
    await writeFile(join(sub, '.git'), 'gitdir: ../.git/modules/lib\n')
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(sub)).toEqual({
      root: sub,
      branch: 'main',
      isLinkedWorktree: false
    })
  })

  test('detached HEAD 는 branch null', async () => {
    const repo = await makeRepo(join(tmp, 'detached'), '3f2a9c0d1e2b3a4f5a6b7c8d9e0f1a2b3c4d5e6f\n')
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect((await resolveWorktree(repo))?.branch).toBeNull()
  })

  test('HEAD 를 읽을 수 없어도 저장소로는 판별(branch null)', async () => {
    const dir = join(tmp, 'nohead')
    await mkdir(join(dir, '.git'), { recursive: true })
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(dir)).toEqual({ root: dir, branch: null, isLinkedWorktree: false })
  })

  test('git 이 없으면 null', async () => {
    const plain = join(tmp, 'plain', 'a')
    await mkdir(plain, { recursive: true })
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect(await resolveWorktree(plain)).toBeNull()
  })

  test('한글 폴더명 저장소도 해석', async () => {
    const koreanRepo = await makeRepo(join(tmp, '김개발', 'shop-web'))
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect((await resolveWorktree(join(koreanRepo, 'src')))?.root).toBe(koreanRepo)
  })

  test('홈 폴더 자체가 git 저장소(dotfiles)여도 그 아래 전역 도구를 거기 소속으로 보지 않는다', async () => {
    const home = await makeRepo(join(tmp, 'home'))
    const npmGlobal = join(home, 'AppData', 'Roaming', 'npm')
    await mkdir(npmGlobal, { recursive: true })
    const nested = await makeRepo(join(home, 'work', 'shop-web'))
    const { resolveWorktree } = createWorktreeResolver({ homeDir: home })
    expect(await resolveWorktree(npmGlobal)).toBeNull()
    expect((await resolveWorktree(nested))?.root).toBe(nested)
  })

  test('존재하지 않는 파일 경로도 상위 폴더로 올라가며 찾는다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const { resolveWorktree } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    expect((await resolveWorktree(join(repo, 'src', 'gone', 'server.js')))?.root).toBe(repo)
  })

  test('캐시는 ttl 동안만 유지되어 브랜치 전환이 반영된다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    let now = 1000
    const { resolveWorktree } = createWorktreeResolver({
      homeDir: join(tmp, 'home'),
      ttlMs: 15000,
      now: () => now
    })
    expect((await resolveWorktree(repo))?.branch).toBe('develop')
    await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    now += 14999
    expect((await resolveWorktree(repo))?.branch).toBe('develop')
    now += 2
    expect((await resolveWorktree(repo))?.branch).toBe('main')
  })

  test('resolveProcessWorktrees: 후보를 순서대로 시도해 처음 판별된 것을 쓴다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const proc = (pid: number, commandLine: string): ProcessInfo => ({
      pid,
      ppid: 1,
      name: 'node',
      commandLine,
      memoryBytes: 1,
      startedAt: null
    })
    const { resolveProcessWorktrees } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    const map = await resolveProcessWorktrees([
      proc(
        1,
        `"${join(tmp, 'plain', 'node.exe')}" "${join(repo, 'node_modules', '.bin', 'vite')}"`
      ),
      proc(2, 'claude'),
      proc(3, `"${join(tmp, 'nowhere', 'x.js')}"`)
    ])
    expect([...map.keys()]).toEqual([1])
    expect(map.get(1)?.root).toBe(repo)
  })

  test('명령줄에 경로가 없으면 작업 폴더(cwd)로 판별하고, 명령줄 경로가 있으면 그것을 먼저 쓴다', async () => {
    const repo = await makeRepo(join(tmp, 'shop-web'))
    const other = await makeRepo(join(tmp, 'other'))
    const proc = (pid: number, commandLine: string): ProcessInfo => ({
      pid,
      ppid: 1,
      name: 'node',
      commandLine,
      memoryBytes: 1,
      startedAt: null
    })
    const { resolveProcessWorktrees } = createWorktreeResolver({ homeDir: join(tmp, 'home') })
    const map = await resolveProcessWorktrees(
      [
        proc(1, 'node server.js'),
        proc(2, `node "${join(other, 'server.js')}"`),
        proc(3, 'python app.py')
      ],
      { 1: repo + '\\', 2: repo, 3: '\\\\wsl.localhost\\Ubuntu\\home\\dev' }
    )
    expect(map.get(1)?.root).toBe(repo)
    expect(map.get(2)?.root).toBe(other)
    expect(map.has(3)).toBe(false)
  })
})
