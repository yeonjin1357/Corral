import type {
  ClaudeHookStatus,
  CodexHookStatus,
  ConfirmRequest,
  DashboardSnapshot,
  DiskReport,
  GroupPoint,
  KillResult,
  TrendPoint,
  UpdateStatus
} from './types'
import type { Settings } from './settings'
import type { PitEvent } from './events'

/** 메인 ↔ 렌더러 IPC 채널 이름. */
export const IPC = {
  snapshot: 'pitwall:snapshot',
  getLatest: 'pitwall:get-latest',
  historyRam: 'pitwall:history-ram',
  historyGroups: 'pitwall:history-groups',
  trayAction: 'pitwall:tray-action',
  killServer: 'pitwall:kill-server',
  killLeftover: 'pitwall:kill-leftover',
  killMany: 'pitwall:kill-many',
  cleanupWorkspace: 'pitwall:cleanup-workspace',
  diskScan: 'pitwall:disk-scan',
  diskRemove: 'pitwall:disk-remove',
  diskRemoveAll: 'pitwall:disk-remove-all',
  refreshNow: 'pitwall:refresh-now',
  openPort: 'pitwall:open-port',
  quick: 'pitwall:quick',
  focusAgent: 'pitwall:focus-agent',
  claudeHookStatus: 'pitwall:claude-hook-status',
  claudeHookEnable: 'pitwall:claude-hook-enable',
  claudeHookDisable: 'pitwall:claude-hook-disable',
  codexHookStatus: 'pitwall:codex-hook-status',
  codexHookEnable: 'pitwall:codex-hook-enable',
  codexHookDisable: 'pitwall:codex-hook-disable',
  settingsGet: 'pitwall:settings-get',
  settingsSave: 'pitwall:settings-save',
  settingsPickFolder: 'pitwall:settings-pick-folder',
  settingsChanged: 'pitwall:settings-changed',
  navigate: 'pitwall:navigate',
  appInfo: 'pitwall:app-info',
  fileIcon: 'pitwall:file-icon',
  updateGet: 'pitwall:update-get',
  updateCheck: 'pitwall:update-check',
  updateInstall: 'pitwall:update-install',
  updateCopyCommand: 'pitwall:update-copy-command',
  updateChanged: 'pitwall:update-changed',
  eventsGet: 'pitwall:events-get',
  eventsAdded: 'pitwall:events-added',
  /** 메인 → 화면: 이 내용으로 물어봐 줘(ConfirmRequest). */
  confirmRequest: 'pitwall:confirm-request',
  /** 화면 → 메인: 그 요청을 그렸다(id). */
  confirmShown: 'pitwall:confirm-shown',
  /** 화면 → 메인: 누른 버튼 번호(id, index). */
  confirmReply: 'pitwall:confirm-reply',
  /** 화면 → 메인: 아직 답이 없는 요청(→ ConfirmRequest[]). */
  confirmPending: 'pitwall:confirm-pending',
  /** 메인 → 화면: 그 요청을 거둔다(id) — OS 창으로 넘겼거나 취소해 더는 화면에서 답할 수 없다. */
  confirmWithdraw: 'pitwall:confirm-withdraw'
} as const

/** 바로 가기(G3f): 경로 복사·폴더 열기·터미널 열기. */
export type QuickKind = 'copy' | 'folder' | 'terminal'

/** 알림·트레이에서 창을 열며 보여 줄 곳. key 는 목록 선택 키(null 이면 한눈에 보기). */
export type NavigateTarget = { page: 'dashboard'; key: string | null } | { page: 'settings' }

