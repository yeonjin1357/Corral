import { appendFile, mkdir, mkdtemp, open, rm, writeFile, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  codexHome,
  createCodexReader,
  findRollout,
  readRolloutState,
  rolloutState
} from './codexRollout'

/** 잠깐의 실패(EBUSY 등)를 흉내 낸다(파일 열기만). 나머지는 진짜 fs. */
const fsControl = vi.hoisted(() => ({ failWith: null as string | null }))
vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>()
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      if (fsControl.failWith)
        throw Object.assign(new Error(fsControl.failWith), { code: fsControl.failWith })
      return real.open(...args)
    }
  }
})
beforeEach(() => {
  fsControl.failWith = null
})

const CWD = 'C:\\work\\shop-web'
const MIN = 60_000

function line(type: string, payload: Record<string, unknown>, t: string): string {
  return JSON.stringify({ timestamp: t, type, payload })
}
const event = (kind: string, t: string, extra: Record<string, unknown> = {}): string =>
  line('event_msg', { type: kind, ...extra }, t)

describe('rolloutState', () => {
  test('task_started 뒤 끝 이벤트가 없으면 작업 중', () => {
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('task_complete', '2026-11-09T01:01:00.000Z'),
        event('task_started', '2026-11-09T01:05:00.000Z')
      ])
    ).toEqual({
      state: 'working',
      since: Date.parse('2026-11-09T01:05:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:05:00.000Z')
    })
  })

  test('task_complete 면 쉬는 중, error 가 있으면 오류', () => {
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('task_complete', '2026-11-09T01:02:00.000Z', { last_agent_message: 'done' })
      ])
    ).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:02:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:02:00.000Z')
    })
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('task_complete', '2026-11-09T01:02:00.000Z', { error: { message: 'quota' } })
      ])
    ).toEqual({
      state: 'error',
      since: Date.parse('2026-11-09T01:02:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:02:00.000Z')
    })
  })

  test('turn_aborted 는 쉬는 중', () => {
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('turn_aborted', '2026-11-09T01:00:30.000Z', { reason: 'interrupted' })
      ])
    ).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:00:30.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:00:30.000Z')
    })
  })

  test('대화 내용 필드는 읽은 결과에 남지 않고, 대화 속 글자는 이벤트로 치지 않는다', () => {
    const secret = '비밀 대화 "type":"task_started"'
    const r = rolloutState([
      event('task_started', '2026-11-09T01:00:00.000Z'),
      line(
        'response_item',
        { type: 'message', content: [{ text: secret }] },
        '2026-11-09T01:00:01.000Z'
      ),
      event('task_complete', '2026-11-09T01:00:02.000Z', { last_agent_message: secret }),
      line(
        'response_item',
        { type: 'message', content: [{ text: secret }] },
        '2026-11-09T01:00:03.000Z'
      )
    ])
    expect(r).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:00:02.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:00:02.000Z')
    })
    expect(JSON.stringify(r)).not.toContain('비밀')
  })

  test('lastEventAt 은 읽은 이벤트 가운데 가장 늦은 시각(앞서 읽은 상태에서 이어 간다)', () => {
    // 줄 순서와 시각이 어긋나도(늦게 쓰인 이른 이벤트) 가장 늦은 시각을 쓴다.
    const first = rolloutState([
      event('task_started', '2026-11-09T01:05:00.000Z'),
      event('task_complete', '2026-11-09T01:04:00.000Z')
    ])
    expect(first).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:04:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:05:00.000Z')
    })
    // 덧붙은 줄에 이벤트가 없으면 그대로, 있으면 새 시각.
    expect(rolloutState([line('response_item', { type: 'message' }, 'x')], first)).toEqual(first)
    expect(
      rolloutState([event('task_started', '2026-11-09T02:00:00.000Z')], first)?.lastEventAt
    ).toBe(Date.parse('2026-11-09T02:00:00.000Z'))
  })

  test('근거가 없거나 깨진 줄뿐이면 null', () => {
    expect(rolloutState([])).toBeNull()
    expect(rolloutState(['{not json', line('session_meta', { cwd: CWD }, 'x')])).toBeNull()
  })
})

