import type { AgentRow } from '../shared/types'
import { agentKey } from '../shared/keys'
import { WORKING_CPU_PERCENT } from './agents'

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
 * 작업 중·응답 대기는 아무리 오래여도 아니다. 마지막 활동을 모르면 아니다.
 */
export function isParked(
  agent: Pick<AgentRow, 'state' | 'lastActiveAt'>,
  now: number,
  parkedMs: number
): boolean {
  const resting = agent.state === 'idle' || agent.state === 'error' || agent.state === 'unknown'
  return resting && agent.lastActiveAt != null && now - agent.lastActiveAt >= parkedMs
}

/** 조용한 에이전트(G3c)로 보는 시간. */
export const QUIET_MS = 15 * 60 * 1000

/** 에이전트별 조용한 조건(calm)이 이어진 첫 시각(pitwall 이 처음 본 때). 키는 agentKey. 저장하지 않는다. */
export type CalmMemo = Map<string, number>

/**
 * 조용한 조건: 훅으로 작업 중이고 트리 CPU 가 작업 기준(WORKING_CPU_PERCENT) 아래. CPU 를 모르면 아니다.
 * CPU 추정·세션 기록·세션 파일 상태와 쉬는 중·응답 대기는 아니다.
 */
function isCalm(agent: Pick<AgentRow, 'stateSource' | 'state' | 'cpuPercent'>): boolean {
  return (
    agent.stateSource === 'hook' &&
    agent.state === 'working' &&
    agent.cpuPercent != null &&
    agent.cpuPercent < WORKING_CPU_PERCENT
  )
}

/**
 * 조용한 에이전트(G3c)를 채운다. 조용한 조건이 이어진 첫 시각과 마지막 이벤트(lastActiveAt) 가운데 늦은 쪽부터
 * QUIET_MS 이상이면 quietSince 는 그 시각. 조건이 끊기면(CPU 를 씀·모름, 상태가 바뀜) 기억에서 빼고 처음부터 센다.
 * 기억에는 지금 조건이 이어지는 에이전트만 남긴다.
 */
export function trackQuiet(
  agents: AgentRow[],
  previous: CalmMemo,
  now: number
): { agents: AgentRow[]; memo: CalmMemo } {
  const memo: CalmMemo = new Map()
  const rows = agents.map((a): AgentRow => {
    if (!isCalm(a)) return { ...a, quietSince: null }
    const key = agentKey(a)
    const calm = previous.get(key) ?? now
    memo.set(key, calm)
    const start = Math.max(calm, a.lastActiveAt ?? calm)
    return { ...a, quietSince: now - start >= QUIET_MS ? start : null }
  })
  return { agents: rows, memo }
}

/**
 * 수집 사이(훅 이벤트가 왔을 때)의 조용함: 그 뒤 새 이벤트가 왔거나(lastActiveAt > quietSince) 더는 조용한 조건이
 * 아니면 null, 아니면 그대로. 새로 붙이는 것은 다음 수집(trackQuiet)이 한다.
 */
export function stillQuiet(
  agent: Pick<AgentRow, 'stateSource' | 'state' | 'cpuPercent' | 'lastActiveAt' | 'quietSince'>
): number | null {
  const { quietSince, lastActiveAt } = agent
  if (quietSince == null || !isCalm(agent)) return null
  return lastActiveAt != null && lastActiveAt > quietSince ? null : quietSince
}
