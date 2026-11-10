import { activityOf, judgeServers, type ServerMemo } from './judge'
import type { AgentRow, ServerRow, TcpEntry, WorktreeInfo } from '../shared/types'

const MIN = 60 * 1000
const THRESHOLD = 20 * MIN
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }
const W2: WorktreeInfo = { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true }

function server(overrides: Partial<ServerRow> = {}): ServerRow {
  return {
    ports: [3000],
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: W1,
    workspace: null,
    unresolvable: false,
    memoryBytes: 1,
    descendantPids: [],
    processes: [],
    clientCount: 0,
    startedAt: 100,
    judgement: null,
    idleSince: null,
    agentInWorktree: false,
    cpuPercent: null,
    memoryGrowth: null,
    ...overrides
  }
}

function agent(worktree: WorktreeInfo | null, tool: AgentRow['tool'] = 'claude'): AgentRow {
  return {
    pid: 5000,
    tool,
    worktree,
    workspace: null,
    startedAt: 1,
    memoryBytes: 1,
    descendantCount: 0,
    processes: [],
    state: 'idle',
    stateSource: 'cpu',
    stateSince: null,
    cpuPercent: 0
  }
}

/** 같은 상태로 여러 샘플을 흘려보낸다. */
function over(
  times: number[],
  rows: (t: number) => ServerRow[],
  agents: AgentRow[] = []
): ReturnType<typeof judgeServers> {
  let memo: ServerMemo = new Map()
  let result!: ReturnType<typeof judgeServers>
  for (const t of times) {
    result = judgeServers(rows(t), agents, memo, t, THRESHOLD)
    memo = result.memo
  }
  return result
}

test('에이전트 없고 연결 0 이 기준 시간 이상이면 정리 후보, 그 전에는 판단 없음', () => {
  const before = over([0, 10 * MIN, 20 * MIN - 1], () => [server()])
  expect(before.rows[0]).toMatchObject({ judgement: null, idleSince: 0, agentInWorktree: false })
  const after = over([0, 10 * MIN, 20 * MIN], () => [server()])
  expect(after.rows[0]).toMatchObject({ judgement: 'candidate', idleSince: 0 })
})

test('에이전트 없고 탭만 연결된 상태가 기준 시간 이상이면 확인해볼 것', () => {
  const r = over([0, 20 * MIN], () => [server({ clientCount: 2 })])
  expect(r.rows[0]).toMatchObject({ judgement: 'check', idleSince: 0 })
})

test('연결 수가 바뀌어도(1→3) 탭만 열린 상태는 이어지고, 연결 0 ↔ 있음이 바뀌면 다시 센다', () => {
  const same = over([0, 10 * MIN, 20 * MIN], (t) => [
    server({ clientCount: t === 10 * MIN ? 3 : 1 })
  ])
  expect(same.rows[0].judgement).toBe('check')
  const switched = over([0, 10 * MIN, 20 * MIN], (t) => [
    server({ clientCount: t === 10 * MIN ? 1 : 0 })
  ])
  expect(switched.rows[0]).toMatchObject({ judgement: null, idleSince: 20 * MIN })
})

test('같은 워크트리에 에이전트가 있으면(쉬는 중이어도) 판단하지 않고, 떠나면 처음부터 센다', () => {
  const withAgent = over([0, 30 * MIN], () => [server()], [agent(W1, 'codex')])
  expect(withAgent.rows[0]).toMatchObject({
    judgement: null,
    idleSince: null,
    agentInWorktree: true
  })
  let memo = withAgent.memo
  const left = judgeServers([server()], [], memo, 31 * MIN, THRESHOLD)
  expect(left.rows[0]).toMatchObject({ judgement: null, idleSince: 31 * MIN })
  memo = left.memo
  expect(judgeServers([server()], [], memo, 51 * MIN, THRESHOLD).rows[0].judgement).toBe(
    'candidate'
  )
})

test('워크트리 비교는 대소문자·끝 구분자를 무시한다(Windows·macOS)', () => {
  const r = over([0, 30 * MIN], () => [server()], [agent({ ...W1, root: 'c:\\WORK\\shop-web\\' })])
  expect(r.rows[0].agentInWorktree).toBe(true)
})

test('다른 워크트리의 에이전트는 상관없다', () => {
  const r = over([0, 30 * MIN], () => [server()], [agent(W2)])
  expect(r.rows[0]).toMatchObject({ judgement: 'candidate', agentInWorktree: false })
})

