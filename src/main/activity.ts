import type { AgentRow } from '../shared/types'
import { agentKey } from '../shared/keys'

/**
 * 에이전트의 마지막 활동과 오래 쉬는 세션(G2). 정확한 시각(훅·세션 기록)이 없을 때를 위해 pitwall 이 직접 본 것을
 * 기억한다: 에이전트를 처음 본 시각과 마지막으로 작업 중으로 본 시각. 키는 agentKey(`pid:시작 시각`).
 */
export type SeenMemo = Map<string, { firstSeen: number; lastWorking: number | null }>

/** 이번에 본 에이전트로 기억을 새로 한다. 지금 있는 에이전트만 남긴다. */
export function trackSeen(
  agents: Pick<AgentRow, 'pid' | 'startedAt' | 'state'>[],
  previous: SeenMemo,
  now: number
): SeenMemo {
  const next: SeenMemo = new Map()
  for (const a of agents) {
    const key = agentKey(a)
    const prev = previous.get(key)
    next.set(key, {
      firstSeen: prev?.firstSeen ?? now,
      lastWorking: a.state === 'working' ? now : (prev?.lastWorking ?? null)
    })
  }
  return next
}

/**
 * 마지막 활동 시각. 훅·세션 기록·세션 파일로 아는 상태는 그 정확한 시각(exact, 없으면 본 기록), CPU 추정은 pitwall 이
 * 마지막으로 작업 중으로 본 시각이고 본 적이 없으면 처음 본 시각(그 전은 모르므로 보수적으로).
 * CPU 를 읽지 못해 확인 중(unknown)인 CPU 추정은 근거가 없어 null(오래 쉬는 세션으로 보지 않는다).
 */
export function lastActiveOf(
  agent: Pick<AgentRow, 'stateSource' | 'state'>,
  exact: number | null,
  seen: { firstSeen: number; lastWorking: number | null }
): number | null {
  const observed = seen.lastWorking ?? seen.firstSeen
  if (agent.stateSource !== 'cpu') return exact ?? observed
  return agent.state === 'unknown' ? null : observed
}

/**
 * 오래 쉬는 세션: 쉬는 중·오류·확인 중이고 마지막 활동이 기준 시간(parkedMs) 이상 전.
 * 작업 중·권한 대기는 아무리 오래여도 아니다. 마지막 활동을 모르면 아니다.
 */
export function isParked(
  agent: Pick<AgentRow, 'state' | 'lastActiveAt'>,
  now: number,
  parkedMs: number
): boolean {
  const resting = agent.state === 'idle' || agent.state === 'error' || agent.state === 'unknown'
  return resting && agent.lastActiveAt != null && now - agent.lastActiveAt >= parkedMs
}
