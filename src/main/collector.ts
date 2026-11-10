import { hiddenMatches } from '../shared/settings'
import type {
  AgentActivity,
  AgentRow,
  AgentTool,
  ClaudeHookStatus,
  CodexHookStatus,
  CodexLimits,
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
import {
  isParked,
  lastActiveOf,
  stillQuiet,
  trackQuiet,
  trackSeen,
  type CalmMemo,
  type SeenMemo
} from './activity'
import { fileStateOver, waitReasonOf, type ClaudeSessionFile } from './claudeSessionFiles'
import type { UsageCache, UsageTarget } from './claudeUsage'
import { activityOf, judgeServers, type ServerMemo } from './judge'
import { agentToolOf, topLevelAgentPids } from './processTree'
import {
  claudeTranscriptFor,
  codexTranscriptFor,
  hookViewForAgent,
  oneLine,
  pairBySessionFile,
  reconcileSessions,
  settleWaiting,
  type HookView,
  type LiveClaude,
  type Sessions
} from './sessions'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'
import { createServerHistory, type ServerHistoryData } from './serverHistory'
import { cwdKey, type CodexInfo, type CodexRolloutAgent, type RolloutState } from './codexRollout'
import type { AgentSeenData, AgentStateData, ServerMemoData } from './historyStore'
import { agentKey, selectionKey } from '../shared/keys'
import { text } from '../shared/text'
import { normalizeCandidate, selfWorkspace } from './collect/worktree'
import { buildWorkspaces, withLatestActivity } from './workspaces'

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
  /**
   * 토큰·한도(G6)를 읽는다. 끄면 Claude 세션 기록을 읽게 하지 않고(claudeUsage.want 를 부르지 않음), Codex 는 상태가
   * 필요한 것만 읽으며, 행의 usage·스냅샷의 codexLimits 는 null.
   */
  readUsage: boolean
}

/** 세션 파일의 이름을 제목으로 쓸 때의 길이(훅 제목과 같다). */
const TITLE_MAX = 80

/**
 * 세션 파일의 이름 가운데 제목으로 쓸 것: 어디서 왔는지 알고, Claude Code 가 폴더 이름으로 자동으로 붙인 것(derived)이
 * 아닌 이름만(자동 이름은 프로젝트 칸을 되풀이할 뿐이다).
 */
function fileTitle(file: ClaudeSessionFile | undefined): string | null {
  return file?.nameSource != null && file.nameSource !== 'derived' ? file.name : null
}

/** 이름을 뺀 세션 파일들(하는 일 보기가 꺼져 있으면 이름을 들고 있지 않는다, G3b). 뺄 것이 없으면 그대로. */
function withoutNames(files: Map<number, ClaudeSessionFile>): Map<number, ClaudeSessionFile> {
  if (![...files.values()].some((f) => f.name !== null || f.nameSource !== null)) return files
  return new Map([...files].map(([pid, f]) => [pid, { ...f, name: null, nameSource: null }]))
}

/**
 * 행의 하는 일(G3b): 그 행이 상태를 얻는 훅 세션의 내용에, 훅 제목이 없으면 Claude 세션 파일의 이름(fileTitle, 한 줄
 * 80자)을 제목으로 쓴다(훅 세션이 없어도). 실행 중인 도구는 작업 중·응답 대기일 때만, 권한을 기다리는 도구는 응답 대기일
 * 때만 보인다(세션 파일·Codex 세션 기록이 더 늦은 근거라 상태가 바뀌었으면 옛 도구를 보이지 않게). 권한을 기다리는 그
 * 도구는 실행 중으로 보이지 않는다(늦게 도착한 PreToolUse 등 — 아직 돌지 않았다). 보일 것이 없으면 null.
 */
