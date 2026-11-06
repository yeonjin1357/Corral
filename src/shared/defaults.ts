/** RAM 사용률(%) 단계 기본값. 3단계 설정 화면에서 바꿀 수 있게 된다. */
export const DEFAULT_THRESHOLDS = { ramWarnPercent: 80, ramDangerPercent: 90 } as const

/** 수집 주기 기본값(갱신 주기 "보통"). */
export const DEFAULT_INTERVALS = { openMs: 5000, closedMs: 30000 } as const

/** OS 명령 하나가 이 시간을 넘기면 실패로 본다. */
/** 안 쓰는 포트 기준 시간(스펙 기본 20분). */
export const DEFAULT_IDLE_PORT_MS = 20 * 60 * 1000

export const COMMAND_TIMEOUT_MS = 15000
