import type {
  ClaudeHookStatus,
  DashboardSnapshot,
  DiskReport,
  KillResult,
  UpdateStatus
} from './types'
import type { Settings } from './settings'

/** 메인 ↔ 렌더러 IPC 채널 이름. */
export const IPC = {
  snapshot: 'pitwall:snapshot',
  getLatest: 'pitwall:get-latest',
  killPort: 'pitwall:kill-port',
  killLeftover: 'pitwall:kill-leftover',
  killMany: 'pitwall:kill-many',
  diskScan: 'pitwall:disk-scan',
  diskRemove: 'pitwall:disk-remove',
  refreshNow: 'pitwall:refresh-now',
  openPort: 'pitwall:open-port',
  claudeHookStatus: 'pitwall:claude-hook-status',
  claudeHookEnable: 'pitwall:claude-hook-enable',
  claudeHookDisable: 'pitwall:claude-hook-disable',
  settingsGet: 'pitwall:settings-get',
  settingsSave: 'pitwall:settings-save',
  settingsPickFolder: 'pitwall:settings-pick-folder',
  settingsChanged: 'pitwall:settings-changed',
  navigate: 'pitwall:navigate',
  appInfo: 'pitwall:app-info',
  updateGet: 'pitwall:update-get',
  updateCheck: 'pitwall:update-check',
  updateInstall: 'pitwall:update-install',
  updateChanged: 'pitwall:update-changed'
} as const

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
  killPort(port: number, pid: number): Promise<KillResult>
  /** 주인 없이 남은 프로세스를 끈다(메인에서 확인 창). */
  killLeftover(pid: number): Promise<KillResult>
  /** 정리 추천 중 고른 것(선택 키)을 확인 창 하나로 끈다. */
  killMany(keys: string[]): Promise<KillResult>
  /** 디스크 정리: 끝난 워크트리를 다시 찾고 크기를 잰다(끝날 때까지 기다린다). */
  diskScan(): Promise<DiskReport | null>
  /** 끝난 워크트리의 의존성 폴더를 지운다(메인에서 확인 창). */
  diskRemove(worktreeRoot: string): Promise<KillResult>
  /** 다음 주기를 기다리지 않고 지금 수집한다(끝날 때까지 기다린다). */
  refreshNow(): Promise<void>
  /** 목록에 있는 개발 서버 포트를 기본 브라우저로 연다. 열었으면 true. */
  openPort(port: number): Promise<boolean>
  /** Claude 훅 연동. 켜기·끄기는 메인에서 설정 파일 경로와 백업을 알리는 확인 창을 띄운다. */
  claudeHook: {
    status(): Promise<ClaudeHookStatus | null>
    enable(): Promise<ClaudeHookActionResult>
    disable(): Promise<ClaudeHookActionResult>
  }
  /** 앱 버전 등(설정 > 정보). */
  appInfo(): Promise<{ version: string }>
  /** 새 버전 확인(설정 > 정보). */
  update: {
    get(): Promise<UpdateStatus | null>
    check(): Promise<UpdateStatus | null>
    /** Windows: 받아 둔 새 버전을 설치하려고 다시 시작한다. */
    install(): Promise<void>
    onChange(callback: (status: UpdateStatus) => void): () => void
  }
  /** 알림·트레이에서 특정 화면으로 가라고 할 때 호출된다. 반환 함수로 구독을 끊는다. */
  onNavigate(callback: (target: NavigateTarget) => void): () => void
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