describe('기록 파일 찾기·읽기', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pitwall-codex-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const pad = (n: number): string => String(n).padStart(2, '0')
  /** Codex 처럼 로컬 시각으로 날짜 폴더·파일 이름을 만든다. */
  async function rollout(
    at: Date,
    cwd: string,
    body: string[] = [],
    ext = '.jsonl'
  ): Promise<string> {
    const dir = join(
      home,
      'sessions',
      String(at.getFullYear()),
      pad(at.getMonth() + 1),
      pad(at.getDate())
    )
    await mkdir(dir, { recursive: true })
    const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
    const path = join(dir, `rollout-${stamp}-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b${ext}`)
    const meta = line('session_meta', { id: 'x', cwd, instructions: '긴 안내문' }, at.toISOString())
    await writeFile(path, [meta, ...body].join('\n') + '\n')
    return path
  }

  test('작업 폴더·시작 시각이 맞는 파일 중 가장 최근 것을 고른다', async () => {
    const start = new Date(2026, 10, 9, 10, 0, 0)
    await rollout(new Date(2026, 10, 9, 9, 50, 0), CWD) // 프로세스 시작 전(예전 세션)
    await rollout(new Date(2026, 10, 9, 10, 1, 0), 'C:\\work\\api') // 다른 폴더
    const first = await rollout(new Date(2026, 10, 9, 10, 2, 0), CWD)
    const latest = await rollout(new Date(2026, 10, 9, 10, 30, 0), 'c:/WORK/shop-web/')
    const now = start.getTime() + 40 * MIN
    expect(first).not.toBe(latest)
    expect(await findRollout(home, { cwd: CWD, startedAt: start.getTime() }, now)).toBe(latest)
  })

  test('자정을 넘겨 실행 중인 세션도 시작한 날 폴더에서 찾는다', async () => {
    const start = new Date(2026, 10, 8, 23, 50, 0)
    const path = await rollout(new Date(2026, 10, 8, 23, 55, 0), CWD)
    const now = new Date(2026, 10, 9, 0, 30, 0).getTime()
    expect(await findRollout(home, { cwd: CWD, startedAt: start.getTime() }, now)).toBe(path)
  })

  test('기록 파일이 없거나(첫 입력 전) 압축됐거나 시작 시각을 모르면 null', async () => {
    const start = new Date(2026, 10, 9, 10, 0, 0)
    const now = start.getTime() + 10 * MIN
    expect(await findRollout(home, { cwd: CWD, startedAt: start.getTime() }, now)).toBeNull()
    await rollout(new Date(2026, 10, 9, 10, 1, 0), CWD, [], '.jsonl.zst')
    expect(await findRollout(home, { cwd: CWD, startedAt: start.getTime() }, now)).toBeNull()
    await rollout(new Date(2026, 10, 9, 10, 1, 0), CWD)
    expect(await findRollout(home, { cwd: CWD, startedAt: null }, now)).toBeNull()
  })

  test('파일 끝 64KB 만 읽어 상태를 안다(앞의 잘린 줄은 버린다)', async () => {
    const at = new Date(2026, 10, 9, 10, 1, 0)
    const filler = Array.from({ length: 400 }, (_, i) =>
      line(
        'response_item',
        { type: 'message', content: [{ text: 'x'.repeat(300) + i }] },
        at.toISOString()
      )
    )
    const path = await rollout(at, CWD, [
      event('task_started', '2026-11-09T01:00:00.000Z'),
      ...filler,
      event('task_complete', '2026-11-09T01:09:00.000Z')
    ])
    expect(await readRolloutState(path)).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:09:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:09:00.000Z')
    })
    expect(await readRolloutState(join(home, 'none.jsonl'))).toBeNull()
  })

  test('읽기 도구: 맞는 파일이 없으면 null, 있으면 그 상태', async () => {
    const start = new Date(2026, 10, 9, 10, 0, 0)
    const reader = createCodexReader(home)
    const agent = { cwd: CWD, startedAt: start.getTime() }
    expect(await reader.stateFor(agent, start.getTime() + MIN)).toBeNull()
    await rollout(new Date(2026, 10, 9, 10, 1, 0), CWD, [
      event('task_started', '2026-11-09T01:01:05.000Z')
    ])
    expect(await reader.stateFor(agent, start.getTime() + 2 * MIN)).toEqual({
      state: 'working',
      since: Date.parse('2026-11-09T01:01:05.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:01:05.000Z')
    })
  })

  test('auth.json 은 열지 않는다(세션 폴더만 본다)', async () => {
    await writeFile(join(home, 'auth.json'), '{"secret":true}')
    const start = new Date(2026, 10, 9, 10, 0, 0)
    // 세션 폴더가 없으면 아무것도 읽지 않고 null.
    expect(
      await findRollout(home, { cwd: CWD, startedAt: start.getTime() }, start.getTime())
    ).toBeNull()
  })
})

