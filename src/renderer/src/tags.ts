import type { AgentState } from '../../shared/types'

/** Uptime Kuma (MIT) src/components/TagsManager.vue 의 기본 태그 색. */
export const TAG_COLORS = {
  grey: '#4B5563',
  red: '#DC2626',
  orange: '#D97706',
  green: '#059669',
  blue: '#2563EB',
  indigo: '#4F46E5'
} as const

export interface ItemTag {
  text: string
  color: string
}

/** 에이전트 상태별 알약 색(Uptime Kuma Uptime.vue: up 초록·pending 주황·down 빨강·그 밖 회색). */
export const AGENT_PILL: Record<AgentState, string> = {
  working: 'bg-primary',
  waiting: 'bg-warning',
  idle: 'bg-secondary',
  error: 'bg-danger',
  unknown: 'bg-secondary'
}

export const AGENT_TAG: Record<AgentState, string> = {
  working: TAG_COLORS.green,
  waiting: TAG_COLORS.orange,
  idle: TAG_COLORS.grey,
  error: TAG_COLORS.red,
  unknown: TAG_COLORS.grey
}