function rowActivity(
  state: AgentRow['state'],
  hook: AgentActivity | null,
  fileName: string | null
): AgentActivity | null {
  const title = hook?.title ?? oneLine(fileName, TITLE_MAX)
  const prompt = hook?.prompt ?? null
  const waiting = state === 'waiting' ? (hook?.waiting ?? null) : null
  const running = state === 'working' || state === 'waiting' ? (hook?.tool ?? null) : null
  const tool = running && waiting && running.name === waiting.tool ? null : running
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
    showAgentActivity: s.showAgentActivity,
    readUsage: s.readUsage
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
  /**
   * Codex 세션 기록으로 안 상태(F7)·토큰 숫자·사용 한도(G6). 기록이 없으면 모두 null(상태는 CPU 추정).
   * 없으면 쓰지 않는다.
   */
  codexInfo?: (agent: CodexRolloutAgent, now: number) => Promise<CodexInfo>
  /**
   * Claude 의 토큰 숫자(G6). get 은 기억한 값을 바로 주고(기다리지 않음), want 는 뒤에서 세션 기록을 다시 읽는다.
   * 없으면 Claude 의 usage 는 null.
   */
  claudeUsage?: Pick<UsageCache, 'get' | 'want'>
  /**
   * Claude 실행 중 세션 파일(G3a, pid → 파일). 세션과 프로세스를 정확히 잇고, 훅이 없을 때 작업 중·쉬는 중·응답 대기를
   * 안다.
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
  /**
   * 워크트리의 커밋 안 한 변경 수(G4). get 은 기억한 값을 바로 주고(기다리지 않음), want 는 뒤에서 다시 센다.
   * 없으면 작업 공간의 변경 수는 null.
   */
  changedFiles?: { get(root: string): number | null; want(roots: string[]): void }
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
  /** 에이전트별 조용한 조건(훅으로 작업 중·CPU 낮음)이 이어진 첫 시각(G3c). 수집마다 새로 하고 저장하지 않는다. */
  let calm: CalmMemo = new Map()
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
   * 파일을 따라 응답 대기가 되면 그 이유(waitReason)를 담고, 그 밖에는 이유가 없다.
   */
  function stateFrom(a: AgentRow, hook: HookView | null): AgentRow {
    const file = a.tool === 'claude' ? sessionFiles.get(a.pid) : undefined
    const fromFile = file ? fileStateOver(file, hook) : null
    if (file && fromFile) {
      const reason = fromFile === 'waiting' ? waitReasonOf(file.waitingFor) : null
      return {
        ...a,
        state: fromFile,
        stateSource: 'file',
        waitReason: reason === 'dialog' ? null : reason
      }
    }
    return {
      ...a,
      state: hook?.state ?? cpuState(a.cpuPercent),
      stateSource: hook ? 'hook' : 'cpu',
      waitReason: null
    }
  }

  /**
   * 정확한 근거로 아는 마지막 활동 시각. 훅은 그 프로세스 세션의 마지막 활동 이벤트, Codex 세션 기록은 마지막 이벤트,
   * 세션 파일은 상태가 바뀐 시각(busy 일 때만 지금 — shell·waiting·idle 은 그 상태가 된 뒤 활동이 없다).
   * CPU 추정이거나 모르면 null.
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
   * 행마다 하는 일(G3b)을 채운다(최종 상태가 정해진 뒤 — rowActivity). 설정은 붙이는 그때 새로 읽는다(수집 도중 꺼도 그
   * 결과에 내용이 나가지 않게 — 이 뒤에는 기다림이 없어야 한다). 꺼져 있으면 모두 null 이고 기억한 세션 파일의 이름도
   * 버린다(다시 켜도 다음에 새로 읽을 때까지 제목을 모른다). 세션 파일은 Claude 에만 있다.
   */
  function withAgentActivity(agents: AgentRow[], roots: Map<string, string | null>): AgentRow[] {
    if (!deps.options().showAgentActivity) {
      sessionFiles = withoutNames(sessionFiles)
      return agents.map((a): AgentRow => ({ ...a, activity: null }))
    }
    return agents.map((a): AgentRow => ({
      ...a,
      activity: rowActivity(
        a.state,
        hookOfRow(roots)(a)?.activity ?? null,
        a.tool === 'claude' ? fileTitle(sessionFiles.get(a.pid)) : null
      )
    }))
  }

  /**
   * 폴더별로 본 Codex 프로세스의 생존 구간(시작 ~ 마지막으로 본 시각, 하루 보관). 같은 폴더의 다른 프로세스가
   * 살아 있던 동안 만든 기록 파일은 그 프로세스 것일 수 있어 고르지 않는다(먼저 꺼진 프로세스의 파일을 읽지 않게).
   */
  const codexLives = new Map<string, Map<string, { startedAt: number; lastSeen: number }>>()

  /**
   * 세션 기록의 상태를 쓸 Codex: CPU 추정인 것, 그리고 훅으로 작업 중인 것(오류로 끝난 턴은 Stop 이 오지 않아 세션
   * 기록으로 바로잡는다).
   */
  const rolloutDecides = (a: AgentRow): boolean =>
    a.stateSource === 'cpu' || (a.stateSource === 'hook' && a.state === 'working')

  /**
   * Codex 에이전트마다 세션 기록을 읽는다: 상태가 필요한 것(rolloutDecides), 토큰 숫자를 읽으면(G6, withUsage)
   * 지금 도는 Codex 모두. 같은 폴더에서 Codex 가 둘 이상 돌면 어느 쪽 기록인지 알 수 없어 읽지 않는다(지어내지 않음).
   * 실패하면 그 에이전트는 읽은 것이 없다(CPU 추정 그대로).
   */
  async function readRollouts(
    agents: AgentRow[],
    cwds: Record<number, string>,
    now: number,
    withUsage: boolean
  ): Promise<Map<number, CodexInfo>> {
    const result = new Map<number, CodexInfo>()
    const read = deps.codexInfo
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
    const wanted = running.filter((a) => withUsage || rolloutDecides(a))
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
          const info = await read(
            {
              cwd,
              startedAt: a.startedAt,
              ...(exclude.length ? { exclude } : {}),
              ...(transcriptPath ? { transcriptPath } : {})
            },
            now
          )
          result.set(a.pid, info)
        } catch {
          // 읽지 못하면 CPU 추정을 쓴다.
        }
      })
    )
    return result
  }

  /**
   * 그 Claude 에이전트의 토큰 숫자를 읽을 세션 기록(G6): 그 프로세스와 짝지은 세션(세션 파일의 세션이 먼저)의 기록
   * 파일, 경로를 모르면 세션 id(읽는 쪽이 찾는다). 짝이 없으면 null.
   */
  function usageTargetOf(a: AgentRow): UsageTarget | null {
    if (a.tool !== 'claude') return null
    const key = agentKey(a)
    return claudeTranscriptFor(deps.sessions, key, fileSessionOf.get(key) ?? null)
  }

  /**
   * 행마다 토큰 숫자(G6)를 붙인다: Claude 는 기억(claudeUsage)한 값, Codex 는 이번 수집에서 읽은 세션 기록의 값.
   * 설정은 붙이는 그때 새로 읽는다(수집 도중 꺼도 그 결과에 숫자가 나가지 않게 — 이 뒤에는 기다림이 없어야 한다).
   */
  function withTokenUsage(
    agents: AgentRow[],
    claude: Map<number, UsageTarget>,
    codex: Map<number, CodexInfo>
  ): AgentRow[] {
    if (!deps.options().readUsage) return agents.map((a): AgentRow => ({ ...a, usage: null }))
    return agents.map((a): AgentRow => {
      if (a.tool === 'codex') return { ...a, usage: codex.get(a.pid)?.usage ?? null }
      const target = claude.get(a.pid)
      return { ...a, usage: target ? (deps.claudeUsage?.get(target.sessionId) ?? null) : null }
    })
  }

  /** 지금 도는 Codex 의 세션 기록 가운데 가장 최근 token_count 의 사용 한도(G6). 없거나 설정이 꺼져 있으면 null. */
  function latestLimits(codex: Map<number, CodexInfo>): CodexLimits | null {
    if (!deps.options().readUsage) return null
    let latest: CodexLimits | null = null
    for (const { limits } of codex.values())
      if (limits && (latest === null || limits.at > latest.at)) latest = limits
    return latest
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
    // 하는 일 보기가 꺼져 있으면 세션 파일의 이름은 받는 순간 버린다(G3b).
    sessionFiles = deps.options().showAgentActivity ? files : withoutNames(files)
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

    const {
      agents: hooked,
      cpu,
      members: agentMembers
    } = buildAgents({
      sample: raw,
      worktrees,
      devServerPids,
      previousCpu,
      now: sampledAt,
      hookFor: hookFor(roots),
      selfPid: deps.selfPid
    })
    previousCpu = cpu
    // 훅 상태가 없거나 파일이 더 늦은 근거인 Claude 에이전트는 세션 파일의 상태를 쓴다.
    const built = hooked.map((a) => {
      const file = a.tool === 'claude' ? sessionFiles.get(a.pid) : undefined
      if (!file) return a
      const hook = hookOfRow(roots)(a)
      const row = stateFrom(a, hook)
      // 파일의 더 늦은 busy(답하고 다시 일함)가 훅의 응답 대기를 이겼으면 그 훅 세션도 작업 중으로 정리한다: 대기를
      // 풀지 않는 다른 도구의 이벤트가 대기를 되살리지 않고, 그 뒤의 새 권한 요청은 새 대기로 시작하게.
      // 이 수집이 시작된 뒤에 그 세션에 훅 활동이 있었으면 정리하지 않는다(기다리는 사이 다른 도구의 권한 요청이 왔을 수
      // 있다 — 그 대기와 도구 이름을 지우지 않게). 다음 수집이 정한다.
      if (
        hook?.state === 'waiting' &&
        row.stateSource === 'file' &&
        row.state === 'working' &&
        file.statusUpdatedAt !== null &&
        hook.lastActivityAt < sampledAt
      )
        settleWaiting(deps.sessions, hook.sessionId, file.statusUpdatedAt)
      return row
    })
    const codexInfos = await readRollouts(built, raw.cwds ?? {}, now, options.readUsage)
    // 상태는 세션 기록이 정하는 Codex 에만 쓴다(숫자만 읽은 훅 상태의 Codex 는 훅 상태 그대로).
    rollouts = new Map(
      built.flatMap((a) => {
        const state = rolloutDecides(a) ? codexInfos.get(a.pid)?.state : null
        return state ? [[a.pid, state] as const] : []
      })
    )
    // 토큰 숫자(G6): 짝지은 Claude 세션의 기록을 뒤에서 읽게 한다(기다리지 않는다). 기억한 값은 마지막에 붙인다.
    // 설정은 want 바로 전에 새로 읽는다(사이에 기다림 없음): 수집 도중 끄면 — 끌 때 기억을 비운 뒤라도 — 다시 읽게 하지 않는다.
    const usageTargets = new Map<number, UsageTarget>()
    if (deps.claudeUsage && deps.options().readUsage) {
      for (const a of built) {
        const target = usageTargetOf(a)
        if (target) usageTargets.set(a.pid, target)
      }
      deps.claudeUsage.want([...usageTargets.values()])
    }
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
    // 조용한 에이전트(G3c)는 최종 상태·CPU·마지막 활동이 정해진 뒤에 판단한다.
    const quiet = trackQuiet(
      withActivity(stated.agents, roots, sampledAt, options.agentParkedMs),
      calm,
      sampledAt
    )
    calm = quiet.memo
    const active = quiet.agents

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
    // 하는 일(G3b)·토큰 숫자(G6)는 마지막 기다림(작업 공간 판별) 뒤에 붙인다: 그 사이 설정을 꺼도 이 결과에 나가지 않게.
    const agents = withTokenUsage(withAgentActivity(active, roots), usageTargets, codexInfos).map(
      withWorkspace
    )
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
    const shownServers = servers.map(grown)
    const heavyJobs = snapshot.heavyJobs.map(withWorkspace)
    // 작업 공간 합계(G4): 숨긴 서버는 넣지 않는다. 변경 수는 기억한 값만 쓰고, 든 워크트리를 뒤에서 다시 세게 한다.
    const changed = deps.changedFiles
    changed?.want([
      ...new Set(
        [...agents, ...shownServers, ...heavyJobs, ...leftovers].flatMap((r) =>
          r.worktree ? [r.worktree.root] : []
        )
      )
    ])
    const workspaces = buildWorkspaces({
      processes: raw.processes,
      servers: shownServers,
      agents,
      heavyJobs,
      leftovers,
      agentMembers,
      changed: (root) => changed?.get(root) ?? null,
      unknownName: text.ui.tags.noWorktree
    })
    return {
      ...snapshot,
      servers: shownServers,
      hiddenServers: hiddenServers.map(grown),
      leftovers,
      heavyJobs,
      agents,
      workspaces,
      hook,
      codexHook,
      codexLimits: latestLimits(codexInfos)
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
      // (훅 상태가 생기지 않은 파일 행은 그대로). 훅 세션은 고치지 않는다(응답 대기 정리는 수집만 한다).
      return stateFrom(a, hook)
    })
    const now = deps.now()
    const stated = withStateSince(restated, agentStates, now, exactSinceFor(rootOfCwd))
    agentStates = stated.memo
    // 조용함(G3c)은 새 이벤트가 왔으면 지우기만 한다(새로 붙이는 것은 다음 수집).
    const active = withActivity(stated.agents, rootOfCwd, now, deps.options().agentParkedMs).map(
      (a): AgentRow => ({ ...a, quietSince: stillQuiet(a) })
    )
    // 토큰 숫자(G6)는 다음 수집까지 그대로 둔다(설정을 껐으면 바로 숨긴다).
    const usageOn = deps.options().readUsage
    const agents = withAgentActivity(active, rootOfCwd).map((a): AgentRow =>
      usageOn ? a : { ...a, usage: null }
    )
    // 작업 공간 합계는 다음 수집까지 그대로 두고, 에이전트의 마지막 활동만 다시 반영한다.
    return {
      ...snapshot,
      agents,
      workspaces: withLatestActivity(snapshot.workspaces, agents),
      codexLimits: usageOn ? snapshot.codexLimits : null
    }
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
