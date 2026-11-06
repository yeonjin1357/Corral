import type {
  DashboardSnapshot,
  GroupUsage,
  MemoryLevel,
  MemorySummary,
  PortRow,
  ProcessInfo,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { DEFAULT_THRESHOLDS } from '../shared/defaults'

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

const AGENT_NAME = /^(claude(\.exe)?|codex(-(x86_64|aarch64|arm64|x64|universal)[\w.-]*)?(\.exe)?)$/i
const AGENT_PACKAGE = /@anthropic-ai\/claude-code|@openai\/codex/i
/** Claude 데스크톱 앱(이름이 같은 claude.exe / Claude)과 Electron 보조 프로세스는 에이전트가 아니다. */
const NOT_AGENT = /AnthropicClaude|Claude\.app\/|--type=/i

export function classifyAgent(p: ProcessInfo): boolean {
  const commandLine = p.commandLine.replace(/\\/g, '/')
  if (NOT_AGENT.test(commandLine)) return false
  return AGENT_NAME.test(p.name) || AGENT_PACKAGE.test(commandLine)
}

export function levelOf(
  usedPercent: number,
  t: { ramWarnPercent: number; ramDangerPercent: number } = DEFAULT_THRESHOLDS
): MemoryLevel {
  if (usedPercent >= t.ramDangerPercent) return 'danger'
  if (usedPercent >= t.ramWarnPercent) return 'warn'
  return 'normal'
}

/**
 * Windows 는 부모가 끝나도 자식의 ppid 가 남고, 그 pid 가 나중에 다른 프로세스에 재사용될 수 있다.
 * 부모보다 먼저 시작한 "자식"은 진짜 자식이 아니다.
 */
function isPlausibleChild(child: ProcessInfo, parent: ProcessInfo): boolean {
  if (child.pid === parent.pid) return false
  if (child.startedAt == null || parent.startedAt == null) return true
  return child.startedAt >= parent.startedAt
}

interface ProcessTree {
  byPid: Map<number, ProcessInfo>
  parentOf(pid: number): ProcessInfo | undefined
  descendants(pid: number): number[]
  ancestors(pid: number, maxDepth: number): ProcessInfo[]
}

function buildTree(processes: ProcessInfo[]): ProcessTree {
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const children = new Map<number, number[]>()
  for (const p of processes) {
    const parent = byPid.get(p.ppid)
    if (!parent || !isPlausibleChild(p, parent)) continue
    const list = children.get(parent.pid)
    if (list) list.push(p.pid)
    else children.set(parent.pid, [p.pid])
  }

  const parentOf = (pid: number): ProcessInfo | undefined => {
    const p = byPid.get(pid)
    const parent = p && byPid.get(p.ppid)
    return p && parent && isPlausibleChild(p, parent) ? parent : undefined
  }

  // ppid 가 서로를 가리키는 고리가 있을 수 있어 방문 표시로 끊는다.
  const descendants = (pid: number): number[] => {
    const result: number[] = []
    const visited = new Set([pid])
    const queue = [...(children.get(pid) ?? [])]
    while (queue.length) {
      const next = queue.shift()!
      if (visited.has(next)) continue
      visited.add(next)
      result.push(next)
      queue.push(...(children.get(next) ?? []))
    }
    return result
  }

  const ancestors = (pid: number, maxDepth: number): ProcessInfo[] => {
    const result: ProcessInfo[] = []
    const visited = new Set([pid])
    let current = parentOf(pid)
    while (current && result.length < maxDepth && !visited.has(current.pid)) {
      visited.add(current.pid)
      result.push(current)
      current = parentOf(current.pid)
    }
    return result
  }

  return { byPid, parentOf, descendants, ancestors }
}

function summarizeMemory(
  totalBytes: number,
  freeBytes: number,
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
): MemorySummary {
  const total = Math.max(0, totalBytes)
  const used = Math.min(total, Math.max(0, total - freeBytes))
  const usedPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
  return { totalBytes: total, usedBytes: used, usedPercent, level: levelOf(usedPercent, thresholds) }
}

export function buildSnapshot(input: {
  sample: RawSample
  worktrees: Map<number, WorktreeInfo>
  totalBytes: number
  freeBytes: number
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
  now: number
}): DashboardSnapshot {
  const { sample, worktrees } = input
  const tree = buildTree(sample.processes)
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
    if (t.state !== 'Listen' || t.localPort < MIN_DEV_PORT) continue
    const key = `${t.localPort}:${t.pid}`
    if (seen.has(key)) continue
    seen.add(key)
    const p = tree.byPid.get(t.pid)
    if (!p) continue
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
      clientCount: clients.get(`${p.pid}:${t.localPort}`) ?? 0
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
    for (const member of [pid, ...tree.descendants(pid)]) if (!devServer.has(member)) agent.add(member)
  }
  const agentSet = new Set(agentPids)
  const agentProcessCount = agentPids.filter(
    (pid) => !tree.ancestors(pid, Number.MAX_SAFE_INTEGER).some((a) => agentSet.has(a.pid))
  ).length

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

  return { takenAt: input.now, memory, ports, groups, agentProcessCount, stale: false, error: null }
}
