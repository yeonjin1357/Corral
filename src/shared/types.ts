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
  /**
   * 커밋 크기(바이트, Windows `PrivateUsage`): 프로세스가 차지하기로 한 전용 메모리 전체(RAM + 페이지 파일).
   * 메모리가 부족해 RAM 에서 밀려나도 줄지 않는다. 모르면 null·없음(macOS·보조 코드가 막힌 PC·열 수 없는 프로세스).
   */
  commitBytes?: number | null
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
  /** 시스템 전체 커밋·커널 메모리. 모르면 null·없음(macOS·보조 코드가 막힌 PC). */
  system?: SystemMemory | null
}

/** Windows `GetPerformanceInfo` 의 시스템 값(바이트). kernelBytes = paged + nonpaged pool. */
export interface SystemMemory {
  commitUsedBytes: number
  commitLimitBytes: number
  kernelBytes: number
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

/** 시간 추이 그래프의 점(RAM 사용률 등). */
export interface TrendPoint {
  t: number
  value: number
}

/** 시스템 커밋(프로세스가 차지하기로 한 메모리 전체, 페이지 파일 포함)과 한도. */
export interface CommitSummary {
  usedBytes: number
  limitBytes: number
  /** 한도 대비 사용률(소수 1자리). */
  percent: number
  /** RAM 과 같은 경고·위험 기준 % 를 커밋 사용률에 적용한 단계. */
  level: MemoryLevel
}

export interface MemorySummary {
  totalBytes: number
  usedBytes: number
  usedPercent: number
  /** 남은 메모리(total − used). */
  availableBytes: number
  /** RAM 단계와 커밋 단계 중 높은 쪽(메모리 압박 단계). */
  level: MemoryLevel
  /** RAM 사용률만으로 본 단계(level 이 어느 쪽 때문인지 알 수 있게). */
  ramLevel: MemoryLevel
  /** 시스템 커밋. 모르면 null(macOS·보조 코드가 막힌 PC). */
  commit: CommitSummary | null
  /** 커널 메모리(paged + nonpaged pool). 모르면 null. */
  kernelBytes: number | null
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
  /** 같은 프로세스의 커밋 합. 하나도 모르면 null(일부만 알면 아는 것의 합). */
  commitBytes: number | null
  descendantPids: number[]
  /** 맨 위 프로세스 + 자손을 이름별로 묶은 것(상세 패널). */
  processes: ProcessSummary[]
  /** 서버의 모든 포트에 붙은 연결 수 합. */
  clientCount: number
  /** 맨 위 프로세스의 시작 시각. 종료 직전 같은 프로세스인지(pid 재사용 아님) 확인하는 데 쓴다. */
  startedAt: number | null
  /**
   * 안 쓰는 서버 판단. candidate: 정리 후보(에이전트 없음 + 연결 0 이 기준 시간 이상),
   * check: 확인해볼 것(에이전트 없음 + 탭 연결만 기준 시간 이상, 또는 덮는 에이전트가 모두 오래 쉬는 세션이고
   * 연결 0·탭만이 기준 시간 이상), null: 판단 없음(활동 중인 에이전트가 덮고 있거나 아직 기준 시간 전).
   */
  judgement: PortJudgement | null
  /**
   * 지금 상태(연결 0 또는 탭만)가 시작된 시각. 활동 중인 에이전트가 덮고 있어도 잰다(판단만 막는다).
   * 판별 불가·워크트리를 모르면 null.
   */
  idleSince: number | null
  /** 같은 워크트리(또는 상위 폴더)나 같은 작업 공간에 에이전트(Claude·Codex)가 실행 중(오래 쉬는 세션 포함). */
  agentInWorktree: boolean
  /** 덮는 에이전트가 있고 모두 오래 쉬는 세션(G2). 그래서 "확인해볼 것"까지만 오른다. */
  parkedAgent: boolean
  /** parkedAgent 일 때 덮는 에이전트들의 마지막 활동 가운데 가장 늦은 시각. 아니면 null. */
  parkedSince: number | null
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
  /** 같은 프로세스의 커밋 합. 하나도 모르면 null(일부만 알면 아는 것의 합). */
  commitBytes: number | null
  descendantPids: number[]
  /** 자기 + 자손을 이름별로 묶은 것(상세 패널). */
  processes: ProcessSummary[]
  startedAt: number | null
  /** 같은 워크트리에 에이전트가 실행 중. */
  agentInWorktree: boolean
}

export type PortJudgement = 'candidate' | 'check'

export interface GroupUsage {
  group: ProcessGroup
  memoryBytes: number
  /** 묶음 프로세스의 커밋 합. 하나도 모르면 null. system 은 프로세스가 없어 늘 null. */
  commitBytes: number | null
  processCount: number
}

/** 한 행(서버·에이전트·무거운 작업·남은 프로세스)을 이루는 프로세스를 이름·짧은 이름별로 묶은 것(상세 패널용). */
export interface ProcessSummary {
  /** 프로세스 이름(예: node.exe). */
  name: string
  /** 무엇인지 알 수 있는 짧은 이름(패키지·스크립트 이름). 모르면 null. 명령줄의 다른 인자는 담지 않는다. */
  hint: string | null
  count: number
  memoryBytes: number
  /** 묶인 프로세스의 커밋 합. 하나도 모르면 null. */
  commitBytes: number | null
}

/** 다른 앱을 프로세스 이름별로 묶은 것(예: chrome.exe 40개). */
export interface AppUsage {
  name: string
  memoryBytes: number
  /** 그 앱 프로세스의 커밋 합. 하나도 모르면 null. */
  commitBytes: number | null
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

/**
 * 에이전트가 하는 일(G3b). 훅이 알려 준 내용을 메모리에만 들고 pitwall 창에만 보인다(history.json·기록·로그·OS 알림에는
 * 넣지 않는다). title: 세션 제목(훅의 session_title, 없으면 Claude 세션 파일의 이름), prompt: 마지막 요청의 첫 줄,
 * tool: 지금 실행 중인 도구(이름·요약·시작 시각), waiting: 권한을 기다리는 도구(이름·요약). 모르면 null.
 */
export interface AgentActivity {
  title: string | null
  prompt: string | null
  tool: { name: string; summary: string | null; since: number } | null
  waiting: { tool: string | null; summary: string | null } | null
}

/**
 * 에이전트가 떠 있는 창을 찾을 단서(G3f 창으로 가기). pids: 창 후보 pid(고를 순서대로, 최대 64 — 조상과 그 콘솔 호스트 자식,
 * 바깥 앱과 같은 이름의 프로세스, 앱 조상이 없으면 WindowsTerminal. 규칙은 agents.ts 의 hostFinder), app: 조상 가운데 명령줄이
 * `/…/<이름>.app/Contents/MacOS/…` 인 첫 것의 `.app` 경로(다른 .app 안의 보조 앱은 건너뛴다). 모르면 빈 목록·null.
 */
export interface AgentHost {
  pids: number[]
  app: string | null
}

export interface AgentRow {
  pid: number
  tool: AgentTool
  worktree: WorktreeInfo | null
  workspace: WorkspaceInfo | null
  startedAt: number | null
  /** 자기 + 자손 중 개발 서버가 아닌 것. */
  memoryBytes: number
  /** 같은 프로세스의 커밋 합. 하나도 모르면 null(일부만 알면 아는 것의 합). */
  commitBytes: number | null
  descendantCount: number
  /** 메모리에 센 프로세스(자기 포함)를 이름별로 묶은 것(상세 패널). */
  processes: ProcessSummary[]
  state: AgentState
  /**
   * hook: 훅 이벤트로 안 상태, rollout: Codex 세션 기록으로 안 상태, file: Claude 실행 중 세션 파일로 안 상태
   * (작업 중·쉬는 중만), cpu: CPU 변화로 짐작한 상태.
   */
  stateSource: 'hook' | 'cpu' | 'rollout' | 'file'
  /**
   * 지금 상태가 시작된 시각. 훅 상태는 그 상태가 된 이벤트 시각, 세션 파일은 상태가 바뀐 시각(모르면 CPU 추정처럼),
   * CPU 추정은 pitwall 이 그 상태를 처음 본 시각. 아직 판단하지 못했으면(unknown) null.
   */
  stateSince: number | null
  /** 지난 샘플 이후 하위 트리 CPU 사용률(코어 1개 = 100). 모르면 null. */
  cpuPercent: number | null
  /**
   * 마지막 활동 시각(G2). 훅은 그 프로세스 세션의 마지막 활동 이벤트(60초 뒤의 idle 알림은 활동이 아니다),
   * Codex 세션 기록은 마지막 이벤트, 세션 파일은 상태가 바뀐 시각(작업 중이면 수집 시각), CPU 추정은 pitwall 이
   * 마지막으로 작업 중으로 본 시각(본 적 없으면 처음 본 시각). CPU 를 읽지 못해 확인 중인 CPU 추정과
   * 수집기가 채우기 전에는 null.
   */
  lastActiveAt: number | null
  /** 오래 쉬는 세션: 쉬는 중·오류·확인 중이고 마지막 활동이 기준 시간(설정 agentParkedMinutes) 이상 전. */
  parked: boolean
  /** 하는 일(G3b). 설정 showAgentActivity 가 꺼져 있거나 아는 것이 없으면 null. */
  activity: AgentActivity | null
  /**
   * 조용해진 시각(G3c): 훅으로 작업 중인데 이벤트가 없고 트리 CPU 가 작업 기준 아래인 채 15분이 지났으면 그 상태가
   * 시작된 시각(마지막 이벤트와 pitwall 이 CPU 가 낮은 것을 처음 본 때 가운데 늦은 쪽). 아니면 null.
   * 멈췄다고 단정하지 않는다(오래 걸리는 명령을 기다리는 중일 수도 있다).
   */
  quietSince: number | null
  /** 에이전트가 떠 있는 터미널·에디터 창을 찾을 단서(G3f 창으로 가기). */
  host: AgentHost
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

/** Codex 훅 연동 상태(F7). on 이어도 Codex 의 /hooks 에서 승인해야 이벤트가 온다. */
export interface CodexHookStatus {
  state: ClaudeHookState
  problem: 'server' | 'settings' | null
  /** hooks.json 경로. */
  path: string
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
  /** 설정에서 숨긴 서버(개수·판단·추천·알림·트레이에 넣지 않는다). */
  hiddenServers: ServerRow[]
  leftovers: LeftoverRow[]
  /** 무거운 작업(설정의 명령 패턴). 메모리 큰 순. */
  heavyJobs: HeavyJobRow[]
  /** 무거운 작업이 2개 이상 겹치고 RAM 이 경고 기준 이상. */
  heavyOverlap: boolean
  agents: AgentRow[]
  /** Claude 훅 연동 상태. 아직 모르면 null. */
  hook: ClaudeHookStatus | null
  /** Codex 훅 연동 상태. 아직 모르면 null. */
  codexHook: CodexHookStatus | null
  /** 디스크 정리(끝난 워크트리의 의존성 폴더). 아직 찾지 않았으면 null. */
  disk: DiskReport | null
  groups: GroupUsage[]
  /** 다른 앱 전부(이름별, 메모리 큰 순). */
  apps: AppUsage[]
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
  /**
   * link: 폴더 자체가 링크(정션·심볼릭 링크)라, unreadable: 읽을 수 없어,
   * tracked: git 이 무시하지 않는 폴더(저장소에 올라간 소스일 수 있음)라 지우지 않는다.
   */
  skipped?: 'link' | 'unreadable' | 'tracked'
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
  /** 같은 프로세스의 커밋 합. 하나도 모르면 null(일부만 알면 아는 것의 합). */
  commitBytes: number | null
  descendantPids: number[]
  /** 자기 + 자손을 이름별로 묶은 것(상세 패널). */
  processes: ProcessSummary[]
  startedAt: number | null
}
