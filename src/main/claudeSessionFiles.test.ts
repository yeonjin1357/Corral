import * as fsp from 'fs/promises'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  createSessionFileReader,
  fileStateOver,
  waitReasonOf,
  type ClaudeSessionFile
} from './claudeSessionFiles'
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
          waitingFor: null,
          name: 'shop-web 로그인 고치기',
          nameSource: 'derived'
        }
      ],
      [
        17600,
        {
          pid: 17600,
          sessionId: 'session-17600',
          status: 'busy',
          statusUpdatedAt: NOW - 1000,
          waitingFor: null,
          name: null,
          nameSource: 'derived'
        }
      ]
    ])
  )
})

test('nameSource 를 읽는다(문자열이 아니면 null)', async () => {
  await put('1.json', sessionJson(1, { nameSource: 'user' }))
  await put('2.json', sessionJson(2, { nameSource: undefined }))
  await put('3.json', sessionJson(3, { nameSource: 7 }))
  await put('4.json', sessionJson(4, { nameSource: 'x'.repeat(41) }))
  await put('5.json', sessionJson(5, { nameSource: '' }))
  await put('6.json', sessionJson(6, { nameSource: 'y'.repeat(40) }))
  const files = await createSessionFileReader({ dir }).read(agents(1, 2, 3, 4, 5, 6), NOW)
  expect([...files.values()].map((f) => [f.pid, f.nameSource])).toEqual([
    [1, 'user'],
    [2, null],
    [3, null],
    // 40자를 넘거나 빈 글은 모양이 다른 것으로 본다.
    [4, null],
    [5, null],
    [6, 'y'.repeat(40)]
  ])
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

test('모르는 상태 글자는 null(지어내지 않음), 미래 시각은 null', async () => {
  await put('1.json', sessionJson(1, { status: 'paused', statusUpdatedAt: NOW + 60_001 }))
  await put('2.json', sessionJson(2, { status: 'BUSY', statusUpdatedAt: NOW + 60_000 }))
  await put('3.json', sessionJson(3, { status: 7, statusUpdatedAt: String(NOW), name: 42 }))
  await put('4.json', sessionJson(4, { status: null, statusUpdatedAt: Number.NaN }))
  await put('5.json', sessionJson(5, { status: 'Waiting', waitingFor: 'input needed' }))
  await put('6.json', sessionJson(6, { status: ' shell' }))
  const files = await createSessionFileReader({ dir }).read(agents(1, 2, 3, 4, 5, 6), NOW)
  expect([...files.values()].map((f) => [f.pid, f.status, f.statusUpdatedAt, f.name])).toEqual([
    [1, null, null, 'shop-web 로그인 고치기'],
    // 지금보다 60초(여유)까지 뒤인 시각은 받는다(두 시계의 차이).
    [2, null, NOW + 60_000, 'shop-web 로그인 고치기'],
    [3, null, null, null],
    [4, null, null, 'shop-web 로그인 고치기'],
    // 아는 네 글자(busy·shell·idle·waiting)와 대소문자·공백까지 같을 때만.
    [5, null, PROC_START + 7759, 'shop-web 로그인 고치기'],
    [6, null, PROC_START + 7759, 'shop-web 로그인 고치기']
  ])
})

test('status shell 은 쉬는 중으로 읽는다', async () => {
  await put('1.json', sessionJson(1, { status: 'shell', statusUpdatedAt: NOW - 5000 }))
  const files = await createSessionFileReader({ dir }).read(agents(1), NOW)
  const file = files.get(1)!
  expect(file).toMatchObject({ status: 'shell', statusUpdatedAt: NOW - 5000, waitingFor: null })
  // 턴이 끝나 쉬는 중이다(띄운 백그라운드 셸이 돌고 있을 뿐).
  expect(fileStateOver(file, null)).toBe('idle')
})

test('status waiting 과 waitingFor 를 읽는다', async () => {
  await put(
    '1.json',
    sessionJson(1, {
      status: 'waiting',
      waitingFor: 'permission prompt',
      statusUpdatedAt: NOW - 1000
    })
  )
  await put('2.json', sessionJson(2, { status: 'waiting', waitingFor: 'input needed' }))
  // waitingFor 가 없어도 상태는 읽는다(이유는 모름).
  await put('3.json', sessionJson(3, { status: 'waiting' }))
  const files = await createSessionFileReader({ dir }).read(agents(1, 2, 3), NOW)
  expect(
    [...files.values()].map((f) => [f.pid, f.status, f.waitingFor, f.statusUpdatedAt])
  ).toEqual([
    [1, 'waiting', 'permission prompt', NOW - 1000],
    [2, 'waiting', 'input needed', PROC_START + 7759],
    [3, 'waiting', null, PROC_START + 7759]
  ])
})

test('waitingFor 가 문자열이 아니거나 40자를 넘으면 null', async () => {
  const cases: unknown[] = [7, '', 'x'.repeat(41), ['input needed'], { what: 'input needed' }, null]
  for (const [i, waitingFor] of cases.entries())
    await put(`${i + 1}.json`, sessionJson(i + 1, { status: 'waiting', waitingFor }))
  await put('20.json', sessionJson(20, { status: 'waiting', waitingFor: 'y'.repeat(40) }))
  const pids = [...cases.keys()].map((i) => i + 1)
  const files = await createSessionFileReader({ dir }).read(agents(...pids, 20), NOW)
  expect([...files.values()].map((f) => [f.pid, f.status, f.waitingFor])).toEqual([
    ...pids.map((pid) => [pid, 'waiting', null]),
    [20, 'waiting', 'y'.repeat(40)]
  ])
})

test('waitReasonOf: 알려진 값 다섯 가지와 dialog, 그 밖은 other', () => {
  expect(
    [
      'permission prompt',
      'input needed',
      'sandbox request',
      'worker request',
      'goal proposal',
      'dialog open',
      'Permission Prompt',
      'something new',
      // 객체가 물려받은 이름도 모르는 글자다.
      'constructor',
      null
    ].map(waitReasonOf)
  ).toEqual([
    'permission',
    'input',
    'sandbox',
    'worker',
    'goal',
    'dialog',
    'other',
    'other',
    'other',
    'other'
  ])
})

describe('fileStateOver', () => {
  const fileOf = (over: Partial<ClaudeSessionFile> = {}): ClaudeSessionFile => ({
    pid: 1,
    sessionId: 's1',
    status: 'idle',
    statusUpdatedAt: NOW,
    waitingFor: null,
    name: null,
    nameSource: null,
    ...over
  })

  test('fileStateOver: waiting(permission prompt) 은 입력 대기, waiting(dialog open) 은 쉬는 중', () => {
    const waiting = (waitingFor: string | null): ClaudeSessionFile =>
      fileOf({ status: 'waiting', waitingFor })
    expect(fileStateOver(waiting('permission prompt'), null)).toBe('waiting')
    expect(fileStateOver(waiting('input needed'), null)).toBe('waiting')
    // 모르는 이유도 기다림이다(이유만 모른다).
    expect(fileStateOver(waiting('something new'), null)).toBe('waiting')
    expect(fileStateOver(waiting(null), null)).toBe('waiting')
    // 사용자가 직접 연 창(슬래시 명령 등)일 수 있어 기다림으로 알리지 않는다.
    expect(fileStateOver(waiting('dialog open'), null)).toBe('idle')
    // 지금까지처럼: busy 는 작업 중, idle 은 쉬는 중, 상태를 모르면 따르지 않는다.
    expect(fileStateOver(fileOf({ status: 'busy' }), null)).toBe('working')
    expect(fileStateOver(fileOf({ status: 'idle' }), null)).toBe('idle')
    expect(fileStateOver(fileOf({ status: null }), null)).toBeNull()
  })

  test('fileStateOver: 훅이 더 늦으면 파일의 waiting 을 따르지 않는다', () => {
    const file = fileOf({ status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: NOW })
    // 훅이 더 늦거나 5초 안이면 훅(같은 때 권한 대기를 알렸으면 도구 이름을 아는 훅이 이긴다).
    expect(fileStateOver(file, { state: 'working', lastActivityAt: NOW + 1000 })).toBeNull()
    expect(fileStateOver(file, { state: 'waiting', lastActivityAt: NOW - 5000 })).toBeNull()
    // 파일이 5초를 넘게 늦으면 파일.
    expect(fileStateOver(file, { state: 'working', lastActivityAt: NOW - 5001 })).toBe('waiting')
    expect(fileStateOver(file, { state: 'idle', lastActivityAt: NOW - 5001 })).toBe('waiting')
    // 상태 시각을 모르는 파일은 훅보다 늦은지 알 수 없다.
    expect(
      fileStateOver({ ...file, statusUpdatedAt: null }, { state: 'idle', lastActivityAt: 0 })
    ).toBeNull()
  })

  test('fileStateOver: 훅이 권한 대기면 파일의 shell 도 따르지 않는다', () => {
    const hook = { state: 'waiting' as const, lastActivityAt: NOW - 60_000 }
    // 쉬는 중으로 읽는 것(idle·shell·dialog open)은 아무리 늦어도 따르지 않는다.
    expect(fileStateOver(fileOf({ status: 'shell' }), hook)).toBeNull()
    expect(fileStateOver(fileOf({ status: 'idle' }), hook)).toBeNull()
    expect(fileStateOver(fileOf({ status: 'waiting', waitingFor: 'dialog open' }), hook)).toBeNull()
    // 더 늦은 busy(새 턴)·waiting 은 따른다.
    expect(fileStateOver(fileOf({ status: 'busy' }), hook)).toBe('working')
    expect(
      fileStateOver(fileOf({ status: 'waiting', waitingFor: 'permission prompt' }), hook)
    ).toBe('waiting')
    // 훅이 권한 대기가 아니면 더 늦은 shell 은 쉬는 중이다.
    expect(fileStateOver(fileOf({ status: 'shell' }), { ...hook, state: 'working' })).toBe('idle')
  })
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
        (f.status === null || ['idle', 'busy', 'shell', 'waiting'].includes(f.status)) &&
        (f.waitingFor === null ||
          (typeof f.waitingFor === 'string' && f.waitingFor.length <= 40)) &&
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
