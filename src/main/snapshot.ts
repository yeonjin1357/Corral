import type {
  AppUsage,
  DashboardSnapshot,
  GroupUsage,
  MemoryLevel,
  MemorySummary,
  Platform,
  ProcessInfo,
  RawSample,
  ServerRow,
  WorktreeInfo
} from '../shared/types'
import { DEFAULT_THRESHOLDS } from '../shared/defaults'
import { exePathOf } from '../shared/exePath'
import { worktreeKey } from '../shared/format'
import { findLeftovers } from './leftovers'
import { findHeavyJobs } from './heavy'
import { summarizeProcesses } from './processSummary'
import { localEndpoints, peerPid } from './tcpPeers'
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
 * 남은 프로세스 후보와 그 자손, 무거운 작업과 그 위 3단계 조상.
 * 모든 프로세스의 경로를 확인하면 파일 시스템 조회가 수백 배 늘고, 응답 없는 네트워크 드라이브에 막힐 수 있다.
 */
export function pidsForWorktreeLookup(
  sample: RawSample,
  platform?: Platform,
  heavyPatterns: string[] = []
): Set<number> {
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
  const agents = new Set(sample.processes.filter(classifyAgent).map((p) => p.pid))
  for (const row of findHeavyJobs(sample, new Map(), {
    patterns: heavyPatterns,
    exclude: agents
  })) {
    pids.add(row.pid)
    for (const ancestor of tree.ancestors(row.pid, MAX_ANCESTOR_DEPTH)) pids.add(ancestor.pid)
  }
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

/** 프로세스 이름별로 묶어 메모리 큰 순(같으면 이름 순). 이름은 대소문자를 무시하고 묶는다. */
function appsOf(processes: ProcessInfo[], platform: Platform | null): AppUsage[] {
  const byName = new Map<string, AppUsage>()
  for (const p of processes) {
    const key = p.name.toLowerCase()
    const app = byName.get(key)
    if (app) {
      app.memoryBytes += p.memoryBytes
      app.processCount++
      app.exePath ??= exePathOf(p.commandLine, platform)
    } else
      byName.set(key, {
        name: p.name,
        memoryBytes: p.memoryBytes,
        processCount: 1,
        exePath: exePathOf(p.commandLine, platform)
      })
  }
  return [...byName.values()].sort(
    (a, b) => b.memoryBytes - a.memoryBytes || a.name.localeCompare(b.name)
  )
}

/**
 * 포트 행을 서버(포트를 연 프로세스 트리의 맨 위) 단위로 합친다. 포트를 연 프로세스의 조상(깊이 제한 없음)
 * 가운데 다른 포트 프로세스가 있으면 가장 위 조상의 서버에 포트를 더한다(java 부모·자식이 포트를 나눠 여는 경우).
 * 메모리·자손은 맨 위 프로세스 기준으로 한 번만 센다. 판별 불가(중계)는 합치지 않고 그 프로세스 하나가 서버다.
 */
/** 포트 하나와 그 포트를 연 프로세스(서버로 합치기 전). */
interface PortEntry {
  port: number
  pid: number
  processName: string
  commandLine: string
  worktree: WorktreeInfo | null
  unresolvable: boolean
  /** 이 포트에 붙은 연결마다 상대 프로세스 pid(같은 PC 밖이거나 모르면 null). */
  peers: (number | null)[]
  startedAt: number | null
}

function serversOf(ports: PortEntry[], tree: ProcessTree): ServerRow[] {
  // 판별된 포트 프로세스 → 워크트리 키. 같은 워크트리의 조상 포트 프로세스에만 합친다(다른 프로젝트의 서버를
  // 띄운 셸이 우연히 어떤 서버 아래에 있어도 따로 센다).
  const portRoots = new Map(
    ports
      .filter((r) => !r.unresolvable && r.worktree)
      .map((r) => [r.pid, worktreeKey(r.worktree!.root)])
  )
  const topOf = (row: PortEntry): number => {
    if (row.unresolvable) return row.pid
    const root = portRoots.get(row.pid)
    let top = row.pid
    // 가까운 조상부터 나오므로 마지막으로 맞는 것이 가장 위.
    for (const a of tree.ancestors(row.pid, Number.MAX_SAFE_INTEGER))
      if (root != null && portRoots.get(a.pid) === root) top = a.pid
    return top
  }
  const groups = new Map<
    number,
    { head: PortEntry; ports: Set<number>; peers: (number | null)[] }
  >()
  for (const row of ports) {
    const top = topOf(row)
    let group = groups.get(top)
    if (!group) {
      const head = ports.find((r) => r.pid === top) ?? row
      group = { head, ports: new Set(), peers: [] }
      groups.set(top, group)
    }
    group.ports.add(row.port)
    // 포트 행은 (포트, pid) 마다 하나라 연결이 겹쳐 세지지 않는다.
    group.peers.push(...row.peers)
  }
  // 서버의 자손에서 그 아래에 있는 다른 서버(의 트리)는 뺀다. 메모리·프로세스를 두 서버가 겹쳐 세지 않게.
  const heads = new Set(groups.keys())
  const ownDescendants = (pid: number): number[] => {
    const all = tree.descendants(pid)
    const nested = new Set<number>()
    for (const d of all)
      if (heads.has(d)) for (const x of [d, ...tree.descendants(d)]) nested.add(x)
    return all.filter((d) => !nested.has(d))
  }
  return [...groups.values()]
    .map(({ head, ports: set, peers }) => {
      const descendantPids = ownDescendants(head.pid)
      const own = new Set([head.pid, ...descendantPids])
      const members = [...own].flatMap((pid) => tree.byPid.get(pid) ?? [])
      // 서버 트리 안의 프로세스가 자기 포트에 붙은 루프백 연결은 클라이언트가 아니다.
      const clientCount = peers.filter((p) => p == null || !own.has(p)).length
      return { head, set, clientCount, descendantPids, members }
    })
    .map(({ head, set: portSet, clientCount, descendantPids, members }) => ({
      pid: head.pid,
      ports: [...portSet].sort((a, b) => a - b),
      processName: head.processName,
      commandLine: head.commandLine,
      worktree: head.worktree,
      // 작업 공간·CPU·메모리 증가·판단은 이전 샘플과 파일 시스템을 아는 수집기가 채운다.
      workspace: null,
      unresolvable: head.unresolvable,
      memoryBytes: members.reduce((sum, m) => sum + m.memoryBytes, 0),
      descendantPids,
      processes: summarizeProcesses(members),
      clientCount,
      startedAt: head.startedAt,
      judgement: null,
      idleSince: null,
      agentInWorktree: false,
      cpuPercent: null,
      memoryGrowth: null
    }))
    .sort((a, b) => a.ports[0] - b.ports[0] || a.pid - b.pid)
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
  /** 논리 코어 수(CPU 표시 기준). */
  cpuCount?: number
  /** 무거운 명령 패턴(설정). 없으면 무거운 작업을 찾지 않는다. */
  heavyPatterns?: string[]
}): DashboardSnapshot {
  const { sample, worktrees } = input
  const tree = buildTree(sample.processes)
  const self = new Set<number>(
    input.selfPid ? [input.selfPid, ...tree.descendants(input.selfPid)] : []
  )
  // pitwall 을 띄운 조상(개발 실행의 electron-vite 서버 등)을 내리면 pitwall 도 같이 꺼진다.
  const selfAncestors = new Set<number>(
    input.selfPid ? tree.ancestors(input.selfPid, 16).map((p) => p.pid) : []
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

  const owners = localEndpoints(sample.tcp)
  const clients = new Map<string, (number | null)[]>()
  for (const t of sample.tcp) {
    if (t.state !== 'Established') continue
    const key = `${t.pid}:${t.localPort}`
    clients.set(key, [...(clients.get(key) ?? []), peerPid(t, owners)])
  }

  const ports: PortEntry[] = []
  const seen = new Set<string>()
  for (const t of sample.tcp) {
    if (
      t.state !== 'Listen' ||
      t.localPort < MIN_DEV_PORT ||
      self.has(t.pid) ||
      selfAncestors.has(t.pid)
    )
      continue
    const key = `${t.localPort}:${t.pid}`
    if (seen.has(key)) continue
    seen.add(key)
    const p = tree.byPid.get(t.pid)
    // 에이전트가 연 포트(예: Claude Code 의 IDE 연동 포트)는 내리면 세션이 끊기므로 개발 서버로 보지 않는다.
    if (!p || classifyAgent(p)) continue
    const worktree = worktreeOf(p.pid)
    const relay = RELAY_SET.has(p.name.toLowerCase())
    if (!worktree && !relay) continue
    ports.push({
      port: t.localPort,
      pid: p.pid,
      processName: p.name,
      commandLine: p.commandLine,
      worktree,
      unresolvable: !worktree,
      peers: clients.get(`${p.pid}:${t.localPort}`) ?? [],
      startedAt: p.startedAt
    })
  }
  ports.sort((a, b) => a.port - b.port || a.pid - b.pid)

  const servers = serversOf(ports, tree)
  const devServer = new Set<number>()
  for (const row of servers) {
    devServer.add(row.pid)
    for (const pid of row.descendantPids) devServer.add(pid)
  }

  const agentPids = sample.processes.filter(classifyAgent).map((p) => p.pid)
  const agentTree = new Set<number>()
  for (const pid of agentPids) {
    for (const member of [pid, ...tree.descendants(pid)])
      if (!devServer.has(member)) agentTree.add(member)
  }

  // 에이전트가 띄운 타입 검사·빌드도 무거운 작업이다(에이전트 자체·개발 서버·pitwall 은 아님).
  const heavyJobs = findHeavyJobs(sample, worktrees, {
    patterns: input.heavyPatterns ?? [],
    exclude: new Set([...self, ...devServer, ...agentPids])
  })
  const heavy = new Set<number>()
  for (const job of heavyJobs) for (const pid of [job.pid, ...job.descendantPids]) heavy.add(pid)
  const agent = new Set([...agentTree].filter((pid) => !heavy.has(pid)))
  const topAgents = topLevelAgentPids(sample.processes, tree)
  const agentProcessCount = topAgents.length

  const agentRoots = new Set(
    topAgents.flatMap((pid) => {
      const w = worktrees.get(pid)
      return w ? [worktreeKey(w.root)] : []
    })
  )
  const leftovers = findLeftovers(sample, worktrees, {
    // 무거운 작업은 끄지 않으므로 남은 프로세스(끌 수 있는 것)로도 세지 않는다.
    exclude: new Set([...self, ...devServer, ...agentTree, ...heavy]),
    agentRoots,
    platform: input.platform,
    now: input.now
  })

  const memory = summarizeMemory(input.totalBytes, input.freeBytes, input.thresholds)
  const devBytes = memoryOf(devServer)
  const agentBytes = memoryOf(agent)
  const heavyBytes = memoryOf(heavy)
  const rest = sample.processes.filter(
    (p) => !devServer.has(p.pid) && !agent.has(p.pid) && !heavy.has(p.pid)
  )
  const known = devBytes + agentBytes + heavyBytes
  // 기본 수집 방식(작업 집합)은 공유 메모리를 겹쳐 세어 합이 사용량을 넘을 수 있다. 사용량 안으로 줄인다.
  const otherBytes = Math.min(
    memoryOf(rest.map((p) => p.pid)),
    Math.max(0, memory.usedBytes - known)
  )
  const groups: GroupUsage[] = [
    { group: 'devServer', memoryBytes: devBytes, processCount: devServer.size },
    { group: 'agent', memoryBytes: agentBytes, processCount: agent.size },
    { group: 'heavy', memoryBytes: heavyBytes, processCount: heavy.size },
    { group: 'otherApps', memoryBytes: otherBytes, processCount: rest.length },
    {
      group: 'system',
      memoryBytes: Math.max(0, memory.usedBytes - known - otherBytes),
      processCount: 0
    }
  ]

  return {
    takenAt: input.now,
    memory,
    servers,
    // 숨김은 설정을 아는 수집기가 나눈다.
    hiddenServers: [],
    leftovers,
    heavyJobs,
    // RAM 이 넉넉하면 겹쳐도 조용하다(스펙 §3-6).
    heavyOverlap: heavyJobs.length >= 2 && memory.level !== 'normal',
    agents: [],
    hook: null,
    codexHook: null,
    disk: null,
    groups,
    apps: appsOf(rest, input.platform ?? null),
    agentProcessCount,
    platform: input.platform ?? null,
    cpuCount: input.cpuCount && input.cpuCount > 0 ? input.cpuCount : 1,
    stale: false,
    error: null,
    collectMode: sample.collectMode ?? null
  }
}
