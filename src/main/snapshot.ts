import type {
  AppUsage,
  CommitSummary,
  DashboardSnapshot,
  GroupUsage,
  MemoryLevel,
  MemorySummary,
  OtherPort,
  Platform,
  ProcessInfo,
  RawSample,
  ServerRow,
  SystemMemory,
  WorktreeInfo
} from '../shared/types'
import { DEFAULT_THRESHOLDS } from '../shared/defaults'
import { exePathOf } from '../shared/exePath'
import { commitSum, worktreeKey } from '../shared/format'
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

/** 1024 미만은 OS·시스템 서비스가 쓰는 포트라 개발 서버로 보지 않는다(다른 포트에도 넣지 않는다). */
const MIN_DEV_PORT = 1024
const MAX_ANCESTOR_DEPTH = 3
/** 이 pid 까지는 OS 자체(Windows 의 Idle·System). 다른 포트에 넣지 않는다. */
const SYSTEM_PID_MAX = 4
/** 다른 포트(G5c)는 포트 순으로 이만큼까지(서비스가 여는 동적 포트가 많아도 화면·IPC 가 무거워지지 않게). */
const OTHER_PORT_LIMIT = 300

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

const LEVEL_RANK: Record<MemoryLevel, number> = { normal: 0, warn: 1, danger: 2 }

/** 사용률(%, 소수 1자리). 전체가 0 이하면 0. */
function percentOf(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0
}

/** 시스템 커밋 요약. 모르거나 한도가 0 이하(이상한 입력)면 null. 단계는 RAM 과 같은 기준 %. */
function commitSummaryOf(
  system: SystemMemory | null | undefined,
  thresholds: { ramWarnPercent: number; ramDangerPercent: number }
): CommitSummary | null {
  if (!system || !(system.commitLimitBytes > 0)) return null
  const usedBytes = Math.max(0, system.commitUsedBytes)
  const percent = percentOf(usedBytes, system.commitLimitBytes)
  return {
    usedBytes,
    limitBytes: system.commitLimitBytes,
    percent,
    level: levelOf(percent, thresholds)
  }
}

/**
 * 메모리 요약. level 은 RAM 단계와 커밋 단계 중 높은 쪽(RAM 이 넉넉해 보여도 커밋이 한도에 가까우면 메모리가
 * 모자란 것이다), ramLevel 은 RAM 만으로 본 단계. 시스템 값(커밋·커널)을 모르면 RAM 만으로.
 */
function summarizeMemory(
  totalBytes: number,
  freeBytes: number,
  thresholds: { ramWarnPercent: number; ramDangerPercent: number },
  system?: SystemMemory | null
): MemorySummary {
  const total = Math.max(0, totalBytes)
  const used = Math.min(total, Math.max(0, total - freeBytes))
  const usedPercent = percentOf(used, total)
  const ramLevel = levelOf(usedPercent, thresholds)
  const commit = commitSummaryOf(system, thresholds)
  return {
    totalBytes: total,
    usedBytes: used,
    usedPercent,
    availableBytes: total - used,
    level: commit && LEVEL_RANK[commit.level] > LEVEL_RANK[ramLevel] ? commit.level : ramLevel,
    ramLevel,
    commit,
    kernelBytes: system?.kernelBytes ?? null
  }
}

/** 런타임: 자기 이름만으로는 누가 쓰는지 알 수 없는 프로세스(에디터의 언어 서버·확장 호스트 등). */
const RUNTIME_NAME = /^(node|javaw?|python[\d.]*w?|bun|deno|dotnet|ruby|php)(\.exe)?$/i
/** 셸·콘솔: 런타임을 띄운 앱을 찾을 때 건너뛴다. macOS 의 로그인 셸은 이름이 `-zsh` 처럼 보인다. */
const SHELL_NAME = /^-?(cmd|bash|sh|zsh|pwsh|powershell|conhost|openconsole)(\.exe)?$/i
/** 여기에 먼저 닿으면 사용자가 직접(탐색기·서비스·Dock) 띄운 것이라 띄운 앱을 모른다. */
const LAUNCHER_NAME = /^(explorer\.exe|services\.exe|launchd|systemd)$/i
const OWNER_DEPTH = 8

/**
 * 런타임 프로세스를 띄운 앱(G5b): 가장 가까운 조상(8단계까지) 가운데 런타임·셸이 아닌 것.
 * 런타임이 아니거나, 그 전에 탐색기·서비스·launchd·systemd·pid 1 에 닿거나, 끝까지 못 찾으면 null.
 */
function ownerOf(p: ProcessInfo, tree: ProcessTree): ProcessInfo | null {
  if (!RUNTIME_NAME.test(p.name)) return null
  for (const a of tree.ancestors(p.pid, OWNER_DEPTH)) {
    if (a.pid === 1 || LAUNCHER_NAME.test(a.name)) return null
    if (!RUNTIME_NAME.test(a.name) && !SHELL_NAME.test(a.name)) return a
  }
  return null
}

/**
 * 프로세스 이름(런타임은 띄운 앱까지)별로 묶어 메모리 큰 순(같으면 이름 순). 대소문자를 무시하고 묶는다.
 * 띄운 앱이 있는 묶음의 아이콘 경로는 띄운 앱의 실행 파일(모르면 지금처럼 자기 것).
 */
