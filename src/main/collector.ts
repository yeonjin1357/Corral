import { hiddenMatches } from '../shared/settings'
import type {
  AgentActivity,
  AgentRow,
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
import { isParked, lastActiveOf, trackSeen, type SeenMemo } from './activity'
import { fileStateOver, type ClaudeSessionFile } from './claudeSessionFiles'
import { activityOf, judgeServers, type ServerMemo } from './judge'
import { agentToolOf, topLevelAgentPids } from './processTree'
import {
  codexTranscriptFor,
  hookViewForAgent,
  oneLine,
  pairBySessionFile,
  reconcileSessions,
  type HookView,
  type LiveClaude,
  type Sessions
} from './sessions'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'
import { createServerHistory, type ServerHistoryData } from './serverHistory'
import { cwdKey, type RolloutState } from './codexRollout'
import type { AgentSeenData, AgentStateData, ServerMemoData } from './historyStore'
import { agentKey, selectionKey } from '../shared/keys'
import { normalizeCandidate, selfWorkspace } from './collect/worktree'

/** 수집마다 새로 읽는 사용자 기준값(설정 화면에서 바꾸면 다음 수집부터 반영). */
export interface CollectOptions {
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
  /** 에이전트 없는 워크트리의 포트가 이 시간 이상 안 쓰이면 정리 후보(오래 쉬는 에이전트만 있으면 확인해볼 것). */
  idlePortMs: number
  /** 쉬는 에이전트의 마지막 활동이 이 시간 이상 전이면 오래 쉬는 세션(G2). */
  agentParkedMs: number
  /** 무거운 명령 패턴. */
  heavyPatterns: string[]
  /** 숨길 서버(`:포트` 또는 프로세스 이름). */
  hiddenServers?: string[]
  /** 작업 공간 경로 → 보여 줄 이름. */
  workspaceAliases?: Record<string, string>
  /** 에이전트가 하는 일(G3b)을 행에 담는다. 끄면 모두 null 이고 Claude 세션 파일의 이름도 쓰지 않는다. */
  showAgentActivity: boolean
}

/** 세션 파일의 이름을 제목으로 쓸 때의 길이(훅 제목과 같다). */
const TITLE_MAX = 80

/**
 * 행의 하는 일(G3b): 그 행이 상태를 얻는 훅 세션의 내용에, 훅 제목이 없으면 Claude 세션 파일의 이름(한 줄 80자)을 제목으로
 * 쓴다(훅 세션이 없어도). 실행 중인 도구는 작업 중·권한 대기일 때만, 권한을 기다리는 도구는 권한 대기일 때만 보인다
 * (세션 파일·Codex 세션 기록이 더 늦은 근거라 상태가 바뀌었으면 옛 도구를 보이지 않게). 보일 것이 없으면 null.
 */
function rowActivity(
  state: AgentRow['state'],
  hook: AgentActivity | null,
  fileName: string | null
): AgentActivity | null {
  const title = hook?.title ?? oneLine(fileName, TITLE_MAX)
  const prompt = hook?.prompt ?? null
  const tool = state === 'working' || state === 'waiting' ? (hook?.tool ?? null) : null
  const waiting = state === 'waiting' ? (hook?.waiting ?? null) : null
  return title || prompt || tool || waiting ? { title, prompt, tool, waiting } : null
}

/** 다른 Codex 프로세스 생존 구간을 기억하는 시간과, 마지막으로 본 뒤 꺼졌을 수 있는 여유(수집 주기보다 길게). */
const CODEX_LIFE_KEEP_MS = 24 * 60 * 60 * 1000
const CODEX_LIFE_SLACK_MS = 60 * 1000

/** 숨김 항목에 맞는 서버(포트·프로세스 이름·워크트리의 포트, 대소문자 무시). */
function isHidden(row: ServerRow, hidden: string[]): boolean {
  return hidden.some((h) => hiddenMatches(h, row))
}

export function collectOptionsFrom(s: Settings): CollectOptions {
  return {
    thresholds: { ramWarnPercent: s.ramWarnPercent, ramDangerPercent: s.ramDangerPercent },
    idlePortMs: s.idlePortMinutes * 60 * 1000,
    agentParkedMs: s.agentParkedMinutes * 60 * 1000,
    heavyPatterns: s.heavyPatterns,
    hiddenServers: s.hiddenServers,
    workspaceAliases: s.workspaceAliases,
    showAgentActivity: s.showAgentActivity
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
    agent: { cwd: string; startedAt: number | null; exclude?: { from: number; to: number }[] },
    now: number
  ) => Promise<RolloutState | null>
  /**
   * Claude 실행 중 세션 파일(G3a, pid → 파일). 세션과 프로세스를 정확히 잇고, 훅이 없을 때 작업 중·쉬는 중을 안다.
   * 없으면 쓰지 않는다(지금처럼 추측으로 잇고 CPU 추정).
   */
  claudeSessionFiles?: (
    agents: { pid: number; startedAt: number | null }[],
    now: number
  ) => Promise<Map<number, ClaudeSessionFile>>
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
  agentSeen: AgentSeenData
}

export function createCollector(deps: CollectorDeps): {
  collect(): Promise<DashboardSnapshot>
  /**
   * 저장할 기억: 서버 메모리 기록, 서버별 정리 판단 시작 시각, 에이전트 상태 시작 시각,
   * 에이전트를 처음 본 시각·마지막으로 작업 중으로 본 시각.
   */
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
      agentSeen: AgentSeenData | null
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
  /** 에이전트별 pitwall 이 처음 본 시각·마지막으로 작업 중으로 본 시각(G2). */
  let agentSeen: SeenMemo = new Map()
  /** 서버별 메모리 기록(F6, 1분 간격·60분). */
  const serverHistory = createServerHistory()
  let serverMemo: ServerMemo = new Map()
  /** 서버별 지난 샘플의 연결 상대(사용 흔적 판단). */
  let serverPeers = new Map<string, Set<string>>()
  /** 세션 작업 폴더 → 워크트리 키. 수집 때마다 다시 판별하고, 그 사이 새 세션은 restate 가 채운다. */
  let rootOfCwd = new Map<string, string | null>()

  /** 마지막 수집에서 읽은 Claude 세션 파일(pid → 파일). restate(수집 사이)는 새로 읽지 않고 이것과 견준다. */
  let sessionFiles = new Map<number, ClaudeSessionFile>()
  /** 세션 파일로 지금 세션을 아는 Claude 프로세스(agentKey → 세션 id). sessionFiles 와 같은 때 새로 한다. */
  let fileSessionOf = new Map<string, string>()

  /**
   * 그 에이전트 프로세스의 훅 세션(G3a): 세션 파일이 있으면 그 파일의 세션만, 없으면 짝지은 세션, 그것도 없으면
   * 그 워크트리의 짝 없는 세션.
   */
  const hookFor =
    (roots: Map<string, string | null>) =>
    (agent: { key: string; worktreeRoot: string | null; tool: AgentTool }): HookView | null =>
      hookViewForAgent(
        deps.sessions,
        {
          key: agent.key,
          rootKey: agent.worktreeRoot === null ? null : worktreeKey(agent.worktreeRoot),
          tool: agent.tool,
          sessionId: fileSessionOf.get(agent.key) ?? null
        },
        (cwd) => roots.get(cwd) ?? null
      )
  const hookOfRow =
    (roots: Map<string, string | null>) =>
    (a: AgentRow): HookView | null =>
      hookFor(roots)({ key: agentKey(a), worktreeRoot: a.worktree?.root ?? null, tool: a.tool })
  /** Codex 세션 기록으로 안 상태(pid → 상태). restate 가 덮어쓰지 않도록 기억한다. */
  let rollouts = new Map<number, RolloutState>()
  /** 정확한 상태의 시작 시각: 훅은 이벤트 시각, Codex 세션 기록은 기록의 이벤트 시각, 세션 파일은 상태가 바뀐 시각. */
  const exactSinceFor =
    (roots: Map<string, string | null>) =>
    (a: AgentRow): number | null => {
      if (a.stateSource === 'rollout') return rollouts.get(a.pid)?.since ?? null
      if (a.stateSource === 'file') return sessionFiles.get(a.pid)?.statusUpdatedAt ?? null
      return hookOfRow(roots)(a)?.since ?? null
    }

  /**
   * 훅·Claude 세션 파일·CPU 가운데 이 에이전트 상태의 근거(G3a). 훅과 파일이 둘 다 있으면 더 늦은 근거를 따르고
   * (fileStateOver), 둘 다 없으면 CPU 추정. Codex 세션 기록은 따로 정한다(readRollouts).
   */
  function stateFrom(a: AgentRow, hook: HookView | null): AgentRow {
    const file = a.tool === 'claude' ? sessionFiles.get(a.pid) : undefined
    const fromFile = file ? fileStateOver(file, hook) : null
    if (fromFile) return { ...a, state: fromFile, stateSource: 'file' }
    return {
      ...a,
      state: hook?.state ?? cpuState(a.cpuPercent),
      stateSource: hook ? 'hook' : 'cpu'
    }
  }

  /**
   * 정확한 근거로 아는 마지막 활동 시각. 훅은 그 프로세스 세션의 마지막 활동 이벤트, Codex 세션 기록은 마지막 이벤트,
   * 세션 파일은 상태가 바뀐 시각(작업 중이면 지금). CPU 추정이거나 모르면 null.
   */
  function exactActivityOf(
    a: AgentRow,
    roots: Map<string, string | null>,
    now: number
  ): number | null {
    switch (a.stateSource) {
      case 'rollout':
        return rollouts.get(a.pid)?.lastEventAt ?? null
      case 'hook':
        return hookOfRow(roots)(a)?.lastActivityAt ?? null
      case 'file': {
        const file = sessionFiles.get(a.pid)
        return file?.status === 'busy' ? now : (file?.statusUpdatedAt ?? null)
      }
      case 'cpu':
        return null
    }
  }

  /**
   * 마지막 활동 시각과 오래 쉬는 세션(G2)을 채운다. 정확한 근거(exactActivityOf)가 없으면 pitwall 이 본 기록
   * (마지막으로 작업 중으로 본 시각, 없으면 처음 본 시각 — CPU 를 읽지 못해 확인 중인 CPU 추정은 모름).
   */
  function withActivity(
    agents: AgentRow[],
    roots: Map<string, string | null>,
    now: number,
    parkedMs: number
  ): AgentRow[] {
    agentSeen = trackSeen(agents, agentSeen, now)
    return agents.map((a): AgentRow => {
      const exact = exactActivityOf(a, roots, now)
      const seen = agentSeen.get(agentKey(a)) ?? { firstSeen: now, lastWorking: null }
      const lastActiveAt = lastActiveOf(a, exact, seen)
      return { ...a, lastActiveAt, parked: isParked({ ...a, lastActiveAt }, now, parkedMs) }
    })
  }

  /**
   * 행마다 하는 일(G3b)을 채운다(최종 상태가 정해진 뒤 — rowActivity). 설정이 꺼져 있으면 모두 null 이고 세션 파일의
   * 이름도 쓰지 않는다. 세션 파일은 Claude 에만 있다.
   */
  function withAgentActivity(
    agents: AgentRow[],
    roots: Map<string, string | null>,
    show: boolean
  ): AgentRow[] {
    return agents.map((a): AgentRow => ({
      ...a,
      activity: show
        ? rowActivity(
            a.state,
            hookOfRow(roots)(a)?.activity ?? null,
            a.tool === 'claude' ? (sessionFiles.get(a.pid)?.name ?? null) : null
          )
        : null
    }))
  }

  /**
   * Codex 에이전트마다 세션 기록 상태를 읽는다. 같은 폴더에서 Codex 가 둘 이상 돌면 어느 쪽 기록인지 알 수 없어
   * 쓰지 않는다(지어내지 않음). 실패하면 그 에이전트는 CPU 추정 그대로.
   */
  /**
   * 폴더별로 본 Codex 프로세스의 생존 구간(시작 ~ 마지막으로 본 시각, 하루 보관). 같은 폴더의 다른 프로세스가
   * 살아 있던 동안 만든 기록 파일은 그 프로세스 것일 수 있어 고르지 않는다(먼저 꺼진 프로세스의 파일을 읽지 않게).
   */
  const codexLives = new Map<string, Map<string, { startedAt: number; lastSeen: number }>>()

  async function readRollouts(
    agents: AgentRow[],
    cwds: Record<number, string>,
    now: number
  ): Promise<Map<number, RolloutState>> {
    const result = new Map<number, RolloutState>()
    const read = deps.codexState
    if (!read) return result
    const running = agents.filter((a) => a.tool === 'codex' && cwds[a.pid])
    for (const a of running) {
      if (a.startedAt == null) continue
      const key = cwdKey(cwds[a.pid])
      const lives = codexLives.get(key) ?? new Map()
      lives.set(agentKey(a), { startedAt: a.startedAt, lastSeen: now })
      codexLives.set(key, lives)
    }
    for (const [key, lives] of codexLives) {
      for (const [id, life] of lives) if (now - life.lastSeen > CODEX_LIFE_KEEP_MS) lives.delete(id)
      if (lives.size === 0) codexLives.delete(key)
    }
    const count = new Map<string, number>()
    for (const a of running)
      count.set(cwdKey(cwds[a.pid]), (count.get(cwdKey(cwds[a.pid])) ?? 0) + 1)
    // CPU 추정인 Codex, 그리고 훅으로 작업 중인 Codex(오류로 끝난 턴은 Stop 이 오지 않아 세션 기록으로 바로잡는다).
    const wanted = running.filter(
      (a) => a.stateSource === 'cpu' || (a.stateSource === 'hook' && a.state === 'working')
    )
    await Promise.all(
      wanted.map(async (a) => {
        const cwd = cwds[a.pid]
        if (count.get(cwdKey(cwd)) !== 1) return
        const exclude = [...(codexLives.get(cwdKey(cwd)) ?? new Map()).entries()]
          .filter(([id]) => id !== agentKey(a))
          .map(([, life]) => ({ from: life.startedAt, to: life.lastSeen + CODEX_LIFE_SLACK_MS }))
        // 훅으로 아는 Codex 는 훅이 알려 준 그 세션의 기록 파일을 읽는다(같은 폴더의 다른 파일을 고르지 않게).
        const transcriptPath =
          a.stateSource === 'hook' ? codexTranscriptFor(deps.sessions, agentKey(a)) : null
        try {
          const state = await read(
            {
              cwd,
              startedAt: a.startedAt,
              ...(exclude.length ? { exclude } : {}),
              ...(transcriptPath ? { transcriptPath } : {})
            },
            now
          )
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

  /** Claude 세션 파일을 읽는다. 읽기가 없거나 실패하면 빈 결과(지금처럼 추측으로 잇고 CPU 추정). */
  async function readSessionFiles(
    agents: { pid: number; startedAt: number | null }[],
    now: number
  ): Promise<Map<number, ClaudeSessionFile>> {
    if (!deps.claudeSessionFiles || agents.length === 0) return new Map()
    try {
      return await deps.claudeSessionFiles(agents, now)
    } catch {
      return new Map()
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
    const agentPids = topLevelAgentPids(raw.processes)
    const worktrees = await deps.resolveProcessWorktrees(
      raw.processes.filter((p) => needed.has(p.pid)),
      raw.cwds ?? {},
      new Set(agentPids)
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
    const byPid = new Map(raw.processes.map((p) => [p.pid, p]))
    const agentProcs = agentPids.flatMap((pid) => {
      const p = byPid.get(pid)
      const tool = p ? agentToolOf(p) : null
      return p && tool ? [{ p, tool }] : []
    })
    // 세션 파일은 Claude 에이전트에만 있다.
    const claudeProcs = agentProcs
      .filter((a) => a.tool === 'claude')
      .map(({ p }) => ({ pid: p.pid, startedAt: p.startedAt }))
    const [roots, hook, codexHook, files] = await Promise.all([
      resolveSessionRoots(),
      readHookStatus(),
      readCodexHookStatus(),
      readSessionFiles(claudeProcs, now)
    ])
    rootOfCwd = roots
    sessionFiles = files
    fileSessionOf = new Map(
      claudeProcs.flatMap((c) => {
        const file = files.get(c.pid)
        return file ? [[agentKey(c), file.sessionId] as const] : []
      })
    )

    // 세션을 이번 샘플의 에이전트 프로세스(Claude·Codex)와 짝짓고 끝난 세션을 버린 뒤 상태를 정한다(끝난 세션이 한 번도 섞이지 않게).
    const live: LiveClaude[] = agentProcs.flatMap(({ p, tool }) => {
      const w = worktrees.get(p.pid)
      return w
        ? [{ key: agentKey(p), rootKey: worktreeKey(w.root), startedAt: p.startedAt, tool }]
        : []
    })
    // 세션 파일이 가리키는 짝이 먼저다(추측은 아직 짝이 없는 세션에만). reconcileSessions 가 꺼진 프로세스의
    // 세션을 버리므로 이번 샘플에서 짝지을 수 있는(live) Claude 로만 잇는다.
    const claudeKeys = new Map(
      agentProcs
        .filter(({ p, tool }) => tool === 'claude' && worktrees.has(p.pid))
        .map(({ p }) => [p.pid, agentKey(p)])
    )
    pairBySessionFile(deps.sessions, files, (pid) => claudeKeys.get(pid) ?? null)
    // 세션 파일로 지금 세션을 아는 프로세스는 추측의 후보가 아니다(남의 세션을 넘겨받지 않게).
    reconcileSessions(deps.sessions, {
      now,
      sampledAt,
      live,
      rootOfCwd: (cwd) => roots.get(cwd) ?? null,
      exact: new Set(fileSessionOf.keys())
    })

    const { agents: hooked, cpu } = buildAgents({
      sample: raw,
      worktrees,
      devServerPids,
      previousCpu,
      now: sampledAt,
      hookFor: hookFor(roots)
    })
    previousCpu = cpu
    // 훅 상태가 없거나 파일이 더 늦은 근거인 Claude 에이전트는 세션 파일의 상태를 쓴다.
    const built = hooked.map((a) =>
      a.tool === 'claude' && sessionFiles.has(a.pid) ? stateFrom(a, hookOfRow(roots)(a)) : a
    )
    rollouts = await readRollouts(built, raw.cwds ?? {}, now)
    const withRollout = built.map((a): AgentRow => {
      const r = rollouts.get(a.pid)
      if (!r) return a
      if (a.stateSource === 'cpu') return { ...a, state: r.state, stateSource: 'rollout' }
      // 훅은 작업 중인데 세션 기록에 그 뒤 끝 이벤트가 있으면(오류로 끝난 턴 등) 세션 기록을 따른다.
      const since = hookOfRow(roots)(a)?.since
      return r.state !== 'working' && since != null && r.since >= since
        ? { ...a, state: r.state, stateSource: 'rollout' }
        : a
    })
    const stated = withStateSince(withRollout, agentStates, sampledAt, exactSinceFor(roots))
    agentStates = stated.memo
    const active = withAgentActivity(
      withActivity(stated.agents, roots, sampledAt, options.agentParkedMs),
      roots,
      options.showAgentActivity
    )

    // 작업 공간은 판단 전에 정한다: 같은 작업 공간에서 에이전트가 일하면 그 작업 공간의 서버·남은 프로세스는
    // 정리 후보로 올리지 않는다(스펙 §4 — 다른 저장소에서 일하는 에이전트가 이 서버를 쓰고 있을 수 있다).
    // 덮는 에이전트가 모두 오래 쉬는 세션이면 서버는 확인해볼 것까지만 오른다(G2, judgeServers).
    const workspaceOf = await resolveWorkspaces(
      [
        ...snapshot.servers.map((r) => r.worktree),
        ...snapshot.leftovers.map((r) => r.worktree),
        ...snapshot.heavyJobs.map((r) => r.worktree),
        ...active.map((a) => a.worktree)
      ],
      options.workspaceAliases
    )
    const withWorkspace = <T extends { worktree: WorktreeInfo | null }>(
      row: T
    ): T & { workspace: WorkspaceInfo | null } => ({ ...row, workspace: workspaceOf(row.worktree) })
    const agents = active.map(withWorkspace)
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
    const restated = snapshot.agents.map((a): AgentRow => {
      const hook = hookOfRow(rootOfCwd)(a)
      // 세션 기록 상태는 다음 수집에서 다시 읽는다. 그보다 새 훅 이벤트(새 입력 등)가 왔을 때만 훅을 따른다.
      if (a.stateSource === 'rollout') {
        const r = rollouts.get(a.pid)
        if (!hook || (r && hook.since <= r.since)) return a
      }
      // 세션 파일은 다음 수집에서 다시 읽는다. 마지막으로 읽은 파일과 훅 가운데 더 늦은 근거를 따른다
      // (훅 상태가 생기지 않은 파일 행은 그대로).
      return stateFrom(a, hook)
    })
    const now = deps.now()
    const options = deps.options()
    const stated = withStateSince(restated, agentStates, now, exactSinceFor(rootOfCwd))
    agentStates = stated.memo
    const agents = withAgentActivity(
      withActivity(stated.agents, rootOfCwd, now, options.agentParkedMs),
      rootOfCwd,
      options.showAgentActivity
    )
    return { ...snapshot, agents }
  }

  function exportState(): CollectorState {
    return {
      servers: serverHistory.export(),
      serverMemo: Object.fromEntries(serverMemo),
      agentStates: Object.fromEntries(agentStates),
      agentSeen: Object.fromEntries(agentSeen)
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
    agentSeen = new Map(
      Object.entries(state.agentSeen ?? {}).filter(
        ([, v]) => v.firstSeen <= now && (v.lastWorking === null || v.lastWorking <= now)
      )
    )
  }

  return { collect, restate, exportState, importState }
}
