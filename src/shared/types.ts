export type Platform = 'win32' | 'darwin'

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  commandLine: string
  memoryBytes: number
  /**
   * 시작 시각(유닉스 ms). Windows 는 부모가 끝나도 자식의 ppid 가 남아 다른 프로세스에 재사용될 수 있어,
   * "부모보다 먼저 시작한 자식"을 걸러내는 데 쓴다. macOS 는 고아가 launchd 로 옮겨지므로 null.
   */
  startedAt: number | null
}

export type TcpState = 'Listen' | 'Established' | 'Other'

export interface TcpEntry {
  pid: number
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: TcpState
}

export interface RawSample {
  processes: ProcessInfo[]
  tcp: TcpEntry[]
}

export interface WorktreeInfo {
  root: string
  branch: string | null
  isLinkedWorktree: boolean
}

export type ProcessGroup = 'devServer' | 'agent' | 'other'

export type MemoryLevel = 'normal' | 'warn' | 'danger'

export interface MemorySummary {
  totalBytes: number
  usedBytes: number
  usedPercent: number
  level: MemoryLevel
}

export interface PortRow {
  port: number
  pid: number
  processName: string
  commandLine: string
  worktree: WorktreeInfo | null
  unresolvable: boolean
  memoryBytes: number
  descendantPids: number[]
  clientCount: number
}

export interface GroupUsage {
  group: ProcessGroup
  memoryBytes: number
  processCount: number
}

export interface DashboardSnapshot {
  takenAt: number
  memory: MemorySummary
  ports: PortRow[]
  groups: GroupUsage[]
  agentProcessCount: number
  stale: boolean
  error: string | null
}
