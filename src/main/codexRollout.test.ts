import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  codexHome,
  createCodexReader,
  findRollout,
  readRolloutState,
  rolloutState
} from './codexRollout'

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
    ).toEqual({ state: 'working', since: Date.parse('2026-11-09T01:05:00.000Z') })
  })

  test('task_complete 면 쉬는 중, error 가 있으면 오류', () => {
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('task_complete', '2026-11-09T01:02:00.000Z', { last_agent_message: 'done' })
      ])
    ).toEqual({ state: 'idle', since: Date.parse('2026-11-09T01:02:00.000Z') })
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('task_complete', '2026-11-09T01:02:00.000Z', { error: { message: 'quota' } })
      ])
    ).toEqual({ state: 'error', since: Date.parse('2026-11-09T01:02:00.000Z') })
  })

  test('turn_aborted 는 쉬는 중', () => {
    expect(
      rolloutState([
        event('task_started', '2026-11-09T01:00:00.000Z'),
        event('turn_aborted', '2026-11-09T01:00:30.000Z', { reason: 'interrupted' })
      ])
    ).toEqual({ state: 'idle', since: Date.parse('2026-11-09T01:00:30.000Z') })
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
    expect(r).toEqual({ state: 'idle', since: Date.parse('2026-11-09T01:00:02.000Z') })
    expect(JSON.stringify(r)).not.toContain('비밀')
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
      since: Date.parse('2026-11-09T01:09:00.000Z')
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
      since: Date.parse('2026-11-09T01:01:05.000Z')
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
