import * as fsp from 'fs/promises'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { createSessionFileReader, type ClaudeSessionFile } from './claudeSessionFiles'
import { claudeConfigDir } from './claudeHooks'
import { sampleWindows } from './collect/windows'
import { agentToolOf, topLevelAgentPids } from './processTree'

// 어떤 파일을 여는지 보려고 파일 열기를 감싼다(동작은 그대로).
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), readFile: vi.fn(actual.readFile) }
})

/** 프로세스(OS) 시작 시각. 세션 파일의 startedAt 은 이보다 0.5초쯤 늦다. */
const PROC_START = 1_794_274_275_500
const NOW = PROC_START + 60 * 60 * 1000

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pitwall-claude-sessions-'))
  vi.mocked(fsp.open).mockClear()
  vi.mocked(fsp.readFile).mockClear()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Claude Code 가 남기는 모양 그대로(쓰지 않는 칸 포함). */
function sessionJson(pid: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid,
    sessionId: `session-${pid}`,
    cwd: 'C:\\work\\shop-web',
    startedAt: PROC_START + 566,
    procStart: '134070678755000000',
    version: '2.1.321',
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'shop-web 로그인 고치기',
    nameSource: 'derived',
    nameSince: PROC_START + 566,
    status: 'idle',
    updatedAt: PROC_START + 7759,
    statusUpdatedAt: PROC_START + 7759,
    ...over
  }
}

async function put(name: string, body: unknown): Promise<void> {
  await writeFile(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
}

function agent(
  pid: number,
  startedAt: number | null = PROC_START
): { pid: number; startedAt: number | null } {
  return { pid, startedAt }
}
const agents = (...pids: number[]): { pid: number; startedAt: number | null }[] =>
  pids.map((pid) => agent(pid))

/** 이 테스트에서 열어 본 파일 이름(open·readFile). */
function opened(): string[] {
  return [...vi.mocked(fsp.open).mock.calls, ...vi.mocked(fsp.readFile).mock.calls]
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(dir))
    .map((path) => path.slice(dir.length + 1))
    .sort()
}

test('pid.json 에서 세션 id·상태·시각을 읽는다', async () => {
  await put('17536.json', sessionJson(17536))
  await put(
    '17600.json',
    sessionJson(17600, { status: 'busy', statusUpdatedAt: NOW - 1000, name: undefined })
  )
  const files = await createSessionFileReader({ dir }).read(agents(17536, 17600), NOW)
  expect(files).toEqual(
    new Map<number, ClaudeSessionFile>([
      [
        17536,
        {
          pid: 17536,
          sessionId: 'session-17536',
          status: 'idle',
          statusUpdatedAt: PROC_START + 7759,
          name: 'shop-web 로그인 고치기'
        }
      ],
      [
        17600,
        {
          pid: 17600,
          sessionId: 'session-17600',
          status: 'busy',
          statusUpdatedAt: NOW - 1000,
          name: null
        }
      ]
    ])
  )
})

test('.key 파일과 목록에 없는 pid 의 파일은 열지 않는다', async () => {
  await put('17536.json', sessionJson(17536))
  await put('17536.0f3a9c.key', sessionJson(17536, { sessionId: 'from-key' }))
  await put('20000.json', sessionJson(20000))
  const files = await createSessionFileReader({ dir }).read([agent(17536)], NOW)
  expect([...files.keys()]).toEqual([17536])
  expect(files.get(17536)?.sessionId).toBe('session-17536')
  expect(opened()).toEqual(['17536.json'])
})

test('파일의 pid 가 이름과 다르거나 시작 시각이 60초 넘게 다르면 버린다(다시 쓰인 pid)', async () => {
  await put('100.json', sessionJson(101))
  await put('102.json', sessionJson(102, { startedAt: PROC_START - 60_001 }))
  await put('103.json', sessionJson(103, { startedAt: PROC_START + 60_000 }))
  await put('104.json', sessionJson(104, { startedAt: undefined }))
  await put('105.json', sessionJson(105, { startedAt: String(PROC_START) }))
  await put('106.json', sessionJson(106))
  const reader = createSessionFileReader({ dir })
  const files = await reader.read([...agents(100, 102, 103, 104, 105), agent(106, null)], NOW)
  // 프로세스 시작 시각을 모르면(106) 어느 프로세스의 파일인지 알 수 없어 버린다.
  expect([...files.keys()]).toEqual([103])
  // 여유는 바꿀 수 있다.
  const strict = await createSessionFileReader({ dir, slackMs: 1000 }).read([agent(103)], NOW)
  expect(strict.size).toBe(0)
})

