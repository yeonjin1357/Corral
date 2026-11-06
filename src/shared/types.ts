export type Platform = 'win32' | 'darwin'

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  commandLine: string
  memoryBytes: number
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
