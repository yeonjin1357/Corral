import type {
  AgentRow,
  AgentState,
  ClaudeHookStatus,
  DashboardSnapshot,
  Platform,
  ProcessInfo,
  RawSample,
  WorkspaceInfo,
  WorktreeInfo
} from '../shared/types'
import { worktreeKey } from '../shared/format'
import type { Settings } from '../shared/settings'
import {
  buildAgents,
  cpuState,
  measureTreeCpu,
  withStateSince,
  type AgentStateMemo,
  type CpuMemo
} from './agents'
import { activityOf, judgeServers, type ServerMemo } from './judge'
import { agentToolOf, topLevelAgentPids } from './processTree'
import { hookStateForWorktree, reconcileSessions, type LiveClaude, type Sessions } from './sessions'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'
import { createServerHistory, type ServerHistoryData } from './serverHistory'
import type { AgentStateData, ServerMemoData } from './historyStore'
import { selectionKey } from '../shared/keys'
import { normalizeCandidate, selfWorkspace } from './collect/worktree'

/** 수집마다 새로 읽는 사용자 기준값(설정 화면에서 바꾸면 다음 수집부터 반영). */
export interface CollectOptions {
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
  /** 에이전트 없는 워크트리의 포트가 이 시간 이상 안 쓰이면 정리 후보. */
  idlePortMs: number
  /** 무거운 명령 패턴. */
  heavyPatterns: string[]
}

export function collectOptionsFrom(s: Settings): CollectOptions {
  return {
    thresholds: { ramWarnPercent: s.ramWarnPercent, ramDangerPercent: s.ramDangerPercent },
    idlePortMs: s.idlePortMinutes * 60 * 1000,
    heavyPatterns: s.heavyPatterns
  }
}

export interface CollectorDeps {
  platform: Platform
  sample: () => Promise<RawSample>
  readMemory: () => Promise<{ totalBytes: number; freeBytes: number }>
  resolveProcessWorktrees: (
    processes: ProcessInfo[],
    cwds: Record<number, string>,
    cwdFirst: Set<number>
  ) => Promise<Map<number, WorktreeInfo>>
  /** Claude 세션 작업 폴더의 워크트리. */
  resolveWorktree: (path: string) => Promise<WorktreeInfo | null>
  /** 워크트리를 감싸는 작업 공간(바깥 저장소). */
  resolveWorkspace: (worktree: WorktreeInfo) => Promise<WorkspaceInfo>
  /** 훅 서버가 채우는 Claude 세션들(수집기는 읽고 끝난 것을 버린다). */
  sessions: Sessions
  hookStatus: () => Promise<ClaudeHookStatus>
  options: () => CollectOptions
  selfPid: number
  /** 논리 코어 수(CPU 표시 기준). */
  cpuCount: number
  now: () => number
}

/**
 * 한 번의 수집: 샘플 → 메모리 → 워크트리 → 스냅샷(서버·남은 프로세스) → 에이전트 → 서버 판단 → 작업 공간.
 * 이전 샘플의 CPU 와 서버별 "안 쓰인 시각"을 기억한다. 스냅샷을 만들 때마다 Claude 세션의 워크트리를 다시 판별한다.
 */
/** 다시 켜도 이어 쓸 수집기 기억(history.json, F8). */
export interface CollectorState {
  servers: ServerHistoryData
  serverMemo: ServerMemoData
  agentStates: AgentStateData
}

