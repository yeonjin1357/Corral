import { buildWorkspaces, withLatestActivity } from './workspaces'
import type {
  AgentRow,
  HeavyJobRow,
  LeftoverRow,
  ProcessInfo,
  ServerRow,
  WorkspaceInfo,
  WorktreeInfo
} from '../shared/types'

const MB = 1024 * 1024
const UNKNOWN = '작업 폴더 모름'

const SHOP: WorktreeInfo = {
  root: 'C:\\work\\shop-web',
  branch: 'develop',
  isLinkedWorktree: false
}
const FRONT: WorktreeInfo = {
  root: 'C:\\work\\ws\\repos\\front',
  branch: 'main',
  isLinkedWorktree: false
}
const API: WorktreeInfo = {
  root: 'C:\\work\\ws\\repos\\api',
  branch: 'main',
  isLinkedWorktree: false
}
const WS_SHOP: WorkspaceInfo = {
  root: SHOP.root,
  name: 'shop-web',
  branch: 'develop',
  outer: false
}
const WS_OUTER: WorkspaceInfo = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }

/** 메모리·커밋(MB). 커밋을 넘기지 않으면 모름. */
function proc(pid: number, memoryMb: number, commitMb?: number | null): ProcessInfo {
  return {
    pid,
    ppid: 1,
    name: 'node.exe',
    commandLine: 'node',
    memoryBytes: memoryMb * MB,
    startedAt: 100,
    commitBytes: commitMb == null ? commitMb : commitMb * MB
  }
}

function agent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    pid: 5000,
    tool: 'claude',
    worktree: SHOP,
    workspace: WS_SHOP,
    startedAt: 100,
    memoryBytes: 0,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state: 'working',
    stateSource: 'hook',
    stateSince: null,
    cpuPercent: null,
    lastActiveAt: null,
    parked: false,
    activity: null,
    quietSince: null,
    usage: null,
    host: { pids: [], app: null },
    ...over
  }
}

function server(over: Partial<ServerRow> = {}): ServerRow {
  return {
    pid: 4100,
    ports: [3000],
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: SHOP,
    workspace: WS_SHOP,
    unresolvable: false,
    memoryBytes: 0,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    clientCount: 0,
    startedAt: 200,
    judgement: null,
    idleSince: null,
    agentInWorktree: false,
    parkedAgent: false,
    parkedSince: null,
    cpuPercent: null,
    memoryGrowth: null,
    ...over
  }
}

function heavy(over: Partial<HeavyJobRow> = {}): HeavyJobRow {
  return {
    pid: 8000,
    label: 'tsc',
    processName: 'node.exe',
    commandLine: 'node tsc --noEmit',
    worktree: SHOP,
    workspace: WS_SHOP,
    memoryBytes: 0,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 300,
    ...over
  }
}

function leftover(over: Partial<LeftoverRow> = {}): LeftoverRow {
  return {
    pid: 7000,
    processName: 'chrome.exe',
    label: 'Playwright 브라우저',
    commandLine: 'chrome.exe --headless',
    worktree: SHOP,
    workspace: WS_SHOP,
    memoryBytes: 0,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 400,
    agentInWorktree: false,
    ...over
  }
}

type Input = Parameters<typeof buildWorkspaces>[0]

function input(over: Partial<Input> = {}): Input {
  return {
    processes: [],
    servers: [],
    agents: [],
    heavyJobs: [],
    leftovers: [],
    agentMembers: new Map(),
    changed: () => null,
    unknownName: UNKNOWN,
    ...over
  }
}

test('에이전트 아래에서 도는 무거운 작업을 두 번 세지 않는다', () => {
  // 에이전트(5000)가 띄운 tsc(8000, 자식 8001)는 에이전트 멤버이기도 하다. 서버(4100)는 따로.
  const rows = buildWorkspaces(
    input({
      processes: [
        proc(5000, 100, 120),
        proc(5001, 50),
        proc(8000, 1000, 1500),
        proc(8001, 200),
        proc(4100, 300),
        proc(4101, 30)
      ],
      agents: [agent()],
      agentMembers: new Map([['5000:100', [5000, 5001, 8000, 8001]]]),
      heavyJobs: [heavy({ descendantPids: [8001] })],
      servers: [server({ descendantPids: [4101] })]
    })
  )
  expect(rows).toEqual([
    {
      key: 'ws:c:\\work\\shop-web',
      root: SHOP.root,
      name: 'shop-web',
      outer: false,
      memoryBytes: (100 + 50 + 1000 + 200 + 300 + 30) * MB,
      commitBytes: (120 + 1500) * MB,
      processCount: 6,
      agentKeys: ['agent:5000:100'],
      serverKeys: ['server:4100:200'],
      heavyKeys: ['heavy:8000:300'],
      leftoverKeys: [],
      changedFiles: null,
      lastActiveAt: null
    }
  ])
})