function appsOf(
  processes: ProcessInfo[],
  platform: Platform | null,
  tree: ProcessTree
): AppUsage[] {
  const byKey = new Map<string, AppUsage>()
  const ownerExe = new Map<string, string>()
  for (const p of processes) {
    const owner = ownerOf(p, tree)
    const key = `${p.name.toLowerCase()}\0${owner?.name.toLowerCase() ?? ''}`
    const ownerPath = owner ? exePathOf(owner.commandLine, platform) : null
    if (ownerPath && !ownerExe.has(key)) ownerExe.set(key, ownerPath)
    const app = byKey.get(key)
    if (app) {
      app.memoryBytes += p.memoryBytes
      // 커밋은 아는 것만 더한다(하나도 모르면 null 그대로).
      if (p.commitBytes != null) app.commitBytes = (app.commitBytes ?? 0) + p.commitBytes
      app.processCount++
      app.exePath ??= exePathOf(p.commandLine, platform)
    } else
      byKey.set(key, {
        name: p.name,
        owner: owner?.name ?? null,
        memoryBytes: p.memoryBytes,
        commitBytes: p.commitBytes ?? null,
        processCount: 1,
        exePath: exePathOf(p.commandLine, platform)
      })
  }
  return [...byKey]
    .map(([key, app]) => ({ ...app, exePath: ownerExe.get(key) ?? app.exePath }))
    .sort(
      (a, b) =>
        b.memoryBytes - a.memoryBytes ||
        a.name.localeCompare(b.name) ||
        (a.owner ?? '').localeCompare(b.owner ?? '')
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
  /** 판별된 포트 프로세스(어느 서버든 포트를 연 프로세스). */
  const portPids = new Set(ports.map((r) => r.pid))
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
      // 서버를 이루는 포트 프로세스끼리의 루프백 연결(부모·자식 JVM 등)은 클라이언트가 아니다. 서버가 띄운
      // 다른 자식(electron-vite 의 앱 창 등)은 포트를 열지 않으므로 클라이언트로 센다.
      const clientCount = peers.filter((p) => p == null || !(own.has(p) && portPids.has(p))).length
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
      commitBytes: commitSum(members),
      descendantPids,
      processes: summarizeProcesses(members),
      clientCount,
      startedAt: head.startedAt,
      judgement: null,
      idleSince: null,
      agentInWorktree: false,
      parkedAgent: false,
      parkedSince: null,
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
  const commitOf = (pids: Iterable<number>): number | null =>
    commitSum([...pids].flatMap((pid) => tree.byPid.get(pid) ?? []))

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
    const list = clients.get(key)
    if (list) list.push(peerPid(t, owners))
    else clients.set(key, [peerPid(t, owners)])
  }

  const ports: PortEntry[] = []
  const otherPorts: OtherPort[] = []
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
    if (!p) continue
    // 에이전트가 연 포트(예: Claude Code 의 IDE 연동 포트)는 내리면 세션이 끊기므로 개발 서버로 보지 않는다.
    const agent = classifyAgent(p)
    const worktree = agent ? null : worktreeOf(p.pid)
    const relay = !agent && RELAY_SET.has(p.name.toLowerCase())
    if (!worktree && !relay) {
      // 개발 서버가 아닌 포트는 다른 포트로만 보인다(G5c, 끄기 없음). pid 4 이하는 OS 자체(System 등).
      if (p.pid > SYSTEM_PID_MAX)
        otherPorts.push({
          port: t.localPort,
          pid: p.pid,
          processName: p.name,
          memoryBytes: p.memoryBytes,
          commitBytes: p.commitBytes ?? null,
          exePath: exePathOf(p.commandLine, input.platform ?? null)
        })
      continue
    }
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

  const memory = summarizeMemory(input.totalBytes, input.freeBytes, input.thresholds, sample.system)
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
  // 커밋은 RAM 처럼 사용량 안으로 줄이지 않는다(페이지 파일 몫까지 들어 RAM 사용량보다 클 수 있다).
  // 시스템 몫은 프로세스가 아니라 커밋을 셀 수 없다.
  const groups: GroupUsage[] = [
    {
      group: 'devServer',
      memoryBytes: devBytes,
      commitBytes: commitOf(devServer),
      processCount: devServer.size
    },
    {
      group: 'agent',
      memoryBytes: agentBytes,
      commitBytes: commitOf(agent),
      processCount: agent.size
    },
    {
      group: 'heavy',
      memoryBytes: heavyBytes,
      commitBytes: commitOf(heavy),
      processCount: heavy.size
    },
    {
      group: 'otherApps',
      memoryBytes: otherBytes,
      commitBytes: commitSum(rest),
      processCount: rest.length
    },
    {
      group: 'system',
      memoryBytes: Math.max(0, memory.usedBytes - known - otherBytes),
      commitBytes: null,
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
    // 메모리(RAM·커밋 중 높은 단계)가 넉넉하면 겹쳐도 조용하다(스펙 §3-6).
    heavyOverlap: heavyJobs.length >= 2 && memory.level !== 'normal',
    agents: [],
    // 작업 공간 합계는 에이전트·작업 공간을 정한 수집기가 만든다.
    workspaces: [],
    hook: null,
    codexHook: null,
    disk: null,
    groups,
    apps: appsOf(rest, input.platform ?? null, tree),
    otherPorts: otherPorts
      .sort((a, b) => a.port - b.port || a.pid - b.pid)
      .slice(0, OTHER_PORT_LIMIT),
    agentProcessCount,
    platform: input.platform ?? null,
    cpuCount: input.cpuCount && input.cpuCount > 0 ? input.cpuCount : 1,
    stale: false,
    error: null,
    collectMode: sample.collectMode ?? null
  }
}