export function createCollector(deps: CollectorDeps): {
  collect(): Promise<DashboardSnapshot>
  /** 저장할 기억: 서버 메모리 기록, 서버별 정리 판단 시작 시각, 에이전트 상태 시작 시각. */
  exportState(): CollectorState
  /**
   * 저장했던 기억을 불러온다(첫 수집 전). 판단 기억이 null 이면(꺼진 지 오래) 처음부터 센다.
   * 지금보다 뒤의 시각은 버린다.
   */
  importState(
    state: {
      servers: ServerHistoryData
      serverMemo: ServerMemoData | null
      agentStates: AgentStateData | null
    },
    now: number
  ): void
  /** 다시 샘플링하지 않고 훅 세션 상태만 새로 반영한다(훅 이벤트가 왔을 때). */
  restate(snapshot: DashboardSnapshot): Promise<DashboardSnapshot>
} {
  let previousCpu: CpuMemo = new Map()
  /** 서버 트리 CPU(에이전트와 따로 기억 — 같은 프로세스가 둘에 들어가지 않는다). */
  let previousServerCpu: CpuMemo = new Map()
  /** 에이전트별 지금 상태를 처음 본 시각(F3). */
  let agentStates: AgentStateMemo = new Map()
  /** 서버별 메모리 기록(F6, 1분 간격·60분). */
  const serverHistory = createServerHistory()
  let serverMemo: ServerMemo = new Map()
  /** 서버별 지난 샘플의 연결 상대(사용 흔적 판단). */
  let serverPeers = new Map<string, Set<string>>()
  /** 세션 작업 폴더 → 워크트리 키. 수집 때마다 다시 판별하고, 그 사이 새 세션은 restate 가 채운다. */
  let rootOfCwd = new Map<string, string | null>()

  const hookFor =
    (roots: Map<string, string | null>) =>
    (root: string): ReturnType<typeof hookStateForWorktree> =>
      hookStateForWorktree(deps.sessions, worktreeKey(root), (cwd) => roots.get(cwd) ?? null)
  const hookStateFor =
    (roots: Map<string, string | null>) =>
    (root: string): AgentState | null =>
      hookFor(roots)(root)?.state ?? null
  /** 훅 상태 에이전트의 상태 시작 시각(이벤트 시각). */
  const hookSinceFor =
    (roots: Map<string, string | null>) =>
    (a: AgentRow): number | null =>
      a.tool === 'claude' && a.worktree ? (hookFor(roots)(a.worktree.root)?.since ?? null) : null

  /** known 에 없는 세션 작업 폴더만 판별해 더한 새 표를 돌려준다(known 이 없으면 전부 다시). */
  async function resolveSessionRoots(
    known: Map<string, string | null> = new Map()
  ): Promise<Map<string, string | null>> {
    const cwds = [...new Set([...deps.sessions.values()].map((s) => s.cwd))].filter(
      (cwd) => !known.has(cwd)
    )
    const resolved = await Promise.all(
      cwds.map(async (cwd): Promise<[string, string | null]> => {
        // 네트워크 공유·WSL 경로는 응답이 없으면 수집 전체가 멈출 수 있어 판별하지 않는다(포트 판별과 같은 규칙).
        const local = normalizeCandidate(cwd)
        if (!local) return [cwd, null]
        try {
          const w = await deps.resolveWorktree(local)
          return [cwd, w ? worktreeKey(w.root) : null]
        } catch {
          return [cwd, null]
        }
      })
    )
    return new Map([...known, ...resolved])
  }

  /** 행들의 워크트리마다 작업 공간을 한 번씩 판별한다(실패하면 그 워크트리 자체). */
  async function resolveWorkspaces(
    list: (WorktreeInfo | null)[]
  ): Promise<(w: WorktreeInfo | null) => WorkspaceInfo | null> {
    const unique = new Map<string, WorktreeInfo>()
    for (const w of list)
      if (w && !unique.has(worktreeKey(w.root))) unique.set(worktreeKey(w.root), w)
    const resolved = new Map(
      await Promise.all(
        [...unique].map(async ([key, w]): Promise<[string, WorkspaceInfo]> => {
          try {
            return [key, await deps.resolveWorkspace(w)]
          } catch {
            return [key, selfWorkspace(w)]
          }
        })
      )
    )
    return (w) => (w ? (resolved.get(worktreeKey(w.root)) ?? null) : null)
  }

  async function readHookStatus(): Promise<ClaudeHookStatus> {
    try {
      return await deps.hookStatus()
    } catch {
      return { state: 'error', problem: 'settings', allHooksDisabled: false, settingsPath: '' }
    }
  }

  async function collect(): Promise<DashboardSnapshot> {
    const sampledAt = deps.now()
    const options = deps.options()
    const [raw, memory] = await Promise.all([deps.sample(), deps.readMemory()])
    const needed = pidsForWorktreeLookup(raw, deps.platform, options.heavyPatterns)
    const worktrees = await deps.resolveProcessWorktrees(
      raw.processes.filter((p) => needed.has(p.pid)),
      raw.cwds ?? {},
      new Set(topLevelAgentPids(raw.processes))
    )
    const now = deps.now()
    const snapshot = buildSnapshot({
      sample: raw,
      worktrees,
      totalBytes: memory.totalBytes,
      freeBytes: memory.freeBytes,
      thresholds: options.thresholds,
      now,
      selfPid: deps.selfPid,
      platform: deps.platform,
      cpuCount: deps.cpuCount,
      heavyPatterns: options.heavyPatterns
    })

    const devServerPids = new Set(snapshot.servers.flatMap((p) => [p.pid, ...p.descendantPids]))
    const [roots, hook] = await Promise.all([resolveSessionRoots(), readHookStatus()])
    rootOfCwd = roots

    // 세션을 이번 샘플의 Claude 프로세스와 짝짓고 끝난 세션을 버린 뒤 상태를 정한다(끝난 세션이 한 번도 섞이지 않게).
    const byPid = new Map(raw.processes.map((p) => [p.pid, p]))
    const live: LiveClaude[] = topLevelAgentPids(raw.processes).flatMap((pid) => {
      const p = byPid.get(pid)
      const w = worktrees.get(pid)
      if (!p || !w || agentToolOf(p) !== 'claude') return []
      return [
        { key: `${pid}:${p.startedAt ?? ''}`, rootKey: worktreeKey(w.root), startedAt: p.startedAt }
      ]
    })
    reconcileSessions(deps.sessions, {
      now,
      sampledAt,
      live,
      rootOfCwd: (cwd) => roots.get(cwd) ?? null
    })

    const { agents: built, cpu } = buildAgents({
      sample: raw,
      worktrees,
      devServerPids,
      previousCpu,
      now: sampledAt,
      hookStates: hookStateFor(roots)
    })
    previousCpu = cpu
    const stated = withStateSince(built, agentStates, sampledAt, hookSinceFor(roots))
    agentStates = stated.memo
    const agents = stated.agents

    const traces = activityOf(snapshot.servers, raw.tcp, serverPeers)
    serverPeers = traces.connections
    const judged = judgeServers(
      snapshot.servers,
      agents,
      serverMemo,
      now,
      options.idlePortMs,
      traces.activity
    )
    serverMemo = judged.memo

    // 서버 CPU(F5): 서버 트리의 누적 CPU 변화. 에이전트와 같은 계산.
    const serverCpu: CpuMemo = new Map()
    const servers = judged.rows.map((row) => {
      const self = byPid.get(row.pid)
      if (!self) return row
      const members = [self, ...row.descendantPids.flatMap((pid) => byPid.get(pid) ?? [])]
      return {
        ...row,
        cpuPercent: measureTreeCpu(self, members, previousServerCpu, sampledAt, serverCpu)
      }
    })
    previousServerCpu = serverCpu
    // 메모리가 계속 느는 서버(F6): 1분에 한 번 기록해 최근 60분으로 판단한다.
    serverHistory.record(servers, now)
    const measured = servers.map((row) => ({
      ...row,
      memoryGrowth: serverHistory.growthOf(selectionKey.server(row), now)
    }))

    const workspaceOf = await resolveWorkspaces([
      ...measured.map((r) => r.worktree),
      ...snapshot.leftovers.map((r) => r.worktree),
      ...snapshot.heavyJobs.map((r) => r.worktree),
      ...agents.map((a) => a.worktree)
    ])
    const withWorkspace = <T extends { worktree: WorktreeInfo | null }>(
      row: T
    ): T & { workspace: WorkspaceInfo | null } => ({ ...row, workspace: workspaceOf(row.worktree) })

    return {
      ...snapshot,
      servers: measured.map(withWorkspace),
      leftovers: snapshot.leftovers.map(withWorkspace),
      heavyJobs: snapshot.heavyJobs.map(withWorkspace),
      agents: agents.map(withWorkspace),
      hook
    }
  }

  async function restate(snapshot: DashboardSnapshot): Promise<DashboardSnapshot> {
    rootOfCwd = await resolveSessionRoots(rootOfCwd)
    const hookState = hookStateFor(rootOfCwd)
    const restated = snapshot.agents.map((a): AgentRow => {
      const fromHook = a.tool === 'claude' && a.worktree ? hookState(a.worktree.root) : null
      return {
        ...a,
        state: fromHook ?? cpuState(a.cpuPercent),
        stateSource: fromHook ? 'hook' : 'cpu'
      }
    })
    const stated = withStateSince(restated, agentStates, deps.now(), hookSinceFor(rootOfCwd))
    agentStates = stated.memo
    return { ...snapshot, agents: stated.agents }
  }

  function exportState(): CollectorState {
    return {
      servers: serverHistory.export(),
      serverMemo: Object.fromEntries(serverMemo),
      agentStates: Object.fromEntries(agentStates)
    }
  }

  function importState(
    state: Parameters<ReturnType<typeof createCollector>['importState']>[0],
    now: number
  ): void {
    serverHistory.import(state.servers, now)
    const past = <T extends { since: number }>(entries: Record<string, T> | null): [string, T][] =>
      Object.entries(entries ?? {}).filter(([, v]) => v.since <= now)
    serverMemo = new Map(past(state.serverMemo))
    agentStates = new Map(past(state.agentStates))
  }

  return { collect, restate, exportState, importState }
}