test('판별 불가 서버는 판단하지 않고 기록하지도 않는다', () => {
  const r = over([0, 30 * MIN], () => [server({ worktree: null, unresolvable: true })])
  expect(r.rows[0]).toMatchObject({ judgement: null, idleSince: null, agentInWorktree: false })
  expect(r.memo.size).toBe(0)
})

test('같은 서버라도 프로세스가 다시 뜨면(시작 시각 다름) 처음부터 센다', () => {
  const r = over([0, 10 * MIN, 20 * MIN], (t) => [server({ startedAt: t < 10 * MIN ? 100 : 999 })])
  expect(r.rows[0]).toMatchObject({ judgement: null, idleSince: 10 * MIN })
})

test('기록은 지금 있는 서버만 남긴다', () => {
  const first = judgeServers(
    [server(), server({ ports: [3001], pid: 4200 })],
    [],
    new Map(),
    0,
    THRESHOLD
  )
  expect(first.memo.size).toBe(2)
  expect(judgeServers([server()], [], first.memo, MIN, THRESHOLD).memo.size).toBe(1)
})

test('입력 행은 바꾸지 않는다', () => {
  const row = server()
  judgeServers([row], [], new Map(), 0, THRESHOLD)
  expect(row.idleSince).toBeNull()
})

test('워크트리를 모르는 에이전트가 하나라도 있으면 정리 후보를 확인해볼 것으로 낮춘다(그 에이전트의 서버일 수 있음)', () => {
  const r = over([0, 30 * MIN], () => [server()], [agent(W2), agent(null)])
  expect(r.rows[0]).toMatchObject({ judgement: 'check', agentInWorktree: false })
  const noUnknown = over([0, 30 * MIN], () => [server()], [agent(W2)])
  expect(noUnknown.rows[0].judgement).toBe('candidate')
})

test('에이전트가 상위 저장소에서 일하면(하위 저장소를 다룸) 하위 저장소 서버도 에이전트가 있는 것으로 본다', () => {
  const nested = {
    root: 'C:\\work\\shop-web\\vendor\\api',
    branch: 'main',
    isLinkedWorktree: false
  }
  const r = over([0, 30 * MIN], () => [server({ worktree: nested })], [agent(W1)])
  expect(r.rows[0]).toMatchObject({ judgement: null, agentInWorktree: true })
})

test('기억 키는 서버 선택 키(server:<pid>:<시작 시각>)', () => {
  const r = judgeServers([server()], [], new Map(), 0, THRESHOLD)
  expect([...r.memo.keys()]).toEqual(['server:4100:100'])
})

