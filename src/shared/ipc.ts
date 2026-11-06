import type { ClaudeHookStatus, DashboardSnapshot, KillResult } from './types'

/** 메인 ↔ 렌더러 IPC 채널 이름. */
export const IPC = {
  snapshot: 'pitwall:snapshot',
  getLatest: 'pitwall:get-latest',
  killPort: 'pitwall:kill-port',
  killLeftover: 'pitwall:kill-leftover',
  refreshNow: 'pitwall:refresh-now',
  openPort: 'pitwall:open-port',
  claudeHookStatus: 'pitwall:claude-hook-status',
  claudeHookEnable: 'pitwall:claude-hook-enable',
  claudeHookDisable: 'pitwall:claude-hook-disable'
} as const

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
}
