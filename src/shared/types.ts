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

/** TimeWait: 최근 닫힌 연결(사용 흔적). Windows 는 소유 pid 가 0 이다. */
export type TcpState = 'Listen' | 'Established' | 'TimeWait' | 'Other'

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
  /** git 공용 폴더(메인 체크아웃의 `.git`). 디스크 정리에서 저장소를 기억하는 데 쓴다. 모르면 없음. */
  commonDir?: string | null
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

/**
 * 작업 공간: 서버 워크트리를 감싸는 가장 가까운 바깥 git 저장소(여러 저장소를 묶는 작업 공간 저장소 등).
 * outer=false 면 바깥 저장소가 없거나 같은 저장소라 그 워크트리 자체가 작업 공간이다.
 */
export interface WorkspaceInfo {
  root: string
  /** 보여 줄 이름(폴더 이름, 설정의 별칭이 있으면 별칭). */
  name: string
  branch: string | null
  outer: boolean
}

/** 메모리가 계속 는 서버의 근거(처음·지금 메모리와 잰 시간). */
export interface MemoryGrowth {
  fromBytes: number
  toBytes: number
  minutes: number
}

/**
 * 개발 서버 한 줄 = 포트를 연 프로세스 트리의 맨 위 프로세스. 그 트리 안에서 연 포트를 모두 담고
 * 메모리·자손은 한 번만 센다(같은 서버를 두 번 세거나 두 번 끄지 않도록).
 */
export interface ServerRow {
  pid: number
  /** 서버 트리가 연 개발용 포트(오름차순, 중복 없음). */
  ports: number[]
  processName: string
  commandLine: string
  worktree: WorktreeInfo | null
  workspace: WorkspaceInfo | null
  unresolvable: boolean
  /** 맨 위 프로세스 + 모든 자손. */
  memoryBytes: number
  descendantPids: number[]
  /** 서버의 모든 포트에 붙은 연결 수 합. */
  clientCount: number
  /** 맨 위 프로세스의 시작 시각. 종료 직전 같은 프로세스인지(pid 재사용 아님) 확인하는 데 쓴다. */
  startedAt: number | null
  /**
   * 안 쓰는 서버 판단. candidate: 정리 후보(에이전트 없음 + 연결 0 이 기준 시간 이상),
   * check: 확인해볼 것(에이전트 없음 + 탭 연결만 기준 시간 이상), null: 판단 없음.
   */
  judgement: PortJudgement | null
  /** 지금 상태(연결 0 또는 탭만)가 시작된 시각. 에이전트가 있거나 판별 불가면 null. */
  idleSince: number | null
  /** 같은 워크트리에 에이전트(Claude·Codex)가 실행 중. */
  agentInWorktree: boolean
  /** 서버 트리 CPU 사용률(에이전트와 같은 기준). 모르면 null. */
  cpuPercent: number | null
  /** 메모리가 계속 늘고 있으면 그 근거. */
  memoryGrowth: MemoryGrowth | null
}

/** 주인(실행한 프로세스)이 끝났는데 남은 개발 도구 프로세스(자손 포함 한 행). */
export interface LeftoverRow {
  pid: number
  processName: string
  /** 알아보기 쉬운 이름(Playwright 브라우저, Gradle 데몬 등). */
  label: string
  commandLine: string
  worktree: WorktreeInfo | null
  workspace: WorkspaceInfo | null
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
  /** 그 앱의 실행 파일(macOS 는 .app 묶음) 경로. 화면이 OS 앱 아이콘을 보이는 데 쓴다. 모르면 null. */
  exePath: string | null
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
  workspace: WorkspaceInfo | null
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
  /** 개발 서버(포트를 연 프로세스 트리 단위). 첫 포트 순. */
  servers: ServerRow[]
  leftovers: LeftoverRow[]
  /** 무거운 작업(설정의 명령 패턴). 메모리 큰 순. */
  heavyJobs: HeavyJobRow[]
  /** 무거운 작업이 2개 이상 겹치고 RAM 이 경고 기준 이상. */
  heavyOverlap: boolean
  agents: AgentRow[]
  /** Claude 훅 연동 상태. 아직 모르면 null. */
  hook: ClaudeHookStatus | null
  /** 디스크 정리(끝난 워크트리의 의존성 폴더). 아직 찾지 않았으면 null. */
  disk: DiskReport | null
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

/**
 * 새 버전 확인 상태. disabled: 개발 실행·설정에서 끔, available: 새 버전 있음(macOS — 내려받기 페이지),
 * downloading·ready: Windows 자동 업데이트가 받는 중·다 받음(다시 시작하면 설치).
 */
export interface UpdateStatus {
  state: 'disabled' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  version: string | null
  url: string | null
  error: string | null
  checkedAt: number | null
}

/** 끝난 워크트리의 의존성 폴더 하나. */
export interface DiskFolder {
  name: string
  path: string
  /** 크기(바이트). 아직 재는 중이거나 링크라 재지 않으면 null. */
  bytes: number | null
  /** link: 폴더 자체가 링크(정션·심볼릭 링크)라, unreadable: 읽을 수 없어 지우지 않는다. */
  skipped?: 'link' | 'unreadable'
}

/** 디스크 정리 대상: 끝난 연결된 워크트리 하나. */
export interface DiskRow {
  worktreeRoot: string
  commonDir: string
  branch: string | null
  /** 끝났다고 본 근거: upstreamGone 원격 브랜치가 지워짐, merged 기본 브랜치에 머지됨. */
  evidence: 'upstreamGone' | 'merged'
  folders: DiskFolder[]
  /** 지울 수 있는 폴더 크기의 합(재는 중이면 null). */
  totalBytes: number | null
  /** 그 워크트리에서 개발 서버·에이전트 등이 실행 중(지우지 않는다). */
  inUse: boolean
}

export interface DiskReport {
  rows: DiskRow[]
  /** 마지막으로 다 찾은 시각. 아직 한 번도 안 찾았으면 null. */
  scannedAt: number | null
  scanning: boolean
  error: string | null
}

/** 무거운 작업(설정의 명령 패턴에 맞는 프로세스 트리 하나). 경고만 하고 끄지 않는다. */
export interface HeavyJobRow {
  pid: number
  /** 맞은 패턴(설정에 쓴 그대로). */
  label: string
  processName: string
  commandLine: string
  worktree: WorktreeInfo | null
  workspace: WorkspaceInfo | null
  /** 자기 + 자손. */
  memoryBytes: number
  descendantPids: number[]
  startedAt: number | null
}
