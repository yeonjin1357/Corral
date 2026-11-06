import type {
  AgentRow,
  ClaudeHookStatus,
  DashboardSnapshot,
  Platform,
  ProcessInfo,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { worktreeKey } from '../shared/format'
import { buildAgents, cpuState, type CpuMemo } from './agents'
import { judgePorts, type PortMemo } from './judge'
import { topLevelAgentPids } from './processTree'
import { pruneSessions, stateForWorktree, type Sessions } from './sessions'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'

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
  /** 훅 서버가 채우는 Claude 세션들(수집기는 읽고 끝난 것을 버린다). */
  sessions: Sessions
  hookStatus: () => Promise<ClaudeHookStatus>
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
  idlePortMs: number
  selfPid: number
  now: () => number
}

/**
 * 한 번의 수집: 샘플 → 메모리 → 워크트리 → 스냅샷(포트·남은 프로세스) → 에이전트 → 포트 판단.
 * 이전 샘플의 CPU 와 포트별 "안 쓰인 시각"을 기억한다. 스냅샷을 만들 때마다 Claude 세션의 워크트리를 다시 판별한다.
 */
export function createCollector(deps: CollectorDeps): {
  collect(): Promise<DashboardSnapshot>
  /** 다시 샘플링하지 않고 훅 세션 상태만 새로 반영한다(훅 이벤트가 왔을 때). */
  restate(snapshot: DashboardSnapshot): Promise<DashboardSnapshot>
} {
  let previousCpu: CpuMemo = new Map()
  let portMemo: PortMemo = new Map()
  /** 세션 작업 폴더 → 워크트리 키. 수집 때마다 다시 판별하고, 그 사이 새 세션은 restate 가 채운다. */
  let rootOfCwd = new Map<string, string | null>()

  const hookStateFor =
    (roots: Map<string, string | null>) =>
    (root: string): ReturnType<typeof stateForWorktree> =>
      stateForWorktree(deps.sessions, worktreeKey(root), (cwd) => roots.get(cwd) ?? null)

  /** known 에 없는 세션 작업 폴더만 판별해 더한 새 표를 돌려준다(known 이 없으면 전부 다시). */
  async function resolveSessionRoots(
    known: Map<string, string | null> = new Map()
  ): Promise<Map<string, string | null>> {
    const cwds = [...new Set([...deps.sessions.values()].map((s) => s.cwd))].filter(
      (cwd) => !known.has(cwd)
    )
    const resolved = await Promise.all(
      cwds.map(async (cwd): Promise<[string, string | null]> => {
        try {
          const w = await deps.resolveWorktree(cwd)
          return [cwd, w ? worktreeKey(w.root) : null]
        } catch {
          return [cwd, null]
        }
      })
    )
    return new Map([...known, ...resolved])
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
    const [raw, memory] = await Promise.all([deps.sample(), deps.readMemory()])
    const needed = pidsForWorktreeLookup(raw, deps.platform)
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
      thresholds: deps.thresholds,
      now,
      selfPid: deps.selfPid,
      platform: deps.platform
    })

    const devServerPids = new Set(snapshot.ports.flatMap((p) => [p.pid, ...p.descendantPids]))
    const [roots, hook] = await Promise.all([resolveSessionRoots(), readHookStatus()])
    rootOfCwd = roots
    const { agents, cpu } = buildAgents({
      sample: raw,
      worktrees,
      devServerPids,
      previousCpu,
      now: sampledAt,
      hookStates: hookStateFor(roots)
    })
    previousCpu = cpu

    const judged = judgePorts(snapshot.ports, agents, portMemo, now, deps.idlePortMs)
    portMemo = judged.memo

    // 샘플 전에 소식이 온 세션인데 그 워크트리에 Claude 가 없으면 SessionEnd 없이 끝난 세션이다.
    const liveRoots = new Set(
      agents.flatMap((a) =>
        a.tool === 'claude' && a.worktree ? [worktreeKey(a.worktree.root)] : []
      )
    )
    pruneSessions(deps.sessions, {
      now,
      sampledAt,
      liveRoots,
      rootOfCwd: (cwd) => roots.get(cwd) ?? null
    })

    return { ...snapshot, ports: judged.rows, agents, hook }
  }

  async function restate(snapshot: DashboardSnapshot): Promise<DashboardSnapshot> {
    rootOfCwd = await resolveSessionRoots(rootOfCwd)
    const hookState = hookStateFor(rootOfCwd)
    const agents = snapshot.agents.map((a): AgentRow => {
      const fromHook = a.tool === 'claude' && a.worktree ? hookState(a.worktree.root) : null
      return {
        ...a,
        state: fromHook ?? cpuState(a.cpuPercent),
        stateSource: fromHook ? 'hook' : 'cpu'
      }
    })
    return { ...snapshot, agents }
  }

  return { collect, restate }
}