test('모르는 상태 글자는 null, 미래 시각은 null', async () => {
  await put('1.json', sessionJson(1, { status: 'waiting', statusUpdatedAt: NOW + 60_001 }))
  await put('2.json', sessionJson(2, { status: 'BUSY', statusUpdatedAt: NOW + 60_000 }))
  await put('3.json', sessionJson(3, { status: 7, statusUpdatedAt: String(NOW), name: 42 }))
  await put('4.json', sessionJson(4, { status: null, statusUpdatedAt: Number.NaN }))
  const files = await createSessionFileReader({ dir }).read(agents(1, 2, 3, 4), NOW)
  expect([...files.values()].map((f) => [f.pid, f.status, f.statusUpdatedAt, f.name])).toEqual([
    [1, null, null, 'shop-web 로그인 고치기'],
    // 지금보다 60초(여유)까지 뒤인 시각은 받는다(두 시계의 차이).
    [2, null, NOW + 60_000, 'shop-web 로그인 고치기'],
    [3, null, null, null],
    [4, null, null, 'shop-web 로그인 고치기']
  ])
})

test('깨진 JSON·너무 큰 파일은 그 pid 만 건너뛴다', async () => {
  await put('200.json', '{"pid": 200, "sessionId": "abc", ')
  // 64 KB 가 넘는 파일(긴 이름)은 읽지 않는다.
  await put('201.json', sessionJson(201, { name: 'x'.repeat(64 * 1024) }))
  await put('202.json', sessionJson(202))
  await put('203.json', '[1, 2]')
  await put('204.json', 'null')
  await put('205.json', sessionJson(205, { sessionId: 's'.repeat(201) }))
  await put('206.json', sessionJson(206, { sessionId: 206 }))
  await put('207.json', sessionJson(207, { sessionId: '' }))
  const files = await createSessionFileReader({ dir }).read(
    agents(200, 201, 202, 203, 204, 205, 206, 207, 208),
    NOW
  )
  expect([...files.keys()]).toEqual([202])
  // 크기 한도는 바꿀 수 있다.
  const small = await createSessionFileReader({ dir, maxBytes: 100 }).read([agent(202)], NOW)
  expect(small.size).toBe(0)
})

describe.runIf(process.platform === 'win32')('실제 Windows 에서', () => {
  test('실제 세션 폴더를 읽어도 예외가 없다(폴더가 없으면 빈 결과)', async () => {
    const real = join(claudeConfigDir(process.env, homedir()), 'sessions')
    const exists = await stat(real).then(
      (s) => s.isDirectory(),
      () => false
    )
    const sample = await sampleWindows()
    const byPid = new Map(sample.processes.map((p) => [p.pid, p]))
    const claudes = topLevelAgentPids(sample.processes).flatMap((pid) => {
      const p = byPid.get(pid)
      return p && agentToolOf(p) === 'claude' ? [{ pid, startedAt: p.startedAt }] : []
    })
    const files = await createSessionFileReader({ dir: real }).read(claudes, Date.now())
    // 세션 id·이름·경로는 출력에 남기지 않는다(개수·모양만 본다).
    if (!exists) expect(files.size).toBe(0)
    expect(files.size).toBeLessThanOrEqual(claudes.length)
    const wellFormed = [...files.entries()].every(
      ([pid, f]) =>
        f.pid === pid &&
        claudes.some((c) => c.pid === pid) &&
        typeof f.sessionId === 'string' &&
        f.sessionId.length > 0 &&
        (f.status === null || f.status === 'idle' || f.status === 'busy') &&
        (f.statusUpdatedAt === null || Number.isFinite(f.statusUpdatedAt)) &&
        (f.name === null || typeof f.name === 'string')
    )
    expect(wellFormed).toBe(true)
    // 실제 폴더에서도 .key 파일은 열지 않는다.
    expect(
      [...vi.mocked(fsp.open).mock.calls, ...vi.mocked(fsp.readFile).mock.calls].some(([path]) =>
        /\.key$/i.test(String(path))
      )
    ).toBe(false)
    // 없는 폴더는 빈 결과.
    const missing = createSessionFileReader({ dir: join(dir, 'no-such-dir') })
    expect((await missing.read([agent(process.pid, Date.now())], Date.now())).size).toBe(0)
  }, 30000)
})