describe('사용 흔적(F9)', () => {
  const KEY = 'server:4100:100'
  function tcp(
    state: TcpEntry['state'],
    local: [string, number],
    remote: [string, number],
    pid = 4100
  ): TcpEntry {
    return {
      pid,
      localAddress: local[0],
      localPort: local[1],
      remoteAddress: remote[0],
      remotePort: remote[1],
      state
    }
  }
  /** 샘플마다 흔적을 계산해 판단에 넘긴다(수집기와 같은 순서). */
  function run(
    samples: { t: number; tcp: TcpEntry[]; clients: number }[]
  ): ReturnType<typeof judgeServers> {
    let memo: ServerMemo = new Map()
    let connections = new Map<string, Set<string>>()
    let result!: ReturnType<typeof judgeServers>
    for (const sample of samples) {
      const row = server({ clientCount: sample.clients })
      const traces = activityOf([row], sample.tcp, connections)
      connections = traces.connections
      result = judgeServers([row], [], memo, sample.t, THRESHOLD, traces.activity)
      memo = result.memo
    }
    return result
  }

  test('연결 0 이어도 TIME_WAIT 흔적이 있으면 정리 후보 시간을 다시 센다', () => {
    // Windows 는 TIME_WAIT 의 소유 pid 가 0 이라 서버 포트로 맞춘다.
    const closed = tcp('TimeWait', ['::1', 3000], ['::1', 51000], 0)
    const r = run([
      { t: 0, tcp: [], clients: 0 },
      { t: 15 * MIN, tcp: [closed], clients: 0 },
      { t: 30 * MIN, tcp: [], clients: 0 }
    ])
    expect(r.rows[0]).toMatchObject({ judgement: null, idleSince: 15 * MIN })
  })

  test('클라이언트 쪽에 남은 TIME_WAIT(같은 PC 에서 연결을 먼저 닫음)도 흔적', () => {
    const clientSide = tcp('TimeWait', ['127.0.0.1', 51000], ['127.0.0.1', 3000], 0)
    expect(activityOf([server()], [clientSide], new Map()).activity.get(KEY)).toBe(true)
    // 다른 PC 의 3000 번 포트로 나간 연결은 이 서버와 상관없다.
    const outbound = tcp('TimeWait', ['10.0.0.5', 51000], ['10.0.0.9', 3000], 0)
    expect(activityOf([server()], [outbound], new Map()).activity.get(KEY)).toBe(false)
  })

  test('서버를 이루는 포트 프로세스끼리의 루프백 연결은 사용 흔적이 아니다(앱 창 같은 다른 자식은 흔적)', () => {
    const row = server({ ports: [3000, 3001], descendantPids: [4101, 4102] })
    const serverSide = tcp('Established', ['::1', 3000], ['::1', 51000], 4100)
    const childListens = tcp('Listen', ['::', 3001], ['::', 0], 4101)
    const ownChild = tcp('Established', ['::1', 51000], ['::1', 3000], 4101)
    // 이전 샘플에 연결이 없던 서버: 새 상대가 생기면 흔적이다.
    const seen = (): Map<string, Set<string>> => new Map([[KEY, new Set<string>()]])
    const own = activityOf([row], [serverSide, childListens, ownChild], seen())
    expect(own.connections.get(KEY)).toEqual(new Set())
    expect(own.activity.get(KEY)).toBe(false)
    const browser = tcp('Established', ['::1', 51000], ['::1', 3000], 9999)
    expect(activityOf([row], [serverSide, browser], seen()).activity.get(KEY)).toBe(true)
    const appWindow = tcp('Established', ['::1', 51000], ['::1', 3000], 4102)
    expect(activityOf([row], [serverSide, childListens, appWindow], seen()).activity.get(KEY)).toBe(
      true
    )
  })

  test('새 연결이 생기면 연결 0 시간을 다시 센다', () => {
    const first = activityOf(
      [server()],
      [tcp('Established', ['::1', 3000], ['::1', 51000])],
      new Map()
    )
    const next = activityOf(
      [server()],
      [tcp('Established', ['::1', 3000], ['::1', 51001])],
      first.connections
    )
    expect(next.activity.get(KEY)).toBe(true)
    const same = activityOf(
      [server()],
      [tcp('Established', ['::1', 3000], ['::1', 51001])],
      next.connections
    )
    expect(same.activity.get(KEY)).toBe(false)

    // 샘플 사이에 잠깐 붙었다 끊긴 요청(연결 0 으로 보임)도 흔적이면 시간이 다시 시작된다.
    const r = judgeServers(
      [server({ clientCount: 0 })],
      [],
      new Map([[KEY, { state: 'idle', since: 0 }]]),
      25 * MIN,
      THRESHOLD,
      new Map([[KEY, true]])
    )
    expect(r.rows[0]).toMatchObject({ judgement: null, idleSince: 25 * MIN })
  })

  test('연결이 이어지는 서버(폴링 탭)는 새 연결이 생겨도 확인해볼 것 시간이 이어진다', () => {
    const poll = (port: number): TcpEntry[] => [tcp('Established', ['::1', 3000], ['::1', port])]
    const r = run([
      { t: 0, tcp: poll(51000), clients: 1 },
      { t: 10 * MIN, tcp: poll(51001), clients: 1 },
      { t: 20 * MIN, tcp: poll(51002), clients: 1 }
    ])
    expect(r.rows[0]).toMatchObject({ judgement: 'check', idleSince: 0 })
  })

  test('처음 본 연결 목록은 흔적으로 치지 않는다(첫 샘플)', () => {
    const t = activityOf([server()], [tcp('Established', ['::1', 3000], ['::1', 51000])], new Map())
    expect(t.activity.get(KEY)).toBe(false)
    expect([...t.connections.get(KEY)!]).toEqual(['::1:51000'])
  })

  test('서버 트리의 다른 pid 가 연 포트의 연결도 그 서버 것으로 센다', () => {
    const api = server({ pid: 6100, ports: [6176, 8081], descendantPids: [6101], startedAt: 100 })
    const prev = new Map([['server:6100:100', new Set<string>()]])
    const t = activityOf([api], [tcp('Established', ['::1', 8081], ['::1', 52000], 6101)], prev)
    expect(t.activity.get('server:6100:100')).toBe(true)
  })
})
