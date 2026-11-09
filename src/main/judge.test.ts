import { judgeServers, type ServerMemo } from './judge'
import type { AgentRow, ServerRow, WorktreeInfo } from '../shared/types'

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
    state: 'idle',
    stateSource: 'cpu',
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
