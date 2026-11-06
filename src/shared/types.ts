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
  /**
   * 포트를 연 프로세스의 작업 폴더(pid → 경로). `node server.js` 처럼 명령줄에 절대 경로가 없을 때
   * worktree 를 판별하는 데 쓴다. 비용 때문에 포트를 연 프로세스만 조회한다.
   */
  cwds?: Record<number, string>
  collectMode?: CollectMode
}

/**
 * 어떤 방식으로 수집했는지(문제 생겼을 때 원인 찾기용).
 * - helper-dll / helper-memory: Windows 보조 C# 코드를 DLL 에서 / 메모리 컴파일로 불러옴
 * - basic: 보조 코드가 막혀 기본 명령만 씀(작업 폴더·전용 메모리 없음)
 * - safe: 보안 정책으로 기본 스크립트가 막혀 제한 모드용 대체 스크립트를 씀
 * - darwin: macOS ps·lsof
 */
export type CollectMode = 'helper-dll' | 'helper-memory' | 'basic' | 'safe' | 'darwin'

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
  /** 포트를 연 프로세스의 시작 시각. 종료 직전 같은 프로세스인지(pid 재사용 아님) 확인하는 데 쓴다. */
  startedAt: number | null
}

export interface GroupUsage {
  group: ProcessGroup
  memoryBytes: number
  processCount: number
}

export type KillResult = {
  status: 'killed' | 'cancelled' | 'gone' | 'changed' | 'failed'
  message?: string
}

export interface DashboardSnapshot {
  takenAt: number
  memory: MemorySummary
  ports: PortRow[]
  groups: GroupUsage[]
  agentProcessCount: number
  stale: boolean
  error: string | null
  collectMode?: CollectMode | null
}
