import type {
  AgentRow,
  AgentState,
  AgentTool,
  ClaudeHookStatus,
  CodexHookStatus,
  DashboardSnapshot,
  Platform,
  ProcessInfo,
  RawSample,
  ServerRow,
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
import { cwdKey, type RolloutState } from './codexRollout'
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
  /** 숨길 서버(`:포트` 또는 프로세스 이름). */
  hiddenServers?: string[]
  /** 작업 공간 경로 → 보여 줄 이름. */
  workspaceAliases?: Record<string, string>
}

/** 숨김 항목에 맞는 서버: 포트 중 하나가 같거나 프로세스 이름이 같다(대소문자 무시). */
function isHidden(row: ServerRow, hidden: string[]): boolean {
  return hidden.some((h) =>
    h.startsWith(':')
      ? row.ports.includes(Number(h.slice(1)))
      : h.toLowerCase() === row.processName.toLowerCase()
  )
}

export function collectOptionsFrom(s: Settings): CollectOptions {
  return {
    thresholds: { ramWarnPercent: s.ramWarnPercent, ramDangerPercent: s.ramDangerPercent },
    idlePortMs: s.idlePortMinutes * 60 * 1000,
    heavyPatterns: s.heavyPatterns,
    hiddenServers: s.hiddenServers,
    workspaceAliases: s.workspaceAliases
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
  /** Codex 세션 기록으로 안 상태(F7). 기록이 없으면 null(CPU 추정). 없으면 쓰지 않는다. */
  codexState?: (
    agent: { cwd: string; startedAt: number | null },
    now: number
  ) => Promise<RolloutState | null>
  /** 훅 서버가 채우는 에이전트 세션들(수집기는 읽고 끝난 것을 버린다). */
  sessions: Sessions
  hookStatus: () => Promise<ClaudeHookStatus>
  /** Codex 훅 연동 상태. 없으면 스냅샷에 null. */
  codexHookStatus?: () => Promise<CodexHookStatus>
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
    (root: string, tool: AgentTool): ReturnType<typeof hookStateForWorktree> =>
      hookStateForWorktree(deps.sessions, worktreeKey(root), (cwd) => roots.get(cwd) ?? null, tool)
  const hookStateFor =
    (roots: Map<string, string | null>) =>
    (root: string, tool: AgentTool): AgentState | null =>
      hookFor(roots)(root, tool)?.state ?? null
  /** Codex 세션 기록으로 안 상태(pid → 상태). restate 가 덮어쓰지 않도록 기억한다. */
  let rollouts = new Map<number, RolloutState>()
  /** 정확한 상태의 시작 시각: 훅은 이벤트 시각, Codex 세션 기록은 기록의 이벤트 시각. */
  const exactSinceFor =
    (roots: Map<string, string | null>) =>
    (a: AgentRow): number | null => {
      if (a.stateSource === 'rollout') return rollouts.get(a.pid)?.since ?? null
      return a.worktree ? (hookFor(roots)(a.worktree.root, a.tool)?.since ?? null) : null
    }

  /**
   * Codex 에이전트마다 세션 기록 상태를 읽는다. 같은 폴더에서 Codex 가 둘 이상 돌면 어느 쪽 기록인지 알 수 없어
   * 쓰지 않는다(지어내지 않음). 실패하면 그 에이전트는 CPU 추정 그대로.
   */
  async function readRollouts(
    agents: AgentRow[],
    cwds: Record<number, string>,
    now: number
  ): Promise<Map<number, RolloutState>> {
    const result = new Map<number, RolloutState>()
    const read = deps.codexState
    if (!read) return result
    // 훅으로 이미 정확한 상태를 아는 Codex 는 읽지 않는다(훅이 권한 대기까지 알아 더 정확하다).
    const codex = agents.filter((a) => a.tool === 'codex' && a.stateSource === 'cpu' && cwds[a.pid])
    const count = new Map<string, number>()
    for (const a of codex) count.set(cwdKey(cwds[a.pid]), (count.get(cwdKey(cwds[a.pid])) ?? 0) + 1)
    await Promise.all(
      codex.map(async (a) => {
        const cwd = cwds[a.pid]
        if (count.get(cwdKey(cwd)) !== 1) return
        try {
          const state = await read({ cwd, startedAt: a.startedAt }, now)
          if (state) result.set(a.pid, state)
        } catch {
          // 읽지 못하면 CPU 추정을 쓴다.
        }
      })
    )
    return result
  }

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
    list: (WorktreeInfo | null)[],
    aliases: Record<string, string> = {}
  ): Promise<(w: WorktreeInfo | null) => WorkspaceInfo | null> {
    const alias = new Map(Object.entries(aliases).map(([root, name]) => [worktreeKey(root), name]))
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
    // 설정의 별칭이 있으면 그 이름으로 보인다.
    for (const [key, ws] of resolved) {
      const name = alias.get(worktreeKey(ws.root))
      if (name) resolved.set(key, { ...ws, name })
    }
    return (w) => (w ? (resolved.get(worktreeKey(w.root)) ?? null) : null)
  }

  async function readCodexHookStatus(): Promise<CodexHookStatus | null> {
    if (!deps.codexHookStatus) return null
    try {
      return await deps.codexHookStatus()
    } catch {
      return { state: 'error', problem: 'settings', path: '' }
    }
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
    const [roots, hook, codexHook] = await Promise.all([
      resolveSessionRoots(),
      readHookStatus(),
      readCodexHookStatus()
    ])
    rootOfCwd = roots

    // 세션을 이번 샘플의 에이전트 프로세스(Claude·Codex)와 짝짓고 끝난 세션을 버린 뒤 상태를 정한다(끝난 세션이 한 번도 섞이지 않게).
    const byPid = new Map(raw.processes.map((p) => [p.pid, p]))
    const live: LiveClaude[] = topLevelAgentPids(raw.processes).flatMap((pid) => {
      const p = byPid.get(pid)
      const w = worktrees.get(pid)
      const tool = p ? agentToolOf(p) : null
      if (!p || !w || !tool) return []
      return [
        {
          key: `${pid}:${p.startedAt ?? ''}`,
          rootKey: worktreeKey(w.root),
          startedAt: p.startedAt,
          tool
        }
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
    rollouts = await readRollouts(built, raw.cwds ?? {}, now)
    const withRollout = built.map((a): AgentRow => {
      const r = rollouts.get(a.pid)
      return r ? { ...a, state: r.state, stateSource: 'rollout' } : a
    })
    const stated = withStateSince(withRollout, agentStates, sampledAt, exactSinceFor(roots))
    agentStates = stated.memo

    // 작업 공간은 판단 전에 정한다: 같은 작업 공간에서 에이전트가 일하면 그 작업 공간의 서버·남은 프로세스는
    // 정리 후보로 올리지 않는다(스펙 §4 — 다른 저장소에서 일하는 에이전트가 이 서버를 쓰고 있을 수 있다).
    const workspaceOf = await resolveWorkspaces(
      [
        ...snapshot.servers.map((r) => r.worktree),
        ...snapshot.leftovers.map((r) => r.worktree),
        ...snapshot.heavyJobs.map((r) => r.worktree),
        ...stated.agents.map((a) => a.worktree)
      ],
      options.workspaceAliases
    )
    const withWorkspace = <T extends { worktree: WorktreeInfo | null }>(
      row: T
    ): T & { workspace: WorkspaceInfo | null } => ({ ...row, workspace: workspaceOf(row.worktree) })
    const agents = stated.agents.map(withWorkspace)
    const agentWorkspaces = new Set(
      agents.flatMap((a) => (a.workspace ? [worktreeKey(a.workspace.root)] : []))
    )
    const agentInWorkspace = (row: { workspace: WorkspaceInfo | null }): boolean =>
      !!row.workspace && agentWorkspaces.has(worktreeKey(row.workspace.root))
    const allServers = snapshot.servers.map(withWorkspace)
    const leftovers = snapshot.leftovers.map((row) => {
      const r = withWorkspace(row)
      return agentInWorkspace(r) ? { ...r, agentInWorktree: true } : r
    })

    // 숨긴 서버는 판단·추천·알림·트레이에 넣지 않는다(작업 공간·CPU·메모리 기록은 같이 본다).
    const hiddenList = options.hiddenServers ?? []
    const visible = allServers.filter((r) => !isHidden(r, hiddenList))
    const hidden = allServers.filter((r) => isHidden(r, hiddenList))
    const traces = activityOf(visible, raw.tcp, serverPeers)
    serverPeers = traces.connections
    const judged = judgeServers(
      visible,
      agents,
      serverMemo,
      now,
      options.idlePortMs,
      traces.activity
    )
    serverMemo = judged.memo

    // 서버 CPU(F5): 서버 트리의 누적 CPU 변화. 에이전트와 같은 계산.
    const serverCpu: CpuMemo = new Map()
    const measure = (row: ServerRow): ServerRow => {
      const self = byPid.get(row.pid)
      if (!self) return row
      const members = [self, ...row.descendantPids.flatMap((pid) => byPid.get(pid) ?? [])]
      return {
        ...row,
        cpuPercent: measureTreeCpu(self, members, previousServerCpu, sampledAt, serverCpu)
      }
    }
    const servers = judged.rows.map(measure)
    const hiddenServers = hidden.map(measure)
    previousServerCpu = serverCpu
    // 메모리가 계속 느는 서버(F6): 1분에 한 번 기록해 최근 60분으로 판단한다.
    serverHistory.record([...servers, ...hiddenServers], now)
    const grown = (row: ServerRow): ServerRow => ({
      ...row,
      memoryGrowth: serverHistory.growthOf(selectionKey.server(row), now)
    })
    return {
      ...snapshot,
      servers: servers.map(grown),
      hiddenServers: hiddenServers.map(grown),
      leftovers,
      heavyJobs: snapshot.heavyJobs.map(withWorkspace),
      agents,
      hook,
      codexHook
    }
  }

  async function restate(snapshot: DashboardSnapshot): Promise<DashboardSnapshot> {
    rootOfCwd = await resolveSessionRoots(rootOfCwd)
    const hookState = hookStateFor(rootOfCwd)
    const restated = snapshot.agents.map((a): AgentRow => {
      const fromHook = a.worktree ? hookState(a.worktree.root, a.tool) : null
      // 훅이 없으면 Codex 세션 기록 상태는 다음 수집에서 다시 읽는다(훅 이벤트와 상관없음).
      if (!fromHook && a.stateSource === 'rollout') return a
      return {
        ...a,
        state: fromHook ?? cpuState(a.cpuPercent),
        stateSource: fromHook ? 'hook' : 'cpu'
      }
    })
    const stated = withStateSince(restated, agentStates, deps.now(), exactSinceFor(rootOfCwd))
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
