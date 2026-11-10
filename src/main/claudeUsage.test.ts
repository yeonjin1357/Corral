import { appendFile, mkdir, mkdtemp, open, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addUsageLine,
  createClaudeUsageReader,
  createTally,
  createUsageCache,
  tallyUsage,
  type ClaudeUsageReader
} from './claudeUsage'
import type { AgentUsage } from '../shared/types'

const MIN = 60 * 1000
const SESSION = '0199a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b'

/** Claude Code 기록의 응답 줄 모양(내용 블록마다 한 줄 — 같은 message.id 와 usage 가 되풀이된다). */
function reply(o: {
  id?: unknown
  output?: unknown
  input?: unknown
  created?: unknown
  read?: unknown
  model?: string
  sidechain?: boolean
  text?: string
}): string {
  const has = (k: keyof typeof o): boolean => k in o
  return JSON.stringify({
    parentUuid: null,
    isSidechain: o.sidechain ?? false,
    type: 'assistant',
    sessionId: SESSION,
    timestamp: '2026-11-10T01:00:00.000Z',
    message: {
      id: has('id') ? o.id : 'msg_1',
      model: o.model ?? 'claude-test-1',
      role: 'assistant',
      content: [{ type: 'text', text: o.text ?? 'hello' }],
      usage: {
        input_tokens: has('input') ? o.input : 2,
        cache_creation_input_tokens: has('created') ? o.created : 100,
        cache_read_input_tokens: has('read') ? o.read : 1000,
        output_tokens: has('output') ? o.output : 10,
        service_tier: 'standard'
      }
    }
  })
}

/** 사용자 요청 줄. */
const prompt = (text: string): string =>
  JSON.stringify({
    type: 'user',
    isSidechain: false,
    sessionId: SESSION,
    message: { role: 'user', content: text }
  })

