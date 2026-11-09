import { DEFAULT_SETTINGS, REFRESH_INTERVALS } from './settings'

/** RAM 사용률(%) 단계 기본값(설정 기본값과 같다). */
export const DEFAULT_THRESHOLDS = {
  ramWarnPercent: DEFAULT_SETTINGS.ramWarnPercent,
  ramDangerPercent: DEFAULT_SETTINGS.ramDangerPercent
} as const

/** 수집 주기 기본값(갱신 주기 "보통"). */
export const DEFAULT_INTERVALS = REFRESH_INTERVALS.normal

/** 안 쓰는 포트 기준 시간(스펙 기본 20분). */
export const DEFAULT_IDLE_PORT_MS = DEFAULT_SETTINGS.idlePortMinutes * 60 * 1000

/** OS 명령 하나가 이 시간을 넘기면 실패로 본다. */
export const COMMAND_TIMEOUT_MS = 15000