/** Claude 연동 켜기·끄기 결과. 취소하면 메시지 없음. */
export type ClaudeHookActionResult =
  | { status: 'done'; message: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

/** preload 가 렌더러의 window.pitwall 로 노출하는 API. */
export interface PitwallApi {
  /** 새 스냅샷이 올 때마다 호출된다. 반환 함수로 구독을 끊는다. */
  onSnapshot(callback: (snapshot: DashboardSnapshot) => void): () => void
  /** 창이 늦게 열려 앞선 스냅샷을 놓쳤을 때 마지막 스냅샷을 가져온다. */
  getLatest(): Promise<DashboardSnapshot | null>
  /** 트레이 요약 창에서: 앱 열기·설정·종료·창 숨기기·항목 열기(item 은 선택 키). */
  tray: {
    action(kind: 'open' | 'settings' | 'quit' | 'hide' | 'item', key?: string): Promise<void>
  }
  /** 앱이 기억한 RAM 사용률 추이(30초 간격·2시간, 다시 켜도 이어짐). */
  historyRam(): Promise<TrendPoint[]>
  /** 앱이 기억한 묶음별 메모리 추이(G6, RAM 추이와 같이 30초 간격·2시간). */
  historyGroups(): Promise<GroupPoint[]>
  killServer(pid: number): Promise<KillResult>
  /** 주인 없이 남은 프로세스를 끈다(메인에서 확인 창). */
  killLeftover(pid: number): Promise<KillResult>
  /** 정리 추천 중 고른 것(선택 키)을 확인 창 하나로 끈다. */
  killMany(keys: string[]): Promise<KillResult>
  /** 작업 공간의 서버·남은 프로세스를 확인 창 한 번으로 끈다. */
  cleanupWorkspace(root: string): Promise<KillResult>
  /** 디스크 정리: 끝난 워크트리를 다시 찾고 크기를 잰다(끝날 때까지 기다린다). */
  diskScan(): Promise<DiskReport | null>
  /** 끝난 워크트리의 의존성 폴더를 지운다(메인에서 확인 창). */
  diskRemove(worktreeRoot: string): Promise<KillResult>
  /** 모두 정리: 사용 중이 아닌 워크트리의 의존성 폴더를 확인 창 하나로 지운다(검색과 상관없이 전부). */
  diskRemoveAll(): Promise<KillResult>
  /** 다음 주기를 기다리지 않고 지금 수집한다(끝날 때까지 기다린다). */
  refreshNow(): Promise<void>
  /** 목록에 있는 개발 서버 포트를 기본 브라우저로 연다. 열었으면 true. */
  openPort(port: number): Promise<boolean>
  /**
   * 바로 가기: 그 폴더의 경로를 복사하거나 탐색기(Finder)·터미널로 연다. 메인은 지금 스냅샷에 있는 폴더만 다룬다
   * (path 는 찾는 열쇠일 뿐 그대로 열지 않는다). 했으면 true.
   */
  quick(kind: QuickKind, path: string): Promise<boolean>
  /**
   * 창으로 가기: 그 에이전트(선택 키)가 떠 있는 터미널·에디터 창을 앞으로 가져온다. 메인은 지금 스냅샷의 에이전트만 다룬다.
   * 창을 찾지 못했거나 OS 가 거절하면 false.
   */
  focusAgent(key: string): Promise<boolean>
  /** Claude 훅 연동. 켜기·끄기는 메인에서 설정 파일 경로와 백업을 알리는 확인 창을 띄운다. */
  claudeHook: {
    status(): Promise<ClaudeHookStatus | null>
    enable(): Promise<ClaudeHookActionResult>
    disable(): Promise<ClaudeHookActionResult>
  }
  /** Codex 훅 연동(hooks.json). 켠 뒤 Codex 의 /hooks 에서 한 번 승인해야 이벤트가 온다. */
  codexHook: {
    status(): Promise<CodexHookStatus | null>
    enable(): Promise<ClaudeHookActionResult>
    disable(): Promise<ClaudeHookActionResult>
  }
  /**
   * 앱 버전(설정 > 정보)과 앱(메인)이 시작된 시각(ms). 시작 시각은 창을 숨긴 적이 없을 때 자리 비운 사이(G3g)의 기준이다
   * (트레이로만 시작한 뒤 창을 처음 열 때).
   */
  appInfo(): Promise<{ version: string; startedAt: number }>
  /** 스냅샷에 나온 실행 파일의 OS 앱 아이콘(PNG 데이터 주소). 없으면 null. */
  fileIcon(path: string): Promise<string | null>
  /** 새 버전 확인(설정 > 정보). */
  update: {
    get(): Promise<UpdateStatus | null>
    check(): Promise<UpdateStatus | null>
    /**
     * Windows: 받아 둔 새 버전을 설치하려고 다시 시작한다. macOS 설치본: 새 버전을 내려받아 앱을 바꿔 넣고 다시 켠다
     * (실패하면 상태의 error 에 까닭이 담기고 앱은 그대로다).
     */
    install(): Promise<void>
    /** macOS 설치본: 설치 한 줄을 클립보드에 복사한다. 복사했으면 true. */
    copyCommand(): Promise<boolean>
    onChange(callback: (status: UpdateStatus) => void): () => void
  }
  /** 기록(G3g): 메인이 기억한 일어난 일(최근 300개·24시간, 다시 켜도 이어짐). */
  events: {
    get(): Promise<PitEvent[]>
    /** 새 기록이 생길 때마다 호출된다. 반환 함수로 구독을 끊는다. */
    onAdded(callback: (events: PitEvent[]) => void): () => void
  }
  /** 알림·트레이에서 특정 화면으로 가라고 할 때 호출된다. 반환 함수로 구독을 끊는다. */
  onNavigate(callback: (target: NavigateTarget) => void): () => void
  /**
   * 확인 창: 메인이 묻고(끄기·지우기·연동 바꾸기) 화면은 그려서 누른 버튼 번호만 돌려준다.
   * 그렸다고 알리지(shown) 않으면 메인이 OS 확인 창으로 대신 묻는다. 메인 창에서만 쓴다.
   */
  confirm: {
    /** 메인이 물어볼 때 호출된다. 반환 함수로 구독을 끊는다. */
    onRequest(callback: (request: ConfirmRequest) => void): () => void
    /** 메인이 그 요청을 거둘 때(OS 창으로 넘김·취소) 호출된다. 답하지 말고 닫는다. 반환 함수로 구독을 끊는다. */
    onWithdraw(callback: (id: number) => void): () => void
    /** 아직 답이 없는 요청(처음 그려질 때·다시 로드됐을 때 받아 간다). */
    pending(): Promise<ConfirmRequest[]>
    /** 그 요청을 화면에 그렸다. */
    shown(id: number): void
    /** 누른 버튼 번호(Esc 는 cancelId). */
    reply(id: number, index: number): void
  }
  /** 사용자 설정. 저장하면 메인이 범위를 고쳐 저장·반영한 값을 돌려준다. */
  settings: {
    get(): Promise<Settings>
    save(next: Settings): Promise<Settings>
    /** 폴더 고르기 창(추가 저장소). 취소하면 null. */
    pickFolder(): Promise<string | null>
    /** 다른 곳(트레이 등)에서 설정이 바뀌면 호출된다. 반환 함수로 구독을 끊는다. */
    onChange(callback: (settings: Settings) => void): () => void
  }
}
