import type { AgentTool, MemoryLevel } from './types'

/**
 * 기록(G3g)에 남는 일의 종류. 에이전트 시작·꺼짐·작업 끝남·권한 대기·오류·조용함, 서버 시작·꺼짐,
 * 무거운 작업 시작·끝, 메모리 단계 변화, 정리(끄기), 디스크 지움, 에이전트를 기다리게 함(G7).
 */
export const PIT_EVENT_KINDS = [
  'agent-start',
  'agent-end',
  'agent-done',
  'agent-waiting',
  'agent-error',
  'agent-quiet',
  'server-start',
  'server-end',
  'heavy-start',
  'heavy-end',
  'memory-level',
  'cleanup',
  'disk-remove',
  'heavy-defer'
] as const

export type PitEventKind = (typeof PIT_EVENT_KINDS)[number]

/**
 * 기록 한 줄. 내용(프롬프트·명령·세션 제목)과 전체 경로는 담지 않는다 — 종류·시각·폴더 이름·브랜치·숫자만.
 * 모르는 값은 넣지 않는다(화면은 없는 칸을 숨긴다).
 */
export interface PitEvent {
  /** 1부터 하나씩 는다(앱을 다시 켜도 이어서 센다). */
  id: number
  /** 일어난 시각(유닉스 ms). */
  t: number
  kind: PitEventKind
  tool?: AgentTool
  /** 폴더 이름 · 브랜치(worktreeLabel). */
  where?: string
  /** 포트 목록·무거운 작업 이름·지운 폴더 이름. */
  label?: string
  /** 그 항목이 아직 있으면 고를 수 있는 선택 키. */
  key?: string
  ms?: number
  bytes?: number
  count?: number
  percent?: number
  level?: MemoryLevel
  /** agent-end: 작업 중·권한 대기이던 것이 꺼짐. */
  abnormal?: boolean
}