test('작업 공간을 모르는 항목은 ws:? 한 줄, 맨 끝', () => {
  const rows = buildWorkspaces(
    input({
      processes: [
        proc(4100, 10),
        proc(6000, 50),
        proc(7000, 900),
        proc(5100, 2000),
        proc(4200, 400)
      ],
      servers: [
        server(),
        // 판별할 수 없는 중계 서버(wslrelay 등).
        server({
          pid: 6000,
          ports: [8080],
          worktree: null,
          workspace: null,
          unresolvable: true,
          startedAt: 600
        }),
        server({ pid: 4200, ports: [5173], worktree: FRONT, workspace: WS_OUTER, startedAt: 420 })
      ],
      leftovers: [leftover({ worktree: null, workspace: null })],
      // 워크트리를 모르는 에이전트(멤버 기록이 없으면 자기만).
      agents: [agent({ pid: 5100, worktree: null, workspace: null })]
    })
  )
  expect(rows.map((r) => [r.key, r.memoryBytes / MB])).toEqual([
    ['ws:c:\\work\\ws', 400],
    ['ws:c:\\work\\shop-web', 10],
    ['ws:?', 2950]
  ])
  expect(rows[2]).toMatchObject({
    root: null,
    name: UNKNOWN,
    outer: false,
    processCount: 3,
    agentKeys: ['agent:5100:100'],
    serverKeys: ['server:6000:600'],
    leftoverKeys: ['leftover:7000:400']
  })
  expect(rows[0]).toMatchObject({ root: WS_OUTER.root, name: 'ws', outer: true })
})

test('메모리가 같으면 이름 순', () => {
  const rows = buildWorkspaces(
    input({
      processes: [proc(4100, 10), proc(4200, 10)],
      servers: [server(), server({ pid: 4200, worktree: FRONT, workspace: WS_OUTER })]
    })
  )
  expect(rows.map((r) => r.name)).toEqual(['shop-web', 'ws'])
})

test('커밋은 하나도 모르면 null', () => {
  const rows = buildWorkspaces(
    input({
      processes: [proc(4100, 10), proc(4101, 10, null), proc(4200, 10), proc(4201, 10, 5)],
      servers: [
        server({ descendantPids: [4101] }),
        server({ pid: 4200, worktree: FRONT, workspace: WS_OUTER, descendantPids: [4201] })
      ]
    })
  )
  expect(rows.map((r) => [r.name, r.commitBytes])).toEqual([
    ['shop-web', null],
    ['ws', 5 * MB]
  ])
})

test('변경 수는 든 워크트리의 합, 하나도 모르면 null', () => {
  const counts: Record<string, number> = {
    'c:\\work\\ws\\repos\\front': 3,
    'c:\\work\\ws\\repos\\api': 2
  }
  const changed = vi.fn(
    (root: string): number | null => counts[root.replace(/[\\/]+$/, '').toLowerCase()] ?? null
  )
  const rows = buildWorkspaces(
    input({
      processes: [proc(4200, 100), proc(5000, 50), proc(5100, 50), proc(7000, 10), proc(4100, 1)],
      servers: [server({ pid: 4200, worktree: FRONT, workspace: WS_OUTER }), server()],
      agents: [
        agent({ worktree: API, workspace: WS_OUTER }),
        agent({ pid: 5100, worktree: API, workspace: WS_OUTER })
      ],
      // 같은 워크트리를 다른 표기로(대소문자·끝 구분자) — 한 번만 센다.
      leftovers: [
        leftover({
          worktree: { ...FRONT, root: 'c:\\WORK\\ws\\repos\\front\\' },
          workspace: WS_OUTER
        })
      ],
      changed
    })
  )
  expect(rows.map((r) => [r.name, r.changedFiles])).toEqual([
    ['ws', 5],
    ['shop-web', null]
  ])
  expect(changed).toHaveBeenCalledTimes(3)
})

test('마지막 활동은 든 에이전트 가운데 가장 늦은 시각', () => {
  const rows = buildWorkspaces(
    input({
      processes: [proc(5000, 10), proc(5100, 10), proc(5200, 10), proc(4200, 1)],
      agents: [
        agent({ lastActiveAt: 2000 }),
        agent({ pid: 5100, lastActiveAt: 5000 }),
        agent({ pid: 5200, lastActiveAt: null })
      ],
      servers: [server({ pid: 4200, worktree: FRONT, workspace: WS_OUTER })]
    })
  )
  expect(rows.map((r) => [r.name, r.lastActiveAt])).toEqual([
    ['shop-web', 5000],
    ['ws', null]
  ])
})

test('restate: 에이전트의 새 마지막 활동을 작업 공간 줄에 다시 반영하고 나머지는 그대로', () => {
  const rows = buildWorkspaces(
    input({
      processes: [proc(5000, 10), proc(5100, 10), proc(4200, 1)],
      agents: [agent({ lastActiveAt: 2000 }), agent({ pid: 5100, lastActiveAt: null })],
      servers: [server({ pid: 4200, worktree: FRONT, workspace: WS_OUTER })]
    })
  )
  const next = withLatestActivity(rows, [
    agent({ lastActiveAt: 2000 }),
    agent({ pid: 5100, lastActiveAt: 9000 })
  ])
  expect(next.map((r) => [r.name, r.lastActiveAt])).toEqual([
    ['shop-web', 9000],
    ['ws', null]
  ])
  expect(next[0]).toEqual({ ...rows[0], lastActiveAt: 9000 })
  // 바뀌지 않은 줄은 같은 객체.
  expect(next[1]).toBe(rows[1])
})