test('Codex 폴더: CODEX_HOME 이 있으면 그것, 없으면 홈의 .codex', () => {
  expect(codexHome({ CODEX_HOME: 'D:\\codex' }, 'C:\\Users\\dev')).toBe('D:\\codex')
  expect(codexHome({}, '/Users/dev')).toBe(join('/Users/dev', '.codex'))
})

describe('검토 뒤 보강(긴 턴·다른 프로세스의 기록)', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pitwall-codex-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })
  const pad = (n: number): string => String(n).padStart(2, '0')
  async function rolloutAt(at: Date, body: string[]): Promise<string> {
    const dir = join(
      home,
      'sessions',
      String(at.getFullYear()),
      pad(at.getMonth() + 1),
      pad(at.getDate())
    )
    await mkdir(dir, { recursive: true })
    const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
    const path = join(dir, `rollout-${stamp}-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl`)
    const meta = line('session_meta', { id: 'x', cwd: CWD }, at.toISOString())
    await writeFile(path, [meta, ...body].join('\n') + '\n')
    return path
  }
  const big = (n: number): string[] =>
    Array.from({ length: n }, (_, i) =>
      line(
        'response_item',
        { type: 'function_call_output', output: 'y'.repeat(1000) + i },
        '2026-11-09T01:00:01.000Z'
      )
    )

  test('긴 턴(64KB 넘는 기록)에서도 작업 중을 잃지 않고, 덧붙은 부분만 이어 읽는다', async () => {
    const start = new Date(2026, 10, 9, 10, 0, 0)
    const path = await rolloutAt(new Date(2026, 10, 9, 10, 1, 0), [
      event('task_started', '2026-11-09T01:00:00.000Z'),
      ...big(200)
    ])
    const reader = createCodexReader(home)
    const agent = { cwd: CWD, startedAt: start.getTime() }
    expect(await reader.stateFor(agent, start.getTime() + 5 * MIN)).toEqual({
      state: 'working',
      since: Date.parse('2026-11-09T01:00:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:00:00.000Z')
    })
    await appendFile(
      path,
      [...big(100), event('task_complete', '2026-11-09T01:20:00.000Z')].join('\n') + '\n'
    )
    expect(await reader.stateFor(agent, start.getTime() + 25 * MIN)).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-09T01:20:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T01:20:00.000Z')
    })
  })

  test('훅이 알려 준 기록 파일이 있으면 그 파일을 읽는다(같은 폴더의 다른 파일을 고르지 않는다)', async () => {
    const start = new Date(2026, 10, 9, 11, 0, 0)
    const own = await rolloutAt(new Date(2026, 10, 9, 11, 1, 0), [
      event('task_started', '2026-11-09T02:01:00.000Z')
    ])
    // 같은 폴더에서 나중에 만들어진 다른 기록(끝난 턴) — 찾기 규칙으로는 이쪽이 골라질 수 있다.
    await rolloutAt(new Date(2026, 10, 9, 11, 2, 0), [
      event('task_complete', '2026-11-09T02:03:00.000Z')
    ])
    const reader = createCodexReader(home)
    const agent = { cwd: CWD, startedAt: start.getTime(), transcriptPath: own }
    expect(await reader.stateFor(agent, start.getTime() + 5 * MIN)).toEqual({
      state: 'working',
      since: Date.parse('2026-11-09T02:01:00.000Z'),
      lastEventAt: Date.parse('2026-11-09T02:01:00.000Z')
    })
  })

  test.runIf(process.platform === 'win32')(
    '\\\\?\\ 로 시작하는 Windows 경로도 sessions 폴더 안이면 읽는다',
    async () => {
      const start = new Date(2026, 10, 9, 13, 0, 0)
      const own = await rolloutAt(new Date(2026, 10, 9, 13, 1, 0), [
        event('task_started', '2026-11-09T04:01:00.000Z')
      ])
      await rolloutAt(new Date(2026, 10, 9, 13, 2, 0), [
        event('task_complete', '2026-11-09T04:03:00.000Z')
      ])
      const reader = createCodexReader(home)
      const agent = { cwd: CWD, startedAt: start.getTime(), transcriptPath: '\\\\?\\' + own }
      expect((await reader.stateFor(agent, start.getTime() + 5 * MIN))?.state).toBe('working')
    }
  )

  test('sessions 폴더 안의 링크가 밖을 가리키면 따르지 않는다', async () => {
    const start = new Date(2026, 10, 9, 14, 0, 0)
    await rolloutAt(new Date(2026, 10, 9, 14, 1, 0), [
      event('task_complete', '2026-11-09T05:02:00.000Z')
    ])
    const outsideDir = join(home, 'outside')
    await mkdir(outsideDir, { recursive: true })
    await writeFile(
      join(outsideDir, 'x.jsonl'),
      event('task_started', '2026-11-09T05:01:00.000Z') + '\n'
    )
    const link = join(home, 'sessions', 'link')
    await symlink(outsideDir, link, 'junction')
    const reader = createCodexReader(home)
    const agent = { cwd: CWD, startedAt: start.getTime(), transcriptPath: join(link, 'x.jsonl') }
    expect((await reader.stateFor(agent, start.getTime() + 5 * MIN))?.state).toBe('idle')
  })

  test('sessions 폴더 밖의 경로는 따르지 않고 찾기 규칙을 쓴다', async () => {
    const start = new Date(2026, 10, 9, 12, 0, 0)
    await rolloutAt(new Date(2026, 10, 9, 12, 1, 0), [
      event('task_complete', '2026-11-09T03:02:00.000Z')
    ])
    const outside = join(home, 'elsewhere.jsonl')
    await writeFile(outside, event('task_started', '2026-11-09T03:01:00.000Z') + '\n')
    const reader = createCodexReader(home)
    const agent = { cwd: CWD, startedAt: start.getTime(), transcriptPath: outside }
    expect((await reader.stateFor(agent, start.getTime() + 5 * MIN))?.state).toBe('idle')
  })

  test('다른 Codex 프로세스가 살아 있던 동안 만든 기록 파일은 고르지 않는다(그 프로세스 것일 수 있다)', async () => {
    const start = new Date(2026, 10, 9, 9, 0, 0)
    const own = await rolloutAt(new Date(2026, 10, 9, 9, 1, 0), [
      event('task_complete', '2026-11-09T00:02:00.000Z')
    ])
    // 09:30~09:40 에 같은 폴더에서 돌다 꺼진 다른 Codex 의 파일(작업 중에 강제 종료).
    await rolloutAt(new Date(2026, 10, 9, 9, 31, 0), [
      event('task_started', '2026-11-09T00:31:00.000Z')
    ])
    const other = {
      from: new Date(2026, 10, 9, 9, 30, 0).getTime(),
      to: new Date(2026, 10, 9, 9, 40, 0).getTime()
    }
    const now = new Date(2026, 10, 9, 10, 0, 0).getTime()
    expect(
      await findRollout(home, { cwd: CWD, startedAt: start.getTime(), exclude: [other] }, now)
    ).toBe(own)
  })
})

