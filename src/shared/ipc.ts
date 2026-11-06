import type { DashboardSnapshot, KillResult } from './types'

/** 메인 ↔ 렌더러 IPC 채널 이름. */
export const IPC = {
  snapshot: 'pitwall:snapshot',
  getLatest: 'pitwall:get-latest',
  killPort: 'pitwall:kill-port'
} as const

/** preload 가 렌더러의 window.pitwall 로 노출하는 API. */
export interface PitwallApi {
  /** 새 스냅샷이 올 때마다 호출된다. 반환 함수로 구독을 끊는다. */
  onSnapshot(callback: (snapshot: DashboardSnapshot) => void): () => void
  /** 창이 늦게 열려 앞선 스냅샷을 놓쳤을 때 마지막 스냅샷을 가져온다. */
  getLatest(): Promise<DashboardSnapshot | null>
  killPort(port: number, pid: number): Promise<KillResult>
}
