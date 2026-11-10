import type {
  AgentRow,
  AgentState,
  AgentTool,
  ProcessInfo,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { commitSum, worktreeFolder } from '../shared/format'
import { agentKey } from '../shared/keys'
import { agentToolOf, buildTree, topLevelAgentPids } from './processTree'
import { summarizeProcesses } from './processSummary'
import type { HookView } from './sessions'

/** 하위 트리 CPU 사용률이 코어 1개 기준 이 값(%) 이상이면 작업 중으로 본다. */
export const WORKING_CPU_PERCENT = 2

/**
 * 이보다 짧은 간격으로 다시 재면(지금 새로고침 등) CPU 사용률을 새로 계산하지 않는다.
 * 짧은 구간은 잠깐 튄 값(예: 0.3초 동안 60ms = 20%)이 그대로 작업 중으로 보인다.
 */
export const MIN_CPU_WINDOW_MS = 2000

/**
 * 프로세스별 지난 샘플의 누적 CPU 시간. 키는 `pid:시작 시각`(pid 재사용 구분).
 * 에이전트 자신의 기록에는 그때 계산한 사용률(percent)도 남겨, 짧은 간격으로 다시 잴 때 그대로 쓴다.
 */
export type CpuMemo = Map<string, { cpuMs: number; at: number; percent?: number | null }>

function cpuKey(p: ProcessInfo): string {
  return `${p.pid}:${p.startedAt ?? ''}`
}

/**
 * 지난 샘플 이후 하위 트리가 쓴 CPU(ms). 프로세스마다 변화량을 더해, 그사이 끝난 자식 때문에
 * 합이 줄어 음수가 되는 일을 막는다. 기록이 없는 프로세스는 지난 샘플 뒤에 시작한 경우에만
 * 누적값 전체를 그 사이에 쓴 것으로 센다.
 */
function cpuDelta(members: ProcessInfo[], previous: CpuMemo, since: number): number {
  let delta = 0
  for (const m of members) {
    if (m.cpuMs == null) continue
    const prev = previous.get(cpuKey(m))
    if (prev) delta += Math.max(0, m.cpuMs - prev.cpuMs)
    else if (m.startedAt != null && m.startedAt >= since) delta += m.cpuMs
  }
  return delta
}

/**
 * 맨 위 프로세스(self)와 그 트리(members, self 포함)의 CPU 사용률(코어 1개 = 100, 소수 1자리 내림).
 * 지난 기록(previous)과 비교하고 이번 기록을 next 에 쓴다. 지난 기록이 없으면 null.
 * 짧은 간격(MIN_CPU_WINDOW_MS 미만)으로 다시 재면 지난 값을 그대로 쓰고, 기준(지난 샘플)을 넘겨
 * 다음 샘플이 충분히 긴 구간으로 재게 한다. 에이전트와 서버가 같은 계산을 쓴다.
 */
export function measureTreeCpu(
  self: ProcessInfo,
  members: ProcessInfo[],
  previous: CpuMemo,
  now: number,
  next: CpuMemo
): number | null {
  const prevSelf = previous.get(cpuKey(self))
  if (prevSelf && now - prevSelf.at < MIN_CPU_WINDOW_MS) {
    for (const m of members) {
      const prev = previous.get(cpuKey(m))
      if (prev) next.set(cpuKey(m), prev)
      else if (m.cpuMs != null) next.set(cpuKey(m), { cpuMs: m.cpuMs, at: now })
    }
    return prevSelf.percent ?? null
  }
  let cpuPercent: number | null = null
  if (prevSelf && self.cpuMs != null && now > prevSelf.at) {
    const delta = cpuDelta(members, previous, prevSelf.at)
    // 표시값과 판단이 어긋나지 않게(1.98% 를 2.0% 로 보이며 쉬는 중이라 하지 않게) 내려서 쓴다.
    cpuPercent = Math.floor((delta * 1000) / (now - prevSelf.at)) / 10
  }
  for (const m of members) if (m.cpuMs != null) next.set(cpuKey(m), { cpuMs: m.cpuMs, at: now })
  if (self.cpuMs != null)
    next.set(cpuKey(self), { cpuMs: self.cpuMs, at: now, percent: cpuPercent })
  return cpuPercent
}

/** 에이전트별 지금 상태와 그 상태를 처음 본 시각. 키는 agentKey. */
export type AgentStateMemo = Map<string, { state: AgentState; since: number }>

/**
 * 에이전트 상태가 시작된 시각(F3)을 채운다. 정확한 상태(훅·Codex 세션 기록)는 그 상태가 된 이벤트 시각(exactSince),
 * CPU 추정은 pitwall 이 그 상태를 처음 본 시각(memo). 아직 모르는 상태(unknown)는 시각 없음.
 * memo 에는 지금 있는 에이전트만 남긴다.
 */
export function withStateSince(
  agents: AgentRow[],
  previous: AgentStateMemo,
  now: number,
  exactSince: (agent: AgentRow) => number | null
): { agents: AgentRow[]; memo: AgentStateMemo } {
  const memo: AgentStateMemo = new Map()
  const rows = agents.map((a): AgentRow => {
    if (a.state === 'unknown') return { ...a, stateSince: null }
    const key = agentKey(a)
    const prev = previous.get(key)
    const exact = a.stateSource === 'cpu' ? null : exactSince(a)
    const since = exact ?? (prev && prev.state === a.state ? prev.since : now)
    memo.set(key, { state: a.state, since })
    return { ...a, stateSince: since }
  })
  return { agents: rows, memo }
}

/** CPU 사용률로 짐작한 상태. 모르면 unknown. */
export function cpuState(cpuPercent: number | null): AgentState {
  if (cpuPercent == null) return 'unknown'
  return cpuPercent >= WORKING_CPU_PERCENT ? 'working' : 'idle'
}

export function buildAgents(input: {
  sample: RawSample
  worktrees: Map<number, WorktreeInfo>
  /** 개발 서버 포트 행의 프로세스와 자손. 에이전트가 띄운 개발 서버는 에이전트 몫으로 세지 않는다. */
  devServerPids: Set<number>
  previousCpu: CpuMemo
  now: number
  /**
   * 그 에이전트 프로세스의 훅 상태(G3a — 그 프로세스와 짝지은 세션, 없으면 그 워크트리의 짝 없는 세션, 도구별).
   * 워크트리를 모르면 worktreeRoot 는 null. 없으면 null.
   */
  hookFor?: (agent: {
    key: string
    worktreeRoot: string | null
    tool: AgentTool
  }) => HookView | null
}): {
  agents: AgentRow[]
  cpu: CpuMemo
  /** agentKey → 자기와 센 자손(개발 서버가 아닌 것) pid. 메모리·커밋에 센 프로세스와 같다. */
  members: Map<string, number[]>
} {
  const { sample, worktrees, devServerPids, previousCpu, now } = input
  const tree = buildTree(sample.processes)
  const cpu: CpuMemo = new Map()
  const agents: AgentRow[] = []
  const memberPids = new Map<string, number[]>()

  for (const pid of topLevelAgentPids(sample.processes, tree)) {
    const self = tree.byPid.get(pid)
    const tool = self && agentToolOf(self)
    if (!self || !tool) continue
    const descendants = tree
      .descendants(pid)
      .filter((d) => !devServerPids.has(d))
      .map((d) => tree.byPid.get(d))
      .filter((p): p is ProcessInfo => p !== undefined)
    const members = [self, ...descendants]
    const cpuPercent = measureTreeCpu(self, members, previousCpu, now, cpu)

    const worktree = worktrees.get(pid) ?? null
    const key = agentKey({ pid, startedAt: self.startedAt })
    const hook = input.hookFor?.({ key, worktreeRoot: worktree?.root ?? null, tool }) ?? null
    const pids = members.map((m) => m.pid)
    memberPids.set(key, pids)

    agents.push({
      pid,
      tool,
      worktree,
      workspace: null,
      startedAt: self.startedAt,
      memoryBytes: members.reduce((sum, m) => sum + m.memoryBytes, 0),
      commitBytes: commitSum(members),
      descendantCount: descendants.length,
      processes: summarizeProcesses(members),
      state: hook?.state ?? cpuState(cpuPercent),
      stateSource: hook ? 'hook' : 'cpu',
      // 상태 시작 시각·마지막 활동·오래 쉬는 세션은 이전 것을 기억하는 수집기가 채운다.
      stateSince: null,
      cpuPercent,
      lastActiveAt: null,
      parked: false,
      // 하는 일(G3b)은 최종 상태·세션 파일·설정을 아는 수집기가 채운다.
      activity: null,
      // 조용함(G3c)은 조용한 조건이 이어진 시각을 기억하는 수집기가 채운다.
      quietSince: null
    })
  }

  agents.sort((a, b) => {
    if (!a.worktree !== !b.worktree) return a.worktree ? -1 : 1
    return (
      worktreeFolder(a.worktree).localeCompare(worktreeFolder(b.worktree)) ||
      (a.worktree?.root ?? '').localeCompare(b.worktree?.root ?? '') ||
      a.pid - b.pid
    )
  })
  return { agents, cpu, members: memberPids }
}