describe('토큰·사용 한도(G6)', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pitwall-codex-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })
  const pad = (n: number): string => String(n).padStart(2, '0')
  async function rolloutAt(at: Date, body: string[]): Promise<string> {
    const dir = join(
      home,
      'sessions',
      String(at.getFullYear()),
      pad(at.getMonth() + 1),
      pad(at.getDate())
    )
    await mkdir(dir, { recursive: true })
    const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
    const path = join(dir, `rollout-${stamp}-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl`)
    const meta = line('session_meta', { id: 'x', cwd: CWD }, at.toISOString())
    await writeFile(path, [meta, ...body].join('\n') + '\n')
    return path
  }
  const tokenCount = (t: string, info: unknown, rateLimits: unknown): string =>
    event('token_count', t, { info, rate_limits: rateLimits })
  /** 실제 모양의 token_count 값. */
  const INFO = {
    total_token_usage: {
      input_tokens: 666008,
      cached_input_tokens: 590720,
      output_tokens: 2954,
      reasoning_output_tokens: 801,
      total_tokens: 668962
    },
    last_token_usage: {
      input_tokens: 75923,
      cached_input_tokens: 75392,
      output_tokens: 243,
      reasoning_output_tokens: 179,
      total_tokens: 76166
    },
    model_context_window: 258400
  }
  const LIMITS = {
    primary: { used_percent: 14, window_minutes: 300, resets_at: 1794227066 },
    secondary: { used_percent: 31, window_minutes: 10080, resets_at: 1794447205 },
    plan_type: 'plus'
  }
  const start = new Date(2026, 10, 10, 9, 0, 0)
  const agent = { cwd: CWD, startedAt: start.getTime() }
  const now = start.getTime() + 10 * MIN

  test('token_count 에서 합계·컨텍스트·한도를 읽는다', async () => {
    const path = await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      tokenCount('2026-11-10T00:01:30.000Z', null, {
        ...LIMITS,
        primary: { ...LIMITS.primary, used_percent: 10 }
      }),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS),
      // 내용·한도가 빈 이벤트는 알던 값을 지우지 않는다.
      tokenCount('2026-11-10T00:02:10.000Z', null, null),
      event('task_complete', '2026-11-10T00:03:00.000Z')
    ])
    const reader = createCodexReader(home)
    const state = {
      state: 'idle' as const,
      since: Date.parse('2026-11-10T00:03:00.000Z'),
      lastEventAt: Date.parse('2026-11-10T00:03:00.000Z')
    }
    expect(await reader.infoFor(agent, now)).toEqual({
      state,
      usage: {
        contextTokens: 76166,
        contextWindow: 258400,
        outputTokens: 2954,
        totalTokens: 668962,
        model: null
      },
      limits: {
        primary: { usedPercent: 14, windowMinutes: 300, resetsAt: 1794227066000 },
        secondary: { usedPercent: 31, windowMinutes: 10080, resetsAt: 1794447205000 },
        planType: 'plus',
        at: Date.parse('2026-11-10T00:02:00.000Z')
      }
    })
    // 상태만 묻는 쪽은 지금처럼 상태만.
    expect(await reader.stateFor(agent, now)).toEqual(state)

    // 늦게 쓰인 더 이른 시각의 한도는 덮어쓰지 않는다. 모양이 다른 값은 0 이 아니라 없음.
    await appendFile(
      path,
      [
        tokenCount('2026-11-10T00:01:00.000Z', null, {
          ...LIMITS,
          primary: { ...LIMITS.primary, used_percent: 99 }
        }),
        tokenCount(
          '2026-11-10T00:04:00.000Z',
          { ...INFO, last_token_usage: null, model_context_window: 'big' },
          {
            primary: { used_percent: '50', window_minutes: 300 },
            secondary: { used_percent: 40, window_minutes: 10080 },
            plan_type: 7
          }
        )
      ].join('\n') + '\n'
    )
    expect(await reader.infoFor(agent, now)).toEqual({
      state,
      usage: {
        contextTokens: null,
        contextWindow: null,
        outputTokens: 2954,
        totalTokens: 668962,
        model: null
      },
      limits: {
        primary: null,
        secondary: { usedPercent: 40, windowMinutes: 10080, resetsAt: null },
        planType: null,
        at: Date.parse('2026-11-10T00:04:00.000Z')
      }
    })
  })

  test('usage 를 끄면 token_count 를 읽지 않는다', async () => {
    await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS)
    ])
    let on = false
    const reader = createCodexReader(home, { usage: () => on })
    const working = {
      state: 'working' as const,
      since: Date.parse('2026-11-10T00:01:00.000Z'),
      lastEventAt: Date.parse('2026-11-10T00:01:00.000Z')
    }
    const parse = vi.spyOn(JSON, 'parse')
    try {
      expect(await reader.infoFor(agent, now)).toEqual({
        state: working,
        usage: null,
        limits: null
      })
      // token_count 줄은 JSON 으로 읽어 보지도 않는다.
      expect(parse.mock.calls.some(([raw]) => String(raw).includes('token_count'))).toBe(false)
    } finally {
      parse.mockRestore()
    }
    // 켜면 처음부터 다시 읽어 숫자를 안다.
    on = true
    expect(await reader.infoFor(agent, now)).toMatchObject({
      state: working,
      usage: { totalTokens: 668962 },
      limits: { planType: 'plus' }
    })
    // 다시 끄면 알던 숫자도 버린다(상태는 그대로).
    on = false
    expect(await reader.infoFor(agent, now)).toEqual({ state: working, usage: null, limits: null })
  })

  test('dropUsage 는 들고 있던 숫자를 바로 버린다(다시 필요하면 처음부터 읽는다)', async () => {
    const path = await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS)
    ])
    const reader = createCodexReader(home)
    expect((await reader.infoFor(agent, now)).usage?.totalTokens).toBe(668962)
    // 이미 읽은 숫자를 같은 길이로 바꿔 둔다: 들고 있던 숫자를 쓰면 옛 값, 버렸으면 다시 읽어 새 값.
    await rewrite(path, '668962', '668963')
    expect((await reader.infoFor(agent, now)).usage?.totalTokens).toBe(668962)
    reader.dropUsage()
    expect((await reader.infoFor(agent, now)).usage?.totalTokens).toBe(668963)
  })

  test('잠깐 읽지 못하면(EBUSY 등) 알던 상태·숫자를 둔다', async () => {
    const path = await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS)
    ])
    const reader = createCodexReader(home)
    const known = await reader.infoFor(agent, now)
    expect(known.state?.state).toBe('working')
    await appendFile(path, event('task_complete', '2026-11-10T00:03:00.000Z') + '\n')
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      fsControl.failWith = code
      expect(await reader.infoFor(agent, now), code).toEqual(known)
    }
    fsControl.failWith = null
    expect(await reader.infoFor(agent, now)).toMatchObject({
      state: { state: 'idle' },
      usage: { totalTokens: 668962 }
    })
  })

  /** 상태 이벤트가 아닌 긴 기록 줄(대화). */
  const filler = (n: number): string[] =>
    Array.from({ length: n }, (_, i) =>
      line(
        'response_item',
        { type: 'message', content: [{ text: 'x'.repeat(100) + i }] },
        '2026-11-10T00:01:30.000Z'
      )
    )

  test('처음 읽을 때 큰 기록은 끝 firstReadBytes 만 읽는다(창 앞의 상태는 모른다)', async () => {
    const path = await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      ...filler(30),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS)
    ])
    const reader = createCodexReader(home, { firstReadBytes: 1024 })
    const info = await reader.infoFor(agent, now)
    expect(info.state).toBeNull()
    expect(info.usage?.totalTokens).toBe(668962)
    // 그 뒤로는 덧붙은 만큼 이어 읽는다.
    await appendFile(path, event('task_complete', '2026-11-10T00:03:00.000Z') + '\n')
    expect((await reader.infoFor(agent, now)).state?.state).toBe('idle')
  })

  test('끝에서 읽기 시작하는 자리가 줄 처음이면 그 줄도 읽고, 숫자를 다시 켜도 끝만 다시 읽는다', async () => {
    const last = event('task_complete', '2026-11-10T00:09:00.000Z')
    await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      ...filler(30),
      tokenCount('2026-11-10T00:02:00.000Z', INFO, LIMITS),
      last
    ])
    let on = false
    // 창 = 마지막 줄 + 줄바꿈: 창의 첫 바이트가 바로 그 줄의 처음이다.
    const reader = createCodexReader(home, {
      usage: () => on,
      firstReadBytes: Buffer.byteLength(last) + 1
    })
    const idle = {
      state: 'idle' as const,
      since: Date.parse('2026-11-10T00:09:00.000Z'),
      lastEventAt: Date.parse('2026-11-10T00:09:00.000Z')
    }
    expect(await reader.infoFor(agent, now)).toEqual({ state: idle, usage: null, limits: null })
    // 숫자를 켜면 처음부터 다시 읽되 그때도 끝만(창 앞의 token_count 는 모른다).
    on = true
    expect(await reader.infoFor(agent, now)).toEqual({ state: idle, usage: null, limits: null })
  })

  test('덜 쓴 마지막 줄은 들고 있지 않는다(다음에 그 처음부터 다시 읽는다)', async () => {
    const before = event('task_complete', '2026-11-10T00:05:00.000Z')
    const after = event('task_complete', '2026-11-10T00:06:00.000Z')
    const path = await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z')
    ])
    // 줄바꿈 없이 끝난 마지막 줄(쓰는 중).
    await appendFile(path, before)
    const reader = createCodexReader(home)
    expect((await reader.infoFor(agent, now)).state?.state).toBe('working')
    // 그 자리를 같은 길이의 다른 바이트로 바꾸고 줄을 끝낸다: 새 바이트만 읽는다.
    await rewrite(path, before, after)
    await appendFile(path, '\n')
    expect((await reader.infoFor(agent, now)).state).toEqual({
      state: 'idle',
      since: Date.parse('2026-11-10T00:06:00.000Z'),
      lastEventAt: Date.parse('2026-11-10T00:06:00.000Z')
    })
  })

  test('한도(32 MB)보다 긴 한 줄은 건너뛴다(작은 한도로 시험)', async () => {
    await rolloutAt(new Date(2026, 10, 10, 9, 1, 0), [
      event('task_started', '2026-11-10T00:01:00.000Z'),
      event('task_complete', '2026-11-10T00:02:00.000Z', { last_agent_message: 'x'.repeat(2000) })
    ])
    const reader = createCodexReader(home, { maxLineBytes: 512, chunkBytes: 128 })
    expect((await reader.infoFor(agent, now)).state).toEqual({
      state: 'working',
      since: Date.parse('2026-11-10T00:01:00.000Z'),
      lastEventAt: Date.parse('2026-11-10T00:01:00.000Z')
    })
  })
})

/** 파일 안의 글자를 같은 길이의 다른 글자로 바꿔 쓴다(크기는 그대로). */
async function rewrite(path: string, from: string, to: string): Promise<void> {
  expect(Buffer.byteLength(to)).toBe(Buffer.byteLength(from))
  const handle = await open(path, 'r+')
  try {
    const text = (await handle.readFile()).toString('utf8')
    const at = text.indexOf(from)
    expect(at).toBeGreaterThanOrEqual(0)
    await handle.write(to, Buffer.byteLength(text.slice(0, at)))
  } finally {
    await handle.close()
  }
}
