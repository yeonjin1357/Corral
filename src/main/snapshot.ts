import type {
  DashboardSnapshot,
  GroupUsage,
  MemoryLevel,
  MemorySummary,
  Platform,
  PortRow,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { DEFAULT_THRESHOLDS } from '../shared/defaults'
import { worktreeKey } from '../shared/format'
import { findLeftovers } from './leftovers'
import { buildTree, classifyAgent, topLevelAgentPids, type ProcessTree } from './processTree'

/** WSL·Docker·Podman 처럼 다른 환경의 포트를 대신 열어 주는 프로세스. 어느 worktree 것인지 알 수 없다. */
export const RELAY_PROCESS_NAMES: readonly string[] = [
  'wslrelay.exe',
  'com.docker.backend.exe',
  'com.docker.backend',
  'vpnkit',
  'com.docker.vpnkit',
  'docker-proxy',
  'gvproxy',
  'gvproxy.exe',
  'win-sshproxy.exe'
]
const RELAY_SET = new Set(RELAY_PROCESS_NAMES.map((n) => n.toLowerCase()))

/** 1024 미만은 OS·시스템 서비스가 쓰는 포트라 개발 서버로 보지 않는다. */
const MIN_DEV_PORT = 1024
const MAX_ANCESTOR_DEPTH = 3

export function levelOf(
  usedPercent: number,
  t: { ramWarnPercent: number; ramDangerPercent: number } = DEFAULT_THRESHOLDS
): MemoryLevel {
  if (usedPercent >= t.ramDangerPercent) return 'danger'
  if (usedPercent >= t.ramWarnPercent) return 'warn'
  return 'normal'
}

/** 에이전트와 그 자손 pid. */
function agentTreePids(sample: RawSample, tree: ProcessTree): Set<number> {
  const pids = new Set<number>()
  for (const p of sample.processes)
    if (classifyAgent(p)) for (const member of [p.pid, ...tree.descendants(p.pid)]) pids.add(member)
  return pids
}

/**
 * worktree 를 찾아보는 pid: 개발용 포트(1024 이상)를 연 프로세스와 그 위 3단계 조상, 최상위 에이전트,
 * 남은 프로세스 후보와 그 자손.
 * 모든 프로세스의 경로를 확인하면 파일 시스템 조회가 수백 배 늘고, 응답 없는 네트워크 드라이브에 막힐 수 있다.
 */
export function pidsForWorktreeLookup(sample: RawSample, platform?: Platform): Set<number> {
  const tree = buildTree(sample.processes)
  const pids = new Set<number>()
  for (const t of sample.tcp) {
    if (
      t.state !== 'Listen' ||
      t.localPort < MIN_DEV_PORT ||
      pids.has(t.pid) ||
      !tree.byPid.has(t.pid)
    )
      continue
    pids.add(t.pid)
    for (const ancestor of tree.ancestors(t.pid, MAX_ANCESTOR_DEPTH)) pids.add(ancestor.pid)
  }
  for (const pid of topLevelAgentPids(sample.processes, tree)) pids.add(pid)
  // 개발 서버 판별 전이라 개발 서버 트리는 아직 못 뺀다(후보가 조금 더 많을 뿐).
  const exclude = agentTreePids(sample, tree)
  for (const row of findLeftovers(sample, new Map(), { exclude, platform }))
    for (const pid of [row.pid, ...row.descendantPids]) pids.add(pid)
  return pids
}

function summarizeMemory(
  totalBytes: number,
  freeBytes: number,
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
): MemorySummary {
  const total = Math.max(0, totalBytes)
  const used = Math.min(total, Math.max(0, total - freeBytes))
  const usedPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
  return {
    totalBytes: total,
    usedBytes: used,
    usedPercent,
    level: levelOf(usedPercent, thresholds)
  }
}

export function buildSnapshot(input: {
  sample: RawSample
  worktrees: Map<number, WorktreeInfo>
  totalBytes: number
  freeBytes: number
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
  now: number
  /** pitwall 자신의 pid. 자신과 자식이 연 포트는 목록에 올리지 않는다(스스로를 내리지 않도록). */
  selfPid?: number
  /** macOS 는 부모가 끝난 프로세스가 launchd(1) 아래로 옮겨진다(남은 프로세스 판단). */
  platform?: Platform
}): DashboardSnapshot {
  const { sample, worktrees } = input
  const tree = buildTree(sample.processes)
  const self = new Set<number>(
    input.selfPid ? [input.selfPid, ...tree.descendants(input.selfPid)] : []
  )
  const memoryOf = (pids: Iterable<number>): number => {
    let sum = 0
    for (const pid of pids) sum += tree.byPid.get(pid)?.memoryBytes ?? 0
    return sum
  }

  const worktreeOf = (pid: number): WorktreeInfo | null => {
    const own = worktrees.get(pid)
    if (own) return own
    for (const ancestor of tree.ancestors(pid, MAX_ANCESTOR_DEPTH)) {
      const found = worktrees.get(ancestor.pid)
      if (found) return found
    }
    return null
  }

  const clients = new Map<string, number>()
  for (const t of sample.tcp) {
    if (t.state !== 'Established') continue
    const key = `${t.pid}:${t.localPort}`
    clients.set(key, (clients.get(key) ?? 0) + 1)
  }

  const ports: PortRow[] = []
  const seen = new Set<string>()
  for (const t of sample.tcp) {
    if (t.state !== 'Listen' || t.localPort < MIN_DEV_PORT || self.has(t.pid)) continue
    const key = `${t.localPort}:${t.pid}`
    if (seen.has(key)) continue
    seen.add(key)
    const p = tree.byPid.get(t.pid)
    // 에이전트가 연 포트(예: Claude Code 의 IDE 연동 포트)는 내리면 세션이 끊기므로 개발 서버로 보지 않는다.
    if (!p || classifyAgent(p)) continue
    const worktree = worktreeOf(p.pid)
    const relay = RELAY_SET.has(p.name.toLowerCase())
    if (!worktree && !relay) continue
    const descendantPids = tree.descendants(p.pid)
    ports.push({
      port: t.localPort,
      pid: p.pid,
      processName: p.name,
      commandLine: p.commandLine,
      worktree,
      unresolvable: !worktree,
      memoryBytes: p.memoryBytes + memoryOf(descendantPids),
      descendantPids,
      clientCount: clients.get(`${p.pid}:${t.localPort}`) ?? 0,
      startedAt: p.startedAt,
      // 판단은 이전 샘플을 아는 수집기(judgePorts)가 채운다.
      judgement: null,
      idleSince: null,
      agentInWorktree: false
    })
  }
  ports.sort((a, b) => a.port - b.port || a.pid - b.pid)

  const devServer = new Set<number>()
  for (const row of ports) {
    devServer.add(row.pid)
    for (const pid of row.descendantPids) devServer.add(pid)
  }

  const agentPids = sample.processes.filter(classifyAgent).map((p) => p.pid)
  const agent = new Set<number>()
  for (const pid of agentPids) {
    for (const member of [pid, ...tree.descendants(pid)])
      if (!devServer.has(member)) agent.add(member)
  }
  const topAgents = topLevelAgentPids(sample.processes, tree)
  const agentProcessCount = topAgents.length

  const agentRoots = new Set(
    topAgents.flatMap((pid) => {
      const w = worktrees.get(pid)
      return w ? [worktreeKey(w.root)] : []
    })
  )
  const leftovers = findLeftovers(sample, worktrees, {
    exclude: new Set([...self, ...devServer, ...agent]),
    agentRoots,
    platform: input.platform
  })

  const memory = summarizeMemory(input.totalBytes, input.freeBytes, input.thresholds)
  const devBytes = memoryOf(devServer)
  const agentBytes = memoryOf(agent)
  const groups: GroupUsage[] = [
    { group: 'devServer', memoryBytes: devBytes, processCount: devServer.size },
    { group: 'agent', memoryBytes: agentBytes, processCount: agent.size },
    {
      group: 'other',
      memoryBytes: Math.max(0, memory.usedBytes - devBytes - agentBytes),
      processCount: Math.max(0, sample.processes.length - devServer.size - agent.size)
    }
  ]

  return {
    takenAt: input.now,
    memory,
    ports,
    leftovers,
    agents: [],
    hook: null,
    groups,
    agentProcessCount,
    stale: false,
    error: null,
    collectMode: sample.collectMode ?? null
  }
}
