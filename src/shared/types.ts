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
  /** 누적 CPU 시간(ms). 에이전트가 작업 중인지(CPU 변화) 판단하는 데 쓴다. 모르면 null. */
  cpuMs?: number | null
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
   * 작업 폴더(pid → 경로). `node server.js` 처럼 명령줄에 절대 경로가 없을 때 worktree 를 판별하는 데 쓴다.
   * 비용 때문에 포트를 연 프로세스와 에이전트 프로세스만 조회한다.
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

/**
 * 메모리 묶음. heavy: 무거운 작업(설정의 명령 패턴), otherApps: 나머지 프로세스 전용 메모리 합,
 * system: 사용 중 메모리 중 어느 프로세스 몫으로도 안 잡히는 부분(커널·드라이버·공유·읽지 못한 프로세스).
 */
export type ProcessGroup = 'devServer' | 'agent' | 'heavy' | 'otherApps' | 'system'

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
  /**
   * 안 쓰는 포트 판단. candidate: 정리 후보(에이전트 없음 + 연결 0 이 기준 시간 이상),
   * check: 확인해볼 것(에이전트 없음 + 탭 연결만 기준 시간 이상), null: 판단 없음.
   */
  judgement: PortJudgement | null
  /** 지금 상태(연결 0 또는 탭만)가 시작된 시각. 에이전트가 있거나 판별 불가면 null. */
  idleSince: number | null
  /** 같은 워크트리에 에이전트(Claude·Codex)가 실행 중. */
  agentInWorktree: boolean
}

/** 주인(실행한 프로세스)이 끝났는데 남은 개발 도구 프로세스(자손 포함 한 행). */
export interface LeftoverRow {
  pid: number
  processName: string
  /** 알아보기 쉬운 이름(Playwright 브라우저, Gradle 데몬 등). */
  label: string
  commandLine: string
  worktree: WorktreeInfo | null
  /** 자기 + 자손. */
  memoryBytes: number
  descendantPids: number[]
  startedAt: number | null
  /** 같은 워크트리에 에이전트가 실행 중. */
  agentInWorktree: boolean
}

export type PortJudgement = 'candidate' | 'check'

export interface GroupUsage {
  group: ProcessGroup
  memoryBytes: number
  processCount: number
}

/** 다른 앱을 프로세스 이름별로 묶은 것(예: chrome.exe 40개). */
export interface AppUsage {
  name: string
  memoryBytes: number
  processCount: number
}

export type AgentTool = 'claude' | 'codex'

/**
 * working: 일하는 중, waiting: 권한 확인 등 사용자 응답 대기(훅으로만 앎), idle: 쉬는 중,
 * error: 마지막 응답이 오류로 끝남(훅으로만 앎), unknown: 아직 판단할 근거가 없음(첫 샘플 등).
 */
export type AgentState = 'working' | 'waiting' | 'idle' | 'error' | 'unknown'

export interface AgentRow {
  pid: number
  tool: AgentTool
  worktree: WorktreeInfo | null
  startedAt: number | null
  /** 자기 + 자손 중 개발 서버가 아닌 것. */
  memoryBytes: number
  descendantCount: number
  state: AgentState
  /** hook: Claude 훅 이벤트로 안 상태, cpu: CPU 변화로 짐작한 상태. */
  stateSource: 'hook' | 'cpu'
  /** 지난 샘플 이후 하위 트리 CPU 사용률(코어 1개 = 100). 모르면 null. */
  cpuPercent: number | null
}

export type ClaudeHookState = 'off' | 'on' | 'partial' | 'error'

/** Claude 훅 연동 상태. */
export interface ClaudeHookStatus {
  /** on: 켜짐, partial: 일부만 있거나 예전 포트·토큰(다시 켜야 함), off: 꺼짐, error: 문제 있음. */
  state: ClaudeHookState
  /** server: 훅 서버를 열지 못함, settings: settings.json 을 읽을 수 없음. */
  problem: 'server' | 'settings' | null
  /** 사용자가 disableAllHooks 로 훅을 모두 끈 상태(켜져 있어도 이벤트가 오지 않음). */
  allHooksDisabled: boolean
  settingsPath: string
}

export type KillResult = {
  status: 'killed' | 'cancelled' | 'gone' | 'changed' | 'failed'
  message?: string
}

export interface DashboardSnapshot {
  takenAt: number
  memory: MemorySummary
  ports: PortRow[]
  leftovers: LeftoverRow[]
  agents: AgentRow[]
  /** Claude 훅 연동 상태. 아직 모르면 null. */
  hook: ClaudeHookStatus | null
  groups: GroupUsage[]
  /** 다른 앱 중 메모리를 많이 쓰는 것 상위 5개. */
  topApps: AppUsage[]
  agentProcessCount: number
  /** CPU 표시 기준(Windows 는 전체 CPU 대비, macOS 는 코어 1개 = 100%). 모르면 null. */
  platform: Platform | null
  /** 논리 코어 수. */
  cpuCount: number
  stale: boolean
  error: string | null
  collectMode?: CollectMode | null
}
