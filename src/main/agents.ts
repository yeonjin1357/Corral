import type { AgentRow, AgentState, ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'
import { worktreeFolder } from '../shared/format'
import { agentToolOf, buildTree, topLevelAgentPids } from './snapshot'

/** 하위 트리 CPU 사용률이 코어 1개 기준 이 값(%) 이상이면 작업 중으로 본다. */
export const WORKING_CPU_PERCENT = 2

/** 프로세스별 지난 샘플의 누적 CPU 시간. 키는 `pid:시작 시각`(pid 재사용 구분). */
export type CpuMemo = Map<string, { cpuMs: number; at: number }>

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

export function buildAgents(input: {
  sample: RawSample
  worktrees: Map<number, WorktreeInfo>
  /** 개발 서버 포트 행의 프로세스와 자손. 에이전트가 띄운 개발 서버는 에이전트 몫으로 세지 않는다. */
  devServerPids: Set<number>
  previousCpu: CpuMemo
  now: number
  /** 워크트리의 Claude 훅 상태. 없으면 null. */
  hookStates?: (worktreeRoot: string) => AgentState | null
}): { agents: AgentRow[]; cpu: CpuMemo } {
  const { sample, worktrees, devServerPids, previousCpu, now } = input
  const tree = buildTree(sample.processes)
  const cpu: CpuMemo = new Map()
  const agents: AgentRow[] = []

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
    for (const m of members) if (m.cpuMs != null) cpu.set(cpuKey(m), { cpuMs: m.cpuMs, at: now })

    const prevSelf = previousCpu.get(cpuKey(self))
    let cpuPercent: number | null = null
    if (prevSelf && self.cpuMs != null && now > prevSelf.at) {
      const delta = cpuDelta(members, previousCpu, prevSelf.at)
      // 표시값과 판단이 어긋나지 않게(1.98% 를 2.0% 로 보이며 쉬는 중이라 하지 않게) 내려서 쓴다.
      cpuPercent = Math.floor((delta * 1000) / (now - prevSelf.at)) / 10
    }

    const worktree = worktrees.get(pid) ?? null
    const hookState =
      tool === 'claude' && worktree && input.hookStates ? input.hookStates(worktree.root) : null
    const cpuState: AgentState =
      cpuPercent == null ? 'unknown' : cpuPercent >= WORKING_CPU_PERCENT ? 'working' : 'idle'

    agents.push({
      pid,
      tool,
      worktree,
      startedAt: self.startedAt,
      memoryBytes: members.reduce((sum, m) => sum + m.memoryBytes, 0),
      descendantCount: descendants.length,
      state: hookState ?? cpuState,
      stateSource: hookState ? 'hook' : 'cpu',
      cpuPercent
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
  return { agents, cpu }
}
