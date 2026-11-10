import type {
  AgentRow,
  HeavyJobRow,
  LeftoverRow,
  ProcessInfo,
  ServerRow,
  WorkspaceInfo,
  WorkspaceRow,
  WorktreeInfo
} from '../shared/types'
import { commitSum, worktreeKey } from '../shared/format'
import { agentKey, selectionKey } from '../shared/keys'

/** 작업 공간을 모르는 항목을 모은 줄의 키. */
export const UNKNOWN_WORKSPACE_KEY = 'ws:?'

/** 작업 공간 줄의 키: `ws:<worktreeKey(root)>`, 모르면 `ws:?`. */
export function workspaceKey(workspace: WorkspaceInfo | null): string {
  return workspace ? `ws:${worktreeKey(workspace.root)}` : UNKNOWN_WORKSPACE_KEY
}

/** 아는 시각 가운데 가장 늦은 것. 하나도 모르면 null. */
function latest(times: Iterable<number | null>): number | null {
  let result: number | null = null
  for (const t of times) if (t != null && (result === null || t > result)) result = t
  return result
}

/** 한 작업 공간에 모으는 것: 구성 pid(한 번씩), 행 키, 워크트리(worktreeKey → 경로), 에이전트의 마지막 활동. */
interface Bucket {
  key: string
  root: string | null
  name: string
  outer: boolean
  pids: Set<number>
  agentKeys: string[]
  serverKeys: string[]
  heavyKeys: string[]
  leftoverKeys: string[]
  worktrees: Map<string, string>
  activeTimes: (number | null)[]
}

/**
 * 작업 공간별 합계(G4). 작업 공간 키별로 구성 pid 를 모아(서버·무거운 작업·남은 프로세스는 자기 + descendantPids,
 * 에이전트는 agentMembers — 없으면 자기만) 메모리·커밋을 pid 마다 한 번 더한다. 에이전트 아래에서 도는 무거운 작업은
 * 에이전트 멤버이기도 해서, 행의 값을 그대로 더하면 두 번 센다.
 * 작업 공간을 모르는 항목은 `ws:?` 한 줄(이름 unknownName)에 모은다. 변경 수는 든 워크트리(경로 표기가 달라도 한 번)의
 * changed 값 합(하나도 모르면 null). 메모리 큰 순·이름 순, `ws:?` 는 맨 끝.
 * 넘긴 서버만 넣는다(숨긴 서버는 넘기지 않는다).
 */
export function buildWorkspaces(input: {
  processes: ProcessInfo[]
  servers: ServerRow[]
  agents: AgentRow[]
  heavyJobs: HeavyJobRow[]
  leftovers: LeftoverRow[]
  /** agentKey → 에이전트 메모리에 센 pid(자기 포함, buildAgents 의 members). */
  agentMembers: Map<string, number[]>
  /** 워크트리의 커밋 안 한 변경 수(기억한 값). 모르면 null. */
  changed: (worktreeRoot: string) => number | null
  /** `ws:?` 줄의 이름. */
  unknownName: string
}): WorkspaceRow[] {
  const byPid = new Map(input.processes.map((p) => [p.pid, p]))
  const buckets = new Map<string, Bucket>()

  const add = (
    row: { workspace: WorkspaceInfo | null; worktree: WorktreeInfo | null },
    pids: number[]
  ): Bucket => {
    const key = workspaceKey(row.workspace)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        root: row.workspace?.root ?? null,
        name: row.workspace?.name ?? input.unknownName,
        outer: row.workspace?.outer ?? false,
        pids: new Set(),
        agentKeys: [],
        serverKeys: [],
        heavyKeys: [],
        leftoverKeys: [],
        worktrees: new Map(),
        activeTimes: []
      }
      buckets.set(key, bucket)
    }
    for (const pid of pids) bucket.pids.add(pid)
    if (row.worktree) {
      const wt = worktreeKey(row.worktree.root)
      if (!bucket.worktrees.has(wt)) bucket.worktrees.set(wt, row.worktree.root)
    }
    return bucket
  }

  for (const a of input.agents) {
    const bucket = add(a, input.agentMembers.get(agentKey(a)) ?? [a.pid])
    bucket.agentKeys.push(selectionKey.agent(a))
    bucket.activeTimes.push(a.lastActiveAt)
  }
  for (const s of input.servers)
    add(s, [s.pid, ...s.descendantPids]).serverKeys.push(selectionKey.server(s))
  for (const j of input.heavyJobs)
    add(j, [j.pid, ...j.descendantPids]).heavyKeys.push(selectionKey.heavy(j))
  for (const l of input.leftovers)
    add(l, [l.pid, ...l.descendantPids]).leftoverKeys.push(selectionKey.leftover(l))

  const rows = [...buckets.values()].map((b): WorkspaceRow => {
    const members = [...b.pids].flatMap((pid) => byPid.get(pid) ?? [])
    let changedFiles: number | null = null
    for (const root of b.worktrees.values()) {
      const n = input.changed(root)
      if (n != null) changedFiles = (changedFiles ?? 0) + n
    }
    return {
      key: b.key,
      root: b.root,
      name: b.name,
      outer: b.outer,
      memoryBytes: members.reduce((sum, p) => sum + p.memoryBytes, 0),
      commitBytes: commitSum(members),
      processCount: members.length,
      agentKeys: b.agentKeys,
      serverKeys: b.serverKeys,
      heavyKeys: b.heavyKeys,
      leftoverKeys: b.leftoverKeys,
      changedFiles,
      lastActiveAt: latest(b.activeTimes)
    }
  })
  const unknownLast = (r: WorkspaceRow): number => (r.key === UNKNOWN_WORKSPACE_KEY ? 1 : 0)
  return rows.sort(
    (a, b) =>
      unknownLast(a) - unknownLast(b) ||
      b.memoryBytes - a.memoryBytes ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key)
  )
}

/**
 * 수집 사이(restate)에 바뀐 에이전트의 마지막 활동을 작업 공간 줄에 다시 반영한다. 합계·구성원은 다음 수집까지
 * 그대로 두고, 바뀌지 않은 줄은 같은 객체를 돌려준다.
 */
export function withLatestActivity(rows: WorkspaceRow[], agents: AgentRow[]): WorkspaceRow[] {
  const activeAt = new Map(agents.map((a) => [selectionKey.agent(a), a.lastActiveAt]))
  return rows.map((row) => {
    const lastActiveAt = latest(row.agentKeys.map((key) => activeAt.get(key) ?? null))
    return lastActiveAt === row.lastActiveAt ? row : { ...row, lastActiveAt }
  })
}