/** 대기 중인 프로미스 콜백을 모두 돌린다. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('Claude 세션 기록에서 토큰 숫자 읽기(G6)', () => {
  let home: string
  let projects: string
  let project: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pitwall-usage-'))
    projects = join(home, 'projects')
    project = join(projects, 'C--work-shop-web')
    await mkdir(project, { recursive: true })
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  async function transcript(lines: string[], name = SESSION, dir = project): Promise<string> {
    const path = join(dir, `${name}.jsonl`)
    await writeFile(path, lines.map((l) => l + '\n').join(''))
    return path
  }

  test('같은 message.id 는 마지막 값 하나로 출력 합을 센다', async () => {
    const path = await transcript([
      reply({ id: 'msg_1', output: 1 }),
      reply({ id: 'msg_1', output: 30 }),
      reply({ id: 'msg_1', output: 30 }),
      prompt('hello'),
      reply({ id: 'msg_2', output: 5 }),
      reply({ id: 'msg_2', output: 12 })
    ])
    const reader = createClaudeUsageReader({ projectsDir: projects })
    expect((await reader.usageFor(path))?.outputTokens).toBe(42)
  })

  test('컨텍스트는 사이드체인이 아닌 마지막 요청의 입력 + 캐시', async () => {
    const path = await transcript([
      reply({ id: 'msg_1', input: 2, created: 100, read: 1000, model: 'claude-a', output: 10 }),
      reply({ id: 'msg_2', input: 3, created: 50, read: 2000, model: 'claude-b', output: 20 }),
      // 하위 에이전트(사이드체인)의 요청은 이 세션의 컨텍스트가 아니다(출력 합에는 든다).
      reply({
        id: 'msg_3',
        input: 9,
        created: 9,
        read: 9,
        model: 'claude-small',
        output: 5,
        sidechain: true
      })
    ])
    const reader = createClaudeUsageReader({ projectsDir: projects })
    expect(await reader.usageFor(path)).toEqual<AgentUsage>({
      contextTokens: 2053,
      contextWindow: null,
      outputTokens: 35,
      totalTokens: null,
      model: 'claude-b'
    })
  })

  test('덧붙은 줄만 더 읽는다', async () => {
    const first = reply({ id: 'msg_1', output: 10, read: 1000 })
    const path = await transcript([first])
    const reader = createClaudeUsageReader({ projectsDir: projects })
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 1102, outputTokens: 10 })

    // 이미 읽은 부분을 같은 길이로 바꿔 둔다: 처음부터 다시 읽으면 바뀐 숫자가 보인다.
    const changed = reply({ id: 'msg_1', output: 90, read: 9000 })
    expect(changed.length).toBe(first.length)
    const handle = await open(path, 'r+')
    await handle.write(changed, 0)
    await handle.close()
    // 크기가 같으면 다시 읽지 않는다.
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 1102, outputTokens: 10 })

    // 덜 쓴 마지막 줄은 줄바꿈이 올 때까지 세지 않는다(잃지도 않는다).
    const next = reply({ id: 'msg_2', output: 7, read: 3000 })
    await appendFile(path, next.slice(0, 40))
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 1102, outputTokens: 10 })
    await appendFile(path, next.slice(40) + '\n')
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 3102, outputTokens: 17 })

    // 파일이 줄면(다시 씀) 처음부터 읽는다.
    await writeFile(path, reply({ id: 'msg_9', output: 3, read: 10 }) + '\n')
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 112, outputTokens: 3 })
  })

  test('projectsDir 밖의 경로·.jsonl 이 아닌 경로는 열지 않는다', async () => {
    const lines = [reply({ id: 'msg_1' })]
    const reader = createClaudeUsageReader({ projectsDir: projects })
    // 안의 .jsonl 은 읽는다.
    expect(await reader.usageFor(await transcript(lines))).not.toBeNull()
    // .jsonl 이 아닌 파일.
    const notes = join(project, 'notes.txt')
    await writeFile(notes, lines.join('\n') + '\n')
    expect(await reader.usageFor(notes)).toBeNull()
    // 밖의 파일, 이름이 projects 로 시작하는 옆 폴더, .. 로 빠져나가는 경로, 상대 경로.
    const outside = join(home, 'outside')
    await mkdir(outside)
    expect(await reader.usageFor(await transcript(lines, 'x', outside))).toBeNull()
    const sibling = join(home, 'projects-other')
    await mkdir(sibling)
    expect(await reader.usageFor(await transcript(lines, 'y', sibling))).toBeNull()
    expect(await reader.usageFor(join(projects, '..', 'outside', 'x.jsonl'))).toBeNull()
    expect(await reader.usageFor('x.jsonl')).toBeNull()
    // 안의 링크가 밖을 가리키면 따르지 않는다.
    await symlink(outside, join(projects, 'link'), 'junction')
    expect(await reader.usageFor(join(projects, 'link', 'x.jsonl'))).toBeNull()
  })

  test('usage 가 없거나 모양이 다르면 null(지어내지 않음)', async () => {
    const reader = createClaudeUsageReader({ projectsDir: projects })
    const read = async (name: string, lines: string[]): Promise<AgentUsage | null> =>
      reader.usageFor(await transcript(lines, name))
    // 응답 줄이 없다(요청·깨진 줄뿐).
    expect(await read('a1', [prompt('hello'), '{"usage": broken'])).toBeNull()
    // 숫자가 아닌 값은 0 이 아니라 없음: 문자열·음수·무한대.
    expect(await read('a2', [reply({ output: '10', input: '5' })])).toBeNull()
    expect(await read('a3', [reply({ output: -1, read: -5 })])).toBeNull()
    expect(
      await read('a4', [
        reply({ output: 0, read: 0 })
          .replace('"output_tokens":0', '"output_tokens":1e400')
          .replace('"cache_read_input_tokens":0', '"cache_read_input_tokens":1e400')
      ])
    ).toBeNull()
    // 캐시 값이 빠진 줄은 컨텍스트(와 그 모델)를 모르지만 출력은 센다.
    expect(await read('a5', [reply({ created: undefined, output: 7 })])).toEqual({
      contextTokens: null,
      contextWindow: null,
      outputTokens: 7,
      totalTokens: null,
      model: null
    })
    // message.id 가 없으면 출력은 세지 않는다(같은 응답을 여러 번 셀 수 있다).
    expect(await read('a6', [reply({ id: undefined }), reply({ id: 7 })])).toMatchObject({
      contextTokens: 1102,
      outputTokens: null
    })
    // usage 가 객체가 아니거나 응답 줄이 아니면 쓰지 않는다.
    const counts = {
      input_tokens: 1,
      cache_creation_input_tokens: 1,
      cache_read_input_tokens: 1,
      output_tokens: 1
    }
    expect(
      await read('a7', [
        JSON.stringify({ type: 'assistant', message: { id: 'm', usage: 5 } }),
        JSON.stringify({ type: 'user', message: { id: 'm', usage: counts } }),
        JSON.stringify({ type: 'assistant', message: 'x', usage: counts })
      ])
    ).toBeNull()
    // 없는 파일.
    expect(await reader.usageFor(join(project, 'none.jsonl'))).toBeNull()
  })

  test('64 MB 보다 크면 끝만 읽고 출력 합은 null', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => prompt('x'.repeat(100) + i))
    const path = await transcript([
      reply({ id: 'msg_old', read: 1, model: 'claude-old' }),
      ...filler,
      reply({ id: 'msg_new', read: 5000, model: 'claude-new' })
    ])
    // 작은 한도로 시험한다: 4 KB 를 넘으면 끝 1 KB 만.
    const reader = createClaudeUsageReader({
      projectsDir: projects,
      maxFullBytes: 4096,
      tailBytes: 1024
    })
    expect(await reader.usageFor(path)).toEqual<AgentUsage>({
      contextTokens: 5102,
      contextWindow: null,
      outputTokens: null,
      totalTokens: null,
      model: 'claude-new'
    })
    // 그 뒤에 덧붙은 줄도 이어 읽는다(출력 합은 여전히 모른다).
    await appendFile(path, reply({ id: 'msg_more', read: 6000 }) + '\n')
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 6102, outputTokens: null })
  })

  test('한 줄이 한도(32 MB)보다 길면 그 줄만 건너뛴다(작은 한도로 시험)', async () => {
    const path = await transcript([
      reply({ id: 'msg_1', output: 1 }),
      reply({ id: 'msg_2', output: 2, read: 3, text: 'y'.repeat(5000) }),
      reply({ id: 'msg_3', output: 4, read: 7 }),
      prompt('z'.repeat(3000))
    ])
    // 덩어리(256 바이트)보다 긴 보통 줄도 이어 붙여 읽는다.
    const reader = createClaudeUsageReader({
      projectsDir: projects,
      chunkBytes: 256,
      maxLineBytes: 2048
    })
    expect(await reader.usageFor(path)).toMatchObject({ contextTokens: 109, outputTokens: 5 })
  })

  test('message.id 는 상한(5만 개)까지 기억하고, 넘으면 오래된 id 를 잊되 그 출력은 합에 남긴다', async () => {
    const path = await transcript([
      reply({ id: 'a', output: 1 }),
      reply({ id: 'b', output: 2 }),
      reply({ id: 'c', output: 3 }),
      reply({ id: 'c', output: 4 })
    ])
    const reader = createClaudeUsageReader({ projectsDir: projects, maxIds: 2 })
    expect((await reader.usageFor(path))?.outputTokens).toBe(7)
  })

  test('결과에 대화 내용이 남지 않는다', async () => {
    const secret = '비밀 대화'
    const lines = [
      prompt(secret),
      reply({ id: 'msg_1', text: secret }),
      // usage 가 있어 읽어 보는 줄이어도 응답 줄이 아니면 버린다.
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: secret }], usage: { secret } }
      })
    ]
    const reader = createClaudeUsageReader({ projectsDir: projects })
    const usage = await reader.usageFor(await transcript(lines))
    expect(usage).not.toBeNull()
    expect(JSON.stringify(usage)).not.toContain('비밀')
    // 읽어 두는 것(파일마다의 집계)도 숫자·메시지 id·모델 이름뿐이다.
    const tally = createTally(true)
    for (const line of lines) addUsageLine(tally, line)
    expect(JSON.stringify({ ...tally, outputs: [...(tally.outputs ?? [])] })).not.toContain('비밀')
    expect(tallyUsage(tally)).toEqual(usage)
  })

  test('세션 id 로 projects 아래의 기록 파일을 찾고 기억한다(id 모양이 다르면 찾지 않는다)', async () => {
    const api = join(projects, 'C--work-api')
    await mkdir(api)
    const path = await transcript([reply({})], SESSION, api)
    const reader = createClaudeUsageReader({ projectsDir: projects })
    expect(await reader.transcriptFor(SESSION)).toBe(path)
    for (const bad of ['', 'abc', 'x'.repeat(10), '../' + SESSION, SESSION + '/..', '*'])
      expect(await reader.transcriptFor(bad)).toBeNull()
    // 기억한 파일이 없어지면 다시 찾는다.
    await rm(path)
    const moved = await transcript([reply({})], SESSION, project)
    expect(await reader.transcriptFor(SESSION)).toBe(moved)
    await rm(moved)
    expect(await reader.transcriptFor(SESSION)).toBeNull()
    // projects 폴더가 없어도 null.
    const none = createClaudeUsageReader({ projectsDir: join(home, 'none') })
    expect(await none.transcriptFor(SESSION)).toBeNull()
  })
})

describe('토큰 숫자 기억(수집을 기다리게 하지 않는다)', () => {
  const U = (n: number): AgentUsage => ({
    contextTokens: n,
    contextWindow: null,
    outputTokens: null,
    totalTokens: null,
    model: null
  })

  /** 바깥에서 끝낼 수 있는 읽기(읽기 시작한 경로를 순서대로 담는다). */
  function fakeReader(): {
    reader: ClaudeUsageReader
    started: string[]
    finish: (index: number, value: AgentUsage | null) => void
  } {
    const started: string[] = []
    const resolvers: ((value: AgentUsage | null) => void)[] = []
    return {
      started,
      finish: (index, value) => resolvers[index](value),
      reader: {
        usageFor: (path) =>
          new Promise((resolve) => {
            started.push(path)
            resolvers.push(resolve)
          }),
        transcriptFor: vi.fn(async (id: string) => `/p/${id}.jsonl`),
        forget: vi.fn(),
        clear: vi.fn()
      }
    }
  }

  test('get 은 기다리지 않고 기억한 값을, want 는 뒤에서 한 번에 하나씩 읽는다', async () => {
    const clock = { now: 0 }
    const f = fakeReader()
    const cache = createUsageCache({ reader: f.reader, now: () => clock.now })
    const targets = [
      { sessionId: 'a', transcriptPath: '/given/a.jsonl' },
      { sessionId: 'b', transcriptPath: null }
    ]
    cache.want(targets)
    await settle()
    expect(f.started).toEqual(['/given/a.jsonl'])
    expect(cache.get('a')).toBeNull()
    // 읽는 중·줄 선 것은 다시 줄 세우지 않는다(한 수집 주기에 한 번).
    cache.want(targets)
    f.finish(0, U(1))
    await settle()
    expect(cache.get('a')).toEqual(U(1))
    // 기록 경로를 모르면 세션 id 로 찾아 읽는다.
    expect(f.reader.transcriptFor).toHaveBeenCalledWith('b')
    expect(f.started).toEqual(['/given/a.jsonl', '/p/b.jsonl'])
    f.finish(1, U(2))
    await settle()
    expect(cache.get('b')).toEqual(U(2))
    // 다시 읽는 동안에도 기억한 값을 준다.
    cache.want(targets)
    await settle()
    expect(f.started).toHaveLength(3)
    expect(cache.get('a')).toEqual(U(1))
    f.finish(2, U(3))
    await settle()
    expect(cache.get('a')).toEqual(U(3))
  })

  test('30분 동안 찾지 않은 세션은 잊고, 읽기 도구에서도 버린다', async () => {
    const clock = { now: 0 }
    const f = fakeReader()
    const cache = createUsageCache({ reader: f.reader, now: () => clock.now })
    cache.want([{ sessionId: 'a', transcriptPath: '/given/a.jsonl' }])
    f.finish(0, U(1))
    await settle()
    clock.now += 30 * MIN
    cache.want([])
    expect(cache.get('a')).toEqual(U(1))
    clock.now += 1
    cache.want([])
    expect(cache.get('a')).toBeNull()
    expect(f.reader.forget).toHaveBeenCalledWith('/given/a.jsonl')
  })

  test('clear 는 기억과 줄 선 읽기를 모두 버린다(읽던 결과도 남기지 않는다)', async () => {
    const f = fakeReader()
    const cache = createUsageCache({ reader: f.reader, now: () => 0 })
    cache.want([
      { sessionId: 'a', transcriptPath: '/given/a.jsonl' },
      { sessionId: 'b', transcriptPath: '/given/b.jsonl' }
    ])
    await settle()
    cache.clear()
    expect(f.reader.clear).toHaveBeenCalled()
    f.finish(0, U(1))
    await settle()
    expect(cache.get('a')).toBeNull()
    // 줄 서 있던 b 는 읽지 않는다.
    expect(f.started).toEqual(['/given/a.jsonl'])
  })
})
